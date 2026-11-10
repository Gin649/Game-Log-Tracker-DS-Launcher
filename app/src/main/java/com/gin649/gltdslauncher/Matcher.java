package com.gin649.gltdslauncher;

import java.text.Normalizer;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Matches a RetroAchievements game title to a ROM file name. */
final class Matcher {

    private Matcher() {}

    // compiled once: these run for every ROM on every scan and every title looked up
    private static final Pattern TAG_AND_SPACE = Pattern.compile("~[^~]*~\\s*");
    private static final Pattern TAG = Pattern.compile("~[^~]*~");
    private static final Pattern NOT_ALNUM = Pattern.compile("[^a-z0-9]");
    private static final Pattern NOT_ALNUM_SPACE = Pattern.compile("[^a-z0-9 ]");
    private static final Pattern MARKS = Pattern.compile("\\p{M}+");
    private static final Pattern BRACKETS = Pattern.compile("\\([^)]*\\)|\\[[^\\]]*\\]");
    private static final Pattern SPACES = Pattern.compile("\\s+");
    private static final Pattern VERSION = Pattern.compile("v\\d+[a-z]?");
    private static final Pattern SHORT_NUMBER = Pattern.compile("\\d{1,3}");
    private static final Pattern NUMBER = Pattern.compile("\\d+");
    private static final Pattern FILE_NUMBER = Pattern.compile("^\\s*\\d{1,5}\\s*[-_.]\\s*");

    /** Title for display: RA tags like ~Hack~ removed. */
    static String display(String title) {
        if (title == null) return "";
        return TAG_AND_SPACE.matcher(title).replaceAll("").trim();
    }

    static boolean wantsHack(String title) {
        return title != null && title.toLowerCase(Locale.ROOT).contains("~hack~");
    }

    /** Lowercase letters and digits only, for comparing console names. */
    static String compact(String s) {
        if (s == null) return "";
        return NOT_ALNUM.matcher(s.toLowerCase(Locale.ROOT)).replaceAll("");
    }

    /** Normalized name: no tags, no brackets, no accents or punctuation, single spaces. */
    static String norm(String s) {
        if (s == null) return "";
        s = MARKS.matcher(Normalizer.normalize(s, Normalizer.Form.NFD)).replaceAll("");
        s = s.toLowerCase(Locale.ROOT);
        s = TAG.matcher(s).replaceAll(" ");
        s = BRACKETS.matcher(s).replaceAll(" ");
        s = s.replace("&", " and ");
        s = NOT_ALNUM_SPACE.matcher(s).replaceAll(" ");
        s = SPACES.matcher(s.trim()).replaceAll(" ");
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
                || w.equals("disc") || w.equals("disk") || w.equals("cd") || VERSION.matcher(w).matches();
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
            if (inVersion && SHORT_NUMBER.matcher(w).matches()) continue; // the 1 in "disc 1"
            inVersion = false;
            if (!NOISE.contains(w)) return false;
        }
        return true;
    }

    private static Set<String> digitWords(String s) {
        Set<String> out = new HashSet<String>();
        for (String w : words(s)) {
            if (NUMBER.matcher(w).matches()) out.add(w);
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
        if (j < 0.6) return 0;
        // The words the two titles do not share must only be noise ("version", "the", a region...). Otherwise
        // "Kirby's Pinball Land" would pass for "Kirby's Dream Land", which shares most of its words.
        Set<String> diff = new HashSet<String>(union);
        diff.removeAll(inter);
        return onlyNoise(diff.toArray(new String[0])) ? (int) (30 + 20 * j) : 0;
    }

    private static int regionBonus(String fileName) {
        String n = fileName.toLowerCase(Locale.ROOT);
        if (n.contains("(usa") || n.contains("(world")) return 5;
        if (n.contains("(europe")) return 3;
        if (n.contains("(japan")) return 2;
        return 0;
    }

    /** The normalized name of a numbered file without its number, or null when the name has no number in front. */
    static String bareNorm(String name) {
        String bare = FILE_NUMBER.matcher(name).replaceFirst("");
        return bare.equals(name) ? null : norm(bare);
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
        // A patched copy made in ROM Hacks often has the game's own name. For the game itself it is only a fallback:
        // the original wins whenever one matches. A hack's own entry is matched as usual.
        RomIndex.Rom bestPatched = null;
        int bestPatchedScore = 0;
        for (RomIndex.Rom r : candidates) {
            int s = 0;
            for (String n : names) s = Math.max(s, score(n, r.norm));
            // DS sets often number the files ("5587 - Chrono Trigger (USA)"): try the name without the number too
            String bn = r.bareNorm;
            if (bn != null) {
                for (String n : names) s = Math.max(s, score(n, bn));
            }
            if (s == 0) continue;
            s += (r.sys.hack == hack) ? 15 : -15;
            s += regionBonus(r.name);
            if (!hack && PatchedRoms.is(r.file)) {
                if (s > bestPatchedScore) {
                    bestPatchedScore = s;
                    bestPatched = r;
                }
                continue;
            }
            if (s > bestScore) {
                bestScore = s;
                best = r;
            }
        }
        if (bestScore >= 40) return best;
        return bestPatchedScore >= 40 ? bestPatched : null;
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
    /**
     * For finding a game's art online: like similarity(), but a title that is the other plus a subtitle also counts
     * ("Sonic Adventure DX" for "Sonic Adventure DX: Director's Cut"), as long as the shorter one is at least three
     * words so a short name never grabs a longer sequel.
     */
    static int artSimilarity(String a, String b) {
        int s = similarity(a, b);
        if (s >= 76) return s;
        Set<String> ta = simTokens(a);
        Set<String> tb = simTokens(b);
        if (ta.isEmpty() || tb.isEmpty() || !numbers(ta).equals(numbers(tb))) return s;
        Set<String> small = ta.size() <= tb.size() ? ta : tb;
        Set<String> big = ta.size() <= tb.size() ? tb : ta;
        if (small.size() >= 3 && big.containsAll(small)) return 76;
        return s;
    }

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
