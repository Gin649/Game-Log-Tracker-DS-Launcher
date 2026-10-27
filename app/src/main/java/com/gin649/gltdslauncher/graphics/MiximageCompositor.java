package com.gin649.gltdslauncher.graphics;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Builds one flat 1280x720 image from a screenshot, box art and a logo, entirely in memory.
 * Based on the implementation spec, with three changes: every layer is optional, layers keep their
 * aspect ratio instead of being stretched, and the result is saved as JPEG (quality 90) because the
 * PNG quality setting is ignored by Android and PNGs this size are several times larger.
 */
public final class MiximageCompositor {

    public static final int WIDTH = 1280;
    public static final int HEIGHT = 720;

    private static final Rect BOX_AREA = new Rect(50, 100, 390, 620);
    private static final Rect LOGO_AREA = new Rect(450, 50, 1230, 300);

    private MiximageCompositor() {}

    /**
     * Returns targetFile when it was written, or null if there was nothing to draw or saving failed.
     * screenshot, boxArt and logo may each be null. The bitmaps passed in are not recycled.
     */
    public static File createMiximage(Bitmap screenshot, Bitmap boxArt, Bitmap logo, File targetFile) {
        if (screenshot == null && boxArt == null && logo == null) return null;

        Bitmap composite = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888);
        File tmp = new File(targetFile.getPath() + ".tmp");
        try {
            Canvas canvas = new Canvas(composite);
            canvas.drawColor(0xFF15121F);
            Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);

            // 1. Background (fan art when there is some, otherwise a screenshot) fills the whole frame (cropped, not stretched), dimmed so the layers on top stand out.
            if (screenshot != null) {
                drawCover(canvas, screenshot, paint);
                Paint dim = new Paint();
                dim.setColor(0x73000000);
                canvas.drawRect(0, 0, WIDTH, HEIGHT, dim);
            }

            // 2. Box art on the left, fitted inside its area and sitting on a soft shadow.
            if (boxArt != null) {
                Rect r = fit(boxArt, BOX_AREA, true);
                Paint shadow = new Paint();
                shadow.setColor(0x80000000);
                canvas.drawRect(r.left + 8, r.top + 8, r.right + 8, r.bottom + 8, shadow);
                canvas.drawBitmap(boxArt, null, r, paint);
            }

            // 3. Transparent logo or marquee at the top right.
            if (logo != null) {
                canvas.drawBitmap(logo, null, fit(logo, LOGO_AREA, false), paint);
            }

            File parent = targetFile.getParentFile();
            if (parent != null) parent.mkdirs();
            FileOutputStream out = new FileOutputStream(tmp);
            try {
                if (!composite.compress(Bitmap.CompressFormat.JPEG, 90, out)) {
                    tmp.delete();
                    return null;
                }
            } finally {
                out.close();
            }
            if (targetFile.exists() && !targetFile.delete()) {
                tmp.delete();
                return null;
            }
            if (tmp.renameTo(targetFile)) return targetFile;
            tmp.delete();
            return null;
        } catch (Exception e) {
            tmp.delete();
            return null;
        } finally {
            composite.recycle();
        }
    }

    /** Decodes image bytes, shrinking anything larger than maxSide so big downloads can't run out of memory. */
    public static Bitmap decode(byte[] data, int maxSide) {
        if (data == null || data.length == 0) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(data, 0, data.length, opts);
    }

    private static void drawCover(Canvas canvas, Bitmap b, Paint paint) {
        float scale = Math.max((float) WIDTH / b.getWidth(), (float) HEIGHT / b.getHeight());
        int srcW = Math.round(WIDTH / scale);
        int srcH = Math.round(HEIGHT / scale);
        int left = Math.max(0, (b.getWidth() - srcW) / 2);
        int top = Math.max(0, (b.getHeight() - srcH) / 2);
        Rect src = new Rect(left, top, Math.min(b.getWidth(), left + srcW), Math.min(b.getHeight(), top + srcH));
        canvas.drawBitmap(b, src, new Rect(0, 0, WIDTH, HEIGHT), paint);
    }

    /** Largest rectangle with the bitmap's aspect ratio that fits in area, centred (or bottom-aligned). */
    private static Rect fit(Bitmap b, Rect area, boolean alignBottom) {
        float scale = Math.min((float) area.width() / b.getWidth(), (float) area.height() / b.getHeight());
        int w = Math.round(b.getWidth() * scale);
        int h = Math.round(b.getHeight() * scale);
        int left = area.left + (area.width() - w) / 2;
        int top = alignBottom ? area.bottom - h : area.top + (area.height() - h) / 2;
        return new Rect(left, top, left + w, top + h);
    }
}
