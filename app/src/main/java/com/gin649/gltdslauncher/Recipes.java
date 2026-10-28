package com.gin649.gltdslauncher;

import android.content.ClipData;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** How to start each standalone emulator. Read from emulators.json, so a fix never needs a rebuild. */
final class Recipes {

    static final class Recipe {
        String id;
        String label;
        String activity = "";
        String action = "";
        /** Other actions to try, in order, when the first one is not understood by the installed version; %PKG% is the emulator's package. */
        final List<String> actions = new ArrayList<String>();
        String category = "";
        String data = "none";   // none, saf (content address) or path
        boolean clearTask;
        /** Emulator that shows both of a handheld's screens itself (DS, 3DS): it starts on the bottom screen. */
        boolean dual;
        /** Other activity names to try, in order, when the first one is not in the installed version. */
        final List<String> activities = new ArrayList<String>();
        final List<String> packages = new ArrayList<String>();
        final List<String> labels = new ArrayList<String>();
        final Map<String, String> extras = new LinkedHashMap<String, String>();
        final Map<String, Boolean> boolExtras = new LinkedHashMap<String, Boolean>();
        /** Extras that are a list of strings; %ROM%, %ROMSAF% and %ROMBASE% work in each item. */
        final Map<String, List<String>> arrayExtras = new LinkedHashMap<String, List<String>>();
    }

    private Recipes() {}

    private static List<Recipe> cache;

    static synchronized List<Recipe> all(Context ctx) {
        if (cache != null) return cache;
        List<Recipe> out = new ArrayList<Recipe>();
        try {
            merge(out, read(ctx.getAssets().open("emulators.json")));
        } catch (Exception ignored) {
        }
        if (!Config.USER_DIR.isEmpty()) {
            File user = new File(Config.USER_DIR, "emulators.json");
            if (user.isFile()) {
                try {
                    merge(out, read(new FileInputStream(user)));
                } catch (Exception ignored) {
                }
            }
        }
        cache = out;
        return out;
    }

    static synchronized void reset() {
        cache = null;
    }

    static Recipe byId(Context ctx, String id) {
        for (Recipe r : all(ctx)) {
            if (r.id.equals(id)) return r;
        }
        return null;
    }

