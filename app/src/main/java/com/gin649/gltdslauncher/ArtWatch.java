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
        stop();
        if (emulatorPackage == null || emulatorPackage.isEmpty()) return;
        Context c = context.getApplicationContext();
        if (!hasUsageAccess(c)) return;
        app = c;
        pkg = emulatorPackage;
        startedAtElapsed = SystemClock.elapsedRealtime();
        startedAtWall = System.currentTimeMillis();
        sawCovered = false;
        goneStreak = 0;
        active = true;
        MAIN.postDelayed(TICK, POLL_MS);
    }

    /** A game was started from here and has not closed yet (needs Usage access to be known). */
    static synchronized boolean gameRunning() {
        return active;
    }

    static synchronized void stop() {
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
        if (age < GRACE_MS) {
            MAIN.postDelayed(TICK, POLL_MS);
            return;
        }

        if (gameOnScreen()) {
            goneStreak = 0;
        } else {
            goneStreak++;
        }
        if (goneStreak >= 2) { // gone on two checks in a row
            stop();
            TopPanel.bringArtFront();
            return;
        }
        MAIN.postDelayed(TICK, POLL_MS);
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
            while (events.hasNextEvent()) {
                events.getNextEvent(e);
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
            if (!any) return true; // no sign of the emulator yet; keep waiting
            return shown.containsValue(Boolean.TRUE);
        } catch (Exception ex) {
            return true;
        }
    }
}
