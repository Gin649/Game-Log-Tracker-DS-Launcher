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

/** What the tracker's JavaScript can call. Exposed to the page as window.ThorBridge. */
final class ThorBridge {

    private final MainActivity act;

    ThorBridge(MainActivity act) {
        this.act = act;
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

    /** Lets games that found no ScreenScraper match be searched again. */
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
