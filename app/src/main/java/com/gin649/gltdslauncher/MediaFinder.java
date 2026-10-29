package com.gin649.gltdslauncher;

import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Finds art your frontend already has for a ROM. The top screen uses, best first: fan art, a finished
 * miximage, a miximage built from the screenshot, box art and marquee (LibrarySync.buildMiximage), art fetched
 * online (LibraryScraper), the marquee, then box art.
 * It looks in ES-DE's downloaded_media/[system]/[type]/, gamelist.xml files, Daijisho media folders (a flat
 * folder of pictures counts as box art) and next to the ROMs. Folder listings are cached briefly.
 */
final class MediaFinder {

    /** What the art found for one ROM is, so the caller can pick or build the best top-screen picture. */
    static final class Found {
        /** Ready to show as it is (fan art or a finished miximage); else null. */
        String direct;
        /** The marquee or box art, shown only when nothing better is found here or online. */
        String fallback;
        /** Parts for building a miximage; any may be null. Only filled in when direct is null. */
        String screen, box, logo;

        /** A miximage can be built: there is no ready picture but there is a screenshot to use as the background. */
        boolean canBuild() {
            return direct == null && screen != null;
        }
    }

    private static final int FANART = 0, MIX = 1, MARQUEE = 2, BOX = 3, SCREEN = 4;
    /** ES-DE type folders for each kind, best first. */
    private static final String[][] ES_TYPES = {
            {"fanart"}, {"miximages"}, {"marquees"}, {"covers", "3dboxes"}, {"screenshots", "titlescreens"}
    };
    /** Sub-folders other tools use under a system folder (Skraper, Daijisho media folders, ES classic). */
    private static final String[][] SUBS = {
            {"fanart", "media/fanart"},
            {"miximages", "miximage", "media/miximages"},
            {"marquees", "wheel", "media/marquees", "media/wheel"},
            {"covers", "boxart", "box2dfront", "media/covers", "media/box2dfront", "media/boxart", "", "images", "image", "media", "media/images"},
            {"screenshots", "snaps", "titlescreens", "media/screenshots"}
    };
    private static final String[] EXTS = {"png", "jpg", "jpeg", "webp"};
    private static final long TTL_MS = 60 * 1000;

    private static final class Listing {
        final long at = System.currentTimeMillis();
        final Map<String, String> byName = new HashMap<String, String>(); // lower-case base name -> full path
    }

    private static final Map<String, Listing> LISTINGS = new HashMap<String, Listing>();
    private static final Map<String, Object[]> GAMELISTS = new HashMap<String, Object[]>(); // path -> {lastModified, map}

    private MediaFinder() {}

    /** Forget cached folder listings (call before a big scan). */
    static synchronized void reset() {
        LISTINGS.clear();
        GAMELISTS.clear();
    }

    static Found lookup(RomIndex.Rom rom) {
        return look(rom.sys.folder, rom.rel, rom.name, rom.file.getName());
    }

    /**
     * Same lookup for a ROM that is only known by its system folder and full path, such as a database row.
     * Art is named after the ROM file, in the same sub-folder the ROM sits in.
     */
    static Found lookup(String systemFolder, String romPath) {
        Found none = new Found();
        if (systemFolder == null || romPath == null || Config.ROMS_ROOT.isEmpty()) return none;
        String root = Config.ROMS_ROOT + "/" + systemFolder + "/";
        if (!romPath.startsWith(root)) return none;
        String rel = romPath.substring(root.length());
        String fileName = rel.substring(rel.lastIndexOf('/') + 1);
        int dot = rel.lastIndexOf('.');
        if (dot > rel.lastIndexOf('/')) rel = rel.substring(0, dot);
        String name = rel.substring(rel.lastIndexOf('/') + 1);
        return look(systemFolder, rel, name, fileName);
    }

    /** Everything one lookup needs, worked out once. */
    private static final class Where {
        File esBase;
        final List<Map<String, Map<Integer, String>>> gamelists = new ArrayList<Map<String, Map<Integer, String>>>();
        final List<File> sysDirs = new ArrayList<File>();
        String relParent, name, fileName;
    }

    private static Found look(String systemFolder, String rel, String name, String fileName) {
        Where w = new Where();
        w.relParent = rel.contains("/") ? rel.substring(0, rel.lastIndexOf('/')) : "";
        w.name = name;
        w.fileName = fileName;

        if (!Config.MEDIA_ROOT.isEmpty()) w.esBase = child(new File(Config.MEDIA_ROOT), systemFolder);

        List<File> roots = new ArrayList<File>();
        if (!Config.DJ_ROOT.isEmpty()) {
            roots.add(new File(Config.DJ_ROOT));
            File nested = child(new File(Config.DJ_ROOT), "DaijishoMedia");
            if (nested != null) roots.add(nested);
        }
        File shared = new File("/storage/emulated/0/DaijishoMedia");
        if (shared.isDirectory()) roots.add(shared);
        List<File> gamelistDirs = new ArrayList<File>();
        for (File r : roots) {
            File d = child(r, systemFolder);
            if (d != null) {
                w.sysDirs.add(d);
                gamelistDirs.add(d);
            }
        }
        File romDir = new File(Config.ROMS_ROOT, systemFolder);
        gamelistDirs.add(romDir);
        w.sysDirs.add(romDir);
        for (File d : gamelistDirs) {
            Map<String, Map<Integer, String>> m = gamelist(d);
            if (m != null) w.gamelists.add(m);
        }

        Found f = new Found();
        String top = of(w, FANART);
        if (top == null) top = of(w, MIX);
        if (top != null) {
            f.direct = top;
            return f;
        }
        f.screen = of(w, SCREEN);
        f.box = of(w, BOX);
        f.logo = of(w, MARQUEE);
        if (f.screen == null) { // nothing to build a miximage on: the marquee, then box art as the last resort
            f.fallback = f.logo != null ? f.logo : f.box;
        }
        return f;
    }

