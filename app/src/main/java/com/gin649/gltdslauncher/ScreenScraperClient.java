package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Talks to ScreenScraper directly from the phone (no Cloudflare in between), so the app's own IP and
 * your own login carry the rate limit. Games are found by searching for their cleaned-up title.
 */
final class ScreenScraperClient {

    private static final String BASE = "https://api.screenscraper.fr/api2/";
    private static final long MAX_DOWNLOAD = 15L * 1024 * 1024;
    private static final String[] REGIONS = {"wor", "us", "eu", "ss", "uk", "jp"};

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();

    private ScreenScraperClient() {}

    /** ScreenScraper is refusing requests for now (too many at once, or the daily limit is used up). */
    static final class LimitException extends IOException {
        LimitException(String m) {
            super(m);
        }
    }

    /** The login or developer keys were rejected. */
    static final class AuthException extends IOException {
        AuthException(String m) {
            super(m);
        }
    }

    static final class Settings {
        String devId = "", devPassword = "", softName = "GLTThor", user = "", pass = "";
        final Map<String, Integer> systems = new HashMap<String, Integer>();

        /** ScreenScraper only answers when it knows which developer is asking. */
        boolean ready() {
            return !devId.isEmpty() && !devPassword.isEmpty();
        }

        int systemId(String folder) {
            Integer v = systems.get(folder);
            return v == null ? 0 : v;
        }
    }

    static final class Match {
        final int id;
        final String name;

        Match(int id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    // ---------- settings ----------

    /**
     * Developer keys and system ids come from assets/screenscraper.json, overridden by
     * [ES-DE folder]/gltthor/screenscraper.json. The login comes from the setup wizard, or failing that
     * from ES-DE's own settings file.
     */
    static Settings load(Context c) {
        Settings s = new Settings();
        try {
            merge(s, readAll(c.getAssets().open("screenscraper.json")));
        } catch (Exception ignored) {
        }
        if (!Config.USER_DIR.isEmpty()) {
            File f = new File(Config.USER_DIR, "screenscraper.json");
            if (f.isFile()) {
                try {
                    merge(s, readAll(new FileInputStream(f)));
                } catch (Exception ignored) {
                }
            }
        }
        s.user = Prefs.get(c, "ssUser", "");
        s.pass = Prefs.get(c, "ssPass", "");
        if ((s.user.isEmpty() || s.pass.isEmpty()) && !Config.ES_ROOT.isEmpty()) {
            File f = new File(Config.ES_ROOT, "settings/es_settings.xml");
            if (f.isFile()) {
                try {
                    String xml = readAll(new FileInputStream(f));
                    if (s.user.isEmpty()) s.user = esValue(xml, "ScraperUsername");
                    if (s.pass.isEmpty()) s.pass = esValue(xml, "ScraperPassword");
                } catch (Exception ignored) {
                }
            }
        }
        return s;
    }

    private static void merge(Settings s, String json) throws JSONException {
        JSONObject o = new JSONObject(json);
        if (!o.optString("devid").isEmpty()) s.devId = o.optString("devid");
        if (!o.optString("devpassword").isEmpty()) s.devPassword = o.optString("devpassword");
        if (!o.optString("softname").isEmpty()) s.softName = o.optString("softname");
        JSONObject sys = o.optJSONObject("systems");
        if (sys != null) {
            Iterator<String> it = sys.keys();
            while (it.hasNext()) {
                String k = it.next();
                s.systems.put(k, sys.optInt(k));
            }
        }
    }

    private static String esValue(String xml, String name) {
        java.util.regex.Matcher m = Pattern.compile("<string\\s+name=\"" + name + "\"\\s+value=\"([^\"]*)\"").matcher(xml);
        if (!m.find()) return "";
        return m.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
                .replace("&apos;", "'").replace("&amp;", "&");
    }

    private static String readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            in.close();
        }
    }

    // ---------- API calls ----------

    private static HttpUrl.Builder base(Settings s, String endpoint) {
        HttpUrl.Builder b = HttpUrl.parse(BASE + endpoint).newBuilder()
                .addQueryParameter("devid", s.devId)
                .addQueryParameter("devpassword", s.devPassword)
                .addQueryParameter("softname", s.softName)
                .addQueryParameter("output", "json");
        if (!s.user.isEmpty()) {
            b.addQueryParameter("ssid", s.user);
            b.addQueryParameter("sspassword", s.pass);
        }
        return b;
    }

