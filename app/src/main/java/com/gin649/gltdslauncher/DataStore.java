package com.gin649.gltdslauncher;

import android.content.Context;
import android.os.Environment;

import com.gin649.gltdslauncher.database.GameRepository;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Where the app keeps its own files: the tracker's saved data (one text file per key), fetched game art and the
 * art index. By default this is a GameLogTracker folder in shared storage, so it survives an uninstall or a switch
 * between debug and release builds; the setup wizard can point it anywhere. Without file access it falls back to the
 * app's private folder.
 */
final class DataStore {

    static final String DEFAULT_FOLDER = "GameLogTracker";
    private static final int CHUNK = 512 * 1024; // characters per bridge call

    private DataStore() {}

    /** The folder everything is kept in. */
    static File root(Context ctx) {
        String chosen = Config.DATA_ROOT;
        boolean all = false;
        try {
            all = Environment.isExternalStorageManager();
        } catch (Exception ignored) {
        }
        File c = rootCache;
        if (c != null && chosen.equals(rootFor) && all == rootAll) return c;
        File dir = chosen.isEmpty() ? defaultRoot() : new File(chosen);
        File out = (dir != null && usable(dir)) ? dir : ctx.getFilesDir();
        rootFor = chosen;
        rootAll = all;
        rootCache = out;
        return out;
    }

    // checking that the folder exists and can be written to costs a few file-system calls; do it once, not on every read
    private static volatile File rootCache;
    private static volatile String rootFor;
    private static volatile boolean rootAll;

    /** The folder used when none was chosen, or null without file access. */
    static File defaultRoot() {
        try {
            if (!Environment.isExternalStorageManager()) return null;
        } catch (Exception e) {
            return null;
        }
        return new File(Environment.getExternalStorageDirectory(), DEFAULT_FOLDER);
    }

    private static boolean usable(File dir) {
        if (!dir.isDirectory() && !dir.mkdirs()) return false;
        return dir.canWrite();
    }

    /** Where ROM hack patches downloaded in the viewer go, or null when the data folder isn't on shared storage. */
    static File hackDownloads(Context ctx) {
        File r = root(ctx);
        if (r.getPath().startsWith(ctx.getFilesDir().getPath())) return null; // the download manager can't write there
        File d = new File(r, "downloaded rom hack files");
        return (d.isDirectory() || d.mkdirs()) ? d : null;
    }

    static File dataDir(Context ctx) {
        File d = new File(root(ctx), "data");
        d.mkdirs();
        return d;
    }

    // saved values: one file per key

