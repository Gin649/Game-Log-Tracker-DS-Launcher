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
 * device ID. Test builds are counted separately under /debug/.
 *
 * Set CODE to your GoatCounter site code (the part before .goatcounter.com). While it is empty, nothing is sent.
 */
final class UsageCount {

    static final String CODE = "gin649";

    private UsageCount() {}

    static void ping(final Context ctx) {
        if (CODE.isEmpty()) return;
        final boolean debug = BuildConfig.DEBUG; // test builds show up under /debug/ so they can be told apart, and send every launch
        final String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        if (!debug && day.equals(Prefs.get(ctx, "countDay2", ""))) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    URL url = new URL("https://" + CODE + ".goatcounter.com/count?p=" + java.net.URLEncoder.encode((debug ? "/debug/" : "/launch/") + BuildConfig.VERSION_NAME, "UTF-8")
                            + "&t=" + java.net.URLEncoder.encode("Game Log Tracker DS Launcher", "UTF-8"));
                    c = (HttpURLConnection) url.openConnection();
                    c.setConnectTimeout(6000);
                    c.setReadTimeout(6000);
                    // the app's own WebView user agent: GoatCounter drops hits whose user agent doesn't look like a browser
                    String ua;
                    try {
                        ua = android.webkit.WebSettings.getDefaultUserAgent(ctx);
                    } catch (Exception e) {
                        ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36";
                    }
                    c.setRequestProperty("User-Agent", ua + " GLTThor/" + BuildConfig.VERSION_NAME);
                    if (c.getResponseCode() / 100 == 2) Prefs.put(ctx, "countDay2", day); // otherwise try again next start
                } catch (Exception ignored) {
                    // a counter must never get in the way
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }, "usage-count").start();
    }
}
