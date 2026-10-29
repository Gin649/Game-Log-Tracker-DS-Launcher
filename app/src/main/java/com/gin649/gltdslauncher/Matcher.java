package com.gin649.gltdslauncher;

import java.text.Normalizer;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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

    /** Words that can trail a game's title without making it a different game. */
    private static final Set<String> NOISE = new HashSet<String>(java.util.Arrays.asList(
            "version", "ver", "edition", "disc", "disk", "cd", "rev", "revision", "special", "complete", "deluxe",
            "remastered", "hd", "goty", "platinum", "hits", "greatest", "players", "choice", "collectors", "limited",
            "original", "game", "of", "the", "year", "usa", "europe", "japan", "eng", "english", "hack", "patched",
            "translated", "translation", "fixed", "fix"));

    private static String[] words(String s) {
        return s.trim().isEmpty() ? new String[0] : s.trim().split(" ");
    }

    private static boolean isVersionWord(String w) {
        return w.equals("version") || w.equals("ver") || w.equals("rev") || w.equals("revision")
                || w.equals("disc") || w.equals("disk") || w.equals("cd") || w.matches("v\\d+[a-z]?");
    }

    /**
     * True when the words left over after the shared title are only things like a version, disc number or region,
     * so the file is the same game. A sequel, prequel or spin-off ("Zero", "2", "Code Veronica") is not.
     */
    private static boolean onlyNoise(String[] extra) {
        boolean inVersion = false;
        for (String w : extra) {
            if (w.isEmpty()) continue;
            if (isVersionWord(w)) {
                inVersion = true;
                continue;
            }
            if (inVersion && w.matches("\\d{1,3}")) continue; // the 1 in "disc 1"
            inVersion = false;
            if (!NOISE.contains(w)) return false;
        }
        return true;
    }

    private static Set<String> digitWords(String s) {
        Set<String> out = new HashSet<String>();
        for (String w : words(s)) {
            if (w.matches("\\d+")) out.add(w);
        }
        return out;
    }

    private static String dropThe(String s) {
        return (" " + s + " ").replace(" the ", " ").trim().replace(" ", "");
    }

    private static int score(String t, String r) {
        String tc = t.replace(" ", "");
        String rc = r.replace(" ", "");
        if (tc.isEmpty() || rc.isEmpty()) return 0;
        if (tc.equals(rc)) return 100;
        // "Simpsons, The - Hit & Run" is the same game as "The Simpsons: Hit & Run"
        if (dropThe(t).equals(dropThe(r))) return 95;

        boolean tShorter = tc.length() <= rc.length();
        String shortS = tShorter ? t : r;
        String longS = tShorter ? r : t;
        String shortC = tShorter ? tc : rc;
        String longC = tShorter ? rc : tc;

        if (longC.startsWith(shortC)) {
            // one title starts with the other: only the same game if what is left over is a version, disc or region
            String[] sw = words(shortS);
            String[] lw = words(longS);
            boolean wordPrefix = lw.length >= sw.length;
            for (int i = 0; wordPrefix && i < sw.length; i++) {
                if (!sw[i].equals(lw[i])) wordPrefix = false;
            }
            String[] extra = wordPrefix
                    ? java.util.Arrays.copyOfRange(lw, sw.length, lw.length)
                    : new String[]{longC.substring(shortC.length())};
            return onlyNoise(extra) ? 80 : 0;
        }

        if (!digitWords(t).equals(digitWords(r))) return 0; // "Game 2" is never "Game"

        if (longC.contains(shortC)) {
            // "Zelda A Link to the Past" inside "The Legend of Zelda A Link to the Past" is the same game, but a
            // short title inside a longer one ("Metroid" in "Super Metroid") is not
            return words(shortS).length >= 3 ? 60 : 0;
        }

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
        // RetroAchievements sometimes lists two names in one title ("Resident Evil | Biohazard"); either can match
        List<String> names = new java.util.ArrayList<String>();
        if (title != null) {
            for (String part : title.split("\\|")) {
                String n = norm(part);
                if (!n.isEmpty() && !names.contains(n)) names.add(n);
            }
        }
        boolean hack = wantsHack(title);
        RomIndex.Rom best = null;
        int bestScore = 0;
        for (RomIndex.Rom r : candidates) {
            int s = 0;
            for (String n : names) s = Math.max(s, score(n, r.norm));
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

    // title similarity for online art lookups
    private static final Set<String> SIM_STOP = new HashSet<String>(java.util.Arrays.asList("the", "a", "an", "of", "and"));

    private static final Map<String, String> SIM_ROMAN = new HashMap<String, String>();

    static {
        String[] r = {"ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"};
        for (int i = 0; i < r.length; i++) SIM_ROMAN.put(r[i], String.valueOf(i + 2));
    }

    private static Set<String> simTokens(String s) {
        Set<String> out = new HashSet<String>();
        for (String w : Matcher.norm(s).split(" ")) {
            if (w.isEmpty() || SIM_STOP.contains(w)) continue;
            String roman = SIM_ROMAN.get(w);
            out.add(roman != null ? roman : w);
        }
        return out;
    }

    private static Set<String> numbers(Set<String> tokens) {
        Set<String> out = new HashSet<String>();
        for (String t : tokens) {
            if (t.matches("\\d+")) out.add(t);
        }
        return out;
    }

    /**
     * 0 to 100. 100 when the titles are the same apart from punctuation, tags and small words; otherwise the
     * share of words in common, but 0 if the sequel numbers differ so "Game 2" never matches "Game".
     */
    static int similarity(String a, String b) {
        Set<String> ta = simTokens(a);
        Set<String> tb = simTokens(b);
        if (ta.isEmpty() || tb.isEmpty()) return 0;
        if (ta.equals(tb)) return 100;
        if (!numbers(ta).equals(numbers(tb))) return 0;
        Set<String> inter = new HashSet<String>(ta);
        inter.retainAll(tb);
        Set<String> union = new HashSet<String>(ta);
        union.addAll(tb);
        return (int) Math.round(100.0 * inter.size() / union.size());
    }
}
