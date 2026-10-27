package com.gin649.gltthor;

import android.content.Context;
import android.graphics.Bitmap;

import com.gin649.gltthor.database.GameDao;
import com.gin649.gltthor.database.GameEntity;
import com.gin649.gltthor.database.GameRepository;
import com.gin649.gltthor.graphics.MiximageCompositor;

import org.json.JSONObject;

import java.io.File;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Finds each game on ScreenScraper by title, downloads its screenshot, box art and logo, and builds the
 * flat miximage that the top screen shows. One game at a time, slowly, to stay inside ScreenScraper's limits.
 */
final class LibraryScraper {

    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Set<Integer> QUEUED = Collections.synchronizedSet(new HashSet<Integer>());
    /** Games ScreenScraper had no pictures for, so opening them again doesn't spend more of the daily limit. */
    private static final Set<Integer> NO_ART = Collections.synchronizedSet(new HashSet<Integer>());
    private static final AtomicInteger DONE = new AtomicInteger();
    private static final AtomicInteger FAILED = new AtomicInteger();
    private static final long API_PAUSE_MS = 1300;

    /** Library id of the game open in the tracker right now, 0 if none. */
    static volatile int viewingId;
    private static volatile boolean running;
    private static volatile boolean stopRequested;
    private static volatile String message = "";

    private LibraryScraper() {}

    /** Called when a game is opened in the tracker: remembers it and fetches its art if it has none yet. */
    static void requestFor(final Context ctx, RomIndex.Rom rom) {
        final GameEntity g = LibrarySync.find(ctx, rom);
        viewingId = g == null ? 0 : g.id;
        if (g == null || g.screenscraperId < 0 || NO_ART.contains(g.id)) return;
        if (Config.useEsdeMedia() && MediaFinder.find(rom) != null) return; // ES-DE already has art for it
        if (g.localMiximagePath != null && new File(g.localMiximagePath).isFile()) return;
        if (!QUEUED.add(g.id)) return;
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    runBatch(ctx, Collections.singletonList(g), false);
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
        NO_ART.clear();
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                GameDao dao = GameRepository.get(ctx).dao();
                Set<Integer> tried = new HashSet<Integer>();
                boolean more = true;
                while (more && !stopRequested) {
                    more = false;
                    List<GameEntity> batch = dao.getUnmatched(40);
                    batch.addAll(dao.getNeedingMiximage(40));
                    java.util.Iterator<GameEntity> it = batch.iterator();
                    while (it.hasNext()) {
                        if (!tried.add(it.next().id)) it.remove();
                    }
                    if (!batch.isEmpty()) {
                        more = true;
                        if (!runBatch(ctx, batch, true)) return; // stopped by a limit or a login problem
                    }
                }
                if (!stopRequested) message = "Finished.";
            }
        });
    }

    static void retryUnmatched(Context ctx) {
        try {
            GameRepository.get(ctx).dao().resetNoMatch();
        } catch (Exception ignored) {
        }
    }

    static String status(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            GameDao dao = GameRepository.get(ctx).dao();
            ScreenScraperClient.Settings s = ScreenScraperClient.load(ctx);
            o.put("configured", s.ready());
            o.put("hasLogin", !s.user.isEmpty());
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

    /** Returns false when the run should stop (limit reached, bad login, missing keys). */
    private static boolean runBatch(Context ctx, List<GameEntity> games, boolean countOnly) {
        ScreenScraperClient.Settings s = ScreenScraperClient.load(ctx);
        if (!s.ready()) {
            message = "ScreenScraper developer keys are missing. See the README (assets/screenscraper.json).";
            return false;
        }
        running = true;
        try {
            for (GameEntity g : games) {
                if (stopRequested) return false;
                try {
                    if (scrapeOne(ctx, s, g)) DONE.incrementAndGet();
                    else FAILED.incrementAndGet();
                } catch (ScreenScraperClient.LimitException e) {
                    message = e.getMessage();
                    return false;
                } catch (ScreenScraperClient.AuthException e) {
                    message = e.getMessage();
                    return false;
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

    private static boolean scrapeOne(Context ctx, ScreenScraperClient.Settings s, GameEntity g) throws Exception {
        GameDao dao = GameRepository.get(ctx).dao();
        if (Config.useEsdeMedia()) { // art ES-DE already downloaded is used as it is, nothing is fetched
            String esde = MediaFinder.find(g.systemId, g.romPath);
            if (esde != null) {
                dao.setMiximagePath(g.id, esde);
                return true;
            }
        }
        int systemId = s.systemId(g.systemId);
        if (systemId <= 0) {
            message = "No ScreenScraper system id for \"" + g.systemId + "\". Add it to screenscraper.json.";
            return false;
        }

        int ssId = g.screenscraperId;
        String canonical = null;
        if (ssId <= 0) {
            ScreenScraperClient.Match m = ScreenScraperClient.search(s, g.title, systemId);
            pause(API_PAUSE_MS);
            if (m == null) {
                dao.markNoMatch(g.id);
                return false;
            }
            ssId = m.id;
            canonical = m.name;
        }

        JSONObject info = ScreenScraperClient.gameInfo(s, ssId, systemId);
        pause(API_PAUSE_MS);
        if (info == null) {
            NO_ART.add(g.id);
            return false;
        }

        Bitmap shot = fetch(ScreenScraperClient.pickMedia(info, "fanart", "ss", "sstitle"), 1600);
        Bitmap box = fetch(ScreenScraperClient.pickMedia(info, "box-2D", "box-2D-front"), 900);
        Bitmap logo = fetch(ScreenScraperClient.pickMedia(info, "wheel-hd", "wheel", "marquee"), 900);
        try {
            File target = new File(ctx.getFilesDir(), "miximages/" + g.systemId + "/" + g.id + ".jpg");
            File out = MiximageCompositor.createMiximage(shot, box, logo, target);
            if (canonical != null || g.screenscraperId <= 0) {
                if (canonical == null || canonical.isEmpty()) canonical = g.title;
                dao.setScreenscraperMatch(g.id, ssId, canonical);
            }
            if (out == null) { // matched, but ScreenScraper had no usable pictures
                NO_ART.add(g.id);
                return false;
            }
            dao.setMiximagePath(g.id, out.getPath());
            if (g.id == viewingId) refreshTopScreen(out.getPath());
            return true;
        } finally {
            if (shot != null) shot.recycle();
            if (box != null) box.recycle();
            if (logo != null) logo.recycle();
        }
    }

    private static Bitmap fetch(String url, int maxSide) throws Exception {
        if (url == null) return null;
        byte[] data = ScreenScraperClient.download(url);
        pause(500);
        return MiximageCompositor.decode(data, maxSide);
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
