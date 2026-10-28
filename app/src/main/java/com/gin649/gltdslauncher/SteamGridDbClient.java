package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONArray;
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
 * Optional fan art from SteamGridDB (steamgriddb.com). It needs your own free API key (your profile, Preferences, API),
 * not a developer account. Games are looked up by title only, so retro coverage depends on what people uploaded:
 * popular games are usually there, obscure ones and ROM hacks often are not.
 * A "hero" is a wide banner and is used as the fan art as it is.
 */
final class SteamGridDbClient {

    private static final String BASE = "https://www.steamgriddb.com/api/v2";
    private static final long MAX_DOWNLOAD = 15L * 1024 * 1024;

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();

    /** The key is wrong or was revoked. */
    static final class AuthException extends IOException {
        AuthException(String m) {
            super(m);
        }
    }

    /** Too many requests right now. */
    static final class LimitException extends IOException {
        LimitException(String m) {
            super(m);
        }
    }

    private SteamGridDbClient() {}

    static String key(Context c) {
        return Prefs.get(c, "sgdbKey", "").trim();
    }

    static boolean enabled(Context c) {
        return !key(c).isEmpty();
    }

    /** Raw bytes of the best hero image for a game, or null when there is no good match or no hero. */
    static byte[] heroFor(Context c, String title) throws IOException {
        String key = key(c);
        if (key.isEmpty()) return null;
        int id = search(key, title);
        if (id <= 0) return null;
        String url = firstImageUrl(key, "heroes", id);
        return url == null ? null : download(url);
    }

    private static int search(String key, String title) throws IOException {
        HttpUrl url = HttpUrl.parse(BASE + "/search/autocomplete/").newBuilder().addPathSegment(title).build();
        JSONObject r = call(key, url);
        JSONArray data = r == null ? null : r.optJSONArray("data");
        if (data == null) return 0;
        int bestId = 0;
        int best = 0;
        for (int i = 0; i < data.length(); i++) {
            JSONObject g = data.optJSONObject(i);
            if (g == null) continue;
            int score = Matcher.similarity(title, g.optString("name"));
            if (score > best) {
                best = score;
                bestId = g.optInt("id", 0);
            }
        }
        return best >= 75 ? bestId : 0;
    }

    private static String firstImageUrl(String key, String kind, int gameId) throws IOException {
        HttpUrl url = HttpUrl.parse(BASE + "/" + kind + "/game/" + gameId).newBuilder()
                .addQueryParameter("types", "static")
                .addQueryParameter("nsfw", "false")
                .addQueryParameter("humor", "false")
                .build();
        JSONObject r = call(key, url);
        JSONArray data = r == null ? null : r.optJSONArray("data");
        if (data == null) return null;
        for (int i = 0; i < data.length(); i++) { // already sorted best-first by the service
            JSONObject o = data.optJSONObject(i);
            if (o != null && !o.optString("url").isEmpty()) return o.optString("url");
        }
        return null;
    }

    private static JSONObject call(String key, HttpUrl url) throws IOException {
        Request req = new Request.Builder().url(url)
                .header("Authorization", "Bearer " + key)
                .header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            int code = res.code();
            ResponseBody body = res.body();
            String text = body == null ? "" : body.string();
            if (code == 401 || code == 403) throw new AuthException("SteamGridDB refused the API key.");
            if (code == 429) throw new LimitException("SteamGridDB rate limit reached.");
            if (code == 404) return null;
            if (code != 200) throw new IOException("SteamGridDB answered " + code);
            try {
                return new JSONObject(text);
            } catch (JSONException e) {
                return null;
            }
        } finally {
            res.close();
        }
    }

    private static byte[] download(String url) throws IOException {
        HttpUrl parsed = HttpUrl.parse(url);
        if (parsed == null) return null;
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
