package com.gin649.gltdslauncher;

import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Environment;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** What the tracker's JavaScript can call. Exposed to the page as window.ThorBridge. */
final class ThorBridge {

    private final MainActivity act;

    /** ROM files the page may read, by token. The page asks for /rom/<token>, MainActivity streams the file. */
    private static final Map<String, File> ROM_TOKENS = new ConcurrentHashMap<String, File>();
    /** ROM files being written in pieces by the ROM patcher, by session id. */
    private static final Map<String, FileOutputStream> SAVES = new HashMap<String, FileOutputStream>();
    private static final Map<String, File> SAVE_FILES = new HashMap<String, File>();
    private static int counter = 1;

    ThorBridge(MainActivity act) {
        this.act = act;
    }

    /** The file behind a /rom/<token> address, or null. Only files under the ROMs folder are ever served. */
    static File romForToken(String token) {
        File f = ROM_TOKENS.get(token);
        if (f == null || Config.ROMS_ROOT.isEmpty()) return null;
        try {
            String root = new File(Config.ROMS_ROOT).getCanonicalPath() + "/";
            return f.getCanonicalPath().startsWith(root) && f.isFile() ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static synchronized String nextId() {
        return String.valueOf(counter++);
    }

    // The app's own version (from the release tag), shown in About.
    @JavascriptInterface
    public String appVersion() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public void setViewing(String json) {
        try {
            JSONObject o = new JSONObject(json);
            Shared.showViewing(o.optString("title"), o.optString("console"), o.optString("art"));
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void clearViewing() {
        Shared.showLogo();
    }

    @JavascriptInterface
    public String launch(String json) {
        try {
            JSONObject o = new JSONObject(json);
            return Launcher.launch(act, o.optString("title"), o.optString("console")).toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"Bad launch request.\"}";
        }
    }

    /** Keys from the setup wizard, so the tracker can fill in its own settings. */
    @JavascriptInterface
    public String getConfig() {
        JSONObject o = new JSONObject();
        try {
            o.put("raUser", Prefs.get(act, "raUser", ""));
            o.put("raKey", Prefs.get(act, "raKey", ""));
            o.put("rawgKey", Prefs.get(act, "rawgKey", ""));
            o.put("rev", Prefs.get(act, "credsRev", ""));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    @JavascriptInterface
    public void openSettings() {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.openSetup();
            }
        });
    }

    /** Battery level (0 to 1) and charging state, for the tracker's clock and battery readout. */
    @JavascriptInterface
    public String battery() {
        JSONObject o = new JSONObject();
        try {
            Intent i = act.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = i == null ? -1 : i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = i == null ? -1 : i.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int status = i == null ? -1 : i.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            double fraction = (level >= 0 && scale > 0) ? (double) level / scale : 1.0;
            o.put("level", fraction);
            o.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /**
     * Starts fetching art for the games in the tracker's Library and Backlog (not every ROM in your folders).
     * gamesJson is [{title, console}]. Safe to call again.
     */
    @JavascriptInterface
    public void scrapeAll(String gamesJson) {
        List<String[]> games = new java.util.ArrayList<String[]>();
        try {
            JSONArray a = new JSONArray(gamesJson);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null) games.add(new String[]{o.optString("title"), o.optString("console")});
            }
        } catch (Exception ignored) {
        }
        LibraryScraper.scrapeAll(act, games);
    }

    @JavascriptInterface
    public String scrapeStatus() {
        return LibraryScraper.status(act);
    }

    // Pictures for games that aren't on RetroAchievements

    private static final java.util.concurrent.ExecutorService ART_IO = java.util.concurrent.Executors.newSingleThreadExecutor();

    /** The picture file behind an /art/<token> address, or null. Only files in folders the app already reads are served. */
    static File artForToken(String token) {
        try {
            // the address carries the file's own path, so a saved address still works after a restart
            File f = new File(new String(Base64.decode(token, Base64.URL_SAFE | Base64.NO_WRAP), "UTF-8"));
            if (!f.isFile()) return null;
            String p = f.getCanonicalPath();
            String[] roots = {Config.ROMS_ROOT, Config.MEDIA_ROOT, Config.DJ_ROOT, "/storage/emulated/0/DaijishoMedia"};
            for (String r : roots) {
                if (!r.isEmpty() && p.startsWith(new File(r).getCanonicalPath() + "/")) return f;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /**
     * Looks for a box-art style picture for a game the tracker has no art for: your frontend's media, then
     * SteamGridDB (with a key), then LaunchBox. The page gets the address in window.thorCustomArt(id, url),
     * with an empty url when nothing was found (it then tries RAWG itself).
     */
    @JavascriptInterface
    public void customArt(final String id, final String title, final String folder, final String romPath) {
        ART_IO.execute(new Runnable() {
            @Override
            public void run() {
                String url = "";
                try {
                    if (!folder.isEmpty() && Config.useEsdeMedia()) {
                        MediaFinder.Found f = MediaFinder.lookup(folder, romPath);
                        String p = f.box != null ? f.box : (f.fallback != null ? f.fallback : f.direct);
                        if (p != null && new File(p).isFile()) {
                            String token = Base64.encodeToString(p.getBytes("UTF-8"), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                            url = "https://" + Config.APP_HOST_BUILTIN + "/art/" + token;
                        }
                    }
                    if (url.isEmpty() && SteamGridDbClient.enabled(act)) {
                        try {
                            String g = SteamGridDbClient.gridFor(act, title);
                            if (g != null) url = g;
                        } catch (java.io.IOException ignored) {
                        }
                    }
                    if (url.isEmpty() && Config.LAUNCHBOX_ART && !folder.isEmpty()) {
                        try {
                            String g = LaunchBoxArt.boxUrl(act, folder, title);
                            if (g != null) url = g;
                        } catch (java.io.IOException ignored) {
                        }
                    }
                } catch (Exception ignored) {
                }
                MainActivity.deliverCustomArt(id, url);
            }
        });
    }

    // Adding games to the backlog from your ROM files

    /** Opens the system file picker (several files at once). The page gets the result in window.thorRomsPicked. */
    @JavascriptInterface
    public void pickRoms() {
        act.pickRoms();
    }

    /** The systems that have ROMs, as [{folder, ra:[names], count}]. */
    @JavascriptInterface
    public String romSystems() {
        JSONArray out = new JSONArray();
        try {
            Map<String, SystemMap.Sys> sysOf = new java.util.TreeMap<String, SystemMap.Sys>();
            Map<String, Integer> counts = new HashMap<String, Integer>();
            for (RomIndex.Rom r : Shared.index().all()) {
                sysOf.put(r.sys.folder, r.sys);
                Integer n = counts.get(r.sys.folder);
                counts.put(r.sys.folder, n == null ? 1 : n + 1);
            }
            for (Map.Entry<String, SystemMap.Sys> e : sysOf.entrySet()) {
                JSONObject o = new JSONObject();
                o.put("folder", e.getKey());
                o.put("ra", new JSONArray(e.getValue().ra));
                o.put("count", counts.get(e.getKey()));
                out.put(o);
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    /** Every game in one system folder, as [{title, folder, ra:[names]}]. */
    @JavascriptInterface
    public String romsIn(String folder) {
        JSONArray out = new JSONArray();
        try {
            for (RomIndex.Rom r : Shared.index().all()) {
                if (r.sys.folder.equals(folder)) out.put(romJson(r.name, r.sys, r.file.getPath()));
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    private static JSONObject romJson(String title, SystemMap.Sys sys, String path) throws org.json.JSONException {
        JSONObject o = new JSONObject();
        o.put("title", title);
        o.put("path", path == null ? "" : path);
        o.put("folder", sys == null ? "" : sys.folder);
        o.put("ra", sys == null ? new JSONArray() : new JSONArray(sys.ra));
        return o;
    }

    /** Describes files picked with the file picker: their titles and, where it can be told, their system. */
    static String describePicked(android.content.Context ctx, java.util.List<android.net.Uri> uris) {
        JSONArray out = new JSONArray();
        List<RomIndex.Rom> all = Shared.index().all();
        SystemMap map = Shared.systems();
        for (android.net.Uri u : uris) {
            try {
                String path = PathUtil.fromDocument(u);
                String name = path != null ? new File(path).getName() : displayName(ctx, u);
                if (name == null || name.isEmpty()) continue;
                int dot = name.lastIndexOf('.');
                String title = dot > 0 ? name.substring(0, dot) : name;

                SystemMap.Sys sys = null;
                if (path != null) {
                    for (RomIndex.Rom r : all) {
                        if (r.file.getPath().equals(path)) {
                            sys = r.sys;
                            break;
                        }
                    }
                    if (sys == null && map != null) {
                        String parent = new File(path).getParentFile() == null ? "" : new File(path).getParentFile().getName();
                        for (SystemMap.Sys s : map.all) {
                            if (s.folder.equalsIgnoreCase(parent)) {
                                sys = s;
                                break;
                            }
                        }
                    }
                }
                out.put(romJson(title, sys, path));
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    private static String displayName(android.content.Context ctx, android.net.Uri u) {
        android.database.Cursor c = null;
        try {
            c = ctx.getContentResolver().query(u, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    // The tracker's saved data, kept as files in the app's data folder (see DataStore). window.storage uses these.

    /** The keys that start with prefix, as a JSON array. */
    @JavascriptInterface
    public String dataList(String prefix) {
        return new org.json.JSONArray(DataStore.list(act, prefix == null ? "" : prefix)).toString();
    }

    /** Number of pieces the value is read in, or -1 when there is none. */
    @JavascriptInterface
    public int dataChunks(String key) {
        return DataStore.chunks(act, key);
    }

    @JavascriptInterface
    public String dataChunk(String key, int index) {
        return DataStore.chunk(act, key, index);
    }

    @JavascriptInterface
    public boolean dataPut(String key, int index, String piece, boolean last) {
        return DataStore.put(act, key, index, piece, last);
    }

    @JavascriptInterface
    public boolean dataDelete(String key) {
        return DataStore.delete(act, key);
    }

    /** Where the app's files are kept, for the settings screen. */
    @JavascriptInterface
    public String dataLocation() {
        JSONObject o = new JSONObject();
        try {
            java.io.File root = DataStore.root(act);
            o.put("path", root.getPath());
            o.put("private", root.equals(act.getFilesDir()));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    // ROM hacks: use the ROM the launcher already found, and save the patched one beside it
    /**
     * Looks for the ROM of a game the same way Play does. Returns {found, name, folder, path, size, token}. The page
     * reads the file from /rom/<token>, so a big ROM never has to be pushed through this bridge as text.
     */
    @JavascriptInterface
    public String findRom(String json) {
        JSONObject o = new JSONObject();
        try {
            JSONObject in = new JSONObject(json);
            if (!Environment.isExternalStorageManager()) {
                o.put("found", false);
                o.put("reason", "access");
                return o.toString();
            }
            RomIndex.Rom rom = Shared.findRom(in.optString("title"), in.optString("console"));
            if (rom == null) {
                o.put("found", false);
                return o.toString();
            }
            String token = nextId() + "-" + Long.toHexString(System.nanoTime());
            ROM_TOKENS.put(token, rom.file);
            o.put("found", true);
            o.put("name", rom.file.getName());
            o.put("folder", rom.sys.folder);
            o.put("path", rom.file.getPath());
            o.put("size", rom.file.length());
            o.put("token", token);
        } catch (Exception e) {
            try {
                o.put("found", false);
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    /**
     * Starts saving a patched ROM in the same folder as the ROM it was made from. Returns {ok, id, name, path}.
     * Send the bytes with romSaveChunk, then call romSaveEnd.
     */
    @JavascriptInterface
    public String romSaveBegin(String basePath, String fileName) {
        JSONObject o = new JSONObject();
        try {
            File base = new File(basePath);
            File dir = base.getParentFile();
            if (dir == null || Config.ROMS_ROOT.isEmpty()
                    || !base.getCanonicalPath().startsWith(new File(Config.ROMS_ROOT).getCanonicalPath() + "/")) {
                o.put("ok", false);
                o.put("message", "That ROM is not inside your ROMs folder.");
                return o.toString();
            }
            String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            File out = new File(dir, safe);
            int n = 1;
            while (out.exists()) {
                int dot = safe.lastIndexOf('.');
                String stem = dot > 0 ? safe.substring(0, dot) : safe;
                String ext = dot > 0 ? safe.substring(dot) : "";
                out = new File(dir, stem + " (" + (n++) + ")" + ext);
            }
            FileOutputStream fos = new FileOutputStream(out);
            String id = nextId();
            synchronized (SAVES) {
                SAVES.put(id, fos);
                SAVE_FILES.put(id, out);
            }
            o.put("ok", true);
            o.put("id", id);
            o.put("name", out.getName());
            o.put("path", out.getPath());
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("message", e.getMessage() == null ? "Could not create the file." : e.getMessage());
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    @JavascriptInterface
    public boolean romSaveChunk(String id, String base64) {
        FileOutputStream fos;
        synchronized (SAVES) {
            fos = SAVES.get(id);
        }
        if (fos == null) return false;
        try {
            fos.write(Base64.decode(base64, Base64.DEFAULT));
            return true;
        } catch (Exception e) {
            romSaveAbort(id);
            return false;
        }
    }

    /** Finishes the file, adds it to the ROM list and returns {ok, name, path}. */
    @JavascriptInterface
    public String romSaveEnd(String id) {
        JSONObject o = new JSONObject();
        FileOutputStream fos;
        File file;
        synchronized (SAVES) {
            fos = SAVES.remove(id);
            file = SAVE_FILES.remove(id);
        }
        try {
            if (fos == null || file == null) {
                o.put("ok", false);
                o.put("message", "The save was interrupted.");
                return o.toString();
            }
            fos.close();
            o.put("ok", true);
            o.put("name", file.getName());
            o.put("path", file.getPath());
            Shared.rescan();
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("message", e.getMessage() == null ? "Could not finish the file." : e.getMessage());
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    private void romSaveAbort(String id) {
        FileOutputStream fos;
        File file;
        synchronized (SAVES) {
            fos = SAVES.remove(id);
            file = SAVE_FILES.remove(id);
        }
        try {
            if (fos != null) fos.close();
        } catch (Exception ignored) {
        }
        if (file != null) file.delete();
    }

    // Disc images (CD and DVD games) are patched here in pieces; they are far too big for the page.

    /** One disc patch running (or finished) in the background. */
    private static final class DiscJob {
        volatile String state = "running"; // running | done | error
        volatile String phase = "Starting";
        volatile long done, total;
        volatile String message, name, path, playPath, notes;
        volatile boolean cancel;
    }

    private static final Map<String, DiscJob> DISC_JOBS = new ConcurrentHashMap<String, DiscJob>();
    private static final Map<String, ByteArrayOutputStream> PATCH_STAGE = new HashMap<String, ByteArrayOutputStream>();

    /** A disc image can be patched here? Returns {ok, message}. */
    @JavascriptInterface
    public String discCheck(String path) {
        JSONObject o = new JSONObject();
        try {
            File f = new File(path);
            DiscPatcher.setTools(new File(act.getApplicationInfo().nativeLibraryDir, "libchdman.so"),
                    new File(act.getApplicationInfo().nativeLibraryDir, "libdolphintool.so"));
            String why = insideRoms(f) ? DiscPatcher.unsupportedReason(f) : "That file is not inside your ROMs folder.";
            o.put("ok", why == null);
            if (why != null) o.put("message", why);
            else if (DiscPatcher.noteFor(f) != null) o.put("note", DiscPatcher.noteFor(f));
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("message", "Could not look at that file.");
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    private static boolean insideRoms(File f) {
        try {
            return !Config.ROMS_ROOT.isEmpty()
                    && f.getCanonicalPath().startsWith(new File(Config.ROMS_ROOT).getCanonicalPath() + "/");
        } catch (Exception e) {
            return false;
        }
    }

    /** Starts handing over a patch file (small) in pieces. Returns the id for patchStageChunk / discPatchStart. */
    @JavascriptInterface
    public String patchStageBegin() {
        String id = nextId();
        synchronized (PATCH_STAGE) {
            PATCH_STAGE.put(id, new ByteArrayOutputStream());
        }
        return id;
    }

    @JavascriptInterface
    public boolean patchStageChunk(String id, String base64) {
        ByteArrayOutputStream b;
        synchronized (PATCH_STAGE) {
            b = PATCH_STAGE.get(id);
        }
        if (b == null) return false;
        try {
            byte[] d = Base64.decode(base64, Base64.DEFAULT);
            b.write(d, 0, d.length);
            return b.size() < 256 * 1024 * 1024;
        } catch (Exception e) {
            return false;
        }
    }

    /** Patches the disc image at basePath with the staged patch, in the background. Returns {ok, job} or {ok:false, message}. */
    @JavascriptInterface
    public String discPatchStart(String basePath, String patchId, String outName) {
        JSONObject o = new JSONObject();
        try {
            final File base = new File(basePath);
            DiscPatcher.setTools(new File(act.getApplicationInfo().nativeLibraryDir, "libchdman.so"),
                    new File(act.getApplicationInfo().nativeLibraryDir, "libdolphintool.so"));
            ByteArrayOutputStream staged;
            synchronized (PATCH_STAGE) {
                staged = PATCH_STAGE.remove(patchId);
            }
            if (staged == null) {
                o.put("ok", false);
                o.put("message", "The patch was not received.");
                return o.toString();
            }
            if (!insideRoms(base) || !base.isFile()) {
                o.put("ok", false);
                o.put("message", "That disc image is not inside your ROMs folder.");
                return o.toString();
            }
            final byte[] patch = staged.toByteArray();
            final String stem = outName;
            final String jobId = nextId();
            final DiscJob job = new DiscJob();
            DISC_JOBS.put(jobId, job);
            Thread t = new Thread(new Runnable() {
                public void run() {
                    try {
                        DiscPatcher.Result r = DiscPatcher.run(base, patch, stem, new DiscPatcher.Progress() {
                            public void update(String phase, long done, long total) {
                                job.phase = phase;
                                job.done = done;
                                job.total = total;
                            }

                            public boolean cancelled() {
                                return job.cancel;
                            }
                        });
                        job.name = r.playable().getName();
                        job.path = r.playable().getPath();
                        StringBuilder n = new StringBuilder();
                        for (String s : r.notes) n.append(n.length() > 0 ? "\n" : "").append(s);
                        job.notes = n.toString();
                        Shared.rescan();
                        job.state = "done";
                    } catch (Throwable e) {
                        job.message = e instanceof OutOfMemoryError ? "Ran out of memory while patching this disc."
                                : (e.getMessage() == null ? "Patching failed." : e.getMessage());
                        job.state = "error";
                    }
                }
            }, "disc-patch");
            t.setDaemon(true);
            t.start();
            o.put("ok", true);
            o.put("job", jobId);
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("message", e.getMessage() == null ? "Could not start." : e.getMessage());
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    /** Progress of a disc patch: {state, phase, done, total, message, name, path, notes}. */
    @JavascriptInterface
    public String discPatchStatus(String jobId) {
        JSONObject o = new JSONObject();
        try {
            DiscJob j = DISC_JOBS.get(jobId);
            if (j == null) {
                o.put("state", "error");
                o.put("message", "That patch is no longer running.");
                return o.toString();
            }
            o.put("state", j.state);
            o.put("phase", j.phase);
            o.put("done", j.done);
            o.put("total", j.total);
            if (j.message != null) o.put("message", j.message);
            if (j.name != null) o.put("name", j.name);
            if (j.path != null) o.put("path", j.path);
            if (j.notes != null) o.put("notes", j.notes);
            if (!"running".equals(j.state)) DISC_JOBS.remove(jobId);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    @JavascriptInterface
    public void discPatchCancel(String jobId) {
        DiscJob j = DISC_JOBS.get(jobId);
        if (j != null) j.cancel = true;
    }

    /** Plays a ROM file by its path, such as a patched ROM that was just saved. */
    @JavascriptInterface
    public String launchFile(final String path) {
        final String[] out = new String[1];
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    out[0] = Launcher.launchFile(act, new File(path)).toString();
                } catch (Exception e) {
                    out[0] = "{\"ok\":false,\"message\":\"Could not start the game.\"}";
                } finally {
                    done.countDown();
                }
            }
        });
        try {
            done.await(10, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
        return out[0] == null ? "{\"ok\":false,\"message\":\"Could not start the game.\"}" : out[0];
    }

    // In-app web pages (YouTube searches, links)
    /**
     * Opens a web page in the app's own viewer, which Back, a swipe or Close leaves. Pass mode "walkthrough" to
     * show a Save video button that sends the open YouTube link back to the tracker.
     */
    @JavascriptInterface
    public void openViewer(final String url, final String mode) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                WebViewerActivity.open(act, url, mode);
            }
        });
    }

    @JavascriptInterface
    public void saveFile(String name, String base64) {
        try {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            dir.mkdirs();
            File out = new File(dir, safe);
            int n = 1;
            while (out.exists()) {
                int dot = safe.lastIndexOf('.');
                String stem = dot > 0 ? safe.substring(0, dot) : safe;
                String ext = dot > 0 ? safe.substring(dot) : "";
                out = new File(dir, stem + " (" + (n++) + ")" + ext);
            }
            FileOutputStream fos = new FileOutputStream(out);
            try {
                fos.write(Base64.decode(base64, Base64.DEFAULT));
            } finally {
                fos.close();
            }
            toast("Saved to Downloads: " + out.getName());
        } catch (Exception e) {
            toast("Could not save the file: " + e.getMessage());
        }
    }

    private void toast(final String msg) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(act, msg, Toast.LENGTH_LONG).show();
            }
        });
    }
}
