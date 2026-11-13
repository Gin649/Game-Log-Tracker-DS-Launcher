package com.gin649.gltdslauncher;

import android.content.Context;
import android.content.SharedPreferences;

/** Everything the setup wizard saves. */
final class Prefs {

    private Prefs() {}

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences("gltthor", Context.MODE_PRIVATE);
    }

    static boolean setupDone(Context c) {
        return p(c).getBoolean("setupDone", false);
    }

    static void setSetupDone(Context c, boolean v) {
        p(c).edit().putBoolean("setupDone", v).apply();
    }

    static String get(Context c, String key, String def) {
        return p(c).getString(key, def);
    }

    static void put(Context c, String key, String value) {
        p(c).edit().putString(key, value).apply();
    }

    static int getInt(Context c, String key, int def) {
        return p(c).getInt(key, def);
    }

    static void putInt(Context c, String key, int value) {
        p(c).edit().putInt(key, value).apply();
    }

    /** Every saved setting, for backups and for clearing a group of keys. */
    static java.util.Map<String, ?> all(Context c) {
        return p(c).getAll();
    }

    /** Writes many settings in one go (a restored backup). Values are strings, numbers or true/false. */
    static void putAll(Context c, java.util.Map<String, Object> values) {
        SharedPreferences.Editor e = p(c).edit();
        for (java.util.Map.Entry<String, Object> v : values.entrySet()) {
            Object o = v.getValue();
            if (o instanceof Boolean) e.putBoolean(v.getKey(), (Boolean) o);
            else if (o instanceof Integer) e.putInt(v.getKey(), (Integer) o);
            else if (o instanceof Long) e.putLong(v.getKey(), (Long) o);
            else if (o instanceof Float) e.putFloat(v.getKey(), (Float) o);
            else if (o instanceof java.util.Set) {
                java.util.Set<String> set = new java.util.HashSet<String>();
                for (Object x : (java.util.Set<?>) o) set.add(String.valueOf(x));
                e.putStringSet(v.getKey(), set);
            }
            else if (o != null) e.putString(v.getKey(), String.valueOf(o));
        }
        e.commit();
    }

    static void remove(Context c, String key) {
        p(c).edit().remove(key).apply();
    }
}
