package com.gin649.gltdslauncher;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;


/** Paths and addresses, loaded from the setup wizard's choices. */
final class Config {

    /** The tracker bundled in the APK, served from assets/www by WebViewAssetLoader. */
    static final String APP_HOST_BUILTIN = "appassets.androidplatform.net";
    static final String BUILTIN_URL = "https://" + APP_HOST_BUILTIN + "/assets/www/index.html";
    /** Saved address meaning "use the built-in tracker". */
    static final String DEFAULT_URL = "";
    /** Address older builds saved by default; treated as "use the built-in tracker". */
    private static final String LEGACY_URL = "https://gin649.github.io/Game-Log-Tracker-Frontend/";
    static final String RA_ACTIVITY = "com.retroarch.browser.retroactivity.RetroActivityFuture";

    static String START_URL = BUILTIN_URL;
    static String APP_HOST = APP_HOST_BUILTIN;

    /**
     * The first ROM folder that holds one folder per system, or "" when there is none. Older code paths that only
     * know about one folder (the file picker's starting place, say) use this. Everything that has to cover every
     * folder goes through ROM_FOLDERS.
     */
    static String ROMS_ROOT = "";

    /**
     * One ROM folder picked in setup. system is empty for a folder that holds one folder per system (the ES-DE
     * layout, where names like "PS1" are recognised too), or the system it stands for when the folder holds a
     * single console's games, like a PS2 folder on internal storage.
     */
    static final class RomFolder {
        final String path;
        final String tree;
        final String system;

        RomFolder(String path, String tree, String system) {
            this.path = trim(path);
            this.tree = tree == null ? "" : tree;
            this.system = system == null ? "" : system.trim();
        }

        boolean allSystems() {
            return system.isEmpty();
        }
    }

    /** Every ROM folder, the preferred one first. When a game is in more than one, Play uses the earliest. */
    static List<RomFolder> ROM_FOLDERS = new ArrayList<RomFolder>();
    static String ES_ROOT = "";
    static String MEDIA_ROOT = "";
    /** The wizard's "use my frontend media" choice (ES-DE). Use useEsdeMedia() to ask whether it actually applies. */
    static boolean USE_ESDE_MEDIA = true;
    /** Optional hand-edited overrides live here: systems.json and emulators.json. */
    static String USER_DIR = "";

    /** Folder chosen for the app's own files (saved data, fetched art); empty means the default, see DataStore. */
    static String DATA_ROOT = "";

    static String RA_PACKAGE = "com.retroarch.aarch64";
    static String RA_CORES_DIR = "/data/data/com.retroarch.aarch64/cores";
    static String RA_CONFIG = "/storage/emulated/0/Android/data/com.retroarch.aarch64/files/retroarch.cfg";

    private Config() {}

    /** LaunchBox art for games that have none from the frontend or SteamGridDB. */
    static boolean LAUNCHBOX_ART = true;

    /**
     * True when the choice to use frontend media is on and there is somewhere to look: ES-DE's downloaded_media,
     * or just the ROMs folder (art generated beside the ROMs, gamelist.xml).
     */
    static boolean useEsdeMedia() {
        return USE_ESDE_MEDIA && !ROM_FOLDERS.isEmpty();
    }

    /** True for a file that sits in any folder that belongs to a frontend (so it is theirs, not built by this app). */
    static boolean isFrontendMedia(String path) {
        if (path == null) return false;
        if (!MEDIA_ROOT.isEmpty() && path.startsWith(MEDIA_ROOT + "/")) return true;
        for (RomFolder f : ROM_FOLDERS) {
            if (path.startsWith(f.path + "/")) return true;
        }
        return false;
    }

    static void load(Context c) {
        String saved = Prefs.get(c, "siteUrl", DEFAULT_URL).trim();
        if (saved.isEmpty() || saved.equals(LEGACY_URL) || !saved.startsWith("http")) {
            START_URL = BUILTIN_URL;
        } else {
            START_URL = saved.endsWith("/") ? saved : saved + "/";
        }
        String host = Uri.parse(START_URL).getHost();
        APP_HOST = host == null ? "" : host;

        ROM_FOLDERS = parseRomFolders(Prefs.get(c, "romsFolders", ""),
                Prefs.get(c, "romsRoot", ""), Prefs.get(c, "romsTree", ""));
        ROMS_ROOT = firstAllSystems(ROM_FOLDERS);
        String fe = Prefs.get(c, "frontend", "");
        if (fe.isEmpty()) fe = Prefs.get(c, "esRoot", "").isEmpty() ? "none" : "esde"; // installs from before the choice existed
        ES_ROOT = fe.equals("esde") ? trim(Prefs.get(c, "esRoot", "")) : "";
        MEDIA_ROOT = ES_ROOT.isEmpty() ? "" : ES_ROOT + "/downloaded_media";
        // hand-edited overrides (systems.json, emulators.json, launchbox.json) live in a gltthor folder in the ES-DE folder
        USER_DIR = ES_ROOT.isEmpty() ? "" : ES_ROOT + "/gltthor";
        DATA_ROOT = trim(Prefs.get(c, "dataRoot", ""));
        USE_ESDE_MEDIA = Prefs.getInt(c, "useEsdeMedia", 1) == 1;
        LAUNCHBOX_ART = Prefs.getInt(c, "launchboxArt", 1) == 1;

        RA_PACKAGE = Prefs.get(c, "raPackage", "com.retroarch.aarch64");
        RA_CORES_DIR = "/data/data/" + RA_PACKAGE + "/cores";
        RA_CONFIG = "/storage/emulated/0/Android/data/" + RA_PACKAGE + "/files/retroarch.cfg";
    }

