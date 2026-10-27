package com.gin649.gltdslauncher;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.display.DisplayManager;
import android.view.Display;

/** Works out which display is the top screen: a saved choice, otherwise the one this app is not on. */
final class DisplayPicker {

    private DisplayPicker() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("gltthor", Context.MODE_PRIVATE);
    }

    static void save(Context c, int id) {
        if (id < 0) {
            prefs(c).edit().remove("topDisplay").apply();
        } else {
            prefs(c).edit().putInt("topDisplay", id).apply();
        }
    }

    @SuppressWarnings("deprecation")
    static int topDisplayId(Activity a) {
        DisplayManager dm = (DisplayManager) a.getSystemService(Context.DISPLAY_SERVICE);
        Display[] all = dm.getDisplays();

        int saved = prefs(a).getInt("topDisplay", -1);
        if (saved >= 0) {
            for (Display d : all) {
                if (d.getDisplayId() == saved) return saved;
            }
        }

        int self = a.getWindowManager().getDefaultDisplay().getDisplayId();
        for (Display d : all) {
            if (d.getDisplayId() == self) continue;
            if ((d.getFlags() & Display.FLAG_PRIVATE) != 0) continue;
            if (d.getState() == Display.STATE_OFF) continue;
            return d.getDisplayId();
        }
        return -1;
    }
}
