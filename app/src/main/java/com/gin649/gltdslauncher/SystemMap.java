package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** ES-DE system folders, the RetroAchievements console names they hold, and the RetroArch core for each. */
final class SystemMap {

    static final class Sys {
        String folder;
        String core = "";
        boolean hack;
        String standalone = "";   // the first standalone emulator for this system (id from emulators.json), or empty
        /** Every standalone emulator that can play this system, best first (includes the one above). */
        final List<String> standalones = new ArrayList<String>();
        /** Other RetroArch cores that can play this system besides {@link #core}. */
        final List<String> cores = new ArrayList<String>();
        /** For a folder found by name ("Game Boy Advance"): the built-in system it stands for ("gba"), else empty. */
        String base = "";
        final List<String> ra = new ArrayList<String>();

        /** This system's folders, one per ROM folder that has it, the preferred one first. */
        final List<File> dirs = new ArrayList<File>();
        /** For each of dirs: its place in Config.ROM_FOLDERS (lower is preferred). */
        final List<Integer> ranks = new ArrayList<Integer>();

        /** The preferred folder, or where it would be in the main ROMs folder when none is there right now. */
        File dir() {
            return dirs.isEmpty() ? new File(Config.ROMS_ROOT, folder) : dirs.get(0);
        }

        /** True when at least one of this system's folders can be read right now. */
        boolean present() {
            for (File d : dirs) {
                if (d.isDirectory()) return true;
            }
            return false;
        }

        /** The folder of this system that a file is in (the deepest when they nest), or null. */
        File dirOf(String path) {
            File best = null;
            for (File d : dirs) {
                String p = d.getPath() + "/";
                if (path.startsWith(p) && (best == null || p.length() > best.getPath().length() + 1)) best = d;
            }
            return best;
        }

        void addDir(File d, int rank) {
            if (dirs.contains(d)) return;
            // kept in order of preference, so dirs.get(0) is always the preferred folder
            int at = 0;
            while (at < ranks.size() && ranks.get(at) <= rank) at++;
            dirs.add(at, d);
            ranks.add(at, rank);
        }
    }

    final List<Sys> all = new ArrayList<Sys>();

    static SystemMap load(Context ctx) {
        SystemMap m = new SystemMap();
        try {
            m.merge(readAll(ctx.getAssets().open("systems.json")));
        } catch (Exception ignored) {
        }
        try {
            m.aliases = new JSONObject(readAll(ctx.getAssets().open("folder_aliases.json")));
        } catch (Exception ignored) {
        }
        try { // before the imports, so your own systems.json can refine what was found
            m.discover();
        } catch (Exception ignored) {
        }
        File imported = new File(ctx.getFilesDir(), "imported_systems.json");
        if (imported.isFile()) {
            try {
                m.merge(readAll(new FileInputStream(imported)));
            } catch (Exception ignored) {
            }
        }
        if (!Config.USER_DIR.isEmpty()) {
            File user = new File(Config.USER_DIR, "systems.json");
            if (user.isFile()) {
                try {
                    m.merge(readAll(new FileInputStream(user)));
                } catch (Exception ignored) {
                }
            }
        }
        m.attachDirs();
        return m;
    }

    /** Folder names to built-in systems ("Game Boy Advance" stands for "gba"), from folder_aliases.json. */
    private JSONObject aliases = new JSONObject();

    /**
     * The system a folder of this name holds: one with exactly that name, else the built-in system it stands for by
     * folder_aliases.json ("PS1" gives "psx"). Null when there is no match. The setup wizard uses this to tell what a
     * picked folder is.
     */
    String systemForName(String name) {
        if (name == null) return null;
        for (Sys s : all) {
            if (s.folder.equals(name)) return s.folder;
        }
        String canonical = aliasOf(name);
        if (canonical != null) return canonical;
        for (Sys s : all) {
            if (s.folder.equalsIgnoreCase(name)) return s.folder;
        }
        return null;
    }

    private String aliasOf(String name) {
        String key = Matcher.compact(name);
        if (key.isEmpty() || aliases == null) return null;
        java.util.Iterator<String> it = aliases.keys();
        while (it.hasNext()) {
            String base = it.next();
            JSONArray list = aliases.optJSONArray(base);
            if (list == null) continue;
            for (int i = 0; i < list.length(); i++) {
                if (key.equals(list.optString(i))) return base;
            }
        }
        return null;
    }

    /** The system with exactly this folder name, or null. */
    Sys byFolder(String folder) {
        for (Sys s : all) {
            if (s.folder.equals(folder)) return s;
        }
        return null;
    }

