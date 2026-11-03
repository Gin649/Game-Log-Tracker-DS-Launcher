package com.gin649.gltdslauncher;

import android.content.Context;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Arcade ROMs are named by short MAME codes ("sfa3.zip"), which say nothing about the game. This turns a code into
 * its title (from the FBNeo and MAME lists in assets/arcade_names.tsv) so it can be matched to a RetroAchievements title.
 */
final class ArcadeNames {

    private ArcadeNames() {}

    private static final Set<String> FOLDERS = new HashSet<String>(Arrays.asList(
            "arcade", "mame", "mame2003", "mame2003plus", "fbneo", "fba", "neogeo", "cps1", "cps2", "cps3",
            "naomi", "atomiswave", "model2", "model3", "daphne", "coinop"));

    private static volatile Map<String, String> names;

    static boolean applies(String folder) {
        return folder != null && FOLDERS.contains(folder.toLowerCase(Locale.ROOT));
    }

    /** The game's title for a ROM file name, or null when it isn't a known code (or the list can't be read). */
    static String title(String romName) {
        if (romName == null) return null;
        Map<String, String> m = load();
        return m == null ? null : m.get(romName.toLowerCase(Locale.ROOT));
    }

    private static Map<String, String> load() {
        Map<String, String> m = names;
        if (m != null) return m;
        synchronized (ArcadeNames.class) {
            if (names != null) return names;
            Context c = Shared.appCtx;
            if (c == null) return null;
            Map<String, String> out = new HashMap<String, String>();
            try {
                BufferedReader r = new BufferedReader(new InputStreamReader(c.getAssets().open("arcade_names.tsv"), "UTF-8"));
                String line;
                while ((line = r.readLine()) != null) {
                    int t = line.indexOf('\t');
                    if (t > 0) out.put(line.substring(0, t), line.substring(t + 1));
                }
                r.close();
            } catch (Exception e) {
                return null; // the list is a help only: without it arcade names stay as they are
            }
            names = out;
            return out;
        }
    }
}
