package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

import java.io.File;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Blank cartridges and discs, one per console, used to make a cartridge for a game that has no picture of its own
 * (see {@link CartArt}). A shell is a shell.png with a see-through window where the label goes. The app comes with
 * a set in assets/shells/[system]/, and a Shells/[system]/ folder in the app's data folder adds to them or
 * replaces them, where [system] is the system's folder name (snes) or any name the app knows that system by.
 *
 * Nothing has to say where the window is. It is found from the picture: the biggest see-through area that has
 * the shell's plastic on both sides of it. That way a window that is open at the top (a label that folds over the
 * edge) counts, and the empty space around the cartridge does not.
 */
final class Shells {

    /** Less solid than this counts as see-through (0 to 255). A disc's faint rim is still solid enough. */
    private static final int SOLID = 96;

    static final class Shell {
        /** Names this shell and this version of it, so a cartridge made with it can be told from one made with another. */
        String id;
        private Bitmap picture;
        private boolean[] window; // true where the label shows through
        private int left, top, right, bottom; // the window's box

        /** The shell with this cover in its label, filling the window and cut to it around the middle. */
        Bitmap withLabel(Bitmap art) {
            int w = picture.getWidth(), h = picture.getHeight();
            Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(out);
            int bw = right - left, bh = bottom - top;
            float k = Math.max(bw / (float) art.getWidth(), bh / (float) art.getHeight());
            float aw = art.getWidth() * k, ah = art.getHeight() * k;
            float x = left + (bw - aw) / 2f, y = top + (bh - ah) / 2f;
            Paint smooth = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
            c.save();
            c.clipRect(left, top, right, bottom);
            c.drawBitmap(art, null, new RectF(x, y, x + aw, y + ah), smooth);
            c.restore();
            // keep the cover only where the window is, then lay the shell over it
            int[] px = new int[w * h];
            out.getPixels(px, 0, w, 0, 0, w, h);
            for (int i = 0; i < px.length; i++) {
                if (!window[i]) px[i] = 0;
            }
            out.setPixels(px, 0, w, 0, 0, w, h);
            c.drawBitmap(picture, 0, 0, smooth);
            return out;
        }
    }

