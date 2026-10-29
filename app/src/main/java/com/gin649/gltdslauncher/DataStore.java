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
        File dir = chosen.isEmpty() ? defaultRoot() : new File(chosen);
        if (dir != null && usable(dir)) return dir;
        return ctx.getFilesDir();
    }

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
        File[] files = dataDir(ctx).listFiles();
        if (files == null) return out;
        for (File f : files) {
            String n = f.getName();
            if (!n.endsWith(".txt")) continue;
            try {
                String key = decode(n.substring(0, n.length() - 4));
                if (key.startsWith(prefix)) out.add(key);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    private static String cachedKey;
    private static long cachedStamp;
    private static String cachedText;

    private static synchronized String read(Context ctx, String key) throws IOException {
        File f = fileFor(ctx, key);
        if (!f.isFile()) return null;
        if (key.equals(cachedKey) && f.lastModified() == cachedStamp && f.length() > 0) return cachedText;
        String text = new String(readAll(f), "UTF-8");
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
    static synchronized boolean put(Context ctx, String key, int index, String piece, boolean last) {
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
