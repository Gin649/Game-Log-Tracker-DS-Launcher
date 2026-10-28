package com.gin649.gltdslauncher;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads Daijisho platform files (the .json files, such as the ones in the Daijisho repo's platforms folder or ones you
 * exported) found in your Daijisho folder, so the core you chose for a platform is used. Daijisho keeps its own ROM
 * folder list in its private database, so a platform is only matched to a folder in your ROMs folder that has
 * the platform's short name, id or name (upper/lower case does not matter).
 */
final class DaijishoImport {

    /** RetroAchievements console id (what Daijisho stores) to the console name the tracker uses. */
    private static final Map<Integer, String> RA_ID = new HashMap<Integer, String>();

    static {
        RA_ID.put(1, "Genesis/Mega Drive");
        RA_ID.put(2, "Nintendo 64");
        RA_ID.put(3, "SNES/Super Famicom");
        RA_ID.put(4, "Game Boy");
        RA_ID.put(5, "Game Boy Advance");
        RA_ID.put(6, "Game Boy Color");
        RA_ID.put(7, "NES/Famicom");
        RA_ID.put(8, "PC Engine/TurboGrafx-16");
        RA_ID.put(9, "Sega CD");
        RA_ID.put(10, "32X");
        RA_ID.put(11, "Master System");
        RA_ID.put(12, "PlayStation");
        RA_ID.put(13, "Atari Lynx");
        RA_ID.put(14, "Neo Geo Pocket");
        RA_ID.put(15, "Game Gear");
        RA_ID.put(16, "GameCube");
        RA_ID.put(17, "Atari Jaguar");
        RA_ID.put(18, "Nintendo DS");
        RA_ID.put(19, "Wii");
        RA_ID.put(21, "PlayStation 2");
        RA_ID.put(23, "Magnavox Odyssey 2");
        RA_ID.put(24, "Pokemon Mini");
        RA_ID.put(25, "Atari 2600");
        RA_ID.put(27, "Arcade");
        RA_ID.put(28, "Virtual Boy");
        RA_ID.put(29, "MSX");
        RA_ID.put(33, "SG-1000");
        RA_ID.put(39, "Saturn");
        RA_ID.put(40, "Dreamcast");
        RA_ID.put(41, "PlayStation Portable");
        RA_ID.put(43, "3DO Interactive Multiplayer");
        RA_ID.put(44, "ColecoVision");
        RA_ID.put(45, "Intellivision");
        RA_ID.put(46, "Vectrex");
        RA_ID.put(51, "Atari 7800");
        RA_ID.put(53, "WonderSwan");
        RA_ID.put(78, "Nintendo DSi");
    }

    private static final Pattern CORE = Pattern.compile("([A-Za-z0-9_\\-]+?)_libretro(?:_android)?\\.so");

    private DaijishoImport() {}

    /** Adds one entry per platform file that matches a folder in your ROMs folder. Does nothing without a Daijisho folder. */
    static void collect(JSONArray out) {
        if (Config.DJ_ROOT.isEmpty() || Config.ROMS_ROOT.isEmpty()) return;
        File root = new File(Config.DJ_ROOT);
        if (!root.isDirectory()) return;
        File[] romDirs = new File(Config.ROMS_ROOT).listFiles();
        if (romDirs == null) return;
        scan(root, 0, romDirs, out);
    }

    private static void scan(File dir, int depth, File[] romDirs, JSONArray out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) {
                if (depth < 2 && !f.getName().equalsIgnoreCase("gltthor")) scan(f, depth + 1, romDirs, out);
            } else if (f.getName().toLowerCase(Locale.ROOT).endsWith(".json") && f.length() < 512 * 1024) {
                try {
                    one(readAll(f), romDirs, out);
                } catch (Exception ignored) {
                    // not a platform file
                }
            }
        }
    }

    private static void one(String json, File[] romDirs, JSONArray out) throws Exception {
        JSONObject root = new JSONObject(json);
        JSONObject p = root.optJSONObject("platform");
        if (p == null) return;

        String folder = null;
        for (String key : new String[]{"shortname", "uniqueId", "name"}) {
            String want = Matcher_compact(p.optString(key));
            if (want.isEmpty()) continue;
            for (File d : romDirs) {
                if (d.isDirectory() && Matcher_compact(d.getName()).equals(want)) {
                    folder = d.getName();
                    break;
                }
            }
            if (folder != null) break;
        }
        if (folder == null) return;

        String core = "";
        JSONArray players = root.optJSONArray("playerList");
        if (players != null) {
            for (int i = 0; i < players.length() && core.isEmpty(); i++) {
                JSONObject pl = players.optJSONObject(i);
                if (pl == null) continue;
                java.util.regex.Matcher m = CORE.matcher(pl.optString("amStartArguments"));
                if (m.find()) core = m.group(1);
            }
        }

        JSONArray raNames = new JSONArray();
        JSONArray ids = p.optJSONArray("retroAchievementsConsoleIdList");
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                String n = RA_ID.get(ids.optInt(i));
                if (n != null) raNames.put(n);
            }
        }
        if (core.isEmpty() && raNames.length() == 0) return;

        JSONObject o = new JSONObject();
        o.put("folder", folder);
        if (raNames.length() > 0) o.put("ra", raNames); // left out when unknown so a built-in list is not wiped
        if (!core.isEmpty()) o.put("core", core);
        out.put(o);
    }

    private static String Matcher_compact(String s) {
        return com.gin649.gltdslauncher.Matcher.compact(s);
    }

    private static String readAll(File f) throws Exception {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        } finally {
            in.close();
        }
    }
}