    /** Runs one request. Returns the JSON "response" object, or null when ScreenScraper has no result. */
    private static JSONObject callJson(HttpUrl url) throws IOException {
        Request req = new Request.Builder().url(url).header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            int code = res.code();
            ResponseBody body = res.body();
            String text = body == null ? "" : body.string();
            if (code == 429 || code == 430 || code == 431) {
                throw new LimitException("ScreenScraper limit reached (" + code + "). Try again later.");
            }
            if (code == 401 || code == 403) throw new AuthException("ScreenScraper refused the login or developer keys.");
            if (code == 404) return null; // "game not found" comes back as 404 with a text body
            if (code != 200) throw new IOException("ScreenScraper answered " + code);
            try {
                JSONObject root = new JSONObject(text);
                return root.optJSONObject("response");
            } catch (JSONException e) {
                if (text.toLowerCase(Locale.ROOT).contains("api closed")) {
                    throw new LimitException("ScreenScraper API is closed for non-members right now.");
                }
                return null; // error text rather than JSON: treat as "nothing found"
            }
        } finally {
            res.close();
        }
    }

    /** Best title match among the search results for one system, or null if nothing is close enough. */
    static Match search(Settings s, String title, int systemId) throws IOException {
        HttpUrl url = base(s, "jeuRecherche.php")
                .addQueryParameter("systemeid", String.valueOf(systemId))
                .addQueryParameter("recherche", title)
                .build();
        JSONObject r = callJson(url);
        if (r == null) return null;
        JSONArray jeux = r.optJSONArray("jeux");
        if (jeux == null) return null;

        Match best = null;
        int bestScore = 0;
        for (int i = 0; i < jeux.length(); i++) {
            JSONObject j = jeux.optJSONObject(i);
            if (j == null) continue;
            int id = j.optInt("id", 0);
            JSONArray noms = j.optJSONArray("noms");
            if (id <= 0 || noms == null) continue;
            for (int n = 0; n < noms.length(); n++) {
                JSONObject nom = noms.optJSONObject(n);
                if (nom == null) continue;
                int score = similarity(title, nom.optString("text"));
                if (score > bestScore) {
                    bestScore = score;
                    best = new Match(id, canonicalName(noms));
                }
            }
        }
        return bestScore >= 75 ? best : null;
    }

    /** Full details for a matched game, including its media list. */
    static JSONObject gameInfo(Settings s, int gameId, int systemId) throws IOException {
        HttpUrl url = base(s, "jeuInfos.php")
                .addQueryParameter("systemeid", String.valueOf(systemId))
                .addQueryParameter("gameid", String.valueOf(gameId))
                .build();
        JSONObject r = callJson(url);
        return r == null ? null : r.optJSONObject("jeu");
    }

    static byte[] download(String url) throws IOException {
        HttpUrl parsed = HttpUrl.parse(url);
        if (parsed == null) return null;
        Request req = new Request.Builder().url(parsed).header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            if (res.code() == 429 || res.code() == 430 || res.code() == 431) {
                throw new LimitException("ScreenScraper limit reached (" + res.code() + ").");
            }
            ResponseBody body = res.body();
            if (!res.isSuccessful() || body == null) return null;
            if (body.contentLength() > MAX_DOWNLOAD) return null;
            byte[] data = body.bytes();
            return data.length > MAX_DOWNLOAD ? null : data;
        } finally {
            res.close();
        }
    }

    // ---------- reading a game's details ----------

    static String canonicalName(JSONArray noms) {
        if (noms == null) return "";
        for (String region : REGIONS) {
            for (int i = 0; i < noms.length(); i++) {
                JSONObject n = noms.optJSONObject(i);
                if (n != null && region.equals(n.optString("region")) && !n.optString("text").isEmpty()) {
                    return n.optString("text");
                }
            }
        }
        JSONObject first = noms.optJSONObject(0);
        return first == null ? "" : first.optString("text");
    }

    /** URL of the first media of any listed type, taking regions in order of preference. */
    static String pickMedia(JSONObject game, String... types) {
        JSONArray medias = game == null ? null : game.optJSONArray("medias");
        if (medias == null) return null;
        for (String type : types) {
            for (String region : REGIONS) {
                String u = find(medias, type, region);
                if (u != null) return u;
            }
            String any = find(medias, type, null);
            if (any != null) return any;
        }
        return null;
    }

    private static String find(JSONArray medias, String type, String region) {
        for (int i = 0; i < medias.length(); i++) {
            JSONObject m = medias.optJSONObject(i);
            if (m == null || !type.equals(m.optString("type"))) continue;
            if (!"jeu".equals(m.optString("parent", "jeu"))) continue;
            if (region != null && !region.equals(m.optString("region"))) continue;
            String u = m.optString("url");
            if (!u.isEmpty()) return u;
        }
        return null;
    }

    // ---------- title matching ----------

    private static final Set<String> STOP = new HashSet<String>(java.util.Arrays.asList("the", "a", "an", "of", "and"));

    private static final Map<String, String> ROMAN = new HashMap<String, String>();

    static {
        String[] r = {"ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"};
        for (int i = 0; i < r.length; i++) ROMAN.put(r[i], String.valueOf(i + 2));
    }

    private static Set<String> tokens(String s) {
        Set<String> out = new HashSet<String>();
        for (String w : Matcher.norm(s).split(" ")) {
            if (w.isEmpty() || STOP.contains(w)) continue;
            String roman = ROMAN.get(w);
            out.add(roman != null ? roman : w);
        }
        return out;
    }

    private static Set<String> numbers(Set<String> tokens) {
        Set<String> out = new HashSet<String>();
        for (String t : tokens) {
            if (t.matches("\\d+")) out.add(t);
        }
        return out;
    }

    /**
     * 0 to 100. 100 when the titles are the same apart from punctuation, tags and small words; otherwise the
     * share of words in common, but 0 if the sequel numbers differ so "Game 2" never matches "Game".
     */
    static int similarity(String a, String b) {
        Set<String> ta = tokens(a);
        Set<String> tb = tokens(b);
        if (ta.isEmpty() || tb.isEmpty()) return 0;
        if (ta.equals(tb)) return 100;
        if (!numbers(ta).equals(numbers(tb))) return 0;
        Set<String> inter = new HashSet<String>(ta);
        inter.retainAll(tb);
        Set<String> union = new HashSet<String>(ta);
        union.addAll(tb);
        return (int) Math.round(100.0 * inter.size() / union.size());
    }
}
