package com.gin649.gltdslauncher;

import android.content.Context;

import com.gin649.gltdslauncher.database.GameEntity;
import com.gin649.gltdslauncher.database.GameRepository;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The fan art pictures found online for one game. They live in fanart/&lt;system&gt;/&lt;game id&gt;/1.jpg, 2.jpg and so
 * on, saved exactly as downloaded (whatever the format, the name stays .jpg). The game's miximage path points at the
 * one in use. Tapping the top screen downloads all the others to swipe through, and when the game is left only the
 * one on show is kept, so each game holds a single picture. src.txt lists where each picture came from.
 */
final class FanArt {

    /** No cap: a tap downloads every fan art found, since all but the one kept are deleted when the game is left. */
    static final int MAX = Integer.MAX_VALUE;
    private static final Object LOCK = new Object();

    private FanArt() {}

    /**
     * Games in the tracker with no ROM on this device have no database row. They get a stand-in entity (negative id,
     * from the console and title) so art can still be fetched for the top screen. Their chosen picture is kept in
     * Prefs instead of the database.
     */
    private static final java.util.Map<Integer, GameEntity> VIRTUAL = new java.util.concurrent.ConcurrentHashMap<Integer, GameEntity>();

    /** The stand-in for a tracker game without a ROM, or null when its console isn't one of your systems. */
    static GameEntity virtualFor(Context ctx, String title, String console) {
        SystemMap map = Shared.systems();
        if (map == null || title == null || console == null) return null;
        java.util.List<SystemMap.Sys> sys = map.forConsole(console);
        if (sys.isEmpty()) return null;
        int id = -(Math.abs((Matcher.compact(console) + "|" + Matcher.norm(title)).hashCode() % 1000000000) + 1);
        GameEntity g = VIRTUAL.get(id);
        if (g == null) {
            g = new GameEntity();
            g.id = id;
            g.title = title;
            g.systemId = sys.get(0).folder;
            g.romPath = "virtual";
            VIRTUAL.put(id, g);
        }
        String pick = Prefs.get(ctx, "fanpick" + id, "");
        if (!pick.isEmpty() && new File(pick).isFile()) {
            g.localMiximagePath = pick;
        } else {
            List<File> have = files(ctx, g);
            g.localMiximagePath = have.isEmpty() ? null : have.get(0).getPath();
        }
        return g;
    }

    static GameEntity virtualById(int id) {
        return VIRTUAL.get(id);
    }

    /** Makes a picture the one in use for a game (database row, or Prefs for a game without a ROM). */
    static void setPick(Context ctx, GameEntity g, String path) {
        g.localMiximagePath = path;
        if (g.id > 0) GameRepository.get(ctx).dao().setMiximagePath(g.id, path);
        else Prefs.put(ctx, "fanpick" + g.id, path == null ? "" : path);
    }

    private static File dir(Context ctx, GameEntity g) {
        return new File(DataStore.root(ctx), "fanart/" + g.systemId + "/" + g.id);
    }

    /** Whether the game has any fan art to swipe between: the frontend's or one fetched here. */
    static boolean hasFanArt(Context ctx, GameEntity g) {
        return !candidates(ctx, g).isEmpty();
    }

    /** True for a picture this app downloaded into its own fan art set (not the frontend's media). */
    static boolean isGallery(Context ctx, String path) {
        return path != null && path.startsWith(new File(DataStore.root(ctx), "fanart").getPath() + "/");
    }

    /**
     * Every picture the top screen can swipe between: the frontend's own fan art or miximage first (when the game has
     * one), then the fan arts downloaded here.
     */
    static List<String> candidates(Context ctx, GameEntity g) {
        List<String> out = new ArrayList<String>();
        List<File> mine = files(ctx, g);
        String front = frontend(g);
        // left out when a bigger copy of the same picture was downloaded (see dropRepeats)
        if (front != null && !(new File(dir(ctx, g), ".nofront").isFile() && !mine.isEmpty())) out.add(front);
        for (File f : mine) out.add(f.getPath());
        return out;
    }

