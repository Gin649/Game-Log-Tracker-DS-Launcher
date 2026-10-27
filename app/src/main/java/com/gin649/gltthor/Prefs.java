package com.gin649.gltthor;

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

    static void remove(Context c, String key) {
        p(c).edit().remove(key).apply();
    }
}
