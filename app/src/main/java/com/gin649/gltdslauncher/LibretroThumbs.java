package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;

import com.gin649.gltdslauncher.graphics.MiximageCompositor;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * The free fallback for game art: the libretro-thumbnails collection (thumbnails.libretro.com), which RetroArch itself
 * uses. It needs no account and no developer keys. Pictures are named after the No-Intro game name, so a ROM with a
 * No-Intro file name is found directly; any other name is matched by title against a cached list of the system's
 * box arts. It has box art, title screens, in-game screenshots and (for many games) logos, but no fan art.
 */
final class LibretroThumbs {

    private static final String HOST = "https://thumbnails.libretro.com";
    private static final long MAX_DOWNLOAD = 8L * 1024 * 1024;
    private static final long LIST_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000;
    private static final Pattern HREF = Pattern.compile("href=\"([^\"]+)\\.png\"");
    private static final String[] REGION_PREFERENCE = {"(USA", "(World", "(Europe", "(Japan"};

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();

    private static Map<String, String> systemDirs;
    private static final Map<String, List<String>> LISTS = new HashMap<String, List<String>>();
    private static final Map<String, Map<String, String>> EXACT = new HashMap<String, Map<String, String>>();

    /** The three pictures the miximage is built from; any may be null. */
    static final class Art {
        Bitmap screen, box, logo;
        String name = "";

        void recycle() {
            if (screen != null) screen.recycle();
            if (box != null) box.recycle();
            if (logo != null) logo.recycle();
        }
    }

    private LibretroThumbs() {}

    /** True when this system has a libretro-thumbnails folder. */
    static boolean supports(Context ctx, String folder) {
        return dirFor(ctx, folder) != null;
    }

