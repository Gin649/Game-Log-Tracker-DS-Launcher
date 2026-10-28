package com.gin649.gltdslauncher;

import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.zip.CRC32;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/**
 * Patches big disc images (CD and DVD games) without loading them into memory: the image is read and written in
 * pieces straight from storage. No Android classes are used, so it can be tested on a desktop JDK.
 *
 * Patch formats: IPS and IPS32, PPF 1/2/3, BPS, UPS and xdelta (VCDIFF, without LZMA/DJW packing).
 * Disc images: .iso, .bin with a .cue (the .cue is rewritten for the new .bin), .img, and .cso/.ciso (unpacked to .iso).
 */
final class DiscPatcher {

    private DiscPatcher() {
    }

    interface Progress {
        void update(String phase, long done, long total);

        boolean cancelled();
    }

    /** A problem to show the person as it is written. */
    static final class PatchException extends IOException {
        PatchException(String m) {
            super(m);
        }
    }

    static final class Result {
        final File file;
        final File cue; // null unless the source was a .cue
        final List<String> notes = new ArrayList<String>();

        Result(File file, File cue) {
            this.file = file;
            this.cue = cue;
        }

        /** What to launch: the .cue when there is one. */
        File playable() {
            return cue != null ? cue : file;
        }
    }

    private static final Progress SILENT = new Progress() {
        public void update(String phase, long done, long total) {
        }

        public boolean cancelled() {
            return false;
        }
    };

    // ---------------------------------------------------------------- entry point

