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
 * 1. your frontend's own fan art or finished miximage
 * 2. fan art online: SteamGridDB (only with an API key), then LaunchBox
 * 3. a miximage built here from your frontend's screenshot, box art and marquee
 * 4. a miximage built here from LaunchBox's box art, screenshot and logo
 * 5. last of all, your frontend's marquee, then its box art (never stored, so a later run can still find better)
 */
final class LibraryScraper {

    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Set<Integer> QUEUED = Collections.synchronizedSet(new HashSet<Integer>());
    /** Games nothing had pictures for, so opening them again doesn't search again. */
    private static final Set<Integer> NO_ART = Collections.synchronizedSet(new HashSet<Integer>());
    /** Games with a built miximage that already had their online fan art search this session. */
    private static final Set<Integer> FAN_TRIED = Collections.synchronizedSet(new HashSet<Integer>());
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
        if (g == null) return;
        topUp(ctx, g);
        if (g.screenscraperId < 0 || NO_ART.contains(g.id)) return;
        boolean hasPicture = g.localMiximagePath != null && new File(g.localMiximagePath).isFile();
        // a miximage built from your frontend's pictures still gets one look for online fan art per session
        boolean builtOnly = hasPicture && g.localMiximagePath.endsWith(LibrarySync.BUILT_SUFFIX);
        if (hasPicture && !builtOnly) return;
        if (builtOnly && !FAN_TRIED.add(g.id)) return;
        if (Config.useEsdeMedia() && MediaFinder.lookup(rom).direct != null) return; // your frontend's own fan art or miximage
        if (!QUEUED.add(g.id)) return;
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    runBatch(ctx, Collections.singletonList(g));
                } finally {
                    QUEUED.remove(g.id);
                }
                topUp(ctx, GameRepository.get(ctx).dao().getById(g.id));
            }
        });
    }

    private static final Set<Integer> TOPPING = Collections.synchronizedSet(new HashSet<Integer>());
    private static final ExecutorService MORE = Executors.newSingleThreadExecutor();

    /** For a game open on the top screen that has a fan art: looks online for its other fan arts so they can be swiped through. */
    private static void topUp(final Context ctx, final GameEntity g) {
        if (g == null || g.localMiximagePath == null || !g.localMiximagePath.contains("/fanart/")) return;
        if (!TOPPING.add(g.id)) return;
        MORE.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    boolean sgdb = SteamGridDbClient.enabled(ctx) && System.currentTimeMillis() >= sgdbOffUntil;
                    FanArt.fillMore(ctx, g, sgdb);
                    if (g.id == viewingId) refreshTopScreen(ctx, g, g.localMiximagePath);
                } finally {
                    TOPPING.remove(g.id);
                }
            }
        });
    }

    /** The games of the current "Fetch game art" run: those in the tracker's Library and Backlog that have a ROM. */
    private static volatile int targetTotal;
    private static volatile int targetHadArt;

    /**
     * Fetches art for the games in the tracker (its Library and Backlog), not for every ROM in your folders. games is a
     * list of {title, console}; each is matched to its ROM the same way Play does. Does nothing if already running.
     */
    static void scrapeAll(final Context ctx, final List<String[]> games) {
        if (running) return;
        stopRequested = false;
        sgdbOffUntil = 0;
        NO_ART.clear();
        FAN_TRIED.clear();
        DONE.set(0);
        FAILED.set(0);
        message = "";
        running = true; // set now so a second tap can't start another run while the games are being matched
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    GameDao dao = GameRepository.get(ctx).dao();
                    dao.resetNoMatch(); // a manual run tries everything again, in case a key or a source was added
                    List<GameEntity> todo = new java.util.ArrayList<GameEntity>();
                    Set<Integer> seen = new HashSet<Integer>();
                    int had = 0;
                    for (String[] tg : games) {
                        if (stopRequested) return;
                        RomIndex.Rom rom = Shared.findRom(tg[0], tg[1]);
                        GameEntity g = rom == null ? null : LibrarySync.find(ctx, rom);
                        if (g == null || !seen.add(g.id)) continue;
                        boolean hasArt = g.localMiximagePath != null && new File(g.localMiximagePath).isFile();
                        if (hasArt && !g.localMiximagePath.endsWith(LibrarySync.BUILT_SUFFIX)) {
                            had++;
                        } else {
                            todo.add(g);
                        }
                    }
                    targetTotal = seen.size();
                    targetHadArt = had;
                    if (!todo.isEmpty()) runBatch(ctx, todo);
                    if (!stopRequested) message = "Finished.";
                } finally {
                    running = false;
                }
            }
        });
    }

    static String status(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            boolean sgdb = SteamGridDbClient.enabled(ctx);
            o.put("configured", sgdb || Config.LAUNCHBOX_ART || Config.useEsdeMedia());
            o.put("steamgriddb", sgdb);
            o.put("launchbox", Config.LAUNCHBOX_ART);
            o.put("running", running);
            o.put("done", DONE.get());
            o.put("failed", FAILED.get());
            o.put("games", targetTotal);
            o.put("withArt", Math.min(targetTotal, targetHadArt + DONE.get()));
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
        MediaFinder.Found f = null;
        String frontendFallback = null; // its box art or marquee, used only if nothing better turns up below
        if (Config.useEsdeMedia()) {
            f = MediaFinder.lookup(g.systemId, g.romPath);
            frontendFallback = f.fallback;
            if (f.direct != null) {
                dao.setMiximagePath(g.id, f.direct);
                return true;
            }
        }

        boolean offline = false;
        File target = new File(DataStore.root(ctx), "miximages/" + g.systemId + "/" + g.id + ".jpg");

        // 2. fan art online: SteamGridDB (with a key), then LaunchBox
        if (SteamGridDbClient.enabled(ctx) && System.currentTimeMillis() >= sgdbOffUntil) {
            try {
                List<String> heroes = SteamGridDbClient.heroUrls(ctx, g.title, 1);
                pause(API_PAUSE_MS);
                if (!heroes.isEmpty()) {
                    byte[] hero = SteamGridDbClient.download(heroes.get(0));
                    Bitmap b = hero == null ? null : MiximageCompositor.decode(hero, 1920);
                    if (b != null) {
                        try {
                            if (keepFan(ctx, g, heroes.get(0), b)) return true;
                        } finally {
                            b.recycle();
                        }
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
        if (Config.LAUNCHBOX_ART) {
            try {
                LaunchBoxArt.Art art = LaunchBoxArt.fetch(ctx, g.systemId, g.title, true);
                if (art != null) {
                    try {
                        List<String> files = LaunchBoxArt.fanFiles(ctx, g.systemId, g.title);
                        if (art.fan != null && !files.isEmpty() && keepFan(ctx, g, files.get(0), art.fan)) return true;
                    } finally {
                        art.recycle();
                    }
                }
            } catch (IOException e) {
                offline = true;
            }
        }

        // 3. no fan art anywhere: a miximage from your frontend's screenshot, box art and marquee
        if (f != null && f.canBuild()) {
            if (g.localMiximagePath != null && g.localMiximagePath.endsWith(LibrarySync.BUILT_SUFFIX)
                    && new File(g.localMiximagePath).isFile()) return true; // already built; nothing better was found
            String built = LibrarySync.buildMiximage(ctx, g, f);
            if (built != null) {
                if (g.id == viewingId) refreshTopScreen(ctx, g, built);
                return true;
            }
        }

        // 4. a miximage from LaunchBox's box art, screenshot and logo
        if (Config.LAUNCHBOX_ART) {
            try {
                LaunchBoxArt.Art art = LaunchBoxArt.fetch(ctx, g.systemId, g.title, false);
                if (art != null) {
                    try {
                        File out = MiximageCompositor.createMiximage(art.screen, art.box, art.logo, target);
                        if (out != null) {
                            dao.setMiximagePath(g.id, out.getPath());
                            if (g.id == viewingId) refreshTopScreen(ctx, g, out.getPath());
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

    /**
     * Saves a fan art picture into the game's set and makes it the one in use, unless the game already has a fan art
     * chosen (that choice stays). Returns whether the game now has fan art.
     */
    private static boolean keepFan(Context ctx, GameEntity g, String source, Bitmap b) {
        File added = FanArt.has(ctx, g, source) ? null : FanArt.add(ctx, g, source, b);
        List<File> all = FanArt.files(ctx, g);
        if (all.isEmpty()) return false;
        boolean chosen = g.localMiximagePath != null && g.localMiximagePath.contains("/fanart/")
                && new File(g.localMiximagePath).isFile();
        if (!chosen) {
            String path = (added != null ? added : all.get(0)).getPath();
            GameRepository.get(ctx).dao().setMiximagePath(g.id, path);
            g.localMiximagePath = path;
            if (g.id == viewingId) refreshTopScreen(ctx, g, path);
        }
        return true;
    }

    static void refreshTopScreen(Context ctx, GameEntity g, String path) {
        ArtBus.State cur = ArtBus.get();
        if (!cur.game || cur.gameId != 0 && cur.gameId != g.id) return;
        ArtBus.State n = new ArtBus.State();
        n.game = true;
        n.title = cur.title;
        n.console = cur.console;
        n.remoteUrl = cur.remoteUrl;
        n.localPath = path;
        n.gameId = g.id;
        FanArt.decorate(ctx, g, n);
        ArtBus.set(n);
    }
}
