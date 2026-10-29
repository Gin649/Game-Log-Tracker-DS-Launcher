package com.gin649.gltdslauncher.database;

import android.content.Context;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The one place the rest of the app talks to the database. All methods block, so call them from a
 * background thread (ThorBridge calls from JavaScript already are on one).
 */
public final class GameRepository {

    /** A ROM found on disk, in plain data so this package doesn't depend on RomIndex. */
    public static final class ScannedRom {
        public final String title;
        public final String romPath;

        public ScannedRom(String title, String romPath) {
            this.title = title;
            this.romPath = romPath;
        }
    }

    private static final int DELETE_CHUNK = 500; // stays well under SQLite's variable limit

    private static GameRepository instance;

    private final AppDatabase db;
    private final GameDao dao;

    private GameRepository(Context context) {
        db = AppDatabase.get(context);
        dao = db.gameDao();
    }

    public static synchronized GameRepository get(Context context) {
        if (instance == null) instance = new GameRepository(context.getApplicationContext());
        return instance;
    }

    public GameDao dao() {
        return dao;
    }

    /**
     * Make the table match what is on disk for one system: new files are added, files that are gone
     * are removed, and existing rows (favorites, play counts, art) are left alone.
     * Returns {added, removed}.
     */
    public int[] syncSystem(final String systemId, final List<ScannedRom> found) {
        final int[] result = new int[2];
        db.runInTransaction(new Runnable() {
            @Override
            public void run() {
                Set<String> onDisk = new HashSet<String>();
                for (ScannedRom r : found) {
                    onDisk.add(r.romPath);
                    if (dao.insertIfAbsent(GameEntity.scanned(r.title, r.romPath, systemId)) != -1) result[0]++;
                }
                List<Integer> gone = new ArrayList<Integer>();
                for (GameEntity g : dao.getGamesBySystem(systemId)) {
                    if (!onDisk.contains(g.romPath)) gone.add(g.id);
                }
                for (int i = 0; i < gone.size(); i += DELETE_CHUNK) {
                    dao.deleteByIds(gone.subList(i, Math.min(i + DELETE_CHUNK, gone.size())));
                }
                result[1] = gone.size();
            }
        });
        return result;
    }

    public void markPlayed(int id) {
        dao.incrementPlayCount(id);
    }
}
