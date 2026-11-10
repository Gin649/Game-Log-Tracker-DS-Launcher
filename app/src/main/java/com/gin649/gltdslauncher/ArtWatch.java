package com.gin649.gltdslauncher;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;

import java.util.HashMap;
import java.util.Map;

/**
 * Puts the art screen back on the top screen after a game closes. Android sometimes shows its home
 * screen there instead, and nothing tells the app when another app closes, so after a game starts this
 * checks every few seconds (with Usage access) whether the emulator is still up. Without Usage access it
 * does nothing, so a running game is never interrupted by a guess.
 */
final class ArtWatch {

    private static final long POLL_MS = 2500;
    private static final long GRACE_MS = 12000;      // time for the emulator to appear
    private static final long NO_TAKEOVER_MS = 25000; // the game never covered the art screen
    private static final long MAX_WATCH_MS = 12L * 60 * 60 * 1000;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static Context app;
    private static String pkg;
    private static long startedAtElapsed;
    private static long startedAtWall;
    private static boolean sawCovered;
    private static int goneStreak;
    private static boolean active;
    private static String playKey;      // where this session's time is added, or null
    private static long lastTickElapsed;
    private static String lastForegroundPkg = "";

    private ArtWatch() {}

    @SuppressWarnings("deprecation")
    static boolean hasUsageAccess(Context c) {
        try {
            AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
            if (ops == null) return false;
            int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(), c.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    /** A game was just started in this emulator package. */
    static synchronized void start(Context context, String emulatorPackage) {
        start(context, emulatorPackage, null);
    }

    /** As above, and the time the game is on screen is added to Playtime under this key. */
    static synchronized void start(Context context, String emulatorPackage, String timeKey) {
        stop();
        if (emulatorPackage == null || emulatorPackage.isEmpty()) return;
        Context c = context.getApplicationContext();
        if (!hasUsageAccess(c)) return;
        app = c;
        pkg = emulatorPackage;
        startedAtElapsed = SystemClock.elapsedRealtime();
        lastTickElapsed = startedAtElapsed;
        playKey = timeKey;
        startedAtWall = System.currentTimeMillis();
        sawCovered = false;
        goneStreak = 0;
        active = true;
        MainActivity.lockForGame(true);
        MAIN.postDelayed(TICK, POLL_MS);
    }

    /** A game was started from here and has not closed yet (needs Usage access to be known). */
    static synchronized boolean gameRunning() {
        return active;
    }

    static synchronized void stop() {
        if (active) MainActivity.lockForGame(false);
        active = false;
        MAIN.removeCallbacks(TICK);
    }

    private static final Runnable TICK = new Runnable() {
        @Override
        public void run() {
            tick();
        }
    };

    private static synchronized void tick() {
        if (!active) return;
        long age = SystemClock.elapsedRealtime() - startedAtElapsed;
        if (age > MAX_WATCH_MS) {
            stop();
            return;
        }

        // The screen is off: the game is neither being played nor closed. Wait, and count none of this as playtime.
        if (!screenOn()) {
            lastTickElapsed = SystemClock.elapsedRealtime();
            MAIN.postDelayed(TICK, POLL_MS);
            return;
        }
        if (ArtActivity.resumed) {
            // Showing again: either it came back by itself, or the game never took the screen.
            if (sawCovered || age > NO_TAKEOVER_MS) {
                stop();
                return;
            }
            MAIN.postDelayed(TICK, POLL_MS);
            return;
        }

        sawCovered = true;
        long nowE = SystemClock.elapsedRealtime();
        long delta = nowE - lastTickElapsed;
        lastTickElapsed = nowE;
        if (delta > POLL_MS * 4) delta = POLL_MS; // a long gap means the device was asleep, not that you played
        if (age < GRACE_MS) {
            addPlay(delta);
            MAIN.postDelayed(TICK, POLL_MS);
            return;
        }

        if (gameOnScreen()) {
            goneStreak = 0;
            addPlay(delta);
        } else {
            goneStreak++;
        }
        if (goneStreak >= 2) { // gone on two checks in a row
            stop();
            // Another app in front (Chrome, Files...) means you moved on yourself: leave the screen alone. The art comes
            // back only when the game closed to the home screen or to a frontend.
            if (!otherAppInFront()) TopPanel.bringArtFront();
            return;
        }
        MAIN.postDelayed(TICK, POLL_MS);
    }

    /** True when the app that came to the front after the game is an ordinary app, not home, a frontend or us. */
    private static boolean otherAppInFront() {
        String f = lastForegroundPkg;
        if (f == null || f.isEmpty() || app == null) return false;
        if (f.equals(pkg) || f.equals(app.getPackageName())) return false;
        String l = f.toLowerCase();
        if (l.equals("android") || l.startsWith("com.android.systemui") || l.contains("launcher") || l.contains("home")
                || l.contains("es_de") || l.contains("esde") || l.contains("emulationstation") || l.contains("daijisho")
                || l.contains("beacon") || l.contains("frontend")) return false;
        try {
            android.content.Intent h = new android.content.Intent(android.content.Intent.ACTION_MAIN)
                    .addCategory(android.content.Intent.CATEGORY_HOME);
            android.content.pm.ResolveInfo r = app.getPackageManager().resolveActivity(h, 0);
            if (r != null && r.activityInfo != null && f.equals(r.activityInfo.packageName)) return false;
        } catch (Exception ignored) {
        }
        return true;
    }

    private static boolean screenOn() {
        try {
            android.os.PowerManager pm = (android.os.PowerManager) app.getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Exception e) {
            return true;
        }
    }

    private static void addPlay(long ms) {
        if (playKey != null && app != null) Playtime.add(app, playKey, ms);
    }

    /** True if the emulator has an activity on screen, or if that can't be told (never guess it closed). */
    private static boolean gameOnScreen() {
        try {
            UsageStatsManager usm = (UsageStatsManager) app.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return true;
            long now = System.currentTimeMillis();
            UsageEvents events = usm.queryEvents(startedAtWall - 2000, now + 2000);
            if (events == null) return true;
            UsageEvents.Event e = new UsageEvents.Event();
            Map<String, Boolean> shown = new HashMap<String, Boolean>();
            boolean any = false;
            String lastForeground = "";
            lastForegroundPkg = "";
            while (events.hasNextEvent()) {
                events.getNextEvent(e);
                if (e.getEventType() == 1 && e.getPackageName() != null) lastForeground = e.getPackageName();
                if (!pkg.equals(e.getPackageName())) continue;
                int t = e.getEventType();
                String cls = String.valueOf(e.getClassName());
                if (t == 1) {                         // activity resumed (moved to foreground)
                    shown.put(cls, Boolean.TRUE);
                    any = true;
                } else if (t == 2 || t == 23 || t == 24) { // paused, stopped, destroyed
                    shown.put(cls, Boolean.FALSE);
                }
            }
            lastForegroundPkg = lastForeground;
            if (!any) return true; // no sign of the emulator yet; keep waiting
            if (shown.containsValue(Boolean.TRUE)) return true;
            // The game is only covered, not closed, while Android's file picker (choosing a ROM inside a port) or a
            // permission prompt is on top of it.
            return lastForeground.contains("documentsui") || lastForeground.contains("permissioncontroller")
                    || lastForeground.equals("com.android.externalstorage");
        } catch (Exception ex) {
            return true;
        }
    }
}
