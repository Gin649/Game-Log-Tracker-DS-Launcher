package com.gin649.gltthor;

import android.content.Context;
import android.net.Uri;

import java.io.File;

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

    static String ROMS_ROOT = "";
    static String ES_ROOT = "";
    static String MEDIA_ROOT = "";
    /** The wizard's "use my ES-DE media" choice. Use useEsdeMedia() to ask whether it actually applies. */
    static boolean USE_ESDE_MEDIA = true;
    /** Optional hand-edited overrides live here: systems.json and emulators.json. */
    static String USER_DIR = "";

    static String RA_PACKAGE = "com.retroarch.aarch64";
    static String RA_CORES_DIR = "/data/data/com.retroarch.aarch64/cores";
    static String RA_CONFIG = "/storage/emulated/0/Android/data/com.retroarch.aarch64/files/retroarch.cfg";

    private Config() {}

    /** True when ES-DE's downloaded_media folder is there and the choice to use it is on. */
    static boolean useEsdeMedia() {
        return USE_ESDE_MEDIA && !MEDIA_ROOT.isEmpty() && new File(MEDIA_ROOT).isDirectory();
    }

    static boolean isBuiltIn() {
        return BUILTIN_URL.equals(START_URL);
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

        ROMS_ROOT = trim(Prefs.get(c, "romsRoot", ""));
        ES_ROOT = trim(Prefs.get(c, "esRoot", ""));
        MEDIA_ROOT = ES_ROOT.isEmpty() ? "" : ES_ROOT + "/downloaded_media";
        USER_DIR = ES_ROOT.isEmpty() ? "" : ES_ROOT + "/gltthor";
        USE_ESDE_MEDIA = Prefs.getInt(c, "useEsdeMedia", 1) == 1;

        RA_PACKAGE = Prefs.get(c, "raPackage", "com.retroarch.aarch64");
        RA_CORES_DIR = "/data/data/" + RA_PACKAGE + "/cores";
        RA_CONFIG = "/storage/emulated/0/Android/data/" + RA_PACKAGE + "/files/retroarch.cfg";
    }

    private static String trim(String s) {
        if (s == null) return "";
        s = s.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
