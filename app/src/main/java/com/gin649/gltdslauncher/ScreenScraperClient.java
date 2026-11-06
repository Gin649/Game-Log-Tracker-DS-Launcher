package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Game information and pictures from ScreenScraper (screenscraper.fr), asked through the app's own Cloudflare Worker,
 * which holds the developer login. Nothing needs setting up on the device. Answers are saved on the device (a month for a
 * game that was found, a day for one that wasn't), so a game is only asked for once.
 */
final class ScreenScraperClient {

    private static final String WORKER = "https://ra-proxy.gin649.workers.dev";
    private static final long FOUND_MS = 30L * 24 * 60 * 60 * 1000;
    private static final long MISS_MS = 24L * 60 * 60 * 1000;
    private static final long MAX_DOWNLOAD = 15L * 1024 * 1024;

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .build();

    /** After the Worker says it is busy or not set up, nothing is asked until this time. */
    private static volatile long offUntil;

    static final class Info {
        String name = "", synopsis = "", box, screenshot, wheel, fanart;
    }

    private ScreenScraperClient() {}

    /** The game's ScreenScraper entry, or null when it has none. Blocks on the network the first time. */
    static Info lookup(Context ctx, String title, String system) throws IOException {
        if (title == null || title.trim().isEmpty() || system == null || system.trim().isEmpty()) return null;
        String key = "ss-info2:" + Matcher.compact(system) + ":" + Matcher.norm(title);
        CacheDb db = CacheDb.get(ctx);
        String saved = db.read(key);
        if (saved != null) {
            try {
                JSONObject o = new JSONObject(saved);
                long age = System.currentTimeMillis() - o.optLong("ts");
                boolean found = o.optBoolean("found");
                if (age < (found ? FOUND_MS : MISS_MS)) return found ? parse(o) : null;
            } catch (JSONException ignored) {
            }
        }
        if (System.currentTimeMillis() < offUntil) return null;

        HttpUrl url = HttpUrl.parse(WORKER + "/ss/info").newBuilder()
                .addQueryParameter("title", title).addQueryParameter("system", system).build();
        Request req = new Request.Builder().url(url).header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            ResponseBody body = res.body();
            String text = body == null ? "" : body.string();
            if (res.code() == 503) { // not set up, or ScreenScraper's quota is used up for now
                offUntil = System.currentTimeMillis() + 10L * 60 * 1000;
                return null;
            }
            if (!res.isSuccessful()) throw new IOException("Worker answered " + res.code());
            JSONObject o = new JSONObject(text);
            o.put("ts", System.currentTimeMillis());
            db.write(key, o.toString());
            return o.optBoolean("found") ? parse(o) : null;
        } catch (JSONException e) {
            return null;
        } finally {
            res.close();
        }
    }

    private static Info parse(JSONObject o) {
        Info i = new Info();
        i.name = o.optString("name");
        i.synopsis = o.optString("synopsis");
        i.box = addr(o, "box");
        i.screenshot = addr(o, "screenshot");
        i.wheel = addr(o, "wheel");
        i.fanart = addr(o, "fanart");
        return i;
    }

    private static String addr(JSONObject o, String k) {
        if (o.isNull(k)) return null;
        String s = o.optString(k);
        return s.isEmpty() ? null : s;
    }

    /** A picture's bytes from the Worker, or null when there is none. */
    static byte[] download(String url) throws IOException {
        HttpUrl parsed = HttpUrl.parse(url);
        if (parsed == null || !parsed.host().equals("ra-proxy.gin649.workers.dev")) return null;
        Request req = new Request.Builder().url(parsed).header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            ResponseBody body = res.body();
            if (!res.isSuccessful() || body == null || body.contentLength() > MAX_DOWNLOAD) return null;
            byte[] data = body.bytes();
            return data.length > MAX_DOWNLOAD ? null : data;
        } finally {
            res.close();
        }
    }
}