    /** The first picture of one kind, looking in ES-DE, then gamelist.xml files, then Daijisho and ROM folders. */
    private static String of(Where w, int kind) {
        if (w.esBase != null) {
            for (String type : ES_TYPES[kind]) {
                File typeDir = new File(w.esBase, type);
                String hit = inDir(w.relParent.isEmpty() ? typeDir : new File(typeDir, w.relParent), w.name);
                if (hit == null && !w.relParent.isEmpty()) hit = inDir(typeDir, w.name);
                if (hit != null) return hit;
            }
        }
        for (Map<String, Map<Integer, String>> m : w.gamelists) {
            Map<Integer, String> e = m.get(w.fileName.toLowerCase(Locale.ROOT));
            if (e == null) e = m.get(w.name.toLowerCase(Locale.ROOT));
            if (e != null && e.get(kind) != null) return e.get(kind);
        }
        for (File d : w.sysDirs) {
            for (String sub : SUBS[kind]) {
                File dir = sub.isEmpty() ? d : new File(d, sub);
                String hit = inDir(w.relParent.isEmpty() ? dir : new File(dir, w.relParent), w.name);
                if (hit == null && !w.relParent.isEmpty()) hit = inDir(dir, w.name);
                if (hit != null) return hit;
            }
        }
        return null;
    }

    /** A sub-folder by name, ignoring upper/lower case ("GBA" vs "gba"). */
    private static File child(File parent, String name) {
        File exact = new File(parent, name);
        if (exact.isDirectory()) return exact;
        File[] kids = parent.listFiles();
        if (kids == null) return null;
        for (File k : kids) {
            if (k.isDirectory() && k.getName().equalsIgnoreCase(name)) return k;
        }
        return null;
    }

    /** First image in dir named base (any of the usual extensions), via a cached listing of the folder. */
    private static synchronized String inDir(File dir, String base) {
        String key = dir.getPath();
        Listing l = LISTINGS.get(key);
        if (l == null || System.currentTimeMillis() - l.at > TTL_MS) {
            l = new Listing();
            File[] files = dir.listFiles();
            if (files != null) {
                for (String ext : EXTS) {
                    for (File f : files) {
                        String n = f.getName();
                        int dot = n.lastIndexOf('.');
                        if (dot <= 0 || !f.isFile()) continue;
                        if (!n.substring(dot + 1).toLowerCase(Locale.ROOT).equals(ext)) continue;
                        String k = n.substring(0, dot).toLowerCase(Locale.ROOT);
                        if (!l.byName.containsKey(k)) l.byName.put(k, f.getPath()); // earlier extension wins
                    }
                }
            }
            LISTINGS.put(key, l);
        }
        return l.byName.get(base.toLowerCase(Locale.ROOT));
    }

    // gamelist.xml
    /** ROM file name or base name (lower case) -> kind -> image path, for one folder's gamelist.xml; null if none. */
    @SuppressWarnings("unchecked")
    private static synchronized Map<String, Map<Integer, String>> gamelist(File dir) {
        File xml = new File(dir, "gamelist.xml");
        if (!xml.isFile()) return null;
        Object[] cached = GAMELISTS.get(xml.getPath());
        if (cached != null && ((Long) cached[0]) == xml.lastModified()) {
            return (Map<String, Map<Integer, String>>) cached[1];
        }
        Map<String, Map<Integer, String>> map = readGamelist(xml);
        GAMELISTS.put(xml.getPath(), new Object[]{xml.lastModified(), map});
        return map;
    }

    /**
     * fanart tag is fan art, image is taken as a finished picture (miximage), marquee is the marquee and
     * thumbnail is box art.
     */
    private static Map<String, Map<Integer, String>> readGamelist(File xml) {
        Map<String, Map<Integer, String>> out = new HashMap<String, Map<Integer, String>>();
        try {
            org.w3c.dom.Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(xml);
            NodeList games = doc.getElementsByTagName("game");
            File base = xml.getParentFile();
            String[] tags = {"fanart", "image", "marquee", "thumbnail"};
            int[] kinds = {FANART, MIX, MARQUEE, BOX};
            for (int i = 0; i < games.getLength(); i++) {
                Node n = games.item(i);
                if (n.getNodeType() != Node.ELEMENT_NODE) continue;
                Element g = (Element) n;
                String path = tag(g, "path");
                if (path.isEmpty()) continue;
                Map<Integer, String> e = new HashMap<Integer, String>();
                for (int t = 0; t < tags.length; t++) {
                    String img = tag(g, tags[t]);
                    if (img.isEmpty()) continue;
                    File f = img.startsWith("/") ? new File(img) : new File(base, img.startsWith("./") ? img.substring(2) : img);
                    if (f.isFile()) e.put(kinds[t], f.getPath());
                }
                if (e.isEmpty()) continue;
                String fn = path.substring(path.replace('\\', '/').lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
                out.put(fn, e);
                int dot = fn.lastIndexOf('.');
                if (dot > 0 && !out.containsKey(fn.substring(0, dot))) out.put(fn.substring(0, dot), e);
            }
        } catch (Exception ignored) {
            // a gamelist that can't be read is simply not used
        }
        return out;
    }

    private static String tag(Element parent, String name) {
        NodeList nl = parent.getElementsByTagName(name);
        if (nl.getLength() == 0 || nl.item(0).getTextContent() == null) return "";
        return nl.item(0).getTextContent().trim();
    }
}