    /** The frontend's own fan art or miximage for the game, or null. */
    private static String frontend(GameEntity g) {
        if (g.id <= 0 || !Config.useEsdeMedia()) return null;
        String d = MediaFinder.lookup(g.systemId, g.romPath).direct;
        return d != null && new File(d).isFile() ? d : null;
    }

    /**
     * Goes through all of the game's pictures, the frontend's own included, and drops repeats of the same image,
     * keeping the biggest copy. The picture in use moves to the copy that stays. The frontend's picture is never
     * deleted: when a downloaded copy is bigger it is just left out of the list. Returns true when anything changed.
     */
    static boolean dropRepeats(Context ctx, GameEntity g) {
        boolean changed = false;
        synchronized (LOCK) {
            File d = dir(ctx, g);
            List<File> have = files(ctx, g);
            List<String> src = sourceList(d);
            boolean aligned = src.size() == have.size();
            boolean[] gone = new boolean[have.size()];
            for (int i = 0; i < have.size(); i++) {
                if (gone[i]) continue;
                Print a = print(null, have.get(i));
                for (int j = i + 1; j < have.size(); j++) {
                    if (gone[j]) continue;
                    Print b = print(null, have.get(j));
                    if (!same(a, b) && !same(b, a)) continue;
                    int lose = b.pixels > a.pixels ? i : j, keep = lose == i ? j : i;
                    if (have.get(lose).getPath().equals(g.localMiximagePath)) setPick(ctx, g, have.get(keep).getPath());
                    have.get(lose).delete();
                    if (aligned) noteSame(d, src.get(lose));
                    gone[lose] = true;
                    changed = true;
                    if (lose == i) break;
                }
            }
            if (changed && aligned) {
                List<String> rest = new ArrayList<String>();
                for (int i = 0; i < have.size(); i++) if (!gone[i]) rest.add(src.get(i));
                writeSources(d, rest);
            }
            String front = frontend(g);
            if (front != null) {
                Print f = print(null, new File(front));
                List<File> left = files(ctx, g);
                List<String> leftSrc = sourceList(d);
                boolean leftAligned = leftSrc.size() == left.size();
                for (int i = 0; i < left.size(); i++) {
                    Print b = print(null, left.get(i));
                    if (!same(f, b) && !same(b, f)) continue;
                    if (b.pixels > f.pixels) {
                        // the download is bigger: it stays and the frontend's copy is left out of the list
                        try {
                            new File(d, ".nofront").createNewFile();
                        } catch (IOException ignored) {
                        }
                        if (front.equals(g.localMiximagePath)) setPick(ctx, g, left.get(i).getPath());
                    } else {
                        // the frontend's copy is as big: the download goes
                        if (left.get(i).getPath().equals(g.localMiximagePath)) setPick(ctx, g, front);
                        left.get(i).delete();
                        if (leftAligned) {
                            noteSame(d, leftSrc.get(i));
                            leftSrc.remove(i);
                            writeSources(d, leftSrc);
                        }
                    }
                    changed = true;
                    break;
                }
            }
        }
        return changed;
    }