    /**
     * Gives every system its folders. A folder that holds one folder per system lends each of its system folders
     * to the system of that name. A single console's folder goes to the system picked for it in setup.
     */
    private void attachDirs() {
        for (int i = 0; i < Config.ROM_FOLDERS.size(); i++) {
            Config.RomFolder rf = Config.ROM_FOLDERS.get(i);
            File root = new File(rf.path);
            if (rf.allSystems()) {
                File[] kids = root.listFiles();
                if (kids == null) continue; // not there right now, like an SD card that is out
                for (File k : kids) {
                    if (!k.isDirectory() || k.getName().startsWith(".")) continue;
                    Sys s = byFolder(k.getName());
                    if (s != null) s.addDir(k, i);
                }
            } else {
                Sys s = byFolder(rf.system);
                if (s != null) s.addDir(root, i);
            }
        }
    }

    /** The built-in system folder name this folder stands for ("Game Boy Advance" gives "gba"), or the folder itself. */
    String baseOf(String folder) {
        for (Sys s : all) {
            if (s.folder.equals(folder)) return s.base.isEmpty() ? s.folder : s.base;
        }
        return folder;
    }

    /**
     * Folders in a ROMs folder that are not known by their exact name (where you name them yourself:
     * "Game Boy Advance", "SNES", "PS1") are matched to a built-in system by name from folder_aliases.json,
     * so they get its cores, RetroAchievements names and art lookups. Folders with no match are left alone.
     * Every ROMs folder is looked at, so a "PS2" folder that only exists on internal storage is found too.
     */
    private void discover() {
        for (Config.RomFolder rf : Config.ROM_FOLDERS) {
            if (!rf.allSystems()) continue;
            File[] dirs = new File(rf.path).listFiles();
            if (dirs == null) continue;
            for (File d : dirs) {
                if (!d.isDirectory() || d.getName().startsWith(".")) continue;
                String name = d.getName();
                if (byFolder(name) != null) continue;
                String canonical = aliasOf(name);
                if (canonical == null) continue;
                Sys src = byFolder(canonical);
                if (src == null) continue;
                Sys n = new Sys();
                n.folder = name;
                n.core = src.core;
                n.hack = src.hack;
                n.standalone = src.standalone;
                n.standalones.addAll(src.standalones);
                n.cores.addAll(src.cores);
                n.ra.addAll(src.ra);
                n.base = canonical;
                all.add(n);
            }
        }
    }

    private static String readAll(InputStream in) throws Exception {
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

    private Sys get(String folder) {
        for (Sys s : all) {
            if (s.folder.equals(folder)) return s;
        }
        Sys s = new Sys();
        s.folder = folder;
        all.add(s);
        return s;
    }

    private void merge(String json) throws JSONException {
        JSONArray arr = new JSONArray(json);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            Sys s = get(o.getString("folder"));
            if (o.has("core")) s.core = o.getString("core");
            if (o.has("hack")) s.hack = o.getBoolean("hack");
            if (o.has("standalone")) {
                s.standalone = o.optString("standalone", "");
                s.standalones.remove(s.standalone);
                if (!s.standalone.isEmpty()) s.standalones.add(0, s.standalone);
            }
            if (o.has("standalones")) {
                s.standalones.clear();
                JSONArray a = o.getJSONArray("standalones");
                for (int j = 0; j < a.length(); j++) s.standalones.add(a.getString(j));
                s.standalone = s.standalones.isEmpty() ? "" : s.standalones.get(0);
            }
            if (o.has("cores")) {
                s.cores.clear();
                JSONArray a = o.getJSONArray("cores");
                for (int j = 0; j < a.length(); j++) s.cores.add(a.getString(j));
            }
            if (o.has("ra")) {
                JSONArray r = o.getJSONArray("ra");
                // an empty list (a system imported from your frontend that has no RA name) must not wipe the built-in names
                if (r.length() > 0) {
                    s.ra.clear();
                    for (int j = 0; j < r.length(); j++) s.ra.add(r.getString(j));
                }
            }
        }
    }

    /** Systems that hold games for a RetroAchievements console name, such as "Game Boy Advance". */
    List<Sys> forConsole(String raConsole) {
        List<Sys> out = new ArrayList<Sys>();
        String key = Matcher.compact(raConsole);
        if (key.isEmpty()) return out;
        for (Sys s : all) {
            for (String name : s.ra) {
                if (Matcher.compact(name).equals(key)) {
                    out.add(s);
                    break;
                }
            }
        }
        if (!out.isEmpty() || key.length() < 4) return out;
        for (Sys s : all) {
            for (String name : s.ra) {
                String c = Matcher.compact(name);
                if (c.contains(key) || key.contains(c)) {
                    out.add(s);
                    break;
                }
            }
        }
        return out;
    }
}
