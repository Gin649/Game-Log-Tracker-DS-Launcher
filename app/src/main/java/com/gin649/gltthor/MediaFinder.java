package com.gin649.gltthor;

import java.io.File;

/** Finds ES-DE downloaded art for a ROM, best-looking type first. */
final class MediaFinder {

    private static final String[] TYPES = {
            "fanart", "miximages", "titlescreens", "screenshots", "covers", "3dboxes", "marquees"
    };
    private static final String[] EXTS = {"png", "jpg", "jpeg", "webp"};

    private MediaFinder() {}

    static String find(RomIndex.Rom rom) {
        return look(rom.sys.folder, rom.rel, rom.name);
    }

    /**
     * Same lookup for a ROM that is only known by its system folder and full path, such as a database row.
     * ES-DE names its art after the ROM file, in the same sub-folder the ROM sits in.
     */
    static String find(String systemFolder, String romPath) {
        if (systemFolder == null || romPath == null || Config.ROMS_ROOT.isEmpty()) return null;
        String root = Config.ROMS_ROOT + "/" + systemFolder + "/";
        if (!romPath.startsWith(root)) return null;
        String rel = romPath.substring(root.length());
        int dot = rel.lastIndexOf('.');
        if (dot > rel.lastIndexOf('/')) rel = rel.substring(0, dot);
        String name = rel.substring(rel.lastIndexOf('/') + 1);
        return look(systemFolder, rel, name);
    }

    private static String look(String systemFolder, String rel, String name) {
        if (Config.MEDIA_ROOT.isEmpty()) return null;
        File base = new File(Config.MEDIA_ROOT, systemFolder);
        for (String type : TYPES) {
            for (String ext : EXTS) {
                File f = new File(base, type + "/" + rel + "." + ext);
                if (f.isFile()) return f.getPath();
            }
        }
        for (String type : TYPES) {
            for (String ext : EXTS) {
                File f = new File(base, type + "/" + name + "." + ext);
                if (f.isFile()) return f.getPath();
            }
        }
        return null;
    }
}
