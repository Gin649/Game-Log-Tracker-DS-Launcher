package com.gin649.gltdslauncher;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Matches a RetroAchievements game title to a ROM file name. */
final class Matcher {

    private Matcher() {}

    /** Title for display: RA tags like ~Hack~ removed. */
    static String display(String title) {
        if (title == null) return "";
        return title.replaceAll("~[^~]*~\\s*", "").trim();
    }

    static boolean wantsHack(String title) {
        return title != null && title.toLowerCase(Locale.ROOT).contains("~hack~");
    }

    /** Lowercase letters and digits only, for comparing console names. */
    static String compact(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    /** Normalized name: no tags, no brackets, no accents or punctuation, single spaces. */
    static String norm(String s) {
        if (s == null) return "";
        s = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        s = s.toLowerCase(Locale.ROOT);
        s = s.replaceAll("~[^~]*~", " ");
        s = s.replaceAll("\\([^)]*\\)|\\[[^\\]]*\\]", " ");
        s = s.replace("&", " and ");
        s = s.replaceAll("[^a-z0-9 ]", " ");
        s = s.trim().replaceAll("\\s+", " ");
        if (s.startsWith("the ")) s = s.substring(4);
        if (s.endsWith(" the")) s = s.substring(0, s.length() - 4);
        return s;
    }

    private static int score(String t, String r) {
        String tc = t.replace(" ", "");
        String rc = r.replace(" ", "");
        if (tc.isEmpty() || rc.isEmpty()) return 0;
        if (tc.equals(rc)) return 100;
        if (rc.startsWith(tc) || tc.startsWith(rc)) return 80;
        if (rc.contains(tc) || tc.contains(rc)) return 60;

        Set<String> a = new HashSet<String>();
        Set<String> b = new HashSet<String>();
        for (String w : t.split(" ")) a.add(w);
        for (String w : r.split(" ")) b.add(w);
        Set<String> inter = new HashSet<String>(a);
        inter.retainAll(b);
        Set<String> union = new HashSet<String>(a);
        union.addAll(b);
        double j = union.isEmpty() ? 0 : (double) inter.size() / union.size();
        return j >= 0.6 ? (int) (30 + 20 * j) : 0;
    }

    private static int regionBonus(String fileName) {
        String n = fileName.toLowerCase(Locale.ROOT);
        if (n.contains("(usa") || n.contains("(world")) return 5;
        if (n.contains("(europe")) return 3;
        if (n.contains("(japan")) return 2;
        return 0;
    }

    /** Best ROM for a title among candidates, or null when nothing is close enough. */
    static RomIndex.Rom best(List<RomIndex.Rom> candidates, String title) {
        String t = norm(title);
        boolean hack = wantsHack(title);
        RomIndex.Rom best = null;
        int bestScore = 0;
        for (RomIndex.Rom r : candidates) {
            int s = score(t, r.norm);
            if (s == 0) continue;
            s += (r.sys.hack == hack) ? 15 : -15;
            s += regionBonus(r.name);
            if (s > bestScore) {
                bestScore = s;
                best = r;
            }
        }
        return bestScore >= 40 ? best : null;
    }
}