    /**
     * Patches the disc image `base` (an .iso, .bin, .cue, .cso ...) with `patchBytes`.
     * `outStem` is the name for the new files, without an extension.
     */
    static Result run(File base, byte[] patchBytes, String outStem, Progress progress) throws IOException {
        if (progress == null) progress = SILENT;
        String name = base.getName();
        String ext = ext(name);
        File dir = base.getParentFile();
        String stem = safeName(outStem);
        if (stem.isEmpty()) stem = "patched";

        if (ext.equals("chd") || ext.equals("rvz") || ext.equals("wia") || ext.equals("gcz") || ext.equals("wbfs")
                || ext.equals("zso") || ext.equals("pbp") || ext.equals("ecm") || ext.equals("gdi")
                || ext.equals("m3u") || ext.equals("7z") || ext.equals("zip") || ext.equals("rar")) {
            throw new PatchException(unsupportedImageMessage(ext));
        }

        if (ext.equals("cue")) {
            Cue cue = Cue.parse(base);
            File bin = cue.firstFile(dir);
            if (bin == null || !bin.isFile()) {
                throw new PatchException("The .cue sheet points at a file that isn't there"
                        + (cue.firstName == null ? "." : " (" + cue.firstName + ")."));
            }
            File outBin = freeFile(dir, stem, ".bin");
            Result r;
            try {
                r = new Result(outBin, null);
                patchFile(bin, patchBytes, outBin, progress, r.notes);
            } catch (IOException | RuntimeException e) {
                outBin.delete();
                throw e;
            }
            File outCue = freeFile(dir, outBin.getName().replaceAll("\\.bin$", ""), ".cue");
            try {
                Files.write(outCue.toPath(), cue.rewrite(outBin.getName()).getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) {
                outBin.delete();
                throw e;
            }
            Result withCue = new Result(outBin, outCue);
            withCue.notes.addAll(r.notes);
            if (cue.fileCount > 1) {
                withCue.notes.add("This disc has " + cue.fileCount + " files. Only the first (the data track) was patched; the others are used as they are.");
            }
            return withCue;
        }

        if (ext.equals("cso") || ext.equals("ciso")) {
            File tmpIso = freeFile(dir, ".glt-unpacked-" + System.nanoTime(), ".tmp");
            File out = freeFile(dir, stem, ".iso");
            try {
                csoToIso(base, tmpIso, progress);
                Result r = new Result(out, null);
                r.notes.add("Unpacked the compressed image first, so the patched game is saved as an .iso (uncompressed).");
                patchFile(tmpIso, patchBytes, out, progress, r.notes);
                return r;
            } catch (IOException | RuntimeException e) {
                out.delete();
                throw e;
            } finally {
                tmpIso.delete();
            }
        }

        // .iso, .bin, .img and anything else that is a plain image
        String outExt = ext.isEmpty() ? ".iso" : "." + ext;
        File out = freeFile(dir, stem, outExt);
        Result r = new Result(out, null);
        try {
            patchFile(base, patchBytes, out, progress, r.notes);
        } catch (IOException | RuntimeException e) {
            out.delete();
            throw e;
        }
        return r;
    }

    /** Null when this image can be patched, otherwise why not (in words for the person). */
    static String unsupportedReason(File base) {
        String ext = ext(base.getName());
        switch (ext) {
            case "chd": case "rvz": case "wia": case "gcz": case "wbfs": case "zso": case "pbp": case "ecm":
            case "gdi": case "m3u": case "7z": case "zip": case "rar":
                return unsupportedImageMessage(ext);
            default:
                return null;
        }
    }

    static String unsupportedImageMessage(String ext) {
        switch (ext) {
            case "chd":
                return "This game is a CHD file. CHD can't be patched in place. Convert it to BIN/CUE or ISO first with chdman (extractcd), "
                        + "then patch it here. You can compress the result back to CHD afterwards.";
            case "rvz":
            case "wia":
            case "gcz":
            case "wbfs":
                return "This game is a ." + ext + " file, which can't be patched in place. Convert it to a plain ISO first "
                        + "(Dolphin: right-click the game, Convert File Format, choose ISO), then patch it here.";
            case "zso":
            case "pbp":
            case "ecm":
                return "." + ext + " images aren't supported for patching. Convert the game to a plain ISO or BIN/CUE first.";
            case "gdi":
                return "Dreamcast GDI games aren't supported for patching yet.";
            case "m3u":
                return "That's a multi-disc playlist. Open the game's own disc (the .cue or .iso) instead.";
            default:
                return "This game is packed in a ." + ext + " archive. Extract it first, then patch the disc image inside.";
        }
    }

    // ---------------------------------------------------------------- one image

    /** Applies the patch to a single image file, writing `out`. */
    static void patchFile(File src, byte[] patch, File out, Progress p, List<String> notes) throws IOException {
        String kind = detect(patch);
        if (kind == null) {
            throw new PatchException("That isn't a patch format that can be applied here (it needs to be IPS, PPF, BPS, UPS or xdelta).");
        }
        try {
            switch (kind) {
                case "ips":
                    applyIps(src, patch, out, p, notes);
                    break;
                case "ppf":
                    applyPpf(src, patch, out, p, notes);
                    break;
                case "bps":
                    applyBps(src, patch, out, p, notes);
                    break;
                case "ups":
                    applyUps(src, patch, out, p, notes);
                    break;
                default:
                    applyVcdiff(src, patch, out, p, notes);
                    break;
            }
        } catch (java.io.EOFException e) {
            throw new PatchException("This patch is for a different disc image than yours (it reads past the end of it).");
        }
    }

    static String detect(byte[] p) {
        if (p.length >= 5 && p[0] == 'P' && p[1] == 'A' && p[2] == 'T' && p[3] == 'C' && p[4] == 'H') return "ips";
        if (p.length >= 5 && p[0] == 'I' && p[1] == 'P' && p[2] == 'S' && p[3] == '3' && p[4] == '2') return "ips";
        if (p.length >= 5 && p[0] == 'P' && p[1] == 'P' && p[2] == 'F') return "ppf";
        if (p.length >= 4 && p[0] == 'B' && p[1] == 'P' && p[2] == 'S' && p[3] == '1') return "bps";
        if (p.length >= 4 && p[0] == 'U' && p[1] == 'P' && p[2] == 'S' && p[3] == '1') return "ups";
        if (p.length >= 4 && (p[0] & 0xFF) == 0xD6 && (p[1] & 0xFF) == 0xC3 && (p[2] & 0xFF) == 0xC4) return "vcdiff";
        return null;
    }

    // ---------------------------------------------------------------- helpers

    static String ext(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    static String safeName(String s) {
        if (s == null) return "";
        return s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
    }

    /** dir/stem+ext, or "stem (2)ext" and so on if that name is taken. */
    static File freeFile(File dir, String stem, String ext) {
        File f = new File(dir, stem + ext);
        int n = 1;
        while (f.exists()) f = new File(dir, stem + " (" + (n++) + ")" + ext);
        return f;
    }

    private static void check(Progress p) throws IOException {
        if (p.cancelled()) throw new PatchException("Cancelled.");
    }

    /** Copies src to out, and returns the CRC32 of what was copied. */
    private static long copyFile(File src, File out, Progress p, String phase) throws IOException {
        long total = src.length();
        CRC32 crc = new CRC32();
        byte[] buf = new byte[1 << 20];
        long done = 0;
        try (InputStream in = new FileInputStream(src);
             java.io.OutputStream os = new java.io.FileOutputStream(out)) {
            int n;
            while ((n = in.read(buf)) > 0) {
                crc.update(buf, 0, n);
                os.write(buf, 0, n);
                done += n;
                p.update(phase, done, total);
                check(p);
            }
        }
        return crc.getValue();
    }

    static long crcOfFile(File f, Progress p, String phase) throws IOException {
        CRC32 crc = new CRC32();
        byte[] buf = new byte[1 << 20];
        long total = f.length(), done = 0;
        try (InputStream in = new FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) {
                crc.update(buf, 0, n);
                done += n;
                p.update(phase, done, total);
                check(p);
            }
        }
        return crc.getValue();
    }

    private static long u32le(byte[] b, int o) {
        return (b[o] & 0xFFL) | ((b[o + 1] & 0xFFL) << 8) | ((b[o + 2] & 0xFFL) << 16) | ((b[o + 3] & 0xFFL) << 24);
    }

    private static long crcOf(byte[] b, int off, int len) {
        CRC32 c = new CRC32();
        c.update(b, off, len);
        return c.getValue();
    }

    private static PatchException wrongDisc() {
        return new PatchException("This patch was made for a different copy of the game than yours. Usually that's another region, "
                + "or a disc image laid out differently (one .bin per track instead of one big .bin).");
    }

    private static PatchException damaged() {
        return new PatchException("This patch file is damaged. Try downloading it again.");
    }

    /** Reads bytes of the patch file at a moving position. */
    private static final class Cur {
        final byte[] b;
        int pos;

        Cur(byte[] b, int pos) {
            this.b = b;
            this.pos = pos;
        }

        int u8() throws PatchException {
            if (pos >= b.length) throw damaged();
            return b[pos++] & 0xFF;
        }

        /** The variable-length number BPS and UPS use. */
        long vlq() throws PatchException {
            long num = 0, shift = 1;
            while (true) {
                int x = u8();
                num += (x & 0x7F) * shift;
                if ((x & 0x80) != 0) break;
                shift <<= 7;
                num += shift;
                if (shift < 0 || num < 0) throw damaged();
            }
            return num;
        }

        /** VCDIFF's big-endian base-128 integer. */
        long v7() throws PatchException {
            long v = 0;
            for (int i = 0; i < 10; i++) {
                int x = u8();
                v = (v << 7) | (x & 0x7F);
                if ((x & 0x80) == 0) return v;
            }
            throw damaged();
        }
    }

    /** Random-access reader of the source image with a one-block cache (reads are mostly in order). */
    private static final class Src implements Closeable {
        final RandomAccessFile f;
        final long len;
        final byte[] blk = new byte[1 << 20];
        long blkStart = -1;
        int blkLen;

        Src(File file) throws IOException {
            f = new RandomAccessFile(file, "r");
            len = f.length();
        }

        void read(long pos, byte[] dst, int off, int n) throws IOException {
            if (pos < 0 || pos + n > len) throw new java.io.EOFException();
            while (n > 0) {
                if (blkStart < 0 || pos < blkStart || pos >= blkStart + blkLen) {
                    blkStart = pos & ~((long) blk.length - 1);
                    blkLen = (int) Math.min(blk.length, len - blkStart);
                    f.seek(blkStart);
                    f.readFully(blk, 0, blkLen);
                }
                int k = (int) Math.min(n, blkStart + blkLen - pos);
                System.arraycopy(blk, (int) (pos - blkStart), dst, off, k);
                pos += k;
                off += k;
                n -= k;
            }
        }

        public void close() throws IOException {
            f.close();
        }
    }

    /** Sequential output with a running CRC32. Bytes already written can be read back (BPS and xdelta need that). */
    private static final class Out implements Closeable {
        final RandomAccessFile f;
        final byte[] buf = new byte[1 << 20];
        int n;
        long flushed;
        final CRC32 crc = new CRC32();

        Out(File file) throws IOException {
            f = new RandomAccessFile(file, "rw");
            f.setLength(0);
        }

        long length() {
            return flushed + n;
        }

        void write(byte[] b, int off, int len) throws IOException {
            crc.update(b, off, len);
            while (len > 0) {
                int k = Math.min(len, buf.length - n);
                System.arraycopy(b, off, buf, n, k);
                n += k;
                off += k;
                len -= k;
                if (n == buf.length) flush();
            }
        }

        void flush() throws IOException {
            if (n > 0) {
                f.seek(flushed);
                f.write(buf, 0, n);
                flushed += n;
                n = 0;
            }
        }

        void readAt(long pos, byte[] dst, int off, int len) throws IOException {
            if (pos < 0 || pos + len > length()) throw damaged();
            if (pos + len > flushed) flush();
            f.seek(pos);
            f.readFully(dst, off, len);
        }

        /** Copies `len` bytes that start at `from` in the output to its end. They may overlap what is being written. */
        void copyWithin(long from, long len) throws IOException {
            byte[] tmp = new byte[1 << 16];
            if (from < 0 || from >= length()) throw damaged();
            long avail = length() - from;
            if (avail <= tmp.length / 2 && len > avail) {
                byte[] pat = new byte[(int) avail];
                readAt(from, pat, 0, (int) avail);
                int s = (tmp.length / pat.length) * pat.length;
                for (int i = 0; i < s; i++) tmp[i] = pat[i % pat.length];
                while (len > 0) {
                    int k = (int) Math.min(len, s);
                    write(tmp, 0, k);
                    len -= k;
                }
                return;
            }
            while (len > 0) {
                avail = length() - from;
                int k = (int) Math.min(Math.min(len, avail), tmp.length);
                readAt(from, tmp, 0, k);
                write(tmp, 0, k);
                from += k;
                len -= k;
            }
        }

        void finish() throws IOException {
            flush();
        }

        public void close() throws IOException {
            f.close();
        }
    }

    // ---------------------------------------------------------------- IPS / IPS32

    private static void applyIps(File src, byte[] p, File out, Progress pr, List<String> notes) throws IOException {
        boolean ips32 = p[0] == 'I';
        int off = 5;
        int offBytes = ips32 ? 4 : 3;
        copyFile(src, out, pr, "Copying the disc image");
        try (RandomAccessFile f = new RandomAccessFile(out, "rw")) {
            boolean eof = false;
            long truncate = -1;
            while (off < p.length) {
                if (!ips32 && off + 3 <= p.length && p[off] == 'E' && p[off + 1] == 'O' && p[off + 2] == 'F') {
                    eof = true;
                    if (off + 6 == p.length) truncate = ((p[off + 3] & 0xFFL) << 16) | ((p[off + 4] & 0xFFL) << 8) | (p[off + 5] & 0xFFL);
                    break;
                }
                if (ips32 && off + 4 <= p.length && p[off] == 'E' && p[off + 1] == 'E' && p[off + 2] == 'O' && p[off + 3] == 'F') {
                    eof = true;
                    if (off + 8 == p.length) truncate = u32be(p, off + 4);
                    break;
                }
                if (off + offBytes + 2 > p.length) throw damaged();
                long at = ips32 ? u32be(p, off) : ((p[off] & 0xFFL) << 16) | ((p[off + 1] & 0xFFL) << 8) | (p[off + 2] & 0xFFL);
                off += offBytes;
                int size = ((p[off] & 0xFF) << 8) | (p[off + 1] & 0xFF);
                off += 2;
                if (size == 0) {
                    if (off + 3 > p.length) throw damaged();
                    int run = ((p[off] & 0xFF) << 8) | (p[off + 1] & 0xFF);
                    byte v = p[off + 2];
                    off += 3;
                    byte[] r = new byte[run];
                    java.util.Arrays.fill(r, v);
                    f.seek(at);
                    f.write(r);
                } else {
                    if (off + size > p.length) throw damaged();
                    f.seek(at);
                    f.write(p, off, size);
                    off += size;
                }
                check(pr);
            }
            if (!eof) throw damaged();
            if (truncate >= 0 && truncate < f.length()) f.setLength(truncate);
        }
        notes.add("IPS patches have no checksum, so there's no way to confirm this is the exact disc the patch was made for.");
    }

    private static long u32be(byte[] b, int o) {
        return ((b[o] & 0xFFL) << 24) | ((b[o + 1] & 0xFFL) << 16) | ((b[o + 2] & 0xFFL) << 8) | (b[o + 3] & 0xFFL);
    }

    // ---------------------------------------------------------------- PPF 1 / 2 / 3

    private static void applyPpf(File src, byte[] p, File out, Progress pr, List<String> notes) throws IOException {
        if (p.length < 56) throw damaged();
        int version;
        if (p[3] == '1') version = 1;
        else if (p[3] == '2') version = 2;
        else if (p[3] == '3') version = 3;
        else throw new PatchException("This PPF patch is a version that isn't supported.");
        int pos;
        boolean blockCheck = false;
        long blockOffset = 0x9320;
        boolean undo = false;
        if (version == 1) {
            pos = 56;
        } else if (version == 2) {
            if (p.length < 56 + 4 + 1024) throw damaged();
            long expectLen = u32le(p, 56);
            if (src.length() != expectLen) throw wrongDisc();
            blockCheck = true;
            pos = 56 + 4;
        } else {
            if (p.length < 60) throw damaged();
            int imageType = p[56] & 0xFF;
            blockCheck = (p[57] & 0xFF) != 0;
            undo = (p[58] & 0xFF) != 0;
            if (imageType == 1) blockOffset = 0x80A0;
            pos = 60;
        }
        if (blockCheck) {
            if (pos + 1024 > p.length) throw damaged();
            byte[] want = new byte[1024];
            System.arraycopy(p, pos, want, 0, 1024);
            pos += 1024;
            byte[] have = new byte[1024];
            try (Src s = new Src(src)) {
                s.read(blockOffset, have, 0, 1024);
            } catch (java.io.EOFException e) {
                throw wrongDisc();
            }
            if (!java.util.Arrays.equals(want, have)) throw wrongDisc();
            notes.add("The disc image matches what this patch was made for.");
        } else {
            notes.add("This PPF patch has no check built in, so there's no way to confirm this is the exact disc it was made for.");
        }

        // PPF2 and PPF3 can end with a description file (FILE_ID.DIZ)
        int end = p.length;
        if (version >= 2) {
            byte[] tag = "@BEGIN_FILE_ID.DIZ".getBytes(StandardCharsets.US_ASCII);
            for (int i = p.length - tag.length; i >= Math.max(pos, p.length - 3200); i--) {
                boolean ok = true;
                for (int k = 0; k < tag.length; k++) {
                    if (p[i + k] != tag[k]) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    end = i;
                    break;
                }
            }
        }

        copyFile(src, out, pr, "Copying the disc image");
        try (RandomAccessFile f = new RandomAccessFile(out, "rw")) {
            while (pos < end) {
                long at;
                if (version == 3) {
                    if (pos + 9 > end) throw damaged();
                    at = u32le(p, pos) | (u32le(p, pos + 4) << 32);
                    pos += 8;
                } else {
                    if (pos + 5 > end) throw damaged();
                    at = u32le(p, pos);
                    pos += 4;
                }
                int len = p[pos++] & 0xFF;
                if (pos + len > end) throw damaged();
                f.seek(at);
                f.write(p, pos, len);
                pos += len;
                if (undo) pos += len;
                check(pr);
            }
        }
    }

    // ---------------------------------------------------------------- BPS

    private static void applyBps(File src, byte[] p, File outFile, Progress pr, List<String> notes) throws IOException {
        if (p.length < 19) throw damaged();
        int footer = p.length - 12;
        long wantSrc = u32le(p, footer), wantOut = u32le(p, footer + 4), wantPatch = u32le(p, footer + 8);
        if (crcOf(p, 0, footer + 8) != wantPatch) throw damaged();

        Cur c = new Cur(p, 4);
        long srcSize = c.vlq();
        long outSize = c.vlq();
        long meta = c.vlq();
        c.pos += (int) meta;

        long haveSrc = crcOfFile(src, pr, "Checking the disc image");
        if (haveSrc != wantSrc) {
            if (haveSrc == wantOut) throw new PatchException("This disc image already has this patch applied.");
            throw wrongDisc();
        }

        try (Src s = new Src(src); Out out = new Out(outFile)) {
            byte[] tmp = new byte[1 << 16];
            long srcRel = 0, tgtRel = 0;
            while (c.pos < footer) {
                long data = c.vlq();
                int action = (int) (data & 3);
                long len = (data >>> 2) + 1;
                if (out.length() + len > outSize) throw damaged();
                if (action == 0) { // read from the same place in the source
                    long at = out.length();
                    long left = len;
                    while (left > 0) {
                        int k = (int) Math.min(left, tmp.length);
                        s.read(at, tmp, 0, k);
                        out.write(tmp, 0, k);
                        at += k;
                        left -= k;
                    }
                } else if (action == 1) { // bytes stored in the patch
                    if (c.pos + len > footer) throw damaged();
                    out.write(p, c.pos, (int) len);
                    c.pos += (int) len;
                } else if (action == 2) { // copy from somewhere in the source
                    long rel = c.vlq();
                    srcRel += (rel & 1) != 0 ? -(rel >>> 1) : (rel >>> 1);
                    long at = srcRel;
                    long left = len;
                    while (left > 0) {
                        int k = (int) Math.min(left, tmp.length);
                        s.read(at, tmp, 0, k);
                        out.write(tmp, 0, k);
                        at += k;
                        left -= k;
                    }
                    srcRel += len;
                } else { // copy from what's already written
                    long rel = c.vlq();
                    tgtRel += (rel & 1) != 0 ? -(rel >>> 1) : (rel >>> 1);
                    out.copyWithin(tgtRel, len);
                    tgtRel += len;
                }
                pr.update("Patching", out.length(), outSize);
                check(pr);
            }
            out.finish();
            if (out.length() != outSize) throw damaged();
            if (out.crc.getValue() != wantOut) {
                throw new PatchException("The patched image failed its checksum, so it was thrown away. The patch and your disc image don't go together.");
            }
        }
        notes.add("Checksums verified: the patch matches your disc image, and the result is exactly what the patch's author made.");
    }

    // ---------------------------------------------------------------- UPS

    private static void applyUps(File src, byte[] p, File outFile, Progress pr, List<String> notes) throws IOException {
        if (p.length < 18) throw damaged();
        int footer = p.length - 12;
        long wantIn = u32le(p, footer), wantOut = u32le(p, footer + 4), wantPatch = u32le(p, footer + 8);
        if (crcOf(p, 0, footer + 8) != wantPatch) throw damaged();
        Cur c = new Cur(p, 4);
        long inSize = c.vlq();
        long outSize = c.vlq();

        long haveSrc = copyFile(src, outFile, pr, "Copying the disc image");
        if (haveSrc != wantIn) {
            if (haveSrc == wantOut) throw new PatchException("This disc image already has this patch applied.");
            throw wrongDisc();
        }
        try (RandomAccessFile f = new RandomAccessFile(outFile, "rw")) {
            f.setLength(outSize); // grows with zeros, or cuts
            long at = 0;
            byte[] tmp = new byte[1 << 16];
            while (c.pos < footer) {
                at += c.vlq();
                int end = c.pos;
                while (end < footer && p[end] != 0) end++;
                if (end >= footer) throw damaged();
                long len = end - c.pos;
                if (at + len > outSize) throw damaged();
                while (len > 0) {
                    int k = (int) Math.min(len, tmp.length);
                    f.seek(at);
                    f.readFully(tmp, 0, k);
                    for (int i = 0; i < k; i++) tmp[i] ^= p[c.pos + i];
                    f.seek(at);
                    f.write(tmp, 0, k);
                    at += k;
                    c.pos += k;
                    len -= k;
                }
                c.pos = end + 1; // past the zero that ends the block
                at += 1;         // and that zero stands for one unchanged byte
                check(pr);
            }
        }
        long haveOut = crcOfFile(outFile, pr, "Checking the result");
        if (haveOut != wantOut) {
            throw new PatchException("The patched image failed its checksum, so it was thrown away. The patch and your disc image don't go together.");
        }
        notes.add("Checksums verified: the patch matches your disc image, and the result is exactly what the patch's author made.");
    }

    // ---------------------------------------------------------------- xdelta / VCDIFF

    private static final int T_NOOP = 0, T_ADD = 1, T_RUN = 2, T_COPY = 3;
    private static final int[][] CODE = new int[256][6]; // type1, size1, mode1, type2, size2, mode2

    static {
        int i = 0;
        set(i++, T_RUN, 0, 0, T_NOOP, 0, 0);
        for (int size = 0; size < 18; size++) set(i++, T_ADD, size, 0, T_NOOP, 0, 0);
        for (int mode = 0; mode < 9; mode++) {
            set(i++, T_COPY, 0, mode, T_NOOP, 0, 0);
            for (int size = 4; size < 19; size++) set(i++, T_COPY, size, mode, T_NOOP, 0, 0);
        }
        for (int mode = 0; mode < 6; mode++)
            for (int add = 1; add < 5; add++)
                for (int copy = 4; copy < 7; copy++) set(i++, T_ADD, add, 0, T_COPY, copy, mode);
        for (int mode = 6; mode < 9; mode++)
            for (int add = 1; add < 5; add++) set(i++, T_ADD, add, 0, T_COPY, 4, mode);
        for (int mode = 0; mode < 9; mode++) set(i++, T_COPY, 4, mode, T_ADD, 1, 0);
    }

    private static void set(int i, int t1, int s1, int m1, int t2, int s2, int m2) {
        CODE[i][0] = t1;
        CODE[i][1] = s1;
        CODE[i][2] = m1;
        CODE[i][3] = t2;
        CODE[i][4] = s2;
        CODE[i][5] = m2;
    }

    private static final class AddrCache {
        final long[] near = new long[4];
        final long[] same = new long[3 * 256];
        int nextNear;
        Cur addr;

        void reset(Cur a) {
            java.util.Arrays.fill(near, 0);
            java.util.Arrays.fill(same, 0);
            nextNear = 0;
            addr = a;
        }

        long decode(long here, int mode) throws PatchException {
            long a;
            if (mode == 0) a = addr.v7();
            else if (mode == 1) a = here - addr.v7();
            else if (mode - 2 < 4) a = near[mode - 2] + addr.v7();
            else a = same[(mode - 6) * 256 + addr.u8()];
            if (a < 0) throw damaged();
            near[nextNear] = a;
            nextNear = (nextNear + 1) % 4;
            same[(int) (a % (3 * 256))] = a;
            return a;
        }
    }

    private static long adler32(byte[] d, int off, int len) {
        long a = 1, b = 0;
        int i = 0;
        while (i < len) {
            int n = Math.min(5552, len - i);
            for (int k = 0; k < n; k++) {
                a += d[off + i + k] & 0xFF;
                b += a;
            }
            a %= 65521;
            b %= 65521;
            i += n;
        }
        return (b << 16) | a;
    }

    private static void applyVcdiff(File srcFile, byte[] p, File outFile, Progress pr, List<String> notes) throws IOException {
        Cur h = new Cur(p, 4);
        int hi = h.u8();
        if ((hi & 0x01) != 0) {
            throw new PatchException("This xdelta patch is packed with extra compression (LZMA or similar), which can't be unpacked here. "
                    + "Ask for it to be made again with the xdelta option \"secondary compression: none\", or use a BPS or PPF version of the patch.");
        }
        if ((hi & 0x02) != 0) throw new PatchException("This xdelta patch uses a custom code table, which isn't supported.");
        if ((hi & 0x04) != 0) h.pos += (int) h.v7();
        boolean checked = false;
        AddrCache cache = new AddrCache();

        try (Src s = new Src(srcFile); Out out = new Out(outFile)) {
            Cur w = new Cur(p, h.pos);
            while (w.pos < p.length) {
                int win = w.u8();
                long srcLen = 0, srcPos = 0;
                if ((win & 0x03) != 0) {
                    srcLen = w.v7();
                    srcPos = w.v7();
                }
                long deltaLen = w.v7();
                int deltaStart = w.pos;
                long tgtLen = w.v7();
                if (w.u8() != 0) throw new PatchException("This xdelta patch uses window compression, which isn't supported.");
                long addRunLen = w.v7(), instLen = w.v7(), addrLen = w.v7();
                long adler = -1;
                if ((win & 0x04) != 0) adler = u32be(p, w.pos);
                if ((win & 0x04) != 0) w.pos += 4;
                if (tgtLen > 0x7FFFFFF0L) throw damaged();
                if (w.pos + addRunLen + instLen + addrLen > p.length) throw damaged();

                Cur addRun = new Cur(p, w.pos);
                Cur inst = new Cur(p, (int) (w.pos + addRunLen));
                int addrStart = (int) (w.pos + addRunLen + instLen);
                Cur addr = new Cur(p, addrStart);
                cache.reset(addr);
                byte[] tgt = new byte[(int) tgtLen];
                int tpos = 0;
                boolean fromSrc = (win & 0x01) != 0, fromTgt = (win & 0x02) != 0;
                long windowStart = out.length();

                while (inst.pos < addrStart) {
                    int idx = inst.u8();
                    for (int part = 0; part < 2; part++) {
                        int type = CODE[idx][part * 3], size = CODE[idx][part * 3 + 1], mode = CODE[idx][part * 3 + 2];
                        if (type == T_NOOP) continue;
                        if (size == 0) size = (int) inst.v7();
                        if (tpos + size > tgt.length) throw damaged();
                        if (type == T_ADD) {
                            if (addRun.pos + size > p.length) throw damaged();
                            System.arraycopy(p, addRun.pos, tgt, tpos, size);
                            addRun.pos += size;
                            tpos += size;
                        } else if (type == T_RUN) {
                            byte b = (byte) addRun.u8();
                            java.util.Arrays.fill(tgt, tpos, tpos + size, b);
                            tpos += size;
                        } else {
                            long a = cache.decode(tpos + srcLen, mode);
                            if (a < srcLen) {
                                if (fromSrc) {
                                    s.read(srcPos + a, tgt, tpos, size);
                                } else if (fromTgt) {
                                    out.readAt(srcPos + a, tgt, tpos, size);
                                } else {
                                    throw damaged();
                                }
                            } else {
                                int from = (int) (a - srcLen);
                                if (from >= tpos) throw damaged();
                                for (int k = 0; k < size; k++) tgt[tpos + k] = tgt[from + k]; // may overlap, so byte by byte
                            }
                            tpos += size;
                        }
                    }
                }
                if (tpos != tgt.length) throw damaged();
                if (adler >= 0) {
                    if (adler32(tgt, 0, tgt.length) != adler) throw wrongDisc();
                    checked = true;
                }
                out.write(tgt, 0, tgt.length);
                w.pos = (int) (deltaStart + deltaLen);
                pr.update("Patching", out.length(), Math.max(out.length(), srcFile.length()));
                check(pr);
            }
            out.finish();
        }
        if (checked) notes.add("Checksums verified: the patch matches your disc image.");
        else notes.add("This xdelta patch has no checksums, so there's no way to confirm this is the exact disc it was made for.");
    }

    // ---------------------------------------------------------------- CSO / CISO

    /** Unpacks a PSP/PS2 style .cso (version 0 or 1, deflate) to a plain ISO. */
    static void csoToIso(File in, File out, Progress pr) throws IOException {
        try (RandomAccessFile f = new RandomAccessFile(in, "r")) {
            byte[] h = new byte[24];
            f.readFully(h);
            if (h[0] != 'C' || h[1] != 'I' || h[2] != 'S' || h[3] != 'O') {
                throw new PatchException("That isn't a CSO file.");
            }
            long headerSize = u32le(h, 4);
            if (headerSize != 24 && headerSize != 0) {
                throw new PatchException("This compressed image is in a format that isn't supported (a Wii/GameCube CISO). Convert it to a plain ISO first.");
            }
            long total = (u32le(h, 8)) | (u32le(h, 12) << 32);
            long block = u32le(h, 16);
            int ver = h[20] & 0xFF;
            int align = h[21] & 0xFF;
            if (ver > 1) throw new PatchException("This is a newer CSO version that isn't supported. Convert it to a plain ISO first.");
            if (block < 512 || block > (1 << 24) || total <= 0) throw damaged();
            long blocks = (total + block - 1) / block;
            if (blocks > 20_000_000L) throw damaged();
            byte[] idxRaw = new byte[(int) ((blocks + 1) * 4)];
            f.seek(24);
            f.readFully(idxRaw);
            long[] idx = new long[(int) blocks + 1];
            for (int i = 0; i < idx.length; i++) idx[i] = u32le(idxRaw, i * 4);
            idxRaw = null;

            Inflater inf = new Inflater(true);
            byte[] plain = new byte[(int) block];
            byte[] comp = new byte[(int) block * 2 + 64];
            try (java.io.OutputStream os = new java.io.BufferedOutputStream(new java.io.FileOutputStream(out), 1 << 20)) {
                for (int i = 0; i < blocks; i++) {
                    boolean raw = (idx[i] & 0x80000000L) != 0;
                    long start = (idx[i] & 0x7FFFFFFFL) << align;
                    long end = (idx[i + 1] & 0x7FFFFFFFL) << align;
                    int size = (int) (end - start);
                    if (size < 0 || size > comp.length) throw damaged();
                    f.seek(start);
                    f.readFully(comp, 0, size);
                    int want = (int) Math.min(block, total - (long) i * block);
                    if (raw) {
                        os.write(comp, 0, want);
                    } else {
                        inf.reset();
                        inf.setInput(comp, 0, size);
                        int got = 0;
                        try {
                            while (got < want && !inf.finished()) {
                                int n = inf.inflate(plain, got, want - got);
                                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break;
                                got += n;
                            }
                        } catch (DataFormatException e) {
                            throw damaged();
                        }
                        if (got < want) java.util.Arrays.fill(plain, got, want, (byte) 0);
                        os.write(plain, 0, want);
                    }
                    if ((i & 255) == 0) {
                        pr.update("Unpacking the compressed image", i, blocks);
                        check(pr);
                    }
                }
            } finally {
                inf.end();
            }
        }
    }

    // ---------------------------------------------------------------- .cue

    static final class Cue {
        final List<String> lines = new ArrayList<String>();
        int firstLine = -1;
        String firstName;
        int fileCount;

        static Cue parse(File f) throws IOException {
            Cue c = new Cue();
            String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            if (text.length() > 0 && text.charAt(0) == '﻿') text = text.substring(1);
            for (String line : text.split("\r\n|\n|\r", -1)) c.lines.add(line);
            for (int i = 0; i < c.lines.size(); i++) {
                String t = c.lines.get(i).trim();
                if (t.regionMatches(true, 0, "FILE", 0, 4) && t.length() > 5 && Character.isWhitespace(t.charAt(4))) {
                    c.fileCount++;
                    if (c.firstLine < 0) {
                        c.firstLine = i;
                        c.firstName = nameOf(t);
                    }
                }
            }
            return c;
        }

        /** The file name in a FILE line: "quoted name" or a bare word, then the type. */
        static String nameOf(String t) {
            String rest = t.substring(4).trim();
            if (rest.startsWith("\"")) {
                int end = rest.indexOf('"', 1);
                return end < 0 ? rest.substring(1) : rest.substring(1, end);
            }
            int sp = rest.lastIndexOf(' ');
            return sp < 0 ? rest : rest.substring(0, sp).trim();
        }

        File firstFile(File dir) {
            if (firstName == null) return null;
            File f = new File(firstName);
            return f.isAbsolute() ? f : new File(dir, firstName);
        }

        /** The sheet with its first FILE line pointing at `newName`. */
        String rewrite(String newName) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i);
                if (i == firstLine) {
                    String t = line.trim();
                    String indent = line.substring(0, line.indexOf(t.charAt(0)));
                    String rest = t.substring(4).trim();
                    String type = rest.startsWith("\"") ? rest.substring(rest.indexOf('"', 1) + 1).trim() : rest.substring(rest.lastIndexOf(' ') + 1);
                    if (type.isEmpty()) type = "BINARY";
                    line = indent + "FILE \"" + newName + "\" " + type;
                }
                sb.append(line);
                if (i < lines.size() - 1) sb.append("\r\n");
            }
            return sb.toString();
        }
    }
}
