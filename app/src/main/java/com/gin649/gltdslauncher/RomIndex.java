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
        final String bareNorm; // the same for "5587 - Chrono Trigger" without its number, or null when there is none
        /** For a multi-disc game with no .m3u: every disc in order (the entry itself is disc 1). Otherwise null. */
        List<File> discs;

        Rom(SystemMap.Sys sys, File file, String name, String rel) {
            this.sys = sys;
            this.file = file;
            this.name = name;
            this.rel = rel;
            String t = ArcadeNames.applies(sys.folder) ? ArcadeNames.title(name) : null;
            this.norm = Matcher.norm(t != null ? t : name);
            this.bareNorm = Matcher.bareNorm(name);
        }
    }

    private static final Set<String> SKIP_EXT = new HashSet<String>(Arrays.asList(
            "txt", "xml", "jpg", "jpeg", "png", "gif", "srm", "sav", "bak", "db", "ini", "cfg",
            "nfo", "pdf", "log", "mp4", "mp3", "sub", "dat"));
    private static final Set<String> SKIP_DIRS = new HashSet<String>(Arrays.asList(
            "media", "images", "manuals", "saves", "states", "downloaded_media"));

    private volatile List<Rom> roms = new ArrayList<Rom>();
    // the same ROMs split up by system, in the order they were scanned, so a lookup needn't walk the whole list
    private volatile java.util.Map<SystemMap.Sys, List<Rom>> bySys = new java.util.LinkedHashMap<SystemMap.Sys, List<Rom>>();
    private volatile boolean ready;

    boolean isReady() {
        return ready;
    }

    void awaitReady(long maxMillis) {
        long begin = System.currentTimeMillis();
        long end = begin + maxMillis;
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
        java.util.Map<SystemMap.Sys, List<Rom>> split = new java.util.LinkedHashMap<SystemMap.Sys, List<Rom>>();
        for (Rom r : out) {
            List<Rom> list = split.get(r.sys);
            if (list == null) {
                list = new ArrayList<Rom>();
                split.put(r.sys, list);
            }
            list.add(r);
        }
        bySys = split;
        roms = out;
        ready = true;
    }

    /** Every ROM found by the last scan. */
    List<Rom> all() {
        return roms;
    }

    List<Rom> forSystems(List<SystemMap.Sys> systems) {
        List<Rom> out = new ArrayList<Rom>();
        for (java.util.Map.Entry<SystemMap.Sys, List<Rom>> e : bySys.entrySet()) {
            if (systems.contains(e.getKey())) out.addAll(e.getValue());
        }
        return out;
    }

    /** One system's ROMs. */
    List<Rom> forSystem(SystemMap.Sys sys) {
        List<Rom> list = bySys.get(sys);
        return list == null ? new ArrayList<Rom>() : list;
    }

    /** Every ROM in one system folder. */
    List<Rom> inFolder(String folder) {
        List<Rom> out = new ArrayList<Rom>();
        for (java.util.Map.Entry<SystemMap.Sys, List<Rom>> e : bySys.entrySet()) {
            if (e.getKey().folder.equals(folder)) out.addAll(e.getValue());
        }
        return out;
    }

    /** The systems that have ROMs, with how many each has. */
    java.util.Map<SystemMap.Sys, Integer> systemCounts() {
        java.util.Map<SystemMap.Sys, Integer> out = new java.util.LinkedHashMap<SystemMap.Sys, Integer>();
        for (java.util.Map.Entry<SystemMap.Sys, List<Rom>> e : bySys.entrySet()) out.put(e.getKey(), e.getValue().size());
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
