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

    /**
     * Where a game's time is kept. The "(Disc 1)" tag is left out, so a multi-disc game keeps one total whether it is
     * started from a disc or from its playlist. Time saved under the older name, with the tag, is moved over.
     */
    static synchronized String key(Context c, RomIndex.Rom rom) {
        String old = rom.sys.folder + "/" + rom.rel;
        String key = rom.sys.folder + "/" + RomIndex.discGame(rom.rel);
        if (!old.equals(key)) {
            SharedPreferences sp = p(c);
            long before = sp.getLong(old, 0L);
            if (before > 0) sp.edit().putLong(key, sp.getLong(key, 0L) + before).remove(old).apply();
        }
        return key;
    }

    /** Every game's time in milliseconds, as a JSON object, for the backup file. */
    static synchronized String exportJson(Context c) {
        org.json.JSONObject o = new org.json.JSONObject();
        try {
            for (java.util.Map.Entry<String, ?> e : p(c).getAll().entrySet()) {
                if (e.getValue() instanceof Long) o.put(e.getKey(), ((Long) e.getValue()).longValue());
            }
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Puts times from a backup back. A game keeps whichever is longer, the time here or the one in the backup. */
    static synchronized boolean importJson(Context c, String json) {
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            SharedPreferences sp = p(c);
            SharedPreferences.Editor ed = sp.edit();
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                long ms = o.optLong(k, 0L);
                if (k.isEmpty() || ms <= sp.getLong(k, 0L)) continue;
                ed.putLong(k, ms);
            }
            ed.apply();
            return true;
        } catch (Exception e) {
            return false;
        }
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
