package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;

import com.gin649.gltdslauncher.database.GameDao;
import com.gin649.gltdslauncher.database.GameEntity;
import com.gin649.gltdslauncher.database.GameRepository;
import com.gin649.gltdslauncher.graphics.MiximageCompositor;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Gets the top-screen picture for each game, one game at a time, slowly. In order:
 * 1. your frontend's own art (ES-DE, Daijisho and the like): fan art, miximage, a miximage built here from its screenshot,
 *    box art and marquee
 * 2. SteamGridDB fan art (a hero banner), only when you gave an API key
 * 3. the free libretro thumbnails (box art, screenshot, logo), built into a miximage here
 * 4. last of all, your frontend's marquee, then its box art (never stored, so a later run can still find better)
 */
final class LibraryScraper {

    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Set<Integer> QUEUED = Collections.synchronizedSet(new HashSet<Integer>());
    /** Games nothing had pictures for, so opening them again doesn't search again. */
    private static final Set<Integer> NO_ART = Collections.synchronizedSet(new HashSet<Integer>());
    private static final AtomicInteger DONE = new AtomicInteger();
    private static final AtomicInteger FAILED = new AtomicInteger();
    private static final long API_PAUSE_MS = 700;
    private static final long OFF_MS = 30L * 60 * 1000;

    /** Library id of the game open in the tracker right now, 0 if none. */
    static volatile int viewingId;
    private static volatile boolean running;
    private static volatile boolean stopRequested;
    private static volatile String message = "";
    /** SteamGridDB said stop (limit or key); until this time only the other sources are used. */
    private static volatile long sgdbOffUntil;

    private LibraryScraper() {}

