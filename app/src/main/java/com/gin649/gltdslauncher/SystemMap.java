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
