package com.gin649.gltdslauncher;

import android.os.Environment;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Gets a game's ROM ready for an Android port: ports take plain files, not .zip, .chd or .rvz. The result goes to
 * Downloads/Roms for Ports. Zip files are unpacked, CHD becomes BIN/CUE (or ISO for DVD games), RVZ and the other
 * Dolphin formats become ISO, and N64 files are put in the .z64 byte order. Anything else is copied as it is.
 */
final class RomExport {

    private RomExport() {}

    static File outDir() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Roms for Ports");
    }

    private static final Set<String> JUNK = new HashSet<String>(Arrays.asList(
            "txt", "nfo", "jpg", "jpeg", "png", "gif", "xml", "url", "diz", "sfv", "md5", "sha1", "pdf", "db", "ini", "dat"));

    /**
     * Prepares the ROM and returns the file to pick inside the port. A port that reads its ROM from a fixed folder
     * (mode "shared_folder", with a path inside the phone's storage) gets it there, and a port that wants one file
     * name (filename) gets that name. Otherwise it goes to Downloads/Roms for Ports.
     */
    static File run(File rom, String mode, String path, String filename, DiscPatcher.Progress p) throws IOException {
        File out = outDir();
        if ("shared_folder".equals(mode) && path != null && !path.isEmpty() && !path.contains("..")) {
            out = new File(Environment.getExternalStorageDirectory(), path);
        }
        if (!out.isDirectory() && !out.mkdirs()) throw new DiscPatcher.PatchException("Could not create the folder " + out.getPath() + ".");
        String name = rom.getName();
        String ext = DiscPatcher.ext(name);
        String stem = DiscPatcher.safeName(name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name);
        if (stem.isEmpty()) stem = "game";

        File result = ext.equals("zip") ? fromZip(rom, out, stem, p) : convert(rom, out, stem, p);
        if (filename != null && !filename.isEmpty() && filename.equals(new File(filename).getName()) && result.isFile()
                && out.equals(result.getParentFile())) {
            File named = new File(out, filename);
            if (!named.equals(result)) {
                if (named.exists()) named.delete();
                if (result.renameTo(named)) result = named;
            }
        }
        return result;
    }

    /** Unpacks a zip into a temporary folder, then treats the main file in it like any other ROM. */
    private static File fromZip(File zip, File out, String stem, DiscPatcher.Progress p) throws IOException {
        File work = new File(out, ".work-" + System.nanoTime());
        if (!work.mkdir()) throw new DiscPatcher.PatchException("Could not create a working folder in Downloads.");
        try {
            List<File> files = new ArrayList<File>();
            ZipFile z = new ZipFile(zip);
            try {
                long total = 0;
                List<ZipEntry> entries = new ArrayList<ZipEntry>();
                Enumeration<? extends ZipEntry> en = z.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (e.isDirectory()) continue;
                    String leaf = new File(e.getName()).getName();
                    if (leaf.startsWith(".") || JUNK.contains(DiscPatcher.ext(leaf))) continue;
                    entries.add(e);
                    total += Math.max(e.getSize(), 0);
                }
                if (entries.isEmpty()) throw new DiscPatcher.PatchException("That zip file has no game in it.");
                DiscPatcher.requireSpace(out, total * 3 + (64L << 20));
                long done = 0;
                byte[] buf = new byte[1 << 20];
                for (ZipEntry e : entries) {
                    File f = new File(work, new File(e.getName()).getName()); // only the file name, never a path from the zip
                    InputStream in = z.getInputStream(e);
                    OutputStream os = new FileOutputStream(f);
                    try {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            os.write(buf, 0, n);
                            done += n;
                            p.update("Unpacking the zip", done, Math.max(total, 1));
                            if (p.cancelled()) throw new DiscPatcher.PatchException("Cancelled.");
                        }
                    } finally {
                        os.close();
                        in.close();
                    }
                    files.add(f);
                }
            } finally {
                z.close();
            }

            File main = null;
            for (File f : files) { // the sheet, or a packed disc, is the one to work from
                String e = DiscPatcher.ext(f.getName());
                if (e.equals("cue") || e.equals("chd") || DiscPatcher.isDolphinFormat(e) || e.equals("m3u")) { main = f; break; }
            }
            if (main == null) {
                for (File f : files) if (main == null || f.length() > main.length()) main = f;
            }
            String mainExt = DiscPatcher.ext(main.getName());
            if (files.size() > 1 && !mainExt.equals("chd") && !DiscPatcher.isDolphinFormat(mainExt)) {
                // several files (a disc sheet and its tracks): keep them together in a folder, names unchanged
                File dest = new File(out, stem);
                if (dest.exists()) DiscPatcher.deleteTree(dest);
                dest.mkdirs();
                for (File f : files) {
                    File t = new File(dest, f.getName());
                    if (!f.renameTo(t)) copy(f, t, p, "Saving");
                }
                return new File(dest, main.getName());
            }
            return convert(main, out, stem, p);
        } finally {
            DiscPatcher.deleteTree(work);
        }
    }

    private static File convert(File src, File out, String stem, DiscPatcher.Progress p) throws IOException {
        String ext = DiscPatcher.ext(src.getName());
        if (ext.equals("chd")) {
            File chd = DiscPatcher.chdman;
            if (chd == null) throw new DiscPatcher.PatchException("CHD files can't be unpacked on this device.");
            DiscPatcher.requireSpace(out, src.length() * 4 + (64L << 20));
            File dest = new File(out, stem);
            if (dest.exists()) DiscPatcher.deleteTree(dest);
            dest.mkdirs();
            File cue = new File(dest, stem + ".cue");
            try {
                DiscPatcher.exec(Arrays.asList(chd.getPath(), "extractcd", "-i", src.getPath(), "-o", cue.getPath(), "-ob", new File(dest, stem + ".bin").getPath()),
                        p, "Unpacking the CHD");
                return cue;
            } catch (DiscPatcher.PatchException e) {
                if ("Cancelled.".equals(e.getMessage())) throw e;
                DiscPatcher.deleteTree(dest); // not a CD: a DVD game
                dest.mkdirs();
                File iso = new File(dest, stem + ".iso");
                DiscPatcher.exec(Arrays.asList(chd.getPath(), "extractdvd", "-i", src.getPath(), "-o", iso.getPath()), p, "Unpacking the CHD");
                return iso;
            }
        }
        if (DiscPatcher.isDolphinFormat(ext)) {
            File dt = DiscPatcher.dolphinTool;
            if (dt == null) throw new DiscPatcher.PatchException("This disc format can't be unpacked on this device.");
            DiscPatcher.requireSpace(out, src.length() * 4 + (64L << 20));
            File iso = new File(out, stem + ".iso");
            if (iso.exists()) iso.delete();
            DiscPatcher.exec(Arrays.asList(dt.getPath(), "convert", "-i", src.getPath(), "-o", iso.getPath(), "-f", "iso"), p, "Unpacking the disc");
            return iso;
        }
        if (ext.equals("z64") || ext.equals("v64") || ext.equals("n64")) {
            DiscPatcher.requireSpace(out, src.length() + (16L << 20));
            File z64 = new File(out, stem + ".z64");
            n64ToZ64(src, z64, p);
            return z64;
        }
        if (ext.equals("cue")) {
            File dest = new File(out, stem);
            if (dest.exists()) DiscPatcher.deleteTree(dest);
            dest.mkdirs();
            File sheet = new File(dest, src.getName());
            DiscPatcher.Cue c = DiscPatcher.Cue.parse(src);
            long need = 0;
            List<File> tracks = new ArrayList<File>();
            for (String line : c.lines) {
                String t = line.trim();
                if (t.regionMatches(true, 0, "FILE", 0, 4) && t.length() > 5 && Character.isWhitespace(t.charAt(4))) {
                    File f = new File(DiscPatcher.Cue.nameOf(t));
                    f = f.isAbsolute() ? f : new File(src.getParentFile(), f.getPath());
                    if (f.isFile()) {
                        tracks.add(f);
                        need += f.length();
                    }
                }
            }
            DiscPatcher.requireSpace(out, need + (16L << 20));
            copy(src, sheet, p, "Saving");
            for (File f : tracks) copy(f, new File(dest, f.getName()), p, "Saving");
            return sheet;
        }
        DiscPatcher.requireSpace(out, src.length() + (16L << 20));
        File dest = new File(out, stem + (ext.isEmpty() ? "" : "." + ext));
        copy(src, dest, p, "Saving");
        return dest;
    }

    /** N64 files in any byte order become big-endian (.z64), which is what ports expect. */
    private static void n64ToZ64(File src, File dest, DiscPatcher.Progress p) throws IOException {
        long total = src.length();
        byte[] buf = new byte[1 << 20];
        long done = 0;
        InputStream in = new FileInputStream(src);
        OutputStream os = new FileOutputStream(dest);
        try {
            int mode = -1; // 0 big-endian, 1 v64 (pairs swapped), 2 n64 (words reversed)
            int n;
            while ((n = readFull(in, buf)) > 0) {
                if (mode < 0) {
                    int b0 = buf[0] & 0xff;
                    mode = b0 == 0x37 ? 1 : (b0 == 0x40 ? 2 : 0);
                }
                int len = n - (n % 4);
                if (mode == 1) {
                    for (int i = 0; i + 1 < len; i += 2) { byte t = buf[i]; buf[i] = buf[i + 1]; buf[i + 1] = t; }
                } else if (mode == 2) {
                    for (int i = 0; i + 3 < len; i += 4) {
                        byte t = buf[i]; buf[i] = buf[i + 3]; buf[i + 3] = t;
                        t = buf[i + 1]; buf[i + 1] = buf[i + 2]; buf[i + 2] = t;
                    }
                }
                os.write(buf, 0, n);
                done += n;
                p.update("Saving", done, Math.max(total, 1));
                if (p.cancelled()) throw new DiscPatcher.PatchException("Cancelled.");
            }
        } finally {
            os.close();
            in.close();
        }
    }

    private static int readFull(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int r = in.read(buf, off, buf.length - off);
            if (r < 0) break;
            off += r;
        }
        return off;
    }

    private static void copy(File src, File dest, DiscPatcher.Progress p, String phase) throws IOException {
        long total = src.length(), done = 0;
        byte[] buf = new byte[1 << 20];
        InputStream in = new FileInputStream(src);
        OutputStream os = new FileOutputStream(dest);
        try {
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                done += n;
                p.update(phase, done, Math.max(total, 1));
                if (p.cancelled()) throw new DiscPatcher.PatchException("Cancelled.");
            }
        } finally {
            os.close();
            in.close();
        }
    }
}
