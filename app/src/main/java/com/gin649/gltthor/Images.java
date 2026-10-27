package com.gin649.gltthor;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class Images {

    private Images() {}

    private static int sampleSize(int w, int h, int maxW, int maxH) {
        int sample = 1;
        while (w / (sample * 2) >= maxW && h / (sample * 2) >= maxH) sample *= 2;
        return sample;
    }

    static Bitmap decodeFile(String path, int maxW, int maxH) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, o);
            o.inSampleSize = sampleSize(o.outWidth, o.outHeight, maxW, maxH);
            o.inJustDecodeBounds = false;
            return BitmapFactory.decodeFile(path, o);
        } catch (Throwable t) {
            return null;
        }
    }

    static Bitmap download(String url, int maxW, int maxH) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(12000);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 10 * 1024 * 1024) return null;
            }
            byte[] data = out.toByteArray();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            o.inSampleSize = sampleSize(o.outWidth, o.outHeight, maxW, maxH);
            o.inJustDecodeBounds = false;
            return BitmapFactory.decodeByteArray(data, 0, data.length, o);
        } catch (Throwable t) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