    /** The last few shells used, ready to go. Each is about a megabyte, so only a handful are kept. */
    private static final Map<String, Shell> READY = new LinkedHashMap<String, Shell>(8, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Shell> eldest) {
            return size() > 6;
        }
    };

    private Shells() {}

    /**
     * The shell for a game: the first of these system folders that has one, yours before the app's own. A console
     * the app has no system for (one you added by hand) is looked for by its name. Null when there is none, or
     * when the picture has no window to put a label in.
     */
    static Shell find(Context ctx, List<String> folders, String console) {
        SystemMap map = Shared.systems();
        File[] mine = new File(DataStore.root(ctx), "Shells").listFiles();
        String byName = Matcher.compact(console);
        for (int pass = 0; pass < 2; pass++) {
            // pass 0 is your Shells folder, pass 1 the shells that come with the app
            for (String folder : folders) {
                Shell s = pass == 0 ? fromFolder(mine, map, folder, null) : fromAssets(ctx, folder, map);
                if (s != null) return s;
            }
            if (!byName.isEmpty()) {
                Shell s = pass == 0 ? fromFolder(mine, map, null, byName) : fromAssets(ctx, byName, null);
                if (s != null) return s;
            }
        }
        return null;
    }

    private static Shell fromFolder(File[] dirs, SystemMap map, String folder, String consoleName) {
        if (dirs == null) return null;
        for (File d : dirs) {
            if (!d.isDirectory()) continue;
            String n = d.getName();
            boolean hit;
            if (folder != null) {
                hit = n.equalsIgnoreCase(folder) || (map != null && folder.equals(map.systemForName(n)));
            } else {
                hit = Matcher.compact(n).equals(consoleName);
            }
            if (!hit) continue;
            File png = new File(d, "shell.png");
            if (!png.isFile()) continue;
            String id = "mine:" + png.getPath() + ":" + png.lastModified() + ":" + png.length();
            Shell s = ready(id);
            if (s == null) s = keep(id, BitmapFactory.decodeFile(png.getPath()));
            if (s != null) return s;
        }
        return null;
    }

    private static Shell fromAssets(Context ctx, String folder, SystemMap map) {
        Shell s = fromAsset(ctx, folder);
        if (s == null && map != null) {
            // a folder you named yourself ("Game Boy Advance") stands for a built-in system ("gba")
            String base = map.baseOf(folder);
            if (!base.equals(folder)) s = fromAsset(ctx, base);
        }
        return s;
    }

    private static Shell fromAsset(Context ctx, String name) {
        if (name == null || name.isEmpty() || name.contains("/") || name.contains("..")) return null;
        String id = "app:" + name;
        Shell s = ready(id);
        if (s != null) return s;
        InputStream in = null;
        try {
            in = ctx.getAssets().open("shells/" + name + "/shell.png");
            return keep(id, BitmapFactory.decodeStream(in));
        } catch (Exception e) {
            return null; // no shell for this system
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private static synchronized Shell ready(String id) {
        return READY.get(id);
    }

    private static Shell keep(String id, Bitmap b) {
        Shell s = prepare(b);
        if (s == null) return null;
        s.id = id;
        synchronized (Shells.class) {
            READY.put(id, s);
        }
        return s;
    }

    /** Makes the picture the size cartridges are saved at and finds its window. Null when it has none. */
    private static Shell prepare(Bitmap b) {
        if (b == null) return null;
        int longest = Math.max(b.getWidth(), b.getHeight());
        if (longest > CartArt.MAX_SIDE) {
            float k = CartArt.MAX_SIDE / (float) longest;
            b = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * k)), Math.max(1, Math.round(b.getHeight() * k)), true);
        }
        if (b.getConfig() != Bitmap.Config.ARGB_8888) b = b.copy(Bitmap.Config.ARGB_8888, false);
        if (b == null) return null;
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);

        // see-through spots with solid plastic somewhere to their left and to their right
        boolean[] inside = new boolean[w * h];
        for (int y = 0; y < h; y++) {
            int row = y * w, first = -1, last = -1;
            for (int x = 0; x < w; x++) {
                if ((px[row + x] >>> 24) >= SOLID) {
                    if (first < 0) first = x;
                    last = x;
                }
            }
            for (int x = first + 1; x < last; x++) {
                if (first >= 0 && (px[row + x] >>> 24) < SOLID) inside[row + x] = true;
            }
        }

        // the biggest joined-up area of them is the window
        int[] area = new int[w * h]; // 0 not looked at yet, else the number of the area it belongs to
        int[] queue = new int[w * h];
        int best = 0, bestSize = 0, count = 0;
        int bl = 0, bt = 0, br = 0, bb = 0;
        for (int start = 0; start < inside.length; start++) {
            if (!inside[start] || area[start] != 0) continue;
            count++;
            int head = 0, tail = 0, size = 0;
            int l = w, t = h, r = -1, bo = -1;
            queue[tail++] = start;
            area[start] = count;
            while (head < tail) {
                int i = queue[head++];
                int x = i % w, y = i / w;
                size++;
                if (x < l) l = x;
                if (x > r) r = x;
                if (y < t) t = y;
                if (y > bo) bo = y;
                if (x > 0 && inside[i - 1] && area[i - 1] == 0) { area[i - 1] = count; queue[tail++] = i - 1; }
                if (x < w - 1 && inside[i + 1] && area[i + 1] == 0) { area[i + 1] = count; queue[tail++] = i + 1; }
                if (y > 0 && inside[i - w] && area[i - w] == 0) { area[i - w] = count; queue[tail++] = i - w; }
                if (y < h - 1 && inside[i + w] && area[i + w] == 0) { area[i + w] = count; queue[tail++] = i + w; }
            }
            if (size > bestSize) {
                bestSize = size;
                best = count;
                bl = l;
                bt = t;
                br = r;
                bb = bo;
            }
        }
        if (bestSize < w * h / 50) return null; // too small to be a label

        // one pixel wider all round, so the cover reaches under the window's soft edge
        boolean[] window = new boolean[w * h];
        for (int i = 0; i < window.length; i++) {
            if (area[i] != best) continue;
            int x = i % w, y = i / w;
            window[i] = true;
            if (x > 0) window[i - 1] = true;
            if (x < w - 1) window[i + 1] = true;
            if (y > 0) window[i - w] = true;
            if (y < h - 1) window[i + w] = true;
        }

        // The cover is fitted to the main part of the window. A thin sliver sticking out of it (the gap along a
        // label's edge) would otherwise stretch the box and have the cover cut down far more than it needs.
        int[] perCol = new int[w], perRow = new int[h];
        int mostCol = 0, mostRow = 0;
        for (int i = 0; i < area.length; i++) {
            if (area[i] != best) continue;
            int c = ++perCol[i % w], r = ++perRow[i / w];
            if (c > mostCol) mostCol = c;
            if (r > mostRow) mostRow = r;
        }
        int l2 = bl, r2 = br, t2 = bt, b2 = bb;
        while (l2 < r2 && perCol[l2] * 4 < mostCol) l2++;
        while (r2 > l2 && perCol[r2] * 4 < mostCol) r2--;
        while (t2 < b2 && perRow[t2] * 4 < mostRow) t2++;
        while (b2 > t2 && perRow[b2] * 4 < mostRow) b2--;
        // only when it makes a real difference: the rounded edge of a disc narrows too, and must stay covered
        if ((r2 - l2) * 100 < (br - bl) * 85) {
            bl = l2;
            br = r2;
        }
        if ((b2 - t2) * 100 < (bb - bt) * 85) {
            bt = t2;
            bb = b2;
        }

        Shell s = new Shell();
        s.picture = b;
        s.window = window;
        s.left = bl;
        s.top = bt;
        s.right = br + 1;
        s.bottom = bb + 1;
        return s;
    }
}
