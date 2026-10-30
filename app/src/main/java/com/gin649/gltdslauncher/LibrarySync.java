package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Environment;

import com.gin649.gltdslauncher.database.GameDao;
import com.gin649.gltdslauncher.database.GameEntity;
import com.gin649.gltdslauncher.database.GameRepository;
import com.gin649.gltdslauncher.graphics.MiximageCompositor;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Keeps the Room database in step with the ROM scan, and answers questions about stored games. */
final class LibrarySync {

    private LibrarySync() {}

    /** "Super Mario World (USA) [!]" becomes "Super Mario World". */
    static String cleanTitle(String fileName) {
        if (fileName == null) return "";
        String t = fileName.replaceAll("\\([^)]*\\)|\\[[^\\]]*\\]", " ").replaceAll("\\s+", " ").trim();
        return t.isEmpty() ? fileName.trim() : t;
    }

    /**
     * Copies the ROM scan into the database. Does nothing when storage is not readable or the ROMs folder
     * is missing (an SD card that is out, say), so a failed scan can never wipe the library.
     */
    static void syncAll(Context ctx, RomIndex index, SystemMap map) {
        if (ctx == null || map == null || !index.isReady()) return;
        if (!Environment.isExternalStorageManager()) return;
        if (Config.ROMS_ROOT.isEmpty() || !new File(Config.ROMS_ROOT).isDirectory()) return;

        MediaFinder.reset();
        GameRepository repo = GameRepository.get(ctx);
        for (SystemMap.Sys s : map.all) {
            if (!s.dir().isDirectory()) continue; // not there right now: leave its rows alone
            List<GameRepository.ScannedRom> found = new ArrayList<GameRepository.ScannedRom>();
            for (RomIndex.Rom r : index.all()) {
                if (r.sys == s) found.add(new GameRepository.ScannedRom(cleanTitle(r.name), r.file.getPath()));
            }
            repo.syncSystem(s.folder, found);
        }
        linkEsdeMedia(ctx);
    }

    /**
     * Points games at art your frontend (ES-DE or Daijisho) already has, so none of it is fetched again, and lets
     * go of links whose file is gone or whose use was switched off in the wizard. Art this app built or downloaded
     * itself is only replaced when the frontend has fan art or a finished miximage for the game.
     */
    static void linkEsdeMedia(Context ctx) {
        GameDao dao = GameRepository.get(ctx).dao();
        boolean use = Config.useEsdeMedia();
        for (GameEntity g : dao.getAllGames()) {
            String cur = g.localMiximagePath;
            if (cur != null) {
                boolean fromFrontend = Config.isFrontendMedia(cur);
                if (!new File(cur).isFile() || (fromFrontend && !use)) {
                    dao.setMiximagePath(g.id, null);
                    cur = null;
                }
            }
            if (!use) continue;
            MediaFinder.Found f = MediaFinder.lookup(g.systemId, g.romPath);
            if (f.direct != null) {
                // a downloaded fan art you picked with a swipe stays; otherwise the frontend's picture is used
                if (!f.direct.equals(cur) && !FanArt.isGallery(ctx, cur)) dao.setMiximagePath(g.id, f.direct);
            } else if (cur != null && Config.isFrontendMedia(cur)) {
                // Only box art or a marquee is left of the frontend's. Let go of it so a miximage can be built or
                // fan art fetched; artFor() still shows it while there is nothing better.
                dao.setMiximagePath(g.id, null);
            }
        }
    }

    /**
     * Builds a miximage for a game from the screenshot, box art and marquee your frontend has for it, when there is no fan
     * art or finished miximage. Returns the new file's path, or null.
     */
    static final String BUILT_SUFFIX = ".built.jpg";

    static String buildMiximage(Context ctx, GameEntity g, MediaFinder.Found f) {
        if (g == null || f == null || !f.canBuild()) return null;
        Bitmap screen = MiximageCompositor.decodeFile(f.screen, 1600);
        Bitmap box = MiximageCompositor.decodeFile(f.box, 900);
        Bitmap logo = MiximageCompositor.decodeFile(f.logo, 900);
        try {
            // ".built.jpg" marks a miximage made from the frontend's pictures, so online fan art can still replace it
            File target = new File(DataStore.root(ctx), "miximages/" + g.systemId + "/" + g.id + BUILT_SUFFIX);
            File out = MiximageCompositor.createMiximage(screen, box, logo, target);
            if (out == null) return null;
            GameRepository.get(ctx).dao().setMiximagePath(g.id, out.getPath());
            return out.getPath();
        } finally {
            if (screen != null) screen.recycle();
            if (box != null) box.recycle();
            if (logo != null) logo.recycle();
        }
    }

    /**
     * The picture for the top screen from what is already on the device: frontend art in the order fan art, miximage,
     * built miximage, marquee, box art, otherwise whatever this app downloaded earlier. Null if there is none.
     */
    static String artFor(Context ctx, RomIndex.Rom rom) {
        GameEntity g = find(ctx, rom);
        String cur = g == null || g.localMiximagePath == null || !new File(g.localMiximagePath).isFile() ? null : g.localMiximagePath;
        String fallback = null;
        if (Config.useEsdeMedia()) {
            MediaFinder.Found f = MediaFinder.lookup(rom);
            if (f.direct != null) return FanArt.isGallery(ctx, cur) ? cur : f.direct; // a fan art you picked beats the frontend's
            if (f.canBuild()) {
                if (cur != null && !Config.isFrontendMedia(cur)) return cur;
                String built = buildMiximage(ctx, g, f);
                if (built != null) return built;
            }
            fallback = f.fallback;
        }
        if (cur != null && !Config.isFrontendMedia(cur)) return cur; // fetched or built here: better than box art
        return fallback != null ? fallback : cur;
    }

    /** The row for a ROM, or null. */
    static GameEntity find(Context ctx, RomIndex.Rom rom) {
        try {
            return GameRepository.get(ctx).dao().findByRom(rom.sys.folder, rom.file.getPath());
        } catch (Exception e) {
            return null;
        }
    }

    static void markPlayed(Context ctx, RomIndex.Rom rom) {
        try {
            GameEntity g = find(ctx, rom);
            if (g != null) GameRepository.get(ctx).markPlayed(g.id);
        } catch (Exception ignored) {
        }
    }
}
