package com.gin649.gltdslauncher;

import android.content.Context;
import android.content.pm.ApplicationInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Which RetroArch cores are installed, and which systems each one plays. */
final class RaCores {
    private RaCores() {
    }

    private static JSONObject map;

    private static JSONObject map(Context ctx) {
        if (map != null) return map;
        try {
            InputStream in = ctx.getAssets().open("cores.json");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            map = new JSONObject(out.toString("UTF-8"));
        } catch (Exception e) {
            map = new JSONObject();
        }
        return map;
    }

    /**
     * Names of the cores found in this RetroArch's cores folder, or null when the folder cannot be read
     * (Android keeps another app's private files closed, so it often cannot).
     */
    static Set<String> installed(Context ctx, String pkg) {
        if (pkg == null || pkg.isEmpty()) return null;
        List<File> dirs = new ArrayList<File>();
        try {
            ApplicationInfo ai = ctx.getPackageManager().getApplicationInfo(pkg, 0);
            dirs.add(new File(ai.dataDir, "cores"));
            dirs.add(new File(ai.nativeLibraryDir));
        } catch (Exception ignored) {
        }
        dirs.add(new File("/data/data/" + pkg + "/cores"));
        dirs.add(new File("/data/user/0/" + pkg + "/cores"));
        dirs.add(new File("/storage/emulated/0/Android/data/" + pkg + "/files/cores"));
        dirs.add(new File("/storage/emulated/0/RetroArch/cores"));
        Set<String> found = new HashSet<String>();
        for (File d : dirs) {
            try {
                String[] names = d.list();
                if (names == null) continue;
                for (String name : names) {
                    int i = name.indexOf("_libretro");
                    if (i <= 0 || !name.endsWith(".so")) continue;
                    String core = name.substring(0, i);
                    if (core.startsWith("lib")) core = core.substring(3);
                    if (!core.isEmpty()) found.add(core);
                }
            } catch (Exception ignored) {
            }
        }
        return found.isEmpty() ? null : found;
    }

    /**
     * The cores to offer for a system: the ones it already lists, then any other installed core that plays it. When the
     * installed cores can be read, only those are kept (plus the system's current pick). Otherwise the system's own list.
     */
    static List<String> forSystem(Context ctx, SystemMap.Sys sys, String pkg, String current) {
        List<String> base = new ArrayList<String>();
        if (!sys.core.isEmpty()) base.add(sys.core);
        for (String c : sys.cores) if (!c.isEmpty() && !base.contains(c)) base.add(c);
        Set<String> have = installed(ctx, pkg);
        if (have == null) return base;
        List<String> out = new ArrayList<String>();
        for (String c : base) if (have.contains(c) || c.equals(current)) out.add(c);
        JSONObject m = map(ctx);
        List<String> extra = new ArrayList<String>(have);
        java.util.Collections.sort(extra);
        for (String c : extra) {
            if (out.contains(c)) continue;
            JSONArray folders = m.optJSONArray(c);
            if (folders == null) continue;
            for (int i = 0; i < folders.length(); i++) {
                if (folders.optString(i).equals(sys.folder)) {
                    out.add(c);
                    break;
                }
            }
        }
        return out.isEmpty() ? base : out;
    }
}
