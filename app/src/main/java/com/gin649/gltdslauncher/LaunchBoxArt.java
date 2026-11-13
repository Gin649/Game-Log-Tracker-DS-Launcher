package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;

import com.gin649.gltdslauncher.graphics.MiximageCompositor;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Game art from LaunchBox's games database, with no account or key. A small index per console (built weekly by
 * tools/build_launchbox.py and kept on this repo's data branch) says which picture files exist for each game; the
 * pictures themselves come from images.launchbox-app.com. Fan art is used when there is some. Otherwise the box art,
 * a screenshot and the logo are returned so a miximage can be built from them.
 */
final class LaunchBoxArt {

    private static final String INDEX_URL = "https://raw.githubusercontent.com/Gin649/Game-Log-Tracker-DS-Launcher/data/launchbox/";
    private static final String IMAGE_URL = "https://images.launchbox-app.com/";
    private static final long MAX_DOWNLOAD = 12L * 1024 * 1024;
    private static final long INDEX_MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000;

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();

    /** Why the last lookup found nothing, for the Fetch game art note. */
    static volatile String lastWhy = "";

    private static Map<String, String> platforms;
    private static final Map<String, Index> INDEXES = new HashMap<String, Index>();

    /** One console's games: normalized title to its row [title, fan, box, shot, logo, cart, disc]. */
    private static final class Index {
        /** False for an index built before cartridge and disc pictures were listed. */
        boolean carts;
        final List<String[]> rows = new ArrayList<String[]>();
        final Map<String, String[]> exact = new HashMap<String, String[]>();
    }

    /** What was found for a game; every picture may be null, and fan is the full-frame background when present. */
    static final class Art {
        byte[] fan; // the fan art file as it was downloaded, so it can be kept untouched
        Bitmap screen, box, logo;

        void recycle() {
            if (screen != null) screen.recycle();
            if (box != null) box.recycle();
            if (logo != null) logo.recycle();
        }
    }

    private LaunchBoxArt() {}

    /**
     * With fanOnly, only the fan art is fetched (null when the game has none); otherwise the box art, screenshot and
     * logo for a miximage. Returns null when the console is unknown or the game isn't in the database, and throws IOException when the
     * network could not be reached (so the caller does not remember it as "no art").
     */
    static Art fetch(Context ctx, String folder, String title, boolean fanOnly) throws IOException {
        lastWhy = "";
        String platform = platformFor(ctx, folder);
        if (platform == null) {
            lastWhy = "folder \"" + folder + "\" is not matched to a LaunchBox console";
            return null;
        }
        Index idx = index(ctx, Matcher.compact(platform));
        if (idx == null || idx.rows.isEmpty()) {
            lastWhy = "no LaunchBox list for " + platform;
            return null;
        }
        String[] row = match(idx, title);
        if (row == null) {
            lastWhy = "not found in LaunchBox's " + platform + " list";
            return null;
        }

        Art a = new Art();
        if (fanOnly) {
            if (!row[1].isEmpty()) a.fan = fanBytes(row[1].split("\\|")[0]);
        } else {
            if (!row[2].isEmpty()) a.box = image(row[2], 900);
            if (!row[3].isEmpty()) a.screen = image(row[3], 1600);
            if (!row[4].isEmpty()) a.logo = image(row[4], 900);
        }
        if (a.fan == null && a.box == null && a.screen == null && a.logo == null) {
            lastWhy = fanOnly && row[1].isEmpty() ? "LaunchBox has no fan art for it" : "LaunchBox pictures could not be downloaded";
            return null;
        }
        return a;
    }

    /** Every fan art file LaunchBox has for the game, best first (empty when none or the game isn't listed). */
    static List<String> fanFiles(Context ctx, String folder, String title) throws IOException {
        List<String> out = new ArrayList<String>();
        String platform = platformFor(ctx, folder);
        if (platform == null) return out;
        Index idx = index(ctx, Matcher.compact(platform));
        if (idx == null) return out;
        String[] row = match(idx, title);
        if (row == null || row[1].isEmpty()) return out;
        for (String f : row[1].split("\\|")) if (!f.isEmpty()) out.add(f);
        return out;
    }

