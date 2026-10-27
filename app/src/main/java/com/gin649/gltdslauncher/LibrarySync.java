package com.gin649.gltdslauncher;

import android.content.Context;
import android.os.Environment;

import com.gin649.gltdslauncher.database.GameDao;
import com.gin649.gltdslauncher.database.GameEntity;
import com.gin649.gltdslauncher.database.GameRepository;

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
     * Points games at art ES-DE already downloaded, so none of it is fetched again, and lets go of links whose
     * file is gone or whose use was switched off in the wizard. Art this app built itself is never touched.
     */
    static void linkEsdeMedia(Context ctx) {
        GameDao dao = GameRepository.get(ctx).dao();
        boolean use = Config.useEsdeMedia();
        String prefix = Config.MEDIA_ROOT.isEmpty() ? null : Config.MEDIA_ROOT + "/";
        for (GameEntity g : dao.getAllGames()) {
            String cur = g.localMiximagePath;
            if (cur != null) {
                boolean fromEsde = prefix != null && cur.startsWith(prefix);
                if (!new File(cur).isFile() || (fromEsde && !use)) {
                    dao.setMiximagePath(g.id, null);
                    cur = null;
                }
            }
            if (use && cur == null) {
                String art = MediaFinder.find(g.systemId, g.romPath);
                if (art != null) dao.setMiximagePath(g.id, art);
            }
        }
    }

    /** The row for a ROM, or null. */
    static GameEntity find(Context ctx, RomIndex.Rom rom) {
        try {
            return GameRepository.get(ctx).dao().findByRom(rom.sys.folder, rom.file.getPath());
        } catch (Exception e) {
            return null;
        }
    }

    /** Path of the built miximage for a ROM if the file still exists. */
    static String miximageFor(Context ctx, RomIndex.Rom rom) {
        GameEntity g = find(ctx, rom);
        if (g == null || g.localMiximagePath == null) return null;
        return new File(g.localMiximagePath).isFile() ? g.localMiximagePath : null;
    }

    static void markPlayed(Context ctx, RomIndex.Rom rom) {
        try {
            GameEntity g = find(ctx, rom);
            if (g != null) GameRepository.get(ctx).markPlayed(g.id);
        } catch (Exception ignored) {
        }
    }

    static String gamesJson(Context ctx, String systemId) {
        GameDao dao = GameRepository.get(ctx).dao();
        List<GameEntity> list = (systemId == null || systemId.isEmpty()) ? dao.getAllGames() : dao.getGamesBySystem(systemId);
        return GameRepository.toJson(list);
    }
}
