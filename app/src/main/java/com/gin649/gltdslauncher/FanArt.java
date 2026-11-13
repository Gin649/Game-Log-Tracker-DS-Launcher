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

    /** The most pictures downloaded for a game when the top screen is tapped. */
    static final int MAX = 20;
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
        if (g.id > 0 && Config.useEsdeMedia()) {
            String d = MediaFinder.lookup(g.systemId, g.romPath).direct;
            if (d != null && new File(d).isFile()) out.add(d);
        }
        for (File f : files(ctx, g)) out.add(f.getPath());
        return out;
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
        return sources(dir(ctx, g)).contains(source);
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
        if (still(g)) LibraryScraper.fanSearchDone(ctx, g);
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
