package com.gin649.gltdslauncher;

import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.display.DisplayManager;
import android.os.BatteryManager;
import android.os.Environment;
import android.util.Base64;
import android.view.Display;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
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

    @JavascriptInterface
    public String version() {
        return "1";
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

    // ---- Game library (Room database) ----

    /** JSON array of games in the library. Pass a system folder such as "snes", or "" for all. */
    @JavascriptInterface
    public String libraryGames(String systemId) {
        try {
            return LibrarySync.gamesJson(act, systemId);
        } catch (Exception e) {
            return "[]";
        }
    }

    @JavascriptInterface
    public void setFavorite(int id, boolean favorite) {
        try {
            com.gin649.gltdslauncher.database.GameRepository.get(act).setFavorite(id, favorite);
        } catch (Exception ignored) {
        }
    }

    /** Starts fetching art for every game that has none yet. Safe to call again. */
    @JavascriptInterface
    public void scrapeAll() {
        LibraryScraper.scrapeAll(act);
    }

    /** Lets games that found no art be searched again. */
    @JavascriptInterface
    public void retryUnmatched() {
        LibraryScraper.retryUnmatched(act);
    }

    @JavascriptInterface
    public String scrapeStatus() {
        return LibraryScraper.status(act);
    }

    @JavascriptInterface
    public void rescan() {
        Shared.rescan();
    }

    @JavascriptInterface
    public void setTopDisplay(int id) {
        DisplayPicker.save(act, id);
    }

    @JavascriptInterface
    public String status() {
        JSONObject o = new JSONObject();
        try {
            o.put("storageAccess", Environment.isExternalStorageManager());
            o.put("indexReady", Shared.index().isReady());
            o.put("roms", Shared.index().count());
            o.put("topDisplay", DisplayPicker.topDisplayId(act));
            JSONArray displays = new JSONArray();
            DisplayManager dm = (DisplayManager) act.getSystemService(android.content.Context.DISPLAY_SERVICE);
            for (Display d : dm.getDisplays()) {
                JSONObject dj = new JSONObject();
                dj.put("id", d.getDisplayId());
                dj.put("name", d.getName());
                displays.put(dj);
            }
            o.put("displays", displays);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    // ---- ROM hacks: use the ROM the launcher already found, and save the patched one beside it ----

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

    @JavascriptInterface
    public void romSaveAbort(String id) {
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

    // ---- In-app web pages (YouTube searches, links) ----

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
