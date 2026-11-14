package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;

import com.gin649.gltdslauncher.graphics.MiximageCompositor;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;

/**
 * The picture of a game's cartridge or disc, for Cart view. A real picture of it is used when there is one: your
 * frontend's media (ES-DE's physicalmedia folder) when the game is on the device, else LaunchBox's games database,
 * else ScreenScraper's. The US one is taken first, then Europe's, then any other.
 * A game with neither gets a cartridge made here: its console's blank shell (see {@link Shells}) with the game's
 * cover put in the label. Pictures are trimmed, made small and kept in the Carts folder of the app's data folder,
 * so each game is only worked out once. A game with no picture and no shell keeps its usual icon.
 */
final class CartArt {

    /** Longest side of the saved picture. Two tiles in a row on the Thor are about this wide. */
    static final int MAX_SIDE = 512;
    private static final long MISS_MS = 12L * 60 * 60 * 1000;
    /** Starts the name of every saved picture. Change it to have them all made again. */
    private static final String VERSION = "5_";
    private static final long NO_COVER_MS = 10L * 60 * 1000;

    private static final Map<String, Object> LOCKS = new HashMap<String, Object>();
    /** Games whose cover could not be fetched just now, so they are not asked for again on every redraw. */
    private static final Map<String, Long> NO_COVER = new HashMap<String, Long>();
    /** LaunchBox is a free service, so only two pictures are fetched from it at a time. */
    private static final Semaphore LAUNCHBOX = new Semaphore(2);
    /** ScreenScraper allows few requests at once, so its pictures are fetched one at a time. */
    private static final Semaphore SCREENSCRAPER = new Semaphore(1);

    private CartArt() {}

    /**
     * The saved picture for a game, found or made now if need be, or null when it has none. gameId is the game's
     * number in the tracker (for the cover you picked), cover is the address of its usual picture, and a hack never
     * takes the original game's cartridge or cover. Blocks; never call on the main thread.
     */
    static File find(Context ctx, String title, String console, String gameId, String cover, boolean hack, boolean tile) {
        if (title == null || console == null) return null;
        String key = Matcher.compact(console) + ":" + Matcher.norm(title);
        if (key.length() < 3) return null;
        clearOld(ctx);
        File out = new File(dir(ctx), VERSION + hash(key) + ".webp");
        if (out.isFile() && out.length() > 0) return out;

        Object lock;
        synchronized (LOCKS) {
            lock = LOCKS.get(key);
            if (lock == null) {
                lock = new Object();
                LOCKS.put(key, lock);
            }
        }
        synchronized (lock) {
            if (out.isFile() && out.length() > 0) return out;
            SystemMap map = Shared.systems();
            List<SystemMap.Sys> systems = map == null ? new ArrayList<SystemMap.Sys>() : map.forConsole(console);
            RomIndex.Rom rom = null;
            try {
                rom = hack ? hackRom(title, console) : romFor(systems, title);
            } catch (Throwable ignored) {
            }

            // a real picture of the cartridge or disc (not for systems that always use their own shell)
            CacheDb db = CacheDb.get(ctx);
            String missKey = "cart-miss3:" + key;
            if (!hack && !shellOnly(console, systems) && !recentMiss(db.read(missKey))) {
                boolean unsure = false; // the network let us down, so "no picture" isn't certain
                Bitmap b = null;
                try {
                    b = fromFrontend(rom);
                } catch (Throwable ignored) {
                }
                if (b == null && Config.LAUNCHBOX_ART) {
                    try {
                        b = fromLaunchBox(ctx, systems, title);
                    } catch (IOException e) {
                        unsure = true;
                    } catch (Throwable ignored) {
                    }
                }
                if (b == null) {
                    try {
                        b = fromScreenScraper(ctx, console, title);
                    } catch (IOException e) {
                        unsure = true;
                    } catch (Throwable ignored) {
                    }
                }
                if (b != null) {
                    try {
                        if (save(shrink(trim(b)), out)) return out;
                    } catch (Throwable ignored) { // includes out of memory on a huge picture
                    }
                    return null;
                }
                if (!unsure) db.write(missKey, String.valueOf(System.currentTimeMillis()));
            }

            // none: the console's blank shell with the game's cover in its label
            try {
                return custom(ctx, key, systems, rom, console, title, gameId, cover, hack);
            } catch (Throwable t) {
                return null;
            }
        }
    }

    /**
     * Systems that always get their own shell with the game's cover, never a scan: the scans of their cartridges
     * and discs were patchy and looked plain. Arcade games get an arcade cabinet with the cover on its screen.
     */
    private static final java.util.Set<String> SHELL_ONLY = new java.util.HashSet<String>(
            java.util.Arrays.asList("mastersystem", "pcengine", "pcenginecd", "arcade"));

    private static boolean shellOnly(String console, List<SystemMap.Sys> systems) {
        if (isArcade(console)) return true;
        for (SystemMap.Sys s : systems) {
            if (SHELL_ONLY.contains(s.folder)) return true;
        }
        return false;
    }

