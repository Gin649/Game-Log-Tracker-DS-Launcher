package com.gin649.gltdslauncher;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.view.Display;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Works out which display is the top screen and which is the bottom one, so they never end up swapped. */
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

    /** The display an activity is on. */
    @SuppressWarnings("deprecation")
    static int displayOf(Activity a) {
        return a.getWindowManager().getDefaultDisplay().getDisplayId();
    }

    /**
     * The two screens as {top, bottom}, or null when there is only one. The saved "Top screen" choice
     * wins; otherwise the larger screen is the top one. HDMI, cast and overlay displays don't count.
     */
    @SuppressWarnings("deprecation")
    private static int[] pair(Activity a) {
        DisplayManager dm = (DisplayManager) a.getSystemService(Context.DISPLAY_SERVICE);
        List<Display> real = new ArrayList<Display>();
        for (Display d : dm.getDisplays()) {
            if ((d.getFlags() & Display.FLAG_PRIVATE) != 0) continue;
            String name = d.getName() == null ? "" : d.getName().toLowerCase(Locale.ROOT);
            if (name.contains("hdmi") || name.contains("overlay") || name.contains("virtual")
                    || name.contains("wifi") || name.contains("cast")) continue;
            real.add(d);
        }
        if (real.size() < 2) return null;

        int saved = prefs(a).getInt("topDisplay", -1);
        if (saved >= 0) {
            for (Display top : real) {
                if (top.getDisplayId() != saved) continue;
                for (Display other : real) {
                    if (other.getDisplayId() != saved) return new int[]{saved, other.getDisplayId()};
                }
            }
        }

        Display first = real.get(0), second = real.get(1);
        Point p = new Point();
        first.getRealSize(p);
        long firstArea = (long) p.x * p.y;
        second.getRealSize(p);
        long secondArea = (long) p.x * p.y;
        if (secondArea > firstArea) return new int[]{second.getDisplayId(), first.getDisplayId()};
        return new int[]{first.getDisplayId(), second.getDisplayId()};
    }

    /** The two screens as {top, bottom}, or null with one screen or when "use one screen only" is on. */
    private static int[] screens(Activity a) {
        return singleScreen(a) ? null : pair(a);
    }

    /** True when the person turned on "use one screen only" in setup. */
    static boolean singleScreen(Context c) {
        return prefs(c).getBoolean("singleScreen", false);
    }

    /** "top" or "bottom": which screen of a two-screen device the app uses when it runs on one. */
    static String singleWhich(Context c) {
        return prefs(c).getString("singleWhich", "bottom");
    }

    static void saveSingle(Context c, boolean on, String which) {
        prefs(c).edit().putBoolean("singleScreen", on).putString("singleWhich", which).apply();
    }

    /** True when this device has two screens, whatever the single-screen setting says. */
    static boolean hasTwoScreens(Activity a) {
        return pair(a) != null;
    }

    /** The screen the app lives on when it runs on one screen of a two-screen device, else -1. */
    static int singleDisplayId(Activity a) {
        if (!singleScreen(a)) return -1;
        int[] p = pair(a);
        if (p == null) return -1;
        return "top".equals(singleWhich(a)) ? p[0] : p[1];
    }

    /** Where the tracker should open: the bottom screen, or the screen chosen for single-screen use. */
    static int trackerDisplayId(Activity a) {
        int bottom = bottomDisplayId(a);
        return bottom >= 0 ? bottom : singleDisplayId(a);
    }

    /** The screen the art and header go on, or -1 when there is only one screen. */
    static int topDisplayId(Activity a) {
        int[] s = screens(a);
        return s == null ? -1 : s[0];
    }

    /** The screen the tracker itself lives on, or -1 when there is only one screen. */
    static int bottomDisplayId(Activity a) {
        int[] s = screens(a);
        return s == null ? -1 : s[1];
    }
}
