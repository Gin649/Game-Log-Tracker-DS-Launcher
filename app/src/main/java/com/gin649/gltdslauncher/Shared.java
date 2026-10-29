package com.gin649.gltdslauncher;

import android.content.Context;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** App-wide state: the system list, the ROM index, and the "game being viewed" lookups. */
final class Shared {

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final AtomicInteger VIEW_TOKEN = new AtomicInteger();
    private static final RomIndex INDEX = new RomIndex();
    private static SystemMap systems;
    private static Context appCtx;

    private Shared() {}

    static synchronized void init(Context ctx) {
        if (systems != null) return;
        appCtx = ctx.getApplicationContext();
        systems = SystemMap.load(ctx.getApplicationContext());
        rescan();
    }

    /** Re-read the system lists and rescan the ROM folders after the setup wizard changes something. */
    static synchronized void reload(Context ctx) {
        appCtx = ctx.getApplicationContext();
        systems = SystemMap.load(ctx.getApplicationContext());
        rescan();
    }

    static synchronized SystemMap systems() {
        return systems;
    }

    static RomIndex index() {
        INDEX.awaitReady(4000);
        return INDEX;
    }

    static void rescan() {
        final SystemMap map = systems();
        if (map == null) return;
        IO.execute(new Runnable() {
            @Override
            public void run() {
                INDEX.rebuild(map);
                try {
                    LibrarySync.syncAll(appCtx, INDEX, map);
                } catch (Exception ignored) {
                    // the database is a cache: a failed sync must never stop the app
                }
            }
        });
    }

    static RomIndex.Rom findRom(String title, String console) {
        INDEX.awaitReady(4000);
        SystemMap map = systems();
        if (map == null) return null;
        List<SystemMap.Sys> sys = map.forConsole(console);
        return Matcher.best(INDEX.forSystems(sys), title);
    }

    /** Resolve art for the game now open in the tracker and push it to the top screen. */
    static void showViewing(final String title, final String console, final String artUrl) {
        final int token = VIEW_TOKEN.incrementAndGet();
        IO.execute(new Runnable() {
            @Override
            public void run() {
                ArtBus.State s = new ArtBus.State();
                s.game = true;
                s.title = Matcher.display(title);
                s.console = console == null ? "" : console;
                s.remoteUrl = artUrl;
                RomIndex.Rom rom = findRom(title, console);
                LibraryScraper.viewingId = 0;
                if (rom != null) {
                    // your frontend's art in the order fan art, miximage, built miximage, marquee, box art; else what was downloaded
                    s.localPath = appCtx == null ? null : LibrarySync.artFor(appCtx, rom);
                    if (appCtx != null) {
                        com.gin649.gltdslauncher.database.GameEntity ge = LibrarySync.find(appCtx, rom);
                        s.gameId = ge == null ? 0 : ge.id;
                        FanArt.decorate(appCtx, ge, s);
                    }
                    if (appCtx != null) LibraryScraper.requestFor(appCtx, rom); // fetches art in the background if none yet
                }
                if (token == VIEW_TOKEN.get()) ArtBus.set(s);
            }
        });
    }

    /** Swipe on the top screen: switches the game on show to its next (1) or previous (-1) fan art. */
    static void swipeFan(final int delta) {
        final ArtBus.State cur = ArtBus.get();
        if (!cur.game || cur.gameId == 0 || cur.fanCount < 2 || appCtx == null) return;
        IO.execute(new Runnable() {
            @Override
            public void run() {
                com.gin649.gltdslauncher.database.GameEntity g =
                        com.gin649.gltdslauncher.database.GameRepository.get(appCtx).dao().getById(cur.gameId);
                if (g == null) return;
                String path = FanArt.step(appCtx, g, delta);
                if (path != null && ArtBus.get().gameId == cur.gameId) LibraryScraper.refreshTopScreen(appCtx, g, path);
            }
        });
    }

    static void showLogo() {
        VIEW_TOKEN.incrementAndGet();
        LibraryScraper.viewingId = 0;
        ArtBus.set(ArtBus.State.logo());
    }
}
