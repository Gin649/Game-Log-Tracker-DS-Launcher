package com.gin649.gltdslauncher;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Environment;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Native Android ports of games (recompiled or reimplemented, such as Zelda 64 Recompiled). The list of which ports
 * exist is ports.json in the app's pages. The newest download is looked up on the port's own GitHub releases page
 * when you ask for it, then downloaded, checked and handed to Android's installer.
 */
final class Ports {

    private Ports() {}

    private static final class Job {
        String state = "idle";   // idle, working, ready, error
        String message = "";
        int percent = -1;
        String tag = "";
    }

    private static final Map<String, Job> JOBS = new HashMap<String, Job>();

    private static synchronized Job job(String slug) {
        Job j = JOBS.get(slug);
        if (j == null) {
            j = new Job();
            JOBS.put(slug, j);
        }
        return j;
    }

    /** Package name of the installed port, or "" when it is not installed. */
    static String installedPackage(Context ctx, String slug, String name, String known) {
        PackageManager pm = ctx.getPackageManager();
        if (known != null && !known.isEmpty()) {
            try {
                pm.getPackageInfo(known, 0);
                return known;
            } catch (PackageManager.NameNotFoundException ignored) {
            }
        }
        String saved = Prefs.get(ctx, "port.pkg." + slug, "");
        if (!saved.isEmpty()) {
            try {
                pm.getPackageInfo(saved, 0);
                return saved;
            } catch (PackageManager.NameNotFoundException ignored) {
            }
        }
        // installed some other way: an app named like the port
        String want = name == null ? "" : name.toLowerCase(Locale.ROOT).trim();
        if (want.length() >= 4) {
            try {
                for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
                    if (String.valueOf(pm.getApplicationLabel(ai)).toLowerCase(Locale.ROOT).trim().equals(want)) return ai.packageName;
                }
            } catch (Exception ignored) {
            }
        }
        return "";
    }

    static String state(Context ctx, String slug, String name, String known) {
        JSONObject o = new JSONObject();
        try {
            Job j = job(slug);
            String pkg = installedPackage(ctx, slug, name, known);
            o.put("installed", !pkg.isEmpty());
            o.put("state", j.state);
            o.put("message", j.message);
            o.put("percent", j.percent);
            o.put("tag", j.tag);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    static String play(Activity act, String slug, String name, String known) {
        String pkg = installedPackage(act, slug, name, known);
        if (pkg.isEmpty()) return "{\"ok\":false,\"message\":\"This port is not installed yet.\"}";
        Intent i = act.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) return "{\"ok\":false,\"message\":\"Could not open the port.\"}";
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            // opens where games open: the top screen (the other screen when "use one screen only" is on)
            int display = DisplayPicker.gameDisplayId(act, false);
            if (display >= 0) {
                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                options.setLaunchDisplayId(display);
                act.startActivity(i, options.toBundle());
            } else {
                act.startActivity(i);
            }
            ArtWatch.start(act, pkg);
            return "{\"ok\":true,\"message\":\"Starting the port…\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"Could not open the port.\"}";
        }
    }

    /** What this device can run: {abis, sdk, vulkan}. Ports that need more than this are not offered. */
    static String device(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            JSONArray abis = new JSONArray();
            for (String a : android.os.Build.SUPPORTED_ABIS) abis.put(a);
            o.put("abis", abis);
            o.put("sdk", android.os.Build.VERSION.SDK_INT);
            o.put("vulkan", ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_VERSION));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Looks up, downloads, checks and installs the newest build. Progress is read with state(). */
    static void get(final Activity act, final String slug, final String repo) {
        final Job j = job(slug);
        synchronized (j) {
            if ("working".equals(j.state)) return;
            j.state = "working";
            j.message = "Looking for the latest version…";
            j.percent = -1;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    run0(act, slug, repo, j);
                } catch (Exception e) {
                    fail(j, "Could not get the port. Check the internet connection.");
                }
            }
        }, "port-" + slug).start();
    }

    private static void fail(Job j, String msg) {
        j.state = "error";
        j.message = msg;
        j.percent = -1;
    }

    private static void run0(Activity act, String slug, String repo, Job j) throws Exception {
        if (!repo.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")) {
            fail(j, "Unknown port.");
            return;
        }
        JSONObject rel = fetchJson("https://api.github.com/repos/" + repo + "/releases/latest");
        if (rel == null) {
            fail(j, "Could not reach GitHub.");
            return;
        }
        JSONObject asset = pickAsset(rel.optJSONArray("assets"));
        if (asset == null) {
            // The newest release may not carry the Android file (some projects publish it separately), so look back
            // through the recent ones, newest first, for one that does.
            JSONObject all = fetchJson("https://api.github.com/repos/" + repo + "/releases?per_page=20");
            JSONArray list = all == null ? null : all.optJSONArray("list");
            for (int i = 0; list != null && i < list.length() && asset == null; i++) {
                JSONObject r = list.optJSONObject(i);
                if (r == null || r.optBoolean("draft")) continue;
                JSONObject a = pickAsset(r.optJSONArray("assets"));
                if (a != null) {
                    asset = a;
                    rel = r;
                }
            }
        }
        if (asset == null) {
            fail(j, "No Android build in the recent releases.");
            return;
        }
        j.tag = rel.optString("tag_name", "");
        String url = asset.optString("browser_download_url", "");
        String digest = asset.optString("digest", "");
        String sha = digest.startsWith("sha256:") ? digest.substring(7).toLowerCase(Locale.ROOT) : "";
        if (!url.startsWith("https://")) {
            fail(j, "No Android build found.");
            return;
        }

        File dir = act.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) {
            fail(j, "No storage available.");
            return;
        }
        File apk = new File(dir, "port-" + slug.replaceAll("[^A-Za-z0-9_.-]", "_") + ".apk");
        if (apk.exists()) apk.delete();

        j.message = "Downloading " + j.tag + "…";
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "GLTThor-ports");
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try {
            if (c.getResponseCode() != 200) {
                fail(j, "The download failed.");
                return;
            }
            long total = c.getContentLengthLong();
            InputStream in = c.getInputStream();
            FileOutputStream out = new FileOutputStream(apk);
            try {
                byte[] buf = new byte[65536];
                long got = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    md.update(buf, 0, n);
                    got += n;
                    if (total > 0) j.percent = (int) (got * 100 / total);
                }
            } finally {
                out.close();
                in.close();
            }
        } finally {
            c.disconnect();
        }

        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format("%02x", b));
        if (!sha.isEmpty() && !sha.equals(hex.toString())) {
            apk.delete();
            fail(j, "The file does not match its checksum, so it was not installed.");
            return;
        }
        PackageInfo info = act.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null) {
            apk.delete();
            fail(j, "The download is not a valid app.");
            return;
        }
        Prefs.put(act, "port.pkg." + slug, info.packageName);
        j.state = "ready";
        j.percent = 100;
        j.message = "Downloaded. Confirm the install when Android asks.";
        final File file = apk;
        final Context app = act.getApplicationContext();
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                UpdateChecker.installApk(app, file);
            }
        });
    }

    /** The build for 64-bit ARM phones: prefers names that say arm64, then universal, and skips other chips. */
    private static JSONObject pickAsset(JSONArray assets) {
        if (assets == null) return null;
        JSONObject best = null;
        int bestScore = -1;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a == null) continue;
            String n = a.optString("name", "").toLowerCase(Locale.ROOT);
            if (!n.endsWith(".apk")) continue;
            if (n.contains("x86") || n.contains("x64") || n.contains("x32") || n.contains("armeabi") || n.contains("armv7") || n.contains("debug")) continue;
            int score = 1;
            if (n.contains("universal")) score = 3;
            if (n.contains("arm64") || n.contains("aarch64")) score = 4;
            if (score > bestScore) {
                best = a;
                bestScore = score;
            }
        }
        return best;
    }

    private static final Map<String, String> AVAILABLE = new HashMap<String, String>(); // repo -> "yes" / "no" / "checking"
    private static final long AVAILABLE_TTL = 6L * 60 * 60 * 1000;

    /**
     * Whether a port has an Android build in its recent releases: "yes", "no", or "checking" while the answer is
     * being looked up in the background. A lookup that fails (no network) answers "unknown" and is tried again later.
     */
    static String available(final Context ctx, final String repo) {
        if (repo == null || !repo.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")) return "no";
        final android.content.SharedPreferences sp = ctx.getSharedPreferences("ports-available", Context.MODE_PRIVATE);
        synchronized (AVAILABLE) {
            String mem = AVAILABLE.get(repo);
            if ("checking".equals(mem)) return "checking";
            String saved = sp.getString(repo, "");
            int at = saved.indexOf(':');
            if (at > 0) {
                try {
                    long when = Long.parseLong(saved.substring(0, at));
                    if (System.currentTimeMillis() - when < AVAILABLE_TTL) return saved.substring(at + 1);
                } catch (NumberFormatException ignored) {
                }
            }
            if ("unknown".equals(mem) && mem != null) {
                AVAILABLE.remove(repo);
                return "unknown";
            }
            AVAILABLE.put(repo, "checking");
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                String answer = "unknown";
                try {
                    JSONObject all = fetchJson("https://api.github.com/repos/" + repo + "/releases?per_page=20");
                    JSONArray list = all == null ? null : all.optJSONArray("list");
                    if (list != null) {
                        answer = "no";
                        for (int i = 0; i < list.length(); i++) {
                            JSONObject r = list.optJSONObject(i);
                            if (r != null && !r.optBoolean("draft") && pickAsset(r.optJSONArray("assets")) != null) {
                                answer = "yes";
                                break;
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
                synchronized (AVAILABLE) {
                    if ("unknown".equals(answer)) {
                        AVAILABLE.put(repo, "unknown");
                    } else {
                        AVAILABLE.remove(repo);
                        sp.edit().putString(repo, System.currentTimeMillis() + ":" + answer).apply();
                    }
                }
            }
        }, "port-available").start();
        return "checking";
    }

    private static JSONObject fetchJson(String address) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(address).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("User-Agent", "GLTThor-ports");
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            String text = out.toString("UTF-8").trim();
            if (text.startsWith("[")) return new JSONObject().put("list", new JSONArray(text)); // a list comes back as {list: [...]}
            return new JSONObject(text);
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
