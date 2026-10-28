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
        String standalone = "";   // id from emulators.json, or empty
        /** For a folder found by name ("Game Boy Advance"): the built-in system it stands for ("gba"), else empty. */
        String base = "";
        final List<String> ra = new ArrayList<String>();

        File dir() {
            return new File(Config.ROMS_ROOT, folder);
        }
    }

    final List<Sys> all = new ArrayList<Sys>();

    static SystemMap load(Context ctx) {
        SystemMap m = new SystemMap();
        try {
            m.merge(readAll(ctx.getAssets().open("systems.json")));
        } catch (Exception ignored) {
        }
        try { // before the imports, so a Daijisho platform file or your own systems.json can refine what was found
            m.discover(ctx);
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
        return m;
    }

    /** The built-in system folder name this folder stands for ("Game Boy Advance" gives "gba"), or the folder itself. */
    String baseOf(String folder) {
        for (Sys s : all) {
            if (s.folder.equals(folder)) return s.base.isEmpty() ? s.folder : s.base;
        }
        return folder;
    }

    /**
     * Folders in the ROMs folder that are not known by their exact name (common with Daijisho, where you name them
     * yourself: "Game Boy Advance", "SNES", "PS1") are matched to a built-in system by name from folder_aliases.json,
     * so they get its cores, RetroAchievements names and art lookups. Folders with no match are left alone.
     */
    private void discover(Context ctx) throws Exception {
        if (Config.ROMS_ROOT.isEmpty()) return;
        File[] dirs = new File(Config.ROMS_ROOT).listFiles();
        if (dirs == null) return;
        JSONObject aliases = new JSONObject(readAll(ctx.getAssets().open("folder_aliases.json")));
        for (File d : dirs) {
            if (!d.isDirectory() || d.getName().startsWith(".")) continue;
            String name = d.getName();
            boolean known = false;
            for (Sys s : all) {
                if (s.folder.equals(name)) {
                    known = true;
                    break;
                }
            }
            if (known) continue;
            String key = Matcher.compact(name);
            String canonical = null;
            java.util.Iterator<String> it = aliases.keys();
            while (it.hasNext() && canonical == null) {
                String base = it.next();
                JSONArray list = aliases.getJSONArray(base);
                for (int i = 0; i < list.length(); i++) {
                    if (list.getString(i).equals(key)) {
                        canonical = base;
                        break;
                    }
                }
            }
            if (canonical == null) continue;
            Sys src = null;
            for (Sys s : all) {
                if (s.folder.equals(canonical)) src = s;
            }
            if (src == null) continue;
            Sys n = new Sys();
            n.folder = name;
            n.core = src.core;
            n.hack = src.hack;
            n.standalone = src.standalone;
            n.ra.addAll(src.ra);
            n.base = canonical;
            all.add(n);
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
            if (o.has("standalone")) s.standalone = o.optString("standalone", "");
            if (o.has("ra")) {
                s.ra.clear();
                JSONArray r = o.getJSONArray("ra");
                for (int j = 0; j < r.length(); j++) s.ra.add(r.getString(j));
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
