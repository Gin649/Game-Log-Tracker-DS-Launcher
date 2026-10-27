package com.gin649.gltthor;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** A list of every ROM file under your ES-DE Roms folder, grouped by system. */
final class RomIndex {

    static final class Rom {
        final SystemMap.Sys sys;
        final File file;
        final String name;   // file name without extension
        final String rel;    // path inside the system folder, without extension
        final String norm;   // normalized name used for matching

        Rom(SystemMap.Sys sys, File file, String name, String rel) {
            this.sys = sys;
            this.file = file;
            this.name = name;
            this.rel = rel;
            this.norm = Matcher.norm(name);
        }
    }

    private static final Set<String> SKIP_EXT = new HashSet<String>(Arrays.asList(
            "txt", "xml", "jpg", "jpeg", "png", "gif", "srm", "sav", "bak", "db", "ini", "cfg",
            "nfo", "pdf", "log", "mp4", "mp3", "sub", "dat"));
    private static final Set<String> SKIP_DIRS = new HashSet<String>(Arrays.asList(
            "media", "images", "manuals", "saves", "states", "downloaded_media"));

    private volatile List<Rom> roms = new ArrayList<Rom>();
    private volatile boolean ready;

    boolean isReady() {
        return ready;
    }

    int count() {
        return roms.size();
    }

    void awaitReady(long maxMillis) {
        long end = System.currentTimeMillis() + maxMillis;
        while (!ready && System.currentTimeMillis() < end) {
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    synchronized void rebuild(SystemMap map) {
        List<Rom> out = new ArrayList<Rom>();
        for (SystemMap.Sys s : map.all) {
            if (Config.ROMS_ROOT.isEmpty()) break;
            File d = s.dir();
            if (d.isDirectory()) scan(s, d, d, 0, out);
        }
        roms = out;
        ready = true;
    }

    /** Every ROM found by the last scan. */
    List<Rom> all() {
        return roms;
    }

    List<Rom> forSystems(List<SystemMap.Sys> systems) {
        List<Rom> out = new ArrayList<Rom>();
        for (Rom r : roms) {
            if (systems.contains(r.sys)) out.add(r);
        }
        return out;
    }

    private void scan(SystemMap.Sys s, File root, File dir, int depth, List<Rom> out) {
        File[] files = dir.listFiles();
        if (files == null) return;

        boolean hasM3u = false;
        for (File f : files) {
            if (f.getName().toLowerCase(Locale.ROOT).endsWith(".m3u")) hasM3u = true;
        }

        for (File f : files) {
            String n = f.getName();
            if (n.startsWith(".")) continue;
            if (f.isDirectory()) {
                if (depth < 2 && !SKIP_DIRS.contains(n.toLowerCase(Locale.ROOT))) {
                    scan(s, root, f, depth + 1, out);
                }
                continue;
            }
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 ? n.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
            String base = dot > 0 ? n.substring(0, dot) : n;
            if (SKIP_EXT.contains(ext) || ext.startsWith("state")) continue;
            if (ext.equals("bin") && new File(dir, base + ".cue").exists()) continue;
            if (hasM3u && !ext.equals("m3u") && base.contains("(Disc ")) continue;

            String full = f.getPath();
            String rel = full.substring(root.getPath().length() + 1);
            int relDot = rel.lastIndexOf('.');
            if (relDot > 0) rel = rel.substring(0, relDot);
            out.add(new Rom(s, f, base, rel));
        }
    }
}
