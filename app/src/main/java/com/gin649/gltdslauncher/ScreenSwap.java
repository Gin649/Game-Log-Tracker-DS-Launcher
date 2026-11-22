package com.gin649.gltdslauncher;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/**
 * The "Tracker on top screen" setting (Display Options). With it on, the tracker sits on the top screen and the fan art
 * and cartridge on the bottom one while you are in the menus. When a game starts the two swap back to the usual layout
 * (game on top, tracker underneath), and when the game closes they swap again.
 *
 * While a game runs everything is the normal layout, so the rest of the app only has to ask DisplayPicker where the
 * tracker and the art screen go right now.
 */
final class ScreenSwap {

    /** How long a swap is given before the start-up animation and the game go ahead. */
    static final long MOVE_MS = 450;
    /** The art screen coming to the front this soon after a swap is the swap itself, not a game closing. */
    private static final long SETTLE_MS = 4000;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static Context app;
    /** True from pressing Play until the game closes: the usual layout is in use even though the setting is on. */
    private static volatile boolean gameLayout;
    private static volatile long swappedAt;

    private ScreenSwap() {
    }

    static void init(Context c) {
        app = c.getApplicationContext();
    }

    /** The setting is on, and this device is using both of its screens. */
    static boolean wanted(Context c) {
        if (c == null) return false;
        return "1".equals(Prefs.get(c, "trackerOnTop", "0")) && !DisplayPicker.singleScreen(c)
                && DisplayPicker.hasTwoScreens(c);
    }

    static void setWanted(Context c, boolean on) {
        Prefs.put(c, "trackerOnTop", on ? "1" : "0");
        gameLayout = false;
        moveAll(c);
    }

    /** True while the tracker is on the top screen and the art on the bottom one. */
    static boolean swapped(Context c) {
        return !gameLayout && wanted(c);
    }

    static boolean swapped() {
        return swapped(app);
    }

    /**
     * A game is about to start: put the tracker back underneath and the art on top, ready for the start-up animation.
     * Returns how long to wait before going on, or 0 when nothing had to move.
     */
    static long toGameLayout(Context c) {
        if (gameLayout || !wanted(c)) return 0;
        gameLayout = true;
        swappedAt = SystemClock.elapsedRealtime();
        moveAll(c);
        return MOVE_MS;
    }

    /** The game closed and the art screen is back: tracker on top and art underneath again. */
    static void toMenuLayout(Context c) {
        if (!gameLayout) return;
        gameLayout = false;
        if (wanted(c)) moveAll(c);
        else TopPanel.refresh();
    }

    /**
     * The game closed into another app (Chrome, Files...). Nothing is moved while that app is in front; the menu layout
     * comes back the next time the launcher is brought up (the app icon or Home).
     */
    static void forget() {
        gameLayout = false;
    }

    /**
     * The art screen just came to the front. With no game being watched (usage access is off) this is the only sign that
     * the game closed, so swap back here.
     */
    static void artResumed(Context c) {
        if (!gameLayout || ArtWatch.gameRunning()) return;
        if (SystemClock.elapsedRealtime() - swappedAt < SETTLE_MS) return;
        toMenuLayout(c);
    }

    /** Puts the tracker and the art screen where they belong now. */
    private static void moveAll(final Context c) {
        TopPanel.refresh();
        MAIN.post(new Runnable() {
            @Override
            public void run() {
                MainActivity.moveTracker(DisplayPicker.trackerDisplayId(c));
                MainActivity.moveArt(DisplayPicker.artDisplayId(c));
            }
        });
    }
}