    /**
     * Downloads what exists for the game. Returns null when the system is unknown or nothing matched, and throws
     * IOException when the network could not be reached (so the caller does not remember it as "no art").
     */
    static Art fetch(Context ctx, String folder, String romName, String title) throws IOException {
        try {
            String sysDir = dirFor(ctx, folder);
            if (sysDir == null) return null;
            String name = pickName(ctx, sysDir, romName, title);
            if (name == null) return null;

            Art a = new Art();
            a.name = name;
            a.box = get(sysDir, "Named_Boxarts", name, 900);
            a.screen = get(sysDir, "Named_Snaps", name, 1600);
            if (a.screen == null) a.screen = get(sysDir, "Named_Titles", name, 1600);
            a.logo = get(sysDir, "Named_Logos", name, 900);
            if (a.box == null && a.screen == null && a.logo == null) return null;
            return a;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- finding the right picture name ----------

    private static String pickName(Context ctx, String sysDir, String romName, String title) throws IOException {
        // 1. the ROM's own name, when it is a No-Intro name
        String direct = sanitize(romName);
        if (exists(sysDir, "Named_Boxarts", direct)) return direct;

        // 2. match the cleaned title against the list of box arts
        List<String> names = list(ctx, sysDir);
        if (names.isEmpty()) return null;
        Map<String, String> exact = exactIndex(sysDir, names);
        String key = Matcher.norm(title);
        String hit = exact.get(key);
        if (hit != null) return hit;

        String best = null;
        int bestScore = 0;
        for (String n : names) {
            int score = Matcher.similarity(title, n) * 10 + regionBonus(n);
            if (score > bestScore) {
                bestScore = score;
                best = n;
            }
        }
        return bestScore >= 75 * 10 ? best : null;
    }

    private static int regionBonus(String n) {
        for (int i = 0; i < REGION_PREFERENCE.length; i++) {
            if (n.contains(REGION_PREFERENCE[i])) return REGION_PREFERENCE.length - i;
        }
        return 0;
    }

    /** Normalized title to the best-looking file name with that title (USA first), built once per system. */
    private static synchronized Map<String, String> exactIndex(String sysDir, List<String> names) {
        Map<String, String> m = EXACT.get(sysDir);
        if (m != null) return m;
        m = new HashMap<String, String>();
        for (String n : names) {
            String k = Matcher.norm(n);
            String cur = m.get(k);
            if (cur == null || regionBonus(n) > regionBonus(cur)) m.put(k, n);
        }
        EXACT.put(sysDir, m);
        return m;
    }

    /** libretro-thumbnails replace these characters in file names with an underscore. */
    static String sanitize(String name) {
        return name.replaceAll("[&*/:`<>?\\\\|\"]", "_");
    }

    // ---------- the list of box arts for a system, cached on disk ----------

    private static synchronized List<String> list(Context ctx, String sysDir) throws IOException {
        List<String> cached = LISTS.get(sysDir);
        if (cached != null) return cached;

        File f = new File(ctx.getFilesDir(), "libretro/" + sanitize(sysDir) + ".txt");
        boolean fresh = f.isFile() && System.currentTimeMillis() - f.lastModified() < LIST_MAX_AGE_MS;
        List<String> out = new ArrayList<String>();
        if (fresh) {
            for (String line : new String(readFile(f), "UTF-8").split("\n")) {
                if (!line.isEmpty()) out.add(line);
            }
        }
        if (out.isEmpty()) {
            try {
                HttpUrl url = HttpUrl.parse(HOST).newBuilder().addPathSegment(sysDir).addPathSegment("Named_Boxarts").addPathSegment("").build();
                String html = text(url);
                if (html != null) {
                    java.util.regex.Matcher m = HREF.matcher(html);
                    while (m.find()) {
                        String n = decode(m.group(1));
                        if (!n.isEmpty() && !n.contains("/")) out.add(n);
                    }
                }
            } catch (IOException e) {
                if (f.isFile()) { // offline: an old list is better than none
                    for (String line : new String(readFile(f), "UTF-8").split("\n")) {
                        if (!line.isEmpty()) out.add(line);
                    }
                } else {
                    throw e;
                }
            }
            if (!out.isEmpty() && !fresh) {
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                StringBuilder sb = new StringBuilder();
                for (String n : out) sb.append(n).append('\n');
                FileOutputStream fos = new FileOutputStream(f);
                try {
                    fos.write(sb.toString().getBytes("UTF-8"));
                } finally {
                    fos.close();
                }
            }
        }
        if (!out.isEmpty()) LISTS.put(sysDir, out); // an empty answer is not remembered, so it is tried again later
        return out;
    }

    private static String decode(String href) {
        try {
            return URLDecoder.decode(href.replace("+", "%2B"), "UTF-8").replace("&amp;", "&");
        } catch (Exception e) {
            return href;
        }
    }

    // ---------- network ----------

    private static HttpUrl url(String sysDir, String type, String name) {
        return HttpUrl.parse(HOST).newBuilder().addPathSegment(sysDir).addPathSegment(type).addPathSegment(name + ".png").build();
    }

    private static boolean exists(String sysDir, String type, String name) throws IOException {
        Request req = new Request.Builder().url(url(sysDir, type, name)).head().header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            return res.isSuccessful();
        } finally {
            res.close();
        }
    }

    private static String text(HttpUrl url) throws IOException {
        Request req = new Request.Builder().url(url).header("User-Agent", "GLTThor/1").build();
        Response res = HTTP.newCall(req).execute();
        try {
            ResponseBody body = res.body();
            if (!res.isSuccessful() || body == null) return null;
            return body.string();
        } finally {
            res.close();
        }
    }

    /** One picture, decoded; null when it does not exist. */
    private static Bitmap get(String sysDir, String type, String name, int maxSide) {
        try {
            Request req = new Request.Builder().url(url(sysDir, type, name)).header("User-Agent", "GLTThor/1").build();
            Response res = HTTP.newCall(req).execute();
            try {
                ResponseBody body = res.body();
                if (!res.isSuccessful() || body == null || body.contentLength() > MAX_DOWNLOAD) return null;
                byte[] data = body.bytes();
                return data.length > MAX_DOWNLOAD ? null : MiximageCompositor.decode(data, maxSide);
            } finally {
                res.close();
            }
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

    // ---------- system folders ----------

    /** libretro-thumbnails folder for one of your system folders, or null. */
    private static synchronized String dirFor(Context ctx, String folder) {
        if (systemDirs == null) {
            Map<String, String> m = new HashMap<String, String>();
            try {
                merge(m, readStream(ctx.getAssets().open("libretro.json")));
            } catch (Exception ignored) {
            }
            if (!Config.USER_DIR.isEmpty()) {
                File user = new File(Config.USER_DIR, "libretro.json");
                if (user.isFile()) {
                    try {
                        merge(m, new String(readFile(user), "UTF-8"));
                    } catch (Exception ignored) {
                    }
                }
            }
            systemDirs = m;
        }
        String d = systemDirs.get(folder);
        if (d == null) {
            SystemMap sm = Shared.systems();
            if (sm != null) d = systemDirs.get(sm.baseOf(folder));
        }
        return d;
    }

    /** Call when the wizard may have changed folders, so libretro.json overrides are read again. */
    static synchronized void reset() {
        systemDirs = null;
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
