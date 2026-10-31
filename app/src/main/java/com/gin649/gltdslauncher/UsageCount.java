package com.gin649.gltdslauncher;

import android.content.Context;

import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Counts how many people use the app, and nothing else. Once a day, when the app starts, it asks GoatCounter for
 * one tiny page-view of "/launch/<version>". Nothing about you, your games or your accounts is sent, and there is no
 * device ID. Release builds only.
 *
 * Set CODE to your GoatCounter site code (the part before .goatcounter.com). While it is empty, nothing is sent.
 */
final class UsageCount {

    static final String CODE = "";

    private UsageCount() {}

    static void ping(final Context ctx) {
        if (BuildConfig.DEBUG || CODE.isEmpty()) return;
        final String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        if (day.equals(Prefs.get(ctx, "countDay", ""))) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    URL url = new URL("https://" + CODE + ".goatcounter.com/count?p=" + java.net.URLEncoder.encode("/launch/" + BuildConfig.VERSION_NAME, "UTF-8")
                            + "&t=" + java.net.URLEncoder.encode("Game Log Tracker DS Launcher", "UTF-8"));
                    c = (HttpURLConnection) url.openConnection();
                    c.setConnectTimeout(6000);
                    c.setReadTimeout(6000);
                    c.setRequestProperty("User-Agent", "GLTThor/" + BuildConfig.VERSION_NAME);
                    if (c.getResponseCode() / 100 == 2) Prefs.put(ctx, "countDay", day); // otherwise try again next start
                } catch (Exception ignored) {
                    // a counter must never get in the way
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }, "usage-count").start();
    }
}
