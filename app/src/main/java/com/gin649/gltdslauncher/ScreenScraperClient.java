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
        /** Every regional cover the Worker listed, as {region label, address}; empty on an older cached answer. */
        java.util.List<String[]> boxes = new java.util.ArrayList<String[]>();
        /** Pictures of the cartridge or disc, as {region code, address}; empty when the Worker sent none. */
        java.util.List<String[]> carts = new java.util.ArrayList<String[]>();
    }

    private ScreenScraperClient() {}

    /** The game's ScreenScraper entry, or null when it has none. Blocks on the network the first time. */
    static Info lookup(Context ctx, String title, String system) throws IOException {
        return lookup(ctx, title, system, false);
    }

    /**
     * wantCarts: a saved answer from before the Worker sent cartridge pictures is asked for again, once, so Cart view
     * can use them. Everything else keeps using the saved answer.
     */
    static Info lookup(Context ctx, String title, String system, boolean wantCarts) throws IOException {
        if (title == null || title.trim().isEmpty() || system == null || system.trim().isEmpty()) return null;
        // "3": answers saved before the Worker listed regional covers held one cover only, so they are asked for again
        String key = "ss-info3:" + Matcher.compact(system) + ":" + Matcher.norm(title);
        CacheDb db = CacheDb.get(ctx);
        String saved = db.read(key);
        if (saved != null) {
            try {
                JSONObject o = new JSONObject(saved);
                long age = System.currentTimeMillis() - o.optLong("ts");
                boolean found = o.optBoolean("found");
                boolean stale = wantCarts && found && !o.has("carts") && !o.optBoolean("cartsAsked");
                if (!stale && age < (found ? FOUND_MS : MISS_MS)) return found ? parse(o) : null;
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
            if (wantCarts) o.put("cartsAsked", true); // a Worker that sends no carts isn't asked again for them
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
        org.json.JSONArray bs = o.optJSONArray("boxes");
        if (bs != null) {
            for (int k = 0; k < bs.length(); k++) {
                JSONObject b = bs.optJSONObject(k);
                if (b == null) continue;
                String u = b.optString("url"), l = b.optString("label");
                if (!u.isEmpty()) i.boxes.add(new String[]{l, u});
            }
        }
        org.json.JSONArray cs = o.optJSONArray("carts");
        if (cs != null) {
            for (int k = 0; k < cs.length(); k++) {
                JSONObject c = cs.optJSONObject(k);
                if (c == null) continue;
                String u = c.optString("url"), r = c.optString("region");
                if (!u.isEmpty()) i.carts.add(new String[]{r, u});
            }
        }
        return i;
    }

    /**
     * The best cartridge or disc picture's address: the US one, else the world release, else Europe's (or one of
     * its countries), else any other, with Japan's last. Null when there is none.
     */
    static String bestCart(Info info) {
        if (info == null) return null;
        String best = null;
        int bestRank = Integer.MAX_VALUE;
        for (String[] c : info.carts) {
            int r = cartRank(c[0]);
            if (r < bestRank) {
                bestRank = r;
                best = c[1];
            }
        }
        return best;
    }

    private static int cartRank(String region) {
        String r = region == null ? "" : region.trim().toLowerCase(java.util.Locale.ROOT);
        if (r.equals("us") || r.equals("usa")) return 0;
        if (r.equals("wor") || r.equals("world")) return 1;
        if (r.equals("ca") || r.equals("cus")) return 2;
        if (r.equals("eu") || r.equals("europe")) return 3;
        if (java.util.Arrays.asList("uk", "fr", "de", "it", "sp", "es", "nl", "pt", "se", "dk", "fi", "no", "gr", "pl", "ru", "au").contains(r)) return 4;
        if (r.equals("jp") || r.equals("japan")) return 7;
        if (r.isEmpty() || r.equals("ss")) return 5;
        return 6;
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
