package com.gin649.gltdslauncher;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Remembers which ROM a title matched. Working that out compares the title with every ROM of its console, and the
 * page asks again for the same game each time its profile opens or a list is drawn. The answers are only good for
 * the ROM list and system list they were worked out from, so a rescan or a change in the setup wizard starts afresh.
 */
final class MatchCache {

    private MatchCache() {}

    private static final Object NONE = new Object(); // stands for "no ROM matched", which is worth remembering too

    private static final class Answers {
        final SystemMap map;
        final List<RomIndex.Rom> roms;
        final ConcurrentHashMap<String, Object> found = new ConcurrentHashMap<String, Object>();

        Answers(SystemMap map, List<RomIndex.Rom> roms) {
            this.map = map;
            this.roms = roms;
        }
    }

    private static volatile Answers answers;

    static RomIndex.Rom find(RomIndex index, SystemMap map, String title, String console) {
        // the scan swaps in a new list when it finishes, so a different list means the old answers are out of date
        List<RomIndex.Rom> roms = index.all();
        Answers a = answers;
        if (a == null || a.map != map || a.roms != roms) {
            a = new Answers(map, roms);
            answers = a;
        }
        String key = title + "\u0000" + console;
        Object hit = a.found.get(key);
        if (hit != null) return hit == NONE ? null : (RomIndex.Rom) hit;
        RomIndex.Rom rom = Matcher.best(index.forSystems(map.forConsole(console)), title);
        a.found.put(key, rom == null ? NONE : rom);
        return rom;
    }
}
