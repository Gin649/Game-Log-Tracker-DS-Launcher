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
 * The picture of a game's cartridge or disc, for the tiles in Cart view. It comes from your frontend's media
 * (ES-DE's physicalmedia folder) when the game is on the device, else from LaunchBox's games database. The picture
 * is trimmed, made small and kept in the Carts folder of the app's data folder, so each game is only looked up
 * once. A game with no picture is remembered for a while, and its tile keeps its usual icon.
 */
final class CartArt {

    /** Longest side of the saved picture. Two tiles in a row on the Thor are about this wide. */
    private static final int MAX_SIDE = 512;
    private static final long MISS_MS = 12L * 60 * 60 * 1000;

    private static final Map<String, Object> LOCKS = new HashMap<String, Object>();
    /** LaunchBox is a free service, so only two pictures are fetched from it at a time. */
    private static final Semaphore LAUNCHBOX = new Semaphore(2);

    private CartArt() {}

    /** The saved picture for a game, found and saved now if need be, or null when it has none. Blocks; never call on the main thread. */
    static File find(Context ctx, String title, String console) {
        if (title == null || console == null) return null;
        String key = Matcher.compact(console) + ":" + Matcher.norm(title);
        if (key.length() < 3) return null;
        File out = new File(dir(ctx), hash(key) + ".webp");
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
            CacheDb db = CacheDb.get(ctx);
            String missKey = "cart-miss:" + key;
            String miss = db.read(missKey);
            if (miss != null) {
                try {
                    if (System.currentTimeMillis() - Long.parseLong(miss) < MISS_MS) return null;
                } catch (NumberFormatException ignored) {
                }
            }

            SystemMap map = Shared.systems();
            List<SystemMap.Sys> systems = map == null ? new ArrayList<SystemMap.Sys>() : map.forConsole(console);
            boolean unsure = false; // the network let us down, so "no picture" isn't certain
            Bitmap b = null;
            try {
                b = fromFrontend(systems, title);
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
                if (!unsure) db.write(missKey, String.valueOf(System.currentTimeMillis()));
                return null;
            }
            try {
                return save(shrink(trim(b)), out) ? out : null;
            } catch (Throwable t) { // includes out of memory on a huge picture
                return null;
            }
        }
    }

    /** The picture your frontend has for this game's ROM, when the game is on the device and was scraped with it. */
    private static Bitmap fromFrontend(List<SystemMap.Sys> systems, String title) {
        if (!Config.useEsdeMedia() || systems.isEmpty()) return null;
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
        RomIndex.Rom rom = Matcher.best(pool, title);
        if (rom == null) return null;
        String path = MediaFinder.physical(rom);
        return path == null ? null : MiximageCompositor.decodeFile(path, 1024);
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