    /**
     * Reads the saved folder list. Installs from before there could be more than one folder only have romsRoot and
     * romsTree, so those become a one-folder list and nobody has to run setup again.
     */
    static List<RomFolder> parseRomFolders(String json, String legacyRoot, String legacyTree) {
        List<RomFolder> out = new ArrayList<RomFolder>();
        if (json != null && !json.trim().isEmpty()) {
            try {
                JSONArray a = new JSONArray(json);
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.optJSONObject(i);
                    if (o == null) continue;
                    RomFolder f = new RomFolder(o.optString("path", ""), o.optString("tree", ""), o.optString("system", ""));
                    if (!f.path.isEmpty() && !hasPath(out, f.path)) out.add(f);
                }
                return out;
            } catch (Exception ignored) {
                // a list that can't be read falls back to the single folder below
            }
        }
        String root = trim(legacyRoot);
        if (!root.isEmpty()) out.add(new RomFolder(root, legacyTree, ""));
        return out;
    }

    static String romFoldersJson(List<RomFolder> list) {
        JSONArray a = new JSONArray();
        try {
            for (RomFolder f : list) {
                JSONObject o = new JSONObject();
                o.put("path", f.path);
                o.put("tree", f.tree);
                o.put("system", f.system);
                a.put(o);
            }
        } catch (Exception ignored) {
        }
        return a.toString();
    }

    static boolean hasPath(List<RomFolder> list, String path) {
        String p = trim(path);
        for (RomFolder f : list) {
            if (f.path.equals(p)) return true;
        }
        return false;
    }

    /** The first folder that holds one folder per system, else the first folder of any kind, else "". */
    static String firstAllSystems(List<RomFolder> list) {
        for (RomFolder f : list) {
            if (f.allSystems()) return f.path;
        }
        return list.isEmpty() ? "" : list.get(0).path;
    }

    /**
     * Which ROM folder a file is in, by its place in ROM_FOLDERS, or -1 when it is in none. Real paths are compared
     * so "../" in a path can't reach outside. When folders sit inside each other the deepest one counts.
     */
    static int romFolderOf(File f) {
        if (f == null) return -1;
        try {
            String p = f.getCanonicalPath();
            int best = -1, bestLen = -1;
            for (int i = 0; i < ROM_FOLDERS.size(); i++) {
                String root = new File(ROM_FOLDERS.get(i).path).getCanonicalPath() + "/";
                if (p.startsWith(root) && root.length() > bestLen) {
                    best = i;
                    bestLen = root.length();
                }
            }
            return best;
        } catch (Exception e) {
            return -1;
        }
    }

    /** True for a file inside any of the ROM folders. */
    static boolean inRomFolders(File f) {
        return romFolderOf(f) >= 0;
    }

    /** True when at least one ROM folder can be read right now (an SD card that is out can't). */
    static boolean anyRomFolderReadable() {
        for (RomFolder f : ROM_FOLDERS) {
            if (new File(f.path).isDirectory()) return true;
        }
        return false;
    }

    /** A short way to say where a folder is, for the Play menu: "SD card: Roms" or "Internal storage: PS2". */
    static String folderLabel(String path) {
        String p = trim(path);
        String where;
        String rest;
        if (p.startsWith("/storage/emulated/0")) {
            where = "Internal storage";
            rest = p.substring("/storage/emulated/0".length());
        } else if (p.startsWith("/storage/")) {
            where = "SD card";
            int cut = p.indexOf('/', "/storage/".length());
            rest = cut < 0 ? "" : p.substring(cut);
        } else {
            where = "Folder";
            rest = p;
        }
        while (rest.startsWith("/")) rest = rest.substring(1);
        return rest.isEmpty() ? where : where + ": " + rest;
    }

    static String trim(String s) {
        if (s == null) return "";
        s = s.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
