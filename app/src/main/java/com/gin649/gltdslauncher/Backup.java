package com.gin649.gltdslauncher;

import android.content.Context;
import android.content.UriPermission;

import com.gin649.gltdslauncher.database.GameDao;
import com.gin649.gltdslauncher.database.GameEntity;
import com.gin649.gltdslauncher.database.GameRepository;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The launcher's part of a backup, and backup files kept on the device.
 *
 * The tracker builds a backup (its saved data and the playtime counted on this device) and asks for appSettings()
 * to add the launcher's own settings: ROM folders, emulator picks for each console and game, your launch commands,
 * screens, patched ROM notes, and the favourites, play counts and picked art of each game. Logins and keys are never
 * written in.
 *
 * Backup files go to a Backups folder in the app data folder (GameLogTracker by default), which an uninstall leaves
 * alone. One is made automatically each day the app is used and the last few are kept; ones made by hand are kept
 * until you delete them.
 */
final class Backup {

    static final String FOLDER = "Backups";
    private static final int KEEP_AUTO = 3;
    private static final int KEEP_BEFORE_RESTORE = 3;
    private static final long AUTO_EVERY_MS = 20L * 60 * 60 * 1000; // about once a day, whatever time the app is opened
    private static final int CHUNK = 512 * 1024; // characters per bridge call, as in DataStore
    private static final String LAST_AUTO = "lastAutoBackup";

    /** Settings a backup leaves out: logins and keys, and ones that only make sense for this install. */
    private static final Set<String> NOT_SAVED = new HashSet<String>(Arrays.asList(
            "raKey", "sgdbKey", "credsRev", "wizardDraft", LAST_AUTO));
    /**
     * Settings a restore leaves as they are. The data folder is where the restored data is being written, so moving it
     * would lose that; and setup should still run on a new device, where folder permissions have to be given again.
     */
    private static final Set<String> NOT_RESTORED = new HashSet<String>(Arrays.asList("dataRoot", "setupDone"));

    private Backup() {}

    // what goes into a backup

    static JSONObject appSettings(Context ctx) throws Exception {
        JSONObject out = new JSONObject();
        out.put("version", 1);

        JSONObject settings = new JSONObject();
        for (Map.Entry<String, ?> e : Prefs.all(ctx).entrySet()) {
            String k = e.getKey();
            Object v = e.getValue();
            if (NOT_SAVED.contains(k) || v == null) continue;
            JSONObject item = new JSONObject();
            if (v instanceof Boolean) item.put("t", "b").put("v", v);
            else if (v instanceof Integer) item.put("t", "i").put("v", v);
            else if (v instanceof Long) item.put("t", "l").put("v", v);
            else if (v instanceof Float) item.put("t", "f").put("v", ((Float) v).doubleValue());
            else if (v instanceof Set) item.put("t", "ss").put("v", new JSONArray((Set<?>) v));
            else item.put("t", "s").put("v", String.valueOf(v));
            settings.put(k, item);
        }
        out.put("settings", settings);

        // only rows that hold something a rescan can't bring back
        JSONArray games = new JSONArray();
        GameDao dao = GameRepository.get(ctx).dao();
        for (GameEntity g : dao.getAllGames()) {
            if (!g.favorite && g.playCount == 0 && g.localMiximagePath == null) continue;
            JSONObject o = new JSONObject();
            o.put("system", g.systemId);
            o.put("path", g.romPath);
            o.put("title", g.title);
            if (g.favorite) o.put("favorite", true);
            if (g.playCount > 0) o.put("plays", g.playCount);
            if (g.localMiximagePath != null) o.put("art", g.localMiximagePath);
            games.put(o);
        }
        out.put("games", games);
        return out;
    }

