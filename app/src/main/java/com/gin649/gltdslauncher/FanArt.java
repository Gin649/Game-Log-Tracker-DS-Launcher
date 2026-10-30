package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;

import com.gin649.gltdslauncher.database.GameEntity;
import com.gin649.gltdslauncher.database.GameRepository;
import com.gin649.gltdslauncher.graphics.MiximageCompositor;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The fan art pictures found online for one game, kept side by side so the top screen can swipe between them.
 * They live in fanart/&lt;system&gt;/&lt;game id&gt;/1.jpg, 2.jpg and so on. The game's miximage path points at the one
 * in use, so the choice is remembered without anything else being stored. src.txt lists where each picture came
 * from (so nothing is downloaded twice) and .done means the search for more has finished.
 */
final class FanArt {

    static final int MAX = 6;
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
     * Saves a picture as the next one for the game. Returns the file, or null when it could not be saved or the game
     * already has the most it keeps.
     */
    static File add(Context ctx, GameEntity g, String source, Bitmap b) {
        synchronized (LOCK) {
            File d = dir(ctx, g);
            List<File> have = files(ctx, g);
            if (have.size() >= MAX) return null;
            int next = have.isEmpty() ? 1 : num(have.get(have.size() - 1)) + 1;
            File out = MiximageCompositor.saveJpeg(b, new File(d, next + ".jpg"));
            if (out == null) return null;
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
     * Looks for the game's other fan art online, up to MAX in all, once. Called when a game is opened, so a bulk
     * "Fetch game art" only has to download one picture per game.
     */
    static void fillMore(Context ctx, GameEntity g, boolean useSgdb) {
        File d = dir(ctx, g);
        if (new File(d, ".done").exists()) return;
        boolean complete = true;
        try {
            if (useSgdb) {
                try {
                    for (String url : SteamGridDbClient.heroUrls(ctx, g.title, MAX)) {
                        if (files(ctx, g).size() >= MAX) break;
                        if (has(ctx, g, url)) continue;
                        byte[] data = SteamGridDbClient.download(url);
                        Bitmap b = data == null ? null : MiximageCompositor.decode(data, 1920);
                        if (b != null) {
                            try {
                                add(ctx, g, url, b);
                            } finally {
                                b.recycle();
                            }
                        }
                        pause(400);
                    }
                } catch (SteamGridDbClient.AuthException e) {
                    // the key is wrong; LaunchBox below may still have some
                } catch (SteamGridDbClient.LimitException e) {
                    complete = false;
                }
            }
            if (Config.LAUNCHBOX_ART) {
                for (String file : LaunchBoxArt.fanFiles(ctx, g.systemId, g.title)) {
                    if (files(ctx, g).size() >= MAX) break;
                    if (has(ctx, g, file)) continue;
                    Bitmap b = LaunchBoxArt.fanImage(file);
                    if (b != null) {
                        try {
                            add(ctx, g, file, b);
                        } finally {
                            b.recycle();
                        }
                    }
                }
            }
        } catch (IOException e) {
            complete = false; // offline: try again next time the game is opened
        }
        if (complete) {
            try {
                new File(d, ".done").createNewFile();
            } catch (IOException ignored) {
            }
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
