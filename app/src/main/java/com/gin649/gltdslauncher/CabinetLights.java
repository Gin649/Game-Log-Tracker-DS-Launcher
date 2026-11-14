package com.gin649.gltdslauncher;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.LayerDrawable;
import android.view.Gravity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;

/**
 * The arcade cabinet on the top screen, with its lights. The cabinet's picture is the lit one (cover on the screen);
 * over it lie the parts of the app's off.png that show it switched off: the marquee, the coin slots, and the screen,
 * which is split in two halves so it can open out from a line in the middle, as an old CRT does.
 * shell.json in the app's arcade shell says where each part is.
 */
final class CabinetLights {

    final LayerDrawable drawable;
    private final BitmapDrawable marquee, coins;
    private final ClipDrawable screenTop, screenBottom;
    /** Where the screen's top, middle and bottom are, as levels for the two halves' clips (0 to 10000). */
    private final int topFull, topGone, bottomFull, bottomGone;

    private CabinetLights(LayerDrawable d, BitmapDrawable marquee, BitmapDrawable coins, ClipDrawable top,
                          ClipDrawable bottom, int topFull, int topGone, int bottomFull, int bottomGone) {
        this.drawable = d;
        this.marquee = marquee;
        this.coins = coins;
        this.screenTop = top;
        this.screenBottom = bottom;
        this.topFull = topFull;
        this.topGone = topGone;
        this.bottomFull = bottomFull;
        this.bottomGone = bottomGone;
        off();
    }

    /**
     * The cabinet with its lights, or null when this picture isn't the app's own cabinet (one from your own
     * Shells folder, say), which then just shows lit.
     */
    static CabinetLights make(Context ctx, Bitmap cabinet) {
        InputStream in = null;
        try {
            in = ctx.getAssets().open("shells/arcade/shell.json");
            JSONObject spots = new JSONObject(readAll(in)).getJSONObject("lights");
            in.close();
            in = ctx.getAssets().open("shells/arcade/off.png");
            Bitmap off = BitmapFactory.decodeStream(in);
            if (off == null) return null;
            int w = off.getWidth(), h = off.getHeight();
            // the cabinet picture is the shell, perhaps at another size: the shapes must match
            float a = cabinet.getWidth() / (float) cabinet.getHeight(), b = w / (float) h;
            if (Math.abs(a - b) > 0.01f) return null;

            Rect m = rect(spots.getJSONArray("marquee"));
            JSONArray cs = spots.getJSONArray("coins");
            Rect s = rect(spots.getJSONArray("screen"));
            int mid = (s.top + s.bottom) / 2;

            Bitmap marqueeOff = part(off, m);
            Bitmap coinsOff = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            for (int i = 0; i < cs.length(); i++) {
                Rect r = rect(cs.getJSONArray(i));
                new Canvas(coinsOff).drawBitmap(off, r, r, null);
            }
            Bitmap topOff = part(off, new Rect(s.left, s.top, s.right, mid));
            Bitmap bottomOff = part(off, new Rect(s.left, mid, s.right, s.bottom));
            off.recycle();

            android.content.res.Resources res = ctx.getResources();
            BitmapDrawable base = new BitmapDrawable(res, cabinet);
            BitmapDrawable md = new BitmapDrawable(res, marqueeOff);
            BitmapDrawable cd = new BitmapDrawable(res, coinsOff);
            ClipDrawable top = new ClipDrawable(new BitmapDrawable(res, topOff), Gravity.TOP, ClipDrawable.VERTICAL);
            ClipDrawable bottom = new ClipDrawable(new BitmapDrawable(res, bottomOff), Gravity.BOTTOM, ClipDrawable.VERTICAL);
            LayerDrawable d = new LayerDrawable(new Drawable[]{base, md, cd, top, bottom});
            return new CabinetLights(d, md, cd, top, bottom,
                    level(mid, h), level(s.top, h), level(h - mid, h), level(h - s.bottom, h));
        } catch (Exception e) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /** All off: dark marquee, dark coin slots, a blank screen. */
    void off() {
        marquee(0f);
        coins(0f);
        screen(0f);
    }

    /** 0 off to 1 fully lit. */
    void marquee(float lit) {
        marquee.setAlpha(Math.round(255 * (1f - clamp(lit))));
    }

    void coins(float lit) {
        coins.setAlpha(Math.round(255 * (1f - clamp(lit))));
    }

    /** 0 blank to 1 showing the whole picture, opening out from the middle. */
    void screen(float on) {
        float k = clamp(on);
        screenTop.setLevel(Math.round(topFull + (topGone - topFull) * k));
        screenBottom.setLevel(Math.round(bottomFull + (bottomGone - bottomFull) * k));
        drawable.invalidateSelf();
    }

    private static float clamp(float v) {
        return v < 0 ? 0 : v > 1 ? 1 : v;
    }

    private static int level(int px, int of) {
        return Math.round(10000f * px / of);
    }

    private static Rect rect(JSONArray a) throws Exception {
        return new Rect(a.getInt(0), a.getInt(1), a.getInt(2), a.getInt(3));
    }

    /** A full-size see-through picture with just this part of the source in it. */
    private static Bitmap part(Bitmap src, Rect r) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
        new Canvas(out).drawBitmap(src, r, r, null);
        return out;
    }

    private static String readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