    /**
     * Puts a backup's launcher settings back. Settings already here that the backup doesn't have are kept. Returns
     * {ok, message, regrant}: regrant lists ROM folders whose permission has to be given again in setup (a new device,
     * or a reinstall), which still work in the meantime wherever the emulator can read the file by its path.
     */
    static JSONObject restore(Context ctx, JSONObject in) {
        JSONObject res = new JSONObject();
        try {
            Set<String> granted = new HashSet<String>();
            for (UriPermission p : ctx.getContentResolver().getPersistedUriPermissions()) {
                if (p.isReadPermission()) granted.add(p.getUri().toString());
            }
            JSONArray regrant = new JSONArray();

            Map<String, Object> values = new HashMap<String, Object>();
            JSONObject settings = in.optJSONObject("settings");
            if (settings != null) {
                Iterator<String> keys = settings.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    if (NOT_SAVED.contains(k) || NOT_RESTORED.contains(k)) continue;
                    JSONObject item = settings.optJSONObject(k);
                    if (item == null) continue;
                    Object v = valueOf(item);
                    if (v != null) values.put(k, v);
                }
            }

            // a folder's permission belongs to the install that was given it: keep it only if this one still holds it
            Object folders = values.get("romsFolders");
            if (folders instanceof String) {
                List<Config.RomFolder> list = Config.parseRomFolders((String) folders, "", "");
                List<Config.RomFolder> kept = new ArrayList<Config.RomFolder>();
                for (Config.RomFolder f : list) {
                    boolean ok = f.tree.isEmpty() || granted.contains(f.tree);
                    if (!ok) regrant.put(f.path);
                    kept.add(ok ? f : new Config.RomFolder(f.path, "", f.system));
                }
                values.put("romsFolders", Config.romFoldersJson(kept));
            }
            Object tree = values.get("romsTree");
            if (tree instanceof String && !((String) tree).isEmpty() && !granted.contains(tree)) values.put("romsTree", "");

            Prefs.putAll(ctx, values);

            int games = restoreGames(ctx, in.optJSONArray("games"));

            Config.load(ctx);
            Recipes.reset();
            LaunchBoxArt.reset();
            PatchedRoms.load(ctx);
            Shared.reload(ctx);

            res.put("ok", true);
            res.put("settings", values.size());
            res.put("games", games);
            res.put("regrant", regrant);
            res.put("message", "Restored " + values.size() + " settings and " + games + " games' play counts and art.");
        } catch (Exception e) {
            try {
                res.put("ok", false);
                res.put("message", "Could not restore the launcher settings: " + e.getMessage());
            } catch (Exception ignored) {
            }
        }
        return res;
    }

    private static Object valueOf(JSONObject item) throws Exception {
        String t = item.optString("t", "s");
        if (!item.has("v")) return null;
        if (t.equals("b")) return item.getBoolean("v");
        if (t.equals("i")) return item.getInt("v");
        if (t.equals("l")) return item.getLong("v");
        if (t.equals("f")) return (float) item.getDouble("v");
        if (t.equals("ss")) {
            JSONArray a = item.getJSONArray("v");
            Set<String> s = new HashSet<String>();
            for (int i = 0; i < a.length(); i++) s.add(a.getString(i));
            return s;
        }
        return item.getString("v");
    }

    /** Favourites, play counts and picked art, matched to games by their ROM's path. Returns how many were put back. */
    private static int restoreGames(Context ctx, JSONArray games) {
        if (games == null) return 0;
        GameDao dao = GameRepository.get(ctx).dao();
        int n = 0;
        for (int i = 0; i < games.length(); i++) {
            JSONObject o = games.optJSONObject(i);
            if (o == null) continue;
            String sys = o.optString("system", "");
            String path = o.optString("path", "");
            if (sys.isEmpty() || path.isEmpty()) continue;
            try {
                GameEntity g = dao.findByRom(sys, path);
                if (g == null) {
                    // not scanned yet (a new install): add it, the next scan keeps it if the file is there
                    dao.insertIfAbsent(GameEntity.scanned(o.optString("title", new File(path).getName()), path, sys));
                    g = dao.findByRom(sys, path);
                }
                if (g == null) continue;
                if (o.optBoolean("favorite", false)) g.favorite = true;
                g.playCount = Math.max(g.playCount, o.optInt("plays", 0));
                String art = o.optString("art", "");
                if (!art.isEmpty() && new File(art).isFile()) g.localMiximagePath = art;
                dao.insertGame(g);
                n++;
            } catch (Exception ignored) {
                // one game that can't be put back doesn't stop the rest
            }
        }
        return n;
    }

    // backup files on the device

    static File dir(Context ctx) {
        File d = new File(DataStore.root(ctx), FOLDER);
        d.mkdirs();
        return d;
    }

    /** True when the daily automatic backup hasn't been made yet. */
    static boolean due(Context ctx) {
        long last = 0;
        try {
            last = Long.parseLong(Prefs.get(ctx, LAST_AUTO, "0"));
        } catch (Exception ignored) {
        }
        long now = System.currentTimeMillis();
        return last > now || now - last > AUTO_EVERY_MS; // a clock set back counts as due
    }

    private static final Map<String, File[]> WRITING = new HashMap<String, File[]>(); // id -> {part file, final file}
    private static int counter;

    /** kind: "auto", "manual" or "before-restore". Returns an id for chunk() and end(), or "" when it can't be written. */
    static synchronized String begin(Context ctx, String kind) {
        try {
            String stamp = new SimpleDateFormat(kind.equals("auto") ? "yyyy-MM-dd" : "yyyy-MM-dd-HHmmss", Locale.ROOT).format(new Date());
            String prefix = kind.equals("auto") ? "auto" : kind.equals("before-restore") ? "before-restore" : "backup";
            File dir = dir(ctx);
            File out = new File(dir, prefix + "-" + stamp + ".json");
            File part = new File(dir, "." + out.getName() + ".part");
            Writer w = new OutputStreamWriter(new FileOutputStream(part, false), "UTF-8");
            w.close();
            String id = String.valueOf(++counter) + "-" + Long.toHexString(System.nanoTime());
            WRITING.put(id, new File[]{part, out});
            return id;
        } catch (Exception e) {
            return "";
        }
    }

    static synchronized boolean chunk(String id, String piece) {
        File[] f = WRITING.get(id);
        if (f == null) return false;
        try {
            Writer w = new OutputStreamWriter(new FileOutputStream(f[0], true), "UTF-8");
            try {
                w.write(piece);
            } finally {
                w.close();
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Finishes a file: only a complete backup gets its real name, so a half-written one is never offered. */
    static synchronized JSONObject end(Context ctx, String id) {
        JSONObject o = new JSONObject();
        File[] f = WRITING.remove(id);
        try {
            if (f == null || !f[0].isFile() || f[0].length() == 0) {
                o.put("ok", false);
                o.put("message", "The backup could not be written.");
                return o;
            }
            if (f[1].exists()) f[1].delete(); // the same day's automatic backup is replaced by the newer one
            if (!f[0].renameTo(f[1])) {
                o.put("ok", false);
                o.put("message", "The backup could not be saved in " + f[1].getParent() + ".");
                return o;
            }
            String name = f[1].getName();
            if (name.startsWith("auto-")) Prefs.put(ctx, LAST_AUTO, String.valueOf(System.currentTimeMillis()));
            prune(ctx);
            o.put("ok", true);
            o.put("name", name);
            o.put("path", f[1].getPath());
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("message", "The backup could not be written.");
            } catch (Exception ignored) {
            }
        }
        return o;
    }

    /** Drops the oldest automatic backups, and the oldest copies made before a restore, beyond the number kept. */
    private static void prune(Context ctx) {
        List<File> auto = new ArrayList<File>();
        List<File> before = new ArrayList<File>();
        for (File f : files(ctx)) {
            if (f.getName().startsWith("auto-")) auto.add(f);
            else if (f.getName().startsWith("before-restore-")) before.add(f);
        }
        for (int i = KEEP_AUTO; i < auto.size(); i++) auto.get(i).delete();
        for (int i = KEEP_BEFORE_RESTORE; i < before.size(); i++) before.get(i).delete();
    }

    /** Finished backup files, newest first. */
    private static List<File> files(Context ctx) {
        List<File> out = new ArrayList<File>();
        File[] kids = dir(ctx).listFiles();
        if (kids == null) return out;
        for (File f : kids) {
            if (f.isFile() && !f.getName().startsWith(".") && f.getName().endsWith(".json")) out.add(f);
        }
        java.util.Collections.sort(out, new java.util.Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return Long.compare(b.lastModified(), a.lastModified());
            }
        });
        return out;
    }

    /** [{name, path, size, time, kind}] for the Data window, newest first. */
    static JSONArray list(Context ctx) {
        JSONArray out = new JSONArray();
        for (File f : files(ctx)) {
            try {
                String n = f.getName();
                JSONObject o = new JSONObject();
                o.put("name", n);
                o.put("path", f.getPath());
                o.put("size", f.length());
                o.put("time", f.lastModified());
                o.put("kind", n.startsWith("auto-") ? "auto" : n.startsWith("before-restore-") ? "before-restore" : "manual");
                out.put(o);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    /** The backup file at this path, only when it is one of the files in the Backups folder; else null. */
    static File fileAt(Context ctx, String path) {
        try {
            File f = new File(path);
            String dir = dir(ctx).getCanonicalPath() + "/";
            return f.getCanonicalPath().startsWith(dir) && f.isFile() && f.getName().endsWith(".json") ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static final Map<String, String> READ_CACHE = new HashMap<String, String>();

    /** How many pieces readChunk() splits this backup into, or -1 when it can't be read. */
    static synchronized int chunks(Context ctx, String path) {
        File f = fileAt(ctx, path);
        if (f == null) return -1;
        try {
            StringBuilder sb = new StringBuilder();
            Reader r = new InputStreamReader(new FileInputStream(f), "UTF-8");
            try {
                char[] buf = new char[8192];
                int n;
                while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            } finally {
                r.close();
            }
            READ_CACHE.clear(); // one backup at a time is read
            READ_CACHE.put(f.getPath(), sb.toString());
            return Math.max(1, (sb.length() + CHUNK - 1) / CHUNK);
        } catch (Exception e) {
            return -1;
        }
    }

    static synchronized String readChunk(Context ctx, String path, int index) {
        File f = fileAt(ctx, path);
        String text = f == null ? null : READ_CACHE.get(f.getPath());
        if (text == null) return "";
        int from = Math.min(text.length(), index * CHUNK);
        int to = Math.min(text.length(), from + CHUNK);
        if (to >= text.length()) READ_CACHE.remove(f.getPath()); // the last piece has been asked for
        return text.substring(from, to);
    }

    static boolean delete(Context ctx, String path) {
        File f = fileAt(ctx, path);
        return f != null && f.delete();
    }
}