    private static String read(InputStream in) throws Exception {
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

    private static void merge(List<Recipe> list, String json) throws Exception {
        JSONArray arr = new JSONArray(json);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            String id = o.getString("id");
            Recipe r = null;
            for (Recipe x : list) {
                if (x.id.equals(id)) r = x;
            }
            if (r == null) {
                r = new Recipe();
                r.id = id;
                list.add(r);
            }
            r.label = o.optString("label", r.label == null ? id : r.label);
            if (o.has("activity")) r.activity = o.getString("activity");
            if (o.has("action")) r.action = o.getString("action");
            if (o.has("actions")) fill(r.actions, o.getJSONArray("actions"));
            if (o.has("category")) r.category = o.getString("category");
            if (o.has("data")) r.data = o.getString("data");
            if (o.has("clearTask")) r.clearTask = o.getBoolean("clearTask");
            if (o.has("dual")) r.dual = o.getBoolean("dual");
            if (o.has("activities")) fill(r.activities, o.getJSONArray("activities"));
            if (o.has("arrayExtras")) {
                r.arrayExtras.clear();
                JSONObject e = o.getJSONObject("arrayExtras");
                Iterator<String> keys = e.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    List<String> items = new ArrayList<String>();
                    fill(items, e.getJSONArray(k));
                    r.arrayExtras.put(k, items);
                }
            }
            if (o.has("packages")) fill(r.packages, o.getJSONArray("packages"));
            if (o.has("labels")) fill(r.labels, o.getJSONArray("labels"));
            if (o.has("extras")) {
                r.extras.clear();
                JSONObject e = o.getJSONObject("extras");
                Iterator<String> keys = e.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    r.extras.put(k, e.getString(k));
                }
            }
            if (o.has("boolExtras")) {
                r.boolExtras.clear();
                JSONObject e = o.getJSONObject("boolExtras");
                Iterator<String> keys = e.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    r.boolExtras.put(k, e.getBoolean(k));
                }
            }
        }
    }

    private static void fill(List<String> to, JSONArray from) throws Exception {
        to.clear();
        for (int i = 0; i < from.length(); i++) to.add(from.getString(i));
    }

    private static boolean isInstalled(PackageManager pm, String pkg) {
        try {
            pm.getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** Package name of an installed copy of this emulator, or null. Known names first, then app labels. */
    static String installedPackage(Context ctx, Recipe r) {
        PackageManager pm = ctx.getPackageManager();
        String saved = Prefs.get(ctx, "pkg." + r.id, "");
        if (!saved.isEmpty() && isInstalled(pm, saved)) return saved;
        for (String pkg : r.packages) {
            if (isInstalled(pm, pkg)) return pkg;
        }
        try {
            for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
                String label = String.valueOf(pm.getApplicationLabel(ai)).toLowerCase(Locale.ROOT);
                for (String hint : r.labels) {
                    if (label.contains(hint)) return ai.packageName;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /** One intent per activity to try, best first. A recipe with no activity gives one intent aimed at the package. */
    static List<Intent> buildAll(Context ctx, Recipe r, String pkg, File rom) {
        List<String> acts = new ArrayList<String>();
        if (!r.activity.isEmpty()) acts.add(r.activity);
        for (String a : r.activities) {
            if (!acts.contains(a)) acts.add(a);
        }
        if (acts.isEmpty()) acts.add("");
        List<String> actions = new ArrayList<String>();
        if (!r.action.isEmpty()) actions.add(r.action);
        for (String a : r.actions) {
            String full = a.replace("%PKG%", pkg);
            if (!actions.contains(full)) actions.add(full);
        }
        if (actions.isEmpty()) actions.add("");
        List<Intent> out = new ArrayList<Intent>();
        for (String a : acts) {
            for (String action : actions) out.add(build(ctx, r, pkg, rom, a, action));
        }
        return out;
    }

    static Intent build(Context ctx, Recipe r, String pkg, File rom) {
        return buildAll(ctx, r, pkg, rom).get(0);
    }

    private static String fillIn(String text, String uriText, String path, String base) {
        return text.replace("%ROMSAF%", uriText).replace("%ROMBASE%", base).replace("%ROM%", path);
    }

    private static Intent build(Context ctx, Recipe r, String pkg, File rom, String activity, String action) {
        Intent i = new Intent();
        if (!action.isEmpty()) i.setAction(action);
        if (!r.category.isEmpty()) i.addCategory(r.category);
        if (!activity.isEmpty()) {
            i.setComponent(new ComponentName(pkg, activity));
        } else {
            i.setPackage(pkg);
        }

        String path = rom.getPath();
        String fileName = rom.getName();
        int dot = fileName.lastIndexOf('.');
        String base = dot > 0 ? fileName.substring(0, dot) : fileName;
        Uri uri = RomUri.forRom(ctx, rom);
        String uriText = RomUri.isContent(uri) ? uri.toString() : path;

        if ("saf".equals(r.data)) {
            i.setData(uri);
        } else if ("path".equals(r.data)) {
            i.setData(new Uri.Builder().path(path).build());
        }

        for (Map.Entry<String, String> e : r.extras.entrySet()) {
            i.putExtra(e.getKey(), fillIn(e.getValue(), uriText, path, base));
        }
        for (Map.Entry<String, List<String>> e : r.arrayExtras.entrySet()) {
            String[] items = new String[e.getValue().size()];
            for (int n = 0; n < items.length; n++) items[n] = fillIn(e.getValue().get(n), uriText, path, base);
            i.putExtra(e.getKey(), items);
        }
        for (Map.Entry<String, Boolean> e : r.boolExtras.entrySet()) {
            i.putExtra(e.getKey(), e.getValue().booleanValue());
        }

        if (RomUri.isContent(uri)) {
            i.setClipData(ClipData.newRawUri("rom", uri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (r.clearTask) i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return i;
    }
}