    /** The pictures kept for a game, in order. */
    static List<File> files(Context ctx, GameEntity g) {
        File[] all = dir(ctx, g).listFiles();
        List<File> out = new ArrayList<File>();
        if (all == null) return out;
        for (File f : all) if (f.getName().endsWith(".jpg")) out.add(f);
        java.util.Collections.sort(out, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return num(a) - num(b);
            }
        });
        return out;
    }

    private static int num(File f) {
        try {
            return Integer.parseInt(f.getName().replace(".jpg", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static Set<String> sources(File dir) {
        Set<String> s = new HashSet<String>();
        File f = new File(dir, "src.txt");
        if (!f.isFile()) return s;
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            try {
                String line;
                while ((line = r.readLine()) != null) if (!line.isEmpty()) s.add(line);
            } finally {
                r.close();
            }
        } catch (IOException ignored) {
        }
        return s;
    }

    /** Whether this source (a LaunchBox file name or SteamGridDB address) has been saved already. */
    static boolean has(Context ctx, GameEntity g, String source) {
        File d = dir(ctx, g);
        return sources(d).contains(source) || lines(new File(d, "same.txt")).contains(source);
    }

    /**
     * Sources whose picture turned out to be one already kept (the same image from another site, at the same size
     * or smaller). They are written down so they aren't downloaded again.
     */
    private static void noteSame(File d, String source) {
        try {
            d.mkdirs();
            FileOutputStream fos = new FileOutputStream(new File(d, "same.txt"), true);
            try {
                fos.write((source + "\n").getBytes("UTF-8"));
            } finally {
                fos.close();
            }
        } catch (IOException ignored) {
        }
    }

    private static Set<String> lines(File f) {
        Set<String> out = new HashSet<String>();
        if (!f.isFile()) return out;
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            try {
                String line;
                while ((line = r.readLine()) != null) if (!line.isEmpty()) out.add(line);
            } finally {
                r.close();
            }
        } catch (IOException ignored) {
        }
        return out;
    }

    /**
     * A picture's fingerprint for spotting the same image from another site: a small greyscale copy, 32 points tall,
     * plus the full width and height. Null when it can't be read. Copies of kept pictures are remembered, so each
     * file is only read once.
     */
    private static final class Print {
        int w, h;      // the small copy
        int[] px;      // its brightness, row by row
        long pixels;   // the picture's real size, width times height
    }

    private static final java.util.Map<String, Print> PRINTS = new java.util.concurrent.ConcurrentHashMap<String, Print>();

    private static Print print(byte[] data, File file) {
        String key = file == null ? null : file.getPath() + ":" + file.length() + ":" + file.lastModified();
        if (key != null) {
            Print had = PRINTS.get(key);
            if (had != null) return had;
        }
        android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        if (data != null) android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, o);
        else android.graphics.BitmapFactory.decodeFile(file.getPath(), o);
        int w = o.outWidth, h = o.outHeight;
        if (w <= 0 || h <= 0) return null;
        android.graphics.BitmapFactory.Options d = new android.graphics.BitmapFactory.Options();
        d.inSampleSize = Math.max(1, h / 128);
        android.graphics.Bitmap b = data != null ? android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, d)
                : android.graphics.BitmapFactory.decodeFile(file.getPath(), d);
        if (b == null) return null;
        Print p = new Print();
        p.h = 32;
        p.w = Math.max(1, Math.min(120, Math.round((float) w * p.h / h)));
        android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(b, p.w, p.h, true);
        if (small != b) b.recycle();
        p.px = new int[p.w * p.h];
        for (int y = 0; y < p.h; y++) {
            for (int x = 0; x < p.w; x++) {
                int c = small.getPixel(x, y);
                p.px[y * p.w + x] = (299 * ((c >> 16) & 0xff) + 587 * ((c >> 8) & 0xff) + 114 * (c & 0xff)) / 1000;
            }
        }
        small.recycle();
        p.pixels = (long) w * h;
        if (key != null) PRINTS.put(key, p);
        return p;
    }

    /**
     * Whether two pictures are the same image, even cropped, framed or sized differently. The middle of the first
     * is looked for in the second at a range of sizes and positions, and they count as the same when the best
     * match lines up almost exactly (correlation of 0.85 or more; different art for the same game scores far lower).
     */
    /** A downloaded picture's fingerprint, for other lists that drop repeats (the box art picker). Null if unreadable. */
    static Object printOf(byte[] data) {
        return data == null || data.length == 0 ? null : print(data, null);
    }

    /** Whether two fingerprints from printOf are the same image, and the pixel count of one. */
    static boolean sameImage(Object a, Object b) {
        if (!(a instanceof Print) || !(b instanceof Print)) return false;
        return same((Print) a, (Print) b) || same((Print) b, (Print) a);
    }

    static long pixelsOf(Object p) {
        return p instanceof Print ? ((Print) p).pixels : 0;
    }

    private static boolean same(Print a, Print b) {
        if (a == null || b == null) return false;
        int x0 = a.w / 4, x1 = a.w * 3 / 4, y0 = a.h / 4, y1 = a.h * 3 / 4;
        int n = (x1 - x0) * (y1 - y0);
        if (n < 16) return false;
        double ma = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) ma += a.px[y * a.w + x];
        ma /= n;
        double va = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
            double t = a.px[y * a.w + x] - ma;
            va += t * t;
        }
        if (va < 1) return false; // a flat picture says nothing
        float cxa = a.w / 2f, cya = a.h / 2f, cxb = b.w / 2f, cyb = b.h / 2f;
        int[] vals = new int[n];
        for (int si = 0; si <= 9; si++) {
            float sc = 0.80f + 0.05f * si;
            for (int dy = -a.h / 4; dy <= a.h / 4; dy++) {
                for (int dx = -b.w / 4; dx <= b.w / 4; dx++) {
                    int k = 0;
                    boolean inside = true;
                    double sum = 0;
                    for (int y = y0; y < y1 && inside; y++) {
                        int by = (int) ((y - cya) * sc + cyb + dy);
                        if (by < 0 || by >= b.h) { inside = false; break; }
                        for (int x = x0; x < x1; x++) {
                            int bx = (int) ((x - cxa) * sc + cxb + dx);
                            if (bx < 0 || bx >= b.w) { inside = false; break; }
                            int v = b.px[by * b.w + bx];
                            vals[k++] = v;
                            sum += v;
                        }
                    }
                    if (!inside) continue;
                    double mb = sum / n, vb = 0, cov = 0;
                    k = 0;
                    for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
                        double tb = vals[k++] - mb;
                        vb += tb * tb;
                        cov += (a.px[y * a.w + x] - ma) * tb;
                    }
                    if (vb < 1) continue;
                    if (cov / Math.sqrt(va * vb) >= 0.85) return true;
                }
            }
        }
        return false;
    }

    /**
     * Saves a downloaded picture as the next one for the game, exactly as it came: not made smaller and not saved
     * again as a JPEG, so it stays as sharp as the source. Returns the file, or null when the bytes aren't a picture,
     * it could not be saved or the game already has the most it keeps.
     */
    static File add(Context ctx, GameEntity g, String source, byte[] data) {
        if (data == null || data.length == 0) return null;
        android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        synchronized (LOCK) {
            File d = dir(ctx, g);
            List<File> have = files(ctx, g);
            // the same image from another site: only the bigger copy is kept, in the older one's place
            Print mine = print(data, null);
            for (int i = 0; i < have.size(); i++) {
                File f = have.get(i);
                Print theirs = print(null, f);
                if (!same(mine, theirs) && !same(theirs, mine)) continue;
                if (mine.pixels <= theirs.pixels) {
                    noteSame(d, source); // ours is no bigger: keep theirs
                    return f;
                }
                if (!overwrite(f, data)) return f;
                List<String> src = sourceList(d);
                if (src.size() == have.size()) {
                    noteSame(d, src.get(i)); // the smaller copy's site isn't fetched again either
                    src.set(i, source);
                    writeSources(d, src);
                }
                return f;
            }
            if (have.size() >= MAX) return null;
            int next = have.isEmpty() ? 1 : num(have.get(have.size() - 1)) + 1;
            File out = new File(d, next + ".jpg");
            if (have.isEmpty()) {
                // a first picture saved as it came is already full size, so it never needs fetching again
                try {
                    d.mkdirs();
                    new File(d, ".full").createNewFile();
                } catch (IOException ignored) {
                }
            }
            File tmp = new File(out.getPath() + ".tmp");
            try {
                d.mkdirs();
                FileOutputStream fos = new FileOutputStream(tmp);
                try {
                    fos.write(data);
                } finally {
                    fos.close();
                }
                if (!tmp.renameTo(out)) {
                    tmp.delete();
                    return null;
                }
            } catch (IOException e) {
                tmp.delete();
                return null;
            }
            try {
                FileOutputStream fos = new FileOutputStream(new File(d, "src.txt"), true);
                try {
                    fos.write((source + "\n").getBytes("UTF-8"));
                } finally {
                    fos.close();
                }
            } catch (IOException ignored) {
            }
            return out;
        }
    }

    /** Where each kept picture came from, in the order they were saved. */
    private static List<String> sourceList(File dir) {
        List<String> out = new ArrayList<String>();
        File f = new File(dir, "src.txt");
        if (!f.isFile()) return out;
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            try {
                String line;
                while ((line = r.readLine()) != null) if (!line.isEmpty()) out.add(line);
            } finally {
                r.close();
            }
        } catch (IOException ignored) {
        }
        return out;
    }

    /**
     * Keeps only the picture on show for the game and deletes its other fan arts. When the game's own frontend
     * picture (or a miximage) is the one in use, all the downloaded ones go.
     */
    static void keepPick(Context ctx, GameEntity g) {
        if (g == null) return;
        synchronized (LOCK) {
            File d = dir(ctx, g);
            // the list of repeats only applies to pictures that are going; the next search starts afresh
            new File(d, "same.txt").delete();
            if (g.localMiximagePath == null || !isGallery(ctx, g.localMiximagePath)) new File(d, ".nofront").delete();
            List<File> have = files(ctx, g);
            if (have.isEmpty()) return;
            List<String> src = sourceList(d);
            String keepSource = null;
            File keep = null;
            for (int i = 0; i < have.size(); i++) {
                if (have.get(i).getPath().equals(g.localMiximagePath)) {
                    keep = have.get(i);
                    if (src.size() == have.size()) keepSource = src.get(i);
                }
            }
            for (File f : have) if (!f.equals(keep)) f.delete();
            File srcFile = new File(d, "src.txt");
            if (keep == null || keepSource == null) {
                srcFile.delete();
                return;
            }
            try {
                FileOutputStream fos = new FileOutputStream(srcFile, false);
                try {
                    fos.write((keepSource + "\n").getBytes("UTF-8"));
                } finally {
                    fos.close();
                }
            } catch (IOException ignored) {
            }
        }
    }

    /** Fills in the picture count and position the top screen shows. */
    static void decorate(Context ctx, GameEntity g, ArtBus.State s) {
        s.fanCount = 0;
        s.fanPos = 0;
        if (g == null || s.localPath == null) return;
        List<String> list = candidates(ctx, g);
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).equals(s.localPath)) {
                s.fanCount = list.size();
                s.fanPos = i + 1;
                return;
            }
        }
    }

    /** Makes the next (delta 1) or previous (delta -1) picture the one in use. Returns its path, or null if there is only one. */
    static String step(Context ctx, GameEntity g, int delta) {
        List<String> list = candidates(ctx, g);
        if (list.size() < 2) return null;
        int at = 0;
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).equals(g.localMiximagePath)) at = i;
        }
        int to = ((at + delta) % list.size() + list.size()) % list.size();
        String path = list.get(to);
        setPick(ctx, g, path);
        return path;
    }

    /**
     * Tapping the top screen: downloads every fan art the game has online (ScreenScraper, SteamGridDB, LaunchBox),
     * up to MAX, skipping ones already here, and adds each to the swipe list as it arrives. The picture in use is
     * downloaded again first when it was saved smaller by an older version, so it is full quality too. Stops if the
     * game is left part-way.
     */
    static void reload(Context ctx, GameEntity g, boolean useSgdb) {
        File d = dir(ctx, g);
        if (dropRepeats(ctx, g)) showPick(ctx, g); // repeats saved before this check existed
        try {
            if (!new File(d, ".full").isFile()) {
                refetchPick(ctx, g);
                if (!still(g)) return;
            }
            try {
                ScreenScraperClient.Info si = ScreenScraperClient.lookup(ctx, g.title, g.systemId);
                if (si != null && si.fanart != null) addAndShow(ctx, g, si.fanart, ScreenScraperClient.download(si.fanart));
            } catch (IOException ignored) {
                // ScreenScraper unavailable: the others still count
            }
            if (useSgdb) {
                try {
                    for (String url : SteamGridDbClient.heroUrls(ctx, g.title, MAX)) {
                        if (!still(g) || files(ctx, g).size() >= MAX) break;
                        if (has(ctx, g, url)) continue;
                        addAndShow(ctx, g, url, SteamGridDbClient.download(url));
                        pause(400);
                    }
                } catch (SteamGridDbClient.AuthException e) {
                    // the key is wrong: LaunchBox below may still have some
                } catch (SteamGridDbClient.LimitException e) {
                    // too many requests for now
                }
            }
            if (Config.LAUNCHBOX_ART && still(g)) {
                for (String file : LaunchBoxArt.fanFiles(ctx, g.systemId, g.title)) {
                    if (!still(g) || files(ctx, g).size() >= MAX) break;
                    if (has(ctx, g, file)) continue;
                    addAndShow(ctx, g, file, LaunchBoxArt.fanBytes(file));
                }
            }
        } catch (IOException e) {
            // offline: what was found so far stays
        }
        if (still(g) && dropRepeats(ctx, g)) showPick(ctx, g);
        if (still(g)) LibraryScraper.fanSearchDone(ctx, g);
    }

    /** Puts the picture in use back on the top screen, with the count brought up to date. */
    private static void showPick(Context ctx, GameEntity g) {
        if (still(g) && g.localMiximagePath != null) LibraryScraper.refreshTopScreen(ctx, g, g.localMiximagePath);
    }

    /** Whether the game is still the one open on the top screen. */
    private static boolean still(GameEntity g) {
        return LibraryScraper.viewingId == g.id;
    }

    private static void addAndShow(Context ctx, GameEntity g, String source, byte[] data) {
        if (data == null || has(ctx, g, source) || !still(g)) return;
        if (add(ctx, g, source, data) == null) return;
        // the picture on show stays (you may have swiped meanwhile); only the count goes up
        ArtBus.State cur = ArtBus.get();
        String showing = cur.game && cur.gameId == g.id && cur.localPath != null ? cur.localPath : g.localMiximagePath;
        if (showing != null) LibraryScraper.refreshTopScreen(ctx, g, showing);
    }

    /**
     * For fan art saved by an older version (made smaller): downloads the picture in use again, full size, from
     * where it came, and puts it in place of the old one. A picture whose source is unknown, or has gone, stays.
     */
    private static void refetchPick(Context ctx, GameEntity g) throws IOException {
        File d = dir(ctx, g);
        List<File> have = files(ctx, g);
        List<String> src = sourceList(d);
        int idx = -1;
        for (int i = 0; i < have.size(); i++) if (have.get(i).getPath().equals(g.localMiximagePath)) idx = i;
        if (idx >= 0 && src.size() == have.size()) {
            String source = src.get(idx);
            byte[] data;
            if (source.startsWith("http")) {
                data = source.contains("steamgriddb") ? SteamGridDbClient.download(source) : ScreenScraperClient.download(source);
            } else {
                data = LaunchBoxArt.fanBytes(source);
            }
            if (data != null) {
                File old = have.get(idx);
                synchronized (LOCK) {
                    // the old copy's source line is dropped so the new copy can take it
                    List<String> rest = new ArrayList<String>(src);
                    rest.remove(idx);
                    old.delete();
                    writeSources(d, rest);
                }
                File fresh = add(ctx, g, source, data);
                if (fresh != null) {
                    setPick(ctx, g, fresh.getPath());
                    if (still(g)) LibraryScraper.refreshTopScreen(ctx, g, fresh.getPath());
                }
            }
        }
        try {
            d.mkdirs();
            new File(d, ".full").createNewFile();
        } catch (IOException ignored) {
        }
    }

    /** Replaces a kept picture's file with a bigger copy of the same image, in place, so its position stays. */
    private static boolean overwrite(File f, byte[] data) {
        File tmp = new File(f.getPath() + ".tmp");
        try {
            FileOutputStream fos = new FileOutputStream(tmp);
            try {
                fos.write(data);
            } finally {
                fos.close();
            }
            if (!f.delete() || !tmp.renameTo(f)) {
                tmp.delete();
                return false;
            }
            return true;
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
    }

    private static void writeSources(File d, List<String> list) {
        try {
            FileOutputStream fos = new FileOutputStream(new File(d, "src.txt"), false);
            try {
                StringBuilder sb = new StringBuilder();
                for (String s : list) sb.append(s).append('\n');
                fos.write(sb.toString().getBytes("UTF-8"));
            } finally {
                fos.close();
            }
        } catch (IOException ignored) {
        }
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