    /** Called when a game is opened in the tracker: remembers it and fetches its art if it has none yet. */
    static void requestFor(final Context ctx, RomIndex.Rom rom) {
        final GameEntity g = LibrarySync.find(ctx, rom);
        viewingId = g == null ? 0 : g.id;
        if (g == null || g.screenscraperId < 0 || NO_ART.contains(g.id)) return;
        if (g.localMiximagePath != null && new File(g.localMiximagePath).isFile()) return;
        if (Config.useEsdeMedia()) {
            MediaFinder.Found f = MediaFinder.lookup(rom);
            if (f.direct != null || f.canBuild()) return; // your frontend has something; LibrarySync.artFor handles it
        }
        if (!QUEUED.add(g.id)) return;
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    runBatch(ctx, Collections.singletonList(g));
                } finally {
                    QUEUED.remove(g.id);
                }
            }
        });
    }

    /** Fetches art for every game that has none. Does nothing if it is already running. */
    static void scrapeAll(final Context ctx) {
        if (running) return;
        stopRequested = false;
        sgdbOffUntil = 0;
        NO_ART.clear();
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                GameDao dao = GameRepository.get(ctx).dao();
                dao.resetNoMatch(); // a manual run tries everything again, in case a key or a source was added
                Set<Integer> tried = new HashSet<Integer>();
                boolean more = true;
                while (more && !stopRequested) {
                    more = false;
                    // games that fail stay in this query, so ask for enough rows to get past the ones already tried
                    int lim = 40 + tried.size();
                    List<GameEntity> batch = dao.getUnmatched(lim);
                    batch.addAll(dao.getNeedingMiximage(lim));
                    java.util.Iterator<GameEntity> it = batch.iterator();
                    while (it.hasNext()) {
                        if (!tried.add(it.next().id)) it.remove();
                    }
                    if (!batch.isEmpty()) {
                        more = true;
                        if (!runBatch(ctx, batch)) return;
                    }
                }
                if (!stopRequested) message = "Finished.";
            }
        });
    }

    static String status(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            GameDao dao = GameRepository.get(ctx).dao();
            boolean sgdb = SteamGridDbClient.enabled(ctx);
            o.put("configured", sgdb || Config.LIBRETRO_FALLBACK || Config.useEsdeMedia());
            o.put("steamgriddb", sgdb);
            o.put("libretro", Config.LIBRETRO_FALLBACK);
            o.put("running", running);
            o.put("done", DONE.get());
            o.put("failed", FAILED.get());
            o.put("games", dao.countAll());
            o.put("withArt", dao.countWithMiximage());
            o.put("usingEsdeMedia", Config.useEsdeMedia());
            o.put("message", message);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Returns false when the run should stop. */
    private static boolean runBatch(Context ctx, List<GameEntity> games) {
        running = true;
        try {
            for (GameEntity g : games) {
                if (stopRequested) return false;
                try {
                    if (scrapeOne(ctx, g)) DONE.incrementAndGet();
                    else FAILED.incrementAndGet();
                } catch (Exception e) {
                    FAILED.incrementAndGet();
                    message = "Could not fetch art for " + g.title + ": " + e.getMessage();
                }
            }
            return true;
        } finally {
            running = false;
        }
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static boolean scrapeOne(Context ctx, GameEntity g) throws Exception {
        GameDao dao = GameRepository.get(ctx).dao();

        // 1. what your frontend already has: nothing is downloaded for these
        String frontendFallback = null; // its box art or marquee, used only if nothing better turns up below
        if (Config.useEsdeMedia()) {
            MediaFinder.Found f = MediaFinder.lookup(g.systemId, g.romPath);
            frontendFallback = f.fallback;
            if (f.direct != null) {
                dao.setMiximagePath(g.id, f.direct);
                return true;
            }
            if (f.canBuild()) {
                String built = LibrarySync.buildMiximage(ctx, g, f);
                if (built != null) {
                    if (g.id == viewingId) refreshTopScreen(built);
                    return true;
                }
            }
        }

        boolean offline = false;
        File target = new File(ctx.getFilesDir(), "miximages/" + g.systemId + "/" + g.id + ".jpg");

        // 2. SteamGridDB fan art, if there is a key
        if (SteamGridDbClient.enabled(ctx) && System.currentTimeMillis() >= sgdbOffUntil) {
            try {
                byte[] hero = SteamGridDbClient.heroFor(ctx, g.title);
                pause(API_PAUSE_MS);
                Bitmap b = hero == null ? null : MiximageCompositor.decode(hero, 1920);
                if (b != null) {
                    try {
                        File out = MiximageCompositor.saveJpeg(b, target);
                        if (out != null) {
                            dao.setMiximagePath(g.id, out.getPath());
                            if (g.id == viewingId) refreshTopScreen(out.getPath());
                            return true;
                        }
                    } finally {
                        b.recycle();
                    }
                }
            } catch (SteamGridDbClient.AuthException e) {
                message = e.getMessage() + " Skipping SteamGridDB for now.";
                sgdbOffUntil = System.currentTimeMillis() + OFF_MS;
            } catch (SteamGridDbClient.LimitException e) {
                message = e.getMessage() + " Skipping SteamGridDB for now.";
                sgdbOffUntil = System.currentTimeMillis() + OFF_MS;
            } catch (IOException e) {
                offline = true;
            }
        }

        // 3. free libretro thumbnails, mixed into a miximage
        if (Config.LIBRETRO_FALLBACK) {
            try {
                String romName = new File(g.romPath).getName();
                int dot = romName.lastIndexOf('.');
                if (dot > 0) romName = romName.substring(0, dot);
                LibretroThumbs.Art art = LibretroThumbs.fetch(ctx, g.systemId, romName, g.title);
                if (art != null) {
                    try {
                        File out = MiximageCompositor.createMiximage(art.screen, art.box, art.logo, target);
                        if (out != null) {
                            dao.setMiximagePath(g.id, out.getPath());
                            if (g.id == viewingId) refreshTopScreen(out.getPath());
                            return true;
                        }
                    } finally {
                        art.recycle();
                    }
                }
            } catch (IOException e) {
                offline = true;
            }
        }

        NO_ART.add(g.id);
        if (!offline) dao.markNoMatch(g.id); // looked everywhere and found nothing; a manual "Fetch game art" tries again
        return frontendFallback != null; // the frontend's box art or marquee still shows (LibrarySync.artFor)
    }

    private static void refreshTopScreen(String path) {
        ArtBus.State cur = ArtBus.get();
        if (!cur.game) return;
        ArtBus.State n = new ArtBus.State();
        n.game = true;
        n.title = cur.title;
        n.console = cur.console;
        n.remoteUrl = cur.remoteUrl;
        n.localPath = path;
        ArtBus.set(n);
    }
}
