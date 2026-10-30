package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Reads your ES-DE custom_systems/es_systems.xml, so your own
 * system folders and cores are picked up.
 */
final class EsdeImport {

    private static final Map<String, String> PLATFORM_TO_RA = new HashMap<String, String>();

    static {
        PLATFORM_TO_RA.put("gb", "Game Boy");
        PLATFORM_TO_RA.put("gbc", "Game Boy Color");
        PLATFORM_TO_RA.put("gba", "Game Boy Advance");
        PLATFORM_TO_RA.put("nes", "NES/Famicom");
        PLATFORM_TO_RA.put("famicom", "NES/Famicom");
        PLATFORM_TO_RA.put("snes", "SNES/Super Famicom");
        PLATFORM_TO_RA.put("sfc", "SNES/Super Famicom");
        PLATFORM_TO_RA.put("genesis", "Genesis/Mega Drive");
        PLATFORM_TO_RA.put("megadrive", "Genesis/Mega Drive");
        PLATFORM_TO_RA.put("mastersystem", "Master System");
        PLATFORM_TO_RA.put("gamegear", "Game Gear");
        PLATFORM_TO_RA.put("segacd", "Sega CD");
        PLATFORM_TO_RA.put("sega32x", "32X");
        PLATFORM_TO_RA.put("n64", "Nintendo 64");
        PLATFORM_TO_RA.put("psx", "PlayStation");
        PLATFORM_TO_RA.put("psp", "PlayStation Portable");
        PLATFORM_TO_RA.put("ps2", "PlayStation 2");
        PLATFORM_TO_RA.put("gc", "GameCube");
        PLATFORM_TO_RA.put("wii", "Wii");
        PLATFORM_TO_RA.put("pcengine", "PC Engine/TurboGrafx-16");
        PLATFORM_TO_RA.put("atari2600", "Atari 2600");
        PLATFORM_TO_RA.put("atari7800", "Atari 7800");
        PLATFORM_TO_RA.put("atarilynx", "Atari Lynx");
        PLATFORM_TO_RA.put("arcade", "Arcade");
    }

    private static final Pattern CORE = Pattern.compile("([A-Za-z0-9_\\-]+?)_libretro(?:_android)?\\.so");

    private EsdeImport() {}

    private static String text(Element parent, String... tags) {
        for (String t : tags) {
            NodeList nl = parent.getElementsByTagName(t);
            if (nl.getLength() > 0 && nl.item(0).getTextContent() != null) {
                return nl.item(0).getTextContent().trim();
            }
        }
        return "";
    }

    /** Returns how many systems were found. Saves them for the app to merge in. */
    static int run(Context ctx, String esRoot) {
        File out = new File(ctx.getFilesDir(), "imported_systems.json");
        out.delete();
        JSONArray arr = new JSONArray();
        if (esRoot != null && !esRoot.isEmpty()) {
            try {
                collectEsde(esRoot, arr);
            } catch (Exception ignored) {
                // an unreadable es_systems.xml just means no custom systems
            }
        }
        if (arr.length() == 0) return 0;
        try {
            FileOutputStream fos = new FileOutputStream(out);
            try {
                fos.write(arr.toString(1).getBytes("UTF-8"));
            } finally {
                fos.close();
            }
            return arr.length();
        } catch (Exception e) {
            return 0;
        }
    }

    private static void collectEsde(String esRoot, JSONArray arr) throws Exception {
        File xml = new File(esRoot, "custom_systems/es_systems.xml");
        if (!xml.isFile()) return;
        {
            org.w3c.dom.Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(xml);
            NodeList systems = doc.getDocumentElement().getChildNodes();

            for (int i = 0; i < systems.getLength(); i++) {
                Node n = systems.item(i);
                if (n.getNodeType() != Node.ELEMENT_NODE) continue;
                Element s = (Element) n;

                String path = text(s, "path").replace("%ROMPATH%/", "");
                String platform = text(s, "platform").toLowerCase(Locale.ROOT);
                String fullname = text(s, "fullname");
                if (path.isEmpty()) continue;

                String core = "";
                NodeList cmds = s.getElementsByTagName("command");
                if (cmds.getLength() > 0) {
                    String cmd = cmds.item(0).getTextContent();
                    if (cmd != null && cmd.contains("%EMULATOR_RETROARCH%")) {
                        Matcher m = CORE.matcher(cmd);
                        if (m.find()) core = m.group(1);
                    }
                }

                String ra = PLATFORM_TO_RA.get(platform);
                if (ra == null && core.isEmpty()) continue;

                JSONObject o = new JSONObject();
                o.put("folder", path);
                JSONArray raNames = new JSONArray();
                if (ra != null) raNames.put(ra);
                o.put("ra", raNames);
                if (!core.isEmpty()) o.put("core", core);
                o.put("hack", fullname.toLowerCase(Locale.ROOT).contains("hack"));
                arr.put(o);
            }
        }
    }
}
