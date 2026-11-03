package com.gin649.gltdslauncher;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Time spent in games that aren't on RetroAchievements (which keeps its own playtime for the rest).
 * Counted while the game is on screen, stored on the device only, keyed by the game's system folder and ROM path.
 */
final class Playtime {

    private Playtime() {}

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences("gltplaytime", Context.MODE_PRIVATE);
    }

    static String key(RomIndex.Rom rom) {
        return rom.sys.folder + "/" + rom.rel;
    }

    static synchronized void add(Context c, String key, long ms) {
        if (key == null || key.isEmpty() || ms <= 0) return;
        SharedPreferences sp = p(c);
        sp.edit().putLong(key, sp.getLong(key, 0L) + ms).apply();
    }

    /** Seconds played so far. */
    static long seconds(Context c, String key) {
        return p(c).getLong(key, 0L) / 1000;
    }
}