    private static String encode(String key) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (byte b : key.getBytes("UTF-8")) {
            int c = b & 0xFF;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_') {
                sb.append((char) c);
            } else {
                sb.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16))).append(Character.toUpperCase(Character.forDigit(c & 15, 16)));
            }
        }
        return sb.toString();
    }

    private static String decode(String name) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == '%' && i + 2 < name.length()) {
                out.write(Integer.parseInt(name.substring(i + 1, i + 3), 16));
                i += 2;
            } else {
                out.write(c);
            }
        }
        return out.toString("UTF-8");
    }

    private static File fileFor(Context ctx, String key) throws IOException {
        String enc = encode(key);
        if (enc.length() > 180) throw new IOException("key too long");
        return new File(dataDir(ctx), enc + ".txt");
    }

    /** Keys that start with prefix. */
    static List<String> list(Context ctx, String prefix) {
        List<String> out = new ArrayList<String>();
        for (String n : CacheDb.get(ctx).names(prefix)) {
            if (!out.contains(n)) out.add(n);
        }
        File[] files = dataDir(ctx).listFiles();
        if (files == null) return out;
        for (File f : files) {
            String n = f.getName();
            if (!n.endsWith(".txt")) continue;
            try {
                String key = decode(n.substring(0, n.length() - 4));
                if (key.startsWith(prefix) && !out.contains(key)) out.add(key);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    /** The value for a name in one call, or null when there is none. Large values are returned whole. */
    static String get(Context ctx, String key) {
        try {
            return read(ctx, key);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Moves the old one-file-per-entry caches into the database, once. Reading and deleting hundreds of small files
     * from shared storage takes a moment, so this only runs the first time.
     */
    private static synchronized void migrateCaches(Context ctx) {
        if (Prefs.getInt(ctx, "cacheDbMigrated", 0) == 1) return;
        long t0 = System.currentTimeMillis();
        List<String[]> rows = new ArrayList<String[]>();
        List<File> done = new ArrayList<File>();
        File[] files = dataDir(ctx).listFiles();
        if (files != null) {
            for (File f : files) {
                String n = f.getName();
                if (!n.endsWith(".txt")) continue;
                try {
                    String key = decode(n.substring(0, n.length() - 4));
                    if (!CacheDb.isCache(key)) continue;
                    rows.add(new String[]{key, new String(readAll(f), "UTF-8")});
                    done.add(f);
                } catch (Exception ignored) {
                }
            }
        }
        CacheDb.get(ctx).writeAll(rows);
        for (File f : done) f.delete();
        Prefs.putInt(ctx, "cacheDbMigrated", 1);
        Perf.add("cache migration", System.currentTimeMillis() - t0);
    }

    /**
     * Every saved value up to maxEach characters, as one JSON object of name -> text, stopping at maxTotal. Reading
     * these one at a time from the page costs two calls into the app each, which added up to seconds at start-up.
     */
    static String preload(Context ctx, int maxEach, int maxTotal) {
        long p0 = System.currentTimeMillis();
        migrateCaches(ctx);
        Perf.add("preload.step migrate", System.currentTimeMillis() - p0);
        org.json.JSONObject out = new org.json.JSONObject();
        int total = 0;
        long p1 = System.currentTimeMillis();
        File[] files = dataDir(ctx).listFiles();
        Perf.add("preload.step list files", System.currentTimeMillis() - p1);
        long p2 = System.currentTimeMillis();
        if (files != null) {
            Perf.add("preload.files in folder", files.length);
            for (File f : files) {
                String n = f.getName();
                if (!n.endsWith(".txt") || f.length() > maxEach * 3L) continue;
                try {
                    String key = decode(n.substring(0, n.length() - 4));
                    String text = new String(readAll(f), "UTF-8");
                    if (text.length() > maxEach) continue;
                    total += text.length();
                    out.put(key, text);
                    int colon = key.indexOf(':', key.indexOf(':') + 1);
                    Perf.add("preload.file kind " + (colon > 0 ? key.substring(0, colon) : key), 0);
                } catch (Exception ignored) {
                }
            }
        }
        Perf.add("preload.step read files", System.currentTimeMillis() - p2);
        // then the newest cache entries, up to the size limit
        long p3 = System.currentTimeMillis();
        CacheDb.get(ctx).preloadInto(out, maxEach, Math.max(0, maxTotal - total));
        Perf.add("preload.step cache rows", System.currentTimeMillis() - p3);
        Perf.add("preload.text size (chars)", total);
        return out.toString();
    }

    private static String cachedKey;
    private static long cachedStamp;
    private static String cachedText;

    private static synchronized String read(Context ctx, String key) throws IOException {
        long t0 = System.currentTimeMillis();
        if (CacheDb.isCache(key)) {
            migrateCaches(ctx);
            String v = CacheDb.get(ctx).read(key);
            Perf.add("cache.read", System.currentTimeMillis() - t0);
            return v;
        }
        File f = fileFor(ctx, key);
        if (!f.isFile()) {
            Perf.add("data.read (missing)", System.currentTimeMillis() - t0);
            return null;
        }
        if (key.equals(cachedKey) && f.lastModified() == cachedStamp && f.length() > 0) return cachedText;
        String text = new String(readAll(f), "UTF-8");
        Perf.add("data.read (" + (text.length() > 100000 ? "big" : "small") + ")", System.currentTimeMillis() - t0);
        cachedKey = key;
        cachedStamp = f.lastModified();
        cachedText = text;
        return text;
    }

    /** How many pieces the value is read in, or -1 when there is none. */
    static int chunks(Context ctx, String key) {
        try {
            String t = read(ctx, key);
            if (t == null) return -1;
            return Math.max(1, (t.length() + CHUNK - 1) / CHUNK);
        } catch (Exception e) {
            return -1;
        }
    }

    static String chunk(Context ctx, String key, int index) {
        try {
            String t = read(ctx, key);
            if (t == null) return null;
            int from = index * CHUNK;
            if (from > t.length()) return "";
            return t.substring(from, Math.min(t.length(), from + CHUNK));
        } catch (Exception e) {
            return null;
        }
    }

    /** Writes one piece of a value. Piece 0 starts it; the last piece puts it in place. Returns false if anything failed. */
    private static final java.util.Map<String, StringBuilder> PENDING = new java.util.HashMap<String, StringBuilder>();

    static synchronized boolean put(Context ctx, String key, int index, String piece, boolean last) {
        if (CacheDb.isCache(key)) {
            migrateCaches(ctx);
            StringBuilder sb = index == 0 ? new StringBuilder() : PENDING.get(key);
            if (sb == null) return false;
            sb.append(piece);
            if (!last) {
                PENDING.put(key, sb);
                return true;
            }
            PENDING.remove(key);
            return CacheDb.get(ctx).write(key, sb.toString());
        }
        try {
            File f = fileFor(ctx, key);
            File tmp = new File(f.getPath() + ".tmp");
            if (index == 0 && tmp.exists()) tmp.delete();
            FileOutputStream out = new FileOutputStream(tmp, true);
            try {
                out.write(piece.getBytes("UTF-8"));
            } finally {
                out.close();
            }
            if (last) {
                if (f.exists() && !f.delete()) return false;
                if (!tmp.renameTo(f)) return false;
                if (key.equals(cachedKey)) cachedKey = null;
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static synchronized boolean delete(Context ctx, String key) {
        if (CacheDb.isCache(key)) {
            migrateCaches(ctx);
            PENDING.remove(key);
            return CacheDb.get(ctx).remove(key);
        }
        try {
            File f = fileFor(ctx, key);
            if (key.equals(cachedKey)) cachedKey = null;
            return !f.exists() || f.delete();
        } catch (Exception e) {
            return false;
        }
    }

    // changing the folder

    /**
     * Copies everything the app keeps from one folder to another, then removes the old copies. Returns false if
     * something could not be copied, in which case nothing is removed.
     */
    static boolean move(File from, File to) {
        if (from.equals(to)) return true;
        String[] parts = {"data", "miximages", "launchbox"};
        boolean ok = true;
        for (String p : parts) {
            File src = new File(from, p);
            if (!src.isDirectory()) continue;
            try {
                copyTree(src, new File(to, p));
            } catch (IOException e) {
                ok = false;
            }
        }
        if (ok) {
            for (String p : parts) deleteTree(new File(from, p));
        }
        return ok;
    }

    private static volatile boolean relocating;

    /** Moves saved files (and the paths the game list remembers) from one app folder to another, in the background. */
    static void relocate(final Context ctx, final File from, final File to) {
        if (from.equals(to) || relocating) return;
        relocating = true;
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (move(from, to)) {
                        GameRepository.get(app).dao().rebasePaths(from.getPath(), to.getPath());
                    }
                } catch (Exception ignored) {
                } finally {
                    relocating = false;
                }
            }
        }, "data-move").start();
    }

    private static void copyTree(File src, File dst) throws IOException {
        if (src.isDirectory()) {
            if (!dst.isDirectory() && !dst.mkdirs()) throw new IOException("cannot create " + dst);
            File[] kids = src.listFiles();
            if (kids == null) return;
            for (File k : kids) copyTree(k, new File(dst, k.getName()));
        } else {
            InputStream in = new FileInputStream(src);
            try {
                OutputStream out = new FileOutputStream(dst);
                try {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                } finally {
                    out.close();
                }
            } finally {
                in.close();
            }
        }
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) {
            for (File k : kids) deleteTree(k);
        }
        f.delete();
    }

    private static byte[] readAll(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }
}