    /** One fan art file from LaunchBox's image server, as it is, or null. */
    static byte[] fanBytes(String file) {
        try {
            return download(IMAGE_URL + file, MAX_DOWNLOAD);
        } catch (Exception e) {
            return null;
        } finally {
            try {
                Thread.sleep(250); // be gentle with a free service
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /** Address of the game's box art (else a screenshot) on LaunchBox's image server, or null. */
    static String boxUrl(Context ctx, String folder, String title) throws IOException {
        String platform = platformFor(ctx, folder);
        if (platform == null) return null;
        Index idx = index(ctx, Matcher.compact(platform));
        if (idx == null) return null;
        String[] row = match(idx, title);
        if (row == null) return null;
        String file = !row[2].isEmpty() ? row[2] : row[3];
        return file.isEmpty() ? null : IMAGE_URL + file;
    }

    /** Address of the game's screenshot on LaunchBox's image server, or null. */
    static String screenUrl(Context ctx, String folder, String title) throws IOException {
        return screenUrl(ctx, folder, title, false);
    }

    /** With exact, only a game listed under this very name counts (for hacks, so the original game is never taken). */
    static String screenUrl(Context ctx, String folder, String title, boolean exact) throws IOException {
        String platform = platformFor(ctx, folder);
        if (platform == null) return null;
        Index idx = index(ctx, Matcher.compact(platform));
        if (idx == null) return null;
        String[] row = exact ? idx.exact.get(lbNorm(title)) : match(idx, title);
        if (row == null || row[3].isEmpty()) return null;
        return IMAGE_URL + row[3];
    }

    /** Address of the game's front cover on LaunchBox's image server (never a screenshot), or null. */
    static String frontUrl(Context ctx, String folder, String title) throws IOException {
        String platform = platformFor(ctx, folder);
        if (platform == null) return null;
        Index idx = index(ctx, Matcher.compact(platform));
        if (idx == null) return null;
        String[] row = match(idx, title);
        if (row == null || row[2].isEmpty()) return null;
        return IMAGE_URL + row[2];
    }

    /**
     * Address of the game's cartridge picture (else its disc) on LaunchBox's image server, or null when it has none.
     * An index saved on the device before these pictures were listed is fetched again, once.
     */
    static String cartUrl(Context ctx, String folder, String title) throws IOException {
        String platform = platformFor(ctx, folder);
        if (platform == null) return null;
        String key = Matcher.compact(platform);
        Index idx = index(ctx, key);
        if (idx != null && !idx.carts && !idx.rows.isEmpty()) idx = withCarts(ctx, key);
        if (idx == null) return null;
        String[] row = match(idx, title);
        if (row == null) return null;
        String file = !row[5].isEmpty() ? row[5] : row[6];
        return file.isEmpty() ? null : IMAGE_URL + file;
    }

    private static final java.util.Set<String> CART_RETRIED = new java.util.HashSet<String>();

    private static synchronized Index withCarts(Context ctx, String key) throws IOException {
        if (!CART_RETRIED.add(key)) return INDEXES.get(key);
        File f = new File(DataStore.root(ctx), "launchbox/" + key + ".json");
        File aside = new File(f.getPath() + ".old");
        boolean moved = f.isFile() && f.renameTo(aside);
        INDEXES.remove(key);
        try {
            Index fresh = index(ctx, key);
            if (fresh != null && !fresh.rows.isEmpty()) {
                aside.delete();
                return fresh;
            }
        } catch (IOException e) {
            CART_RETRIED.remove(key); // offline: try again another time
        }
        // nothing newer could be fetched, so go back to the copy we had
        if (moved) {
            f.delete();
            aside.renameTo(f);
        }
        INDEXES.remove(key);
        return index(ctx, key);
    }

    /** A picture from LaunchBox's image server as it is, or null when it isn't there or is too big. */
    static byte[] imageBytes(String url) throws IOException {
        if (url == null || !url.startsWith(IMAGE_URL)) return null;
        return download(url, MAX_DOWNLOAD);
    }

    /** Like Matcher.norm, but a minus sign before a number counts: "Super Mario Bros. -2" is a hack, not "Super Mario Bros. 2". */
    private static String lbNorm(String s) {
        if (s == null) return "";
        return Matcher.norm(s.replaceAll("(^|[\\s.:])-(?=\\d)", "$1 minus "));
    }

    /** LaunchBox's write-up for a game, or null when the console or game isn't listed or has none. */
    static String description(Context ctx, String folder, String title) throws IOException {
        return description(ctx, folder, title, false);
    }

    /** With exact, only a game listed under this very name counts (for hacks, so the original game is never taken). */
    static String description(Context ctx, String folder, String title, boolean exact) throws IOException {
        String platform = platformFor(ctx, folder);
        if (platform == null) return null;
        String key = Matcher.compact(platform);
        Map<String, String> d = descs(ctx, key);
        if (d == null || d.isEmpty()) return null;
        String hit = d.get(lbNorm(title));
        if (hit != null || exact) return hit;
        String best = null;
        int bestScore = 0;
        for (Map.Entry<String, String> e : d.entrySet()) {
            int score = Matcher.artSimilarity(title, e.getKey());
            if (score > bestScore) {
                bestScore = score;
                best = e.getValue();
            }
        }
        return bestScore >= 85 ? best : null;
    }

    private static final Map<String, Map<String, String>> DESCS = new HashMap<String, Map<String, String>>();

    // normalized title to write-up for one console, cached on disk like the art index
    private static synchronized Map<String, String> descs(Context ctx, String key) throws IOException {
        Map<String, String> cached = DESCS.get(key);
        if (cached != null) return cached;
        File f = new File(DataStore.root(ctx), "launchbox/" + key + ".desc.json");
        boolean fresh = f.isFile() && System.currentTimeMillis() - f.lastModified() < INDEX_MAX_AGE_MS;
        byte[] data = fresh ? readFile(f) : null;
        if (data == null) {
            try {
                data = download(INDEX_URL + key + ".desc.json", 40L * 1024 * 1024);
                if (data != null) {
                    File parent = f.getParentFile();
                    if (parent != null) parent.mkdirs();
                    FileOutputStream fos = new FileOutputStream(f);
                    try {
                        fos.write(data);
                    } finally {
                        fos.close();
                    }
                }
            } catch (IOException e) {
                if (!f.isFile()) throw e;
                data = readFile(f);
            }
            if (data == null) {
                Map<String, String> none = new HashMap<String, String>();
                DESCS.put(key, none);
                return none;
            }
        }
        Map<String, String> out = new HashMap<String, String>();
        try {
            JSONArray arr = new JSONObject(new String(data, "UTF-8")).getJSONArray("d");
            for (int i = 0; i < arr.length(); i++) {
                JSONArray r = arr.getJSONArray(i);
                String k = lbNorm(r.getString(0));
                String v = r.getString(1);
                String cur = out.get(k);
                if (cur == null || v.length() > cur.length()) out.put(k, v);
            }
        } catch (Exception e) {
            f.delete();
            return null;
        }
        DESCS.put(key, out);
        return out;
    }

    private static String[] match(Index idx, String title) {
        String[] hit = idx.exact.get(lbNorm(title));
        if (hit != null) return hit;
        String[] best = null;
        int bestScore = 0;
        for (String[] r : idx.rows) {
            int score = Matcher.artSimilarity(title, r[0]);
            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }
        return bestScore >= 75 ? best : null;
    }

    // the per-console index, cached on disk
    private static synchronized Index index(Context ctx, String key) throws IOException {
        Index cached = INDEXES.get(key);
        if (cached != null) return cached;

        File f = new File(DataStore.root(ctx), "launchbox/" + key + ".json");
        boolean fresh = f.isFile() && System.currentTimeMillis() - f.lastModified() < INDEX_MAX_AGE_MS;
        byte[] data = fresh ? readFile(f) : null;
        if (data == null) {
            try {
                data = download(INDEX_URL + key + ".json", 40L * 1024 * 1024);
                if (data != null) {
                    File parent = f.getParentFile();
                    if (parent != null) parent.mkdirs();
                    FileOutputStream fos = new FileOutputStream(f);
                    try {
                        fos.write(data);
                    } finally {
                        fos.close();
                    }
                }
            } catch (IOException e) {
                if (!f.isFile()) throw e;
                data = readFile(f); // offline: an old copy is better than none
            }
            if (data == null) { // this console isn't in the index; don't ask again this session
                Index none = new Index();
                INDEXES.put(key, none);
                return none;
            }
        }

        Index out = new Index();
        try {
            JSONObject root = new JSONObject(new String(data, "UTF-8"));
            out.carts = root.optInt("carts") == 1;
            JSONArray games = root.getJSONArray("g");
            for (int i = 0; i < games.length(); i++) {
                JSONArray r = games.getJSONArray(i);
                String[] row = new String[7];
                for (int j = 0; j < 7; j++) row[j] = r.optString(j, "");
                out.rows.add(row);
                String k = lbNorm(row[0]);
                String[] cur = out.exact.get(k);
                if (cur == null || score(row) > score(cur)) out.exact.put(k, row);
            }
        } catch (Exception e) {
            f.delete();
            return null;
        }
        INDEXES.put(key, out);
        return out;
    }

    /** Prefers the entry with fan art, then the one with the most pictures. */
    private static int score(String[] r) {
        int s = r[1].isEmpty() ? 0 : 10;
        for (int i = 2; i < 5; i++) if (!r[i].isEmpty()) s++;
        return s;
    }

    // network
    private static Bitmap image(String file, int maxSide) {
        try {
            byte[] data = download(IMAGE_URL + file, MAX_DOWNLOAD);
            return data == null ? null : MiximageCompositor.decode(data, maxSide);
        } catch (Exception e) {
            return null;
        } finally {
            try {
                Thread.sleep(250); // be gentle with a free service
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * The body, or null when the file doesn't exist or is too big. Any other refusal (the server is busy or having a
     * bad moment) throws like a lost connection does, so it isn't taken for "not there".
     */
    private static byte[] download(String url, long max) throws IOException {
        Request req = new Request.Builder().url(url).header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            ResponseBody body = res.body();
            if (res.code() == 404 || res.code() == 410) return null;
            if (!res.isSuccessful()) throw new IOException("The server answered " + res.code());
            if (body == null || body.contentLength() > max) return null;
            byte[] data = body.bytes();
            return data.length > max ? null : data;
        } finally {
            res.close();
        }
    }

    // system folders
    /** LaunchBox platform for one of your system folders, or null. */
    private static synchronized String platformFor(Context ctx, String folder) {
        if (platforms == null) {
            Map<String, String> m = new HashMap<String, String>();
            try {
                merge(m, readStream(ctx.getAssets().open("launchbox.json")));
            } catch (Exception ignored) {
            }
            if (!Config.USER_DIR.isEmpty()) {
                File user = new File(Config.USER_DIR, "launchbox.json");
                if (user.isFile()) {
                    try {
                        merge(m, new String(readFile(user), "UTF-8"));
                    } catch (Exception ignored) {
                    }
                }
            }
            platforms = m;
        }
        String d = platforms.get(folder);
        if (d == null) {
            SystemMap sm = Shared.systems();
            if (sm != null) d = platforms.get(sm.baseOf(folder));
        }
        return d;
    }

    /** Call when the wizard may have changed folders, so launchbox.json overrides are read again. */
    static synchronized void reset() {
        platforms = null;
    }

    private static void merge(Map<String, String> m, String json) throws Exception {
        JSONObject root = new JSONObject(json);
        JSONObject sys = root.optJSONObject("systems");
        if (sys == null) sys = root;
        Iterator<String> it = sys.keys();
        while (it.hasNext()) {
            String k = it.next();
            if (k.startsWith("_")) continue;
            String v = sys.optString(k);
            if (!v.isEmpty()) m.put(k, v);
        }
    }

    private static String readStream(InputStream in) throws IOException {
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

    private static byte[] readFile(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }
}