    /** An arcade game: it gets the arcade cabinet, which lights up on the top screen when the game starts. */
    static boolean isArcade(String console) {
        if (console == null) return false;
        if (Matcher.compact(console).equals("arcade")) return true;
        SystemMap map = Shared.systems();
        if (map == null) return false;
        for (SystemMap.Sys s : map.forConsole(console)) {
            if ("arcade".equals(s.folder)) return true;
        }
        return false;
    }


    private static boolean cleared;

    /**
     * Pictures saved by an earlier version of this (cartridges from any region) are thrown away once, so they are
     * looked up again. Saved pictures now have names starting with the version.
     */
    private static synchronized void clearOld(Context ctx) {
        if (cleared) return;
        cleared = true;
        File[] all = dir(ctx).listFiles();
        if (all == null) return;
        for (File f : all) {
            if (!f.getName().startsWith(VERSION)) f.delete();
        }
    }

    private static boolean recentMiss(String saved) {
        if (saved == null) return false;
        try {
            return System.currentTimeMillis() - Long.parseLong(saved) < MISS_MS;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * A cartridge made from the console's shell and the game's cover. It is kept under a name that goes with the
     * shell and the cover you picked, so picking another cover (or swapping the shell) makes a new one.
     */
    private static File custom(Context ctx, String key, List<SystemMap.Sys> systems, RomIndex.Rom rom, String console,
                               String title, String gameId, String cover, boolean hack) {
        List<String> names = new ArrayList<String>();
        boolean arcade = isArcade(console);
        if (arcade) names.add("arcade");
        if (rom != null && !arcade) names.add(rom.sys.folder); // the folder the game is in comes first (Famicom before NES)
        for (SystemMap.Sys s : systems) {
            if (!s.hack && !names.contains(s.folder) && !arcade) names.add(s.folder);
        }
        Shells.Shell shell = Shells.find(ctx, names, console);
        if (shell == null) return null;

        String pick = null;
        if (gameId != null && gameId.matches("[A-Za-z0-9_.-]+")) {
            pick = DataStore.get(ctx, "priv:boxpick:" + gameId);
            if (pick != null) pick = pick.trim();
            if (pick != null && pick.isEmpty()) pick = null;
        }
        String base = VERSION + hash(key);
        // the usual picture is part of the name too: once the tracker has found a game's box art, its cartridge is
        // made again with that in place of the small icon
        String from = pick != null ? pick : "auto|" + (cover == null ? "" : cover);
        File out = new File(dir(ctx), base + "-s" + hash(shell.id + "|" + from) + ".webp");
        if (out.isFile() && out.length() > 0) return out;

        Long failed;
        synchronized (NO_COVER) {
            failed = NO_COVER.get(out.getName());
        }
        if (failed != null && System.currentTimeMillis() - failed < NO_COVER_MS) return null;

        Bitmap art = pick == null ? null : cover(ctx, pick);
        // A hack only takes the box art of its own ROM. Looking it up by name would find the original game's.
        if (art == null) art = hack ? frontendCover(rom) : coverFor(ctx, systems, rom, title);
        if (art == null) art = cover(ctx, cover);
        Bitmap made = art == null ? null : shell.withLabel(art);
        // The cabinet is kept whole and at full size: the top screen lights it up a part at a time, and it is shown
        // large there, so its picture must line up with the shell's own.
        if (made == null || !save(arcade ? made : shrink(trim(made)), out)) {
            synchronized (NO_COVER) {
                NO_COVER.put(out.getName(), System.currentTimeMillis());
            }
            return null;
        }
        // a cartridge made earlier with another cover or shell is no longer wanted
        File[] old = dir(ctx).listFiles();
        if (old != null) {
            for (File f : old) {
                if (f.getName().startsWith(base + "-s") && !f.equals(out)) f.delete();
            }
        }
        return out;
    }

    /** A hack's own ROM, from one of your hack folders, or null. Never the game it is a hack of. */
    private static RomIndex.Rom hackRom(String title, String console) {
        RomIndex.Rom r = Shared.findRom(title, console);
        return r != null && r.sys.hack ? r : null;
    }

    /** The box art your frontend has for this ROM, or null. */
    private static Bitmap frontendCover(RomIndex.Rom rom) {
        if (rom == null || !Config.useEsdeMedia()) return null;
        String path = MediaFinder.boxArt(rom.sys.folder, rom.file.getPath());
        return path == null ? null : MiximageCompositor.decodeFile(path, 1024);
    }

    /** The game's ROM on this device, or null when it isn't here. */
    private static RomIndex.Rom romFor(List<SystemMap.Sys> systems, String title) {
        if (systems.isEmpty()) return null;
        RomIndex index = Shared.index();
        if (index == null) return null;
        List<RomIndex.Rom> pool = new ArrayList<RomIndex.Rom>();
        for (RomIndex.Rom r : index.all()) {
            for (SystemMap.Sys s : systems) {
                if (r.sys.folder.equals(s.folder)) {
                    pool.add(r);
                    break;
                }
            }
        }
        return Matcher.best(pool, title);
    }

    /** The picture your frontend has for this game's ROM, when the game is on the device and was scraped with it. */
    private static Bitmap fromFrontend(RomIndex.Rom rom) {
        if (!Config.useEsdeMedia() || rom == null) return null;
        String path = MediaFinder.physical(rom);
        return path == null ? null : MiximageCompositor.decodeFile(path, 1024);
    }

    /** The cover the tracker would show for a game that is here or listed: your frontend's first, then LaunchBox's. */
    private static Bitmap coverFor(Context ctx, List<SystemMap.Sys> systems, RomIndex.Rom rom, String title) {
        Bitmap own = frontendCover(rom);
        if (own != null) return own;
        if (!Config.LAUNCHBOX_ART) return null;
        for (SystemMap.Sys s : systems) {
            if (s.hack) continue;
            try {
                String url = LaunchBoxArt.frontUrl(ctx, s.folder, title);
                if (url != null) return cover(ctx, url);
            } catch (IOException e) {
                return null;
            }
        }
        return null;
    }

    /** A cover from one of the addresses the tracker uses for them: a file your frontend has, or a picture online. */
    private static Bitmap cover(Context ctx, String url) {
        if (url == null || url.isEmpty()) return null;
        try {
            String local = "https://" + Config.APP_HOST_BUILTIN + "/art/";
            if (url.startsWith(local)) {
                File f = ThorBridge.artForToken(url.substring(local.length()));
                return f == null ? null : MiximageCompositor.decodeFile(f.getPath(), 1024);
            }
            if (!url.startsWith("https://")) return null;
            byte[] data = LaunchBoxArt.imageBytes(url);
            if (data == null) data = ScreenScraperClient.download(url);
            if (data != null) return MiximageCompositor.decode(data, 1024);
            return Images.download(url, 1024, 1024);
        } catch (Throwable t) {
            return null;
        }
    }

    /** LaunchBox's picture of the cartridge, else the disc. Throws when the network could not be reached. */
    private static Bitmap fromLaunchBox(Context ctx, List<SystemMap.Sys> systems, String title) throws IOException {
        String url = null;
        for (SystemMap.Sys s : systems) {
            if (s.hack) continue; // a hack folder stands for the same console as its plain folder
            url = LaunchBoxArt.cartUrl(ctx, s.folder, title);
            if (url != null) break;
        }
        if (url == null) return null;
        try {
            LAUNCHBOX.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted");
        }
        try {
            return MiximageCompositor.decode(LaunchBoxArt.imageBytes(url), 1024);
        } finally {
            LAUNCHBOX.release();
        }
    }

    /** ScreenScraper's picture of the cartridge or disc, through the app's Worker. Throws when the network let us down. */
    private static Bitmap fromScreenScraper(Context ctx, String console, String title) throws IOException {
        try {
            SCREENSCRAPER.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted");
        }
        try {
            ScreenScraperClient.Info info = ScreenScraperClient.lookup(ctx, title, console, true);
            String url = ScreenScraperClient.bestCart(info);
            if (url == null) return null;
            byte[] data = ScreenScraperClient.download(url);
            return data == null ? null : MiximageCompositor.decode(data, 1024);
        } finally {
            SCREENSCRAPER.release();
        }
    }

    /** Cuts away the empty see-through border, so the cartridge fills its tile as far as it can. */
    private static Bitmap trim(Bitmap b) {
        if (!b.hasAlpha()) return b;
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        int left = w, right = -1, top = h, bottom = -1;
        for (int y = 0; y < h; y++) {
            int row = y * w;
            for (int x = 0; x < w; x++) {
                if ((px[row + x] >>> 24) > 16) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    bottom = y;
                }
            }
        }
        if (right < left || bottom < top) return b; // nothing but empty space: leave it alone
        if (left == 0 && top == 0 && right == w - 1 && bottom == h - 1) return b;
        return Bitmap.createBitmap(b, left, top, right - left + 1, bottom - top + 1);
    }

    private static Bitmap shrink(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int longest = Math.max(w, h);
        if (longest <= MAX_SIDE) return b;
        float k = MAX_SIDE / (float) longest;
        return Bitmap.createScaledBitmap(b, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true);
    }

    /** Written under another name first, so a half-written file is never taken for a finished one. */
    private static boolean save(Bitmap b, File out) {
        File parent = out.getParentFile();
        if (parent != null) parent.mkdirs();
        File tmp = new File(out.getPath() + ".tmp");
        try {
            FileOutputStream fos = new FileOutputStream(tmp);
            try {
                if (!b.compress(Bitmap.CompressFormat.WEBP_LOSSY, 90, fos)) return false;
            } finally {
                fos.close();
            }
            return tmp.renameTo(out);
        } catch (IOException e) {
            return false;
        } finally {
            tmp.delete();
        }
    }

    private static File dir(Context ctx) {
        return new File(DataStore.root(ctx), "Carts");
    }

    private static String hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) sb.append(String.format("%02x", d[i] & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
