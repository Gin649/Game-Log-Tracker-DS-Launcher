package com.gin649.gltdslauncher;

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
        /** For a multi-disc game with no .m3u: every disc in order (the entry itself is disc 1). Otherwise null. */
        List<File> discs;

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

        Set<String> m3us = new HashSet<String>(); // game names that have a playlist here
        for (File f : files) {
            String ln = f.getName();
            if (ln.toLowerCase(Locale.ROOT).endsWith(".m3u")) m3us.add(discGame(ln.substring(0, ln.length() - 4)).toLowerCase(Locale.ROOT));
        }
        java.util.Map<String, List<File>> groups = new java.util.TreeMap<String, List<File>>();
        java.util.Map<String, Rom> groupRom = new java.util.HashMap<String, Rom>();

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
            boolean disc = !ext.equals("m3u") && DISC.matcher(base).find();
            String game = discGame(base).toLowerCase(Locale.ROOT);
            if (disc && m3us.contains(game)) continue; // the playlist stands for all of its discs

            String full = f.getPath();
            String rel = full.substring(root.getPath().length() + 1);
            int relDot = rel.lastIndexOf('.');
            if (relDot > 0) rel = rel.substring(0, relDot);
            Rom rom = new Rom(s, f, base, rel);
            if (disc) {
                // no playlist: one entry for the whole game, the first disc, which remembers the others
                String key = game + "." + ext;
                List<File> list = groups.get(key);
                if (list == null) {
                    list = new ArrayList<File>();
                    groups.put(key, list);
                }
                list.add(f);
                continue;
            }
            out.add(rom);
        }

        for (java.util.Map.Entry<String, List<File>> g : groups.entrySet()) {
            List<File> list = g.getValue();
            java.util.Collections.sort(list, new java.util.Comparator<File>() {
                @Override
                public int compare(File a, File b) {
                    int d = discNo(a.getName()) - discNo(b.getName());
                    return d != 0 ? d : a.getName().compareTo(b.getName());
                }
            });
            File first = list.get(0);
            String n = first.getName();
            int dot = n.lastIndexOf('.');
            String base = dot > 0 ? n.substring(0, dot) : n;
            String rel = first.getPath().substring(root.getPath().length() + 1);
            int relDot = rel.lastIndexOf('.');
            if (relDot > 0) rel = rel.substring(0, relDot);
            Rom rom = new Rom(s, first, base, rel);
            if (list.size() > 1) rom.discs = list;
            out.add(rom);
        }
    }

    private static final java.util.regex.Pattern DISC =
            java.util.regex.Pattern.compile("\\s*[\\(\\[](?:disc|disk|cd)\\s*(\\d+)[^\\)\\]]*[\\)\\]]", java.util.regex.Pattern.CASE_INSENSITIVE);

    /** The game's name without its "(Disc 2)" tag. */
    static String discGame(String base) {
        return DISC.matcher(base).replaceAll("").trim();
    }

    static int discNo(String name) {
        java.util.regex.Matcher m = DISC.matcher(name);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }
}
