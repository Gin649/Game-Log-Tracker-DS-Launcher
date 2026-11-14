package com.gin649.gltdslauncher;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.File;

/** Builds the address of a ROM that other apps can be given permission to read. */
final class RomUri {

    private RomUri() {}

    /**
     * A content:// address inside the ROM folder the file is in, using the permission given to that folder in
     * setup, or a plain path address when no folder grant is saved. Never a file:// address, which Android refuses
     * to hand to other apps.
     */
    static Uri forRom(Context c, File rom) {
        String path = rom.getPath();
        Config.RomFolder best = null;
        for (Config.RomFolder f : Config.ROM_FOLDERS) {
            if (f.tree.isEmpty() || !path.startsWith(f.path + "/")) continue;
            if (best == null || f.path.length() > best.path.length()) best = f;
        }
        if (best == null) {
            // older installs saved the one folder's grant on its own
            String tree = Prefs.get(c, "romsTree", "");
            String root = Config.ROMS_ROOT;
            if (!tree.isEmpty() && !root.isEmpty() && path.startsWith(root + "/")) best = new Config.RomFolder(root, tree, "");
        }
        if (best != null) {
            try {
                Uri t = Uri.parse(best.tree);
                String rel = path.substring(best.path.length() + 1);
                String docId = DocumentsContract.getTreeDocumentId(t) + "/" + rel;
                return DocumentsContract.buildDocumentUriUsingTree(t, docId);
            } catch (Exception ignored) {
            }
        }
        return new Uri.Builder().path(path).build();
    }

    /**
     * The game's content:// address as seen from its own system folder (Roms/n64, say), the way ES-DE builds it.
     * Mupen64Plus AE only starts a game it has in its own library, and its library holds addresses under the folder
     * you gave it, which is normally the system folder. This app has no permission for that address, so the
     * emulator opens it with its own. Null when the file is not in one of the ROM folders.
     */
    static Uri inSystemFolder(File rom) {
        String path = rom.getPath();
        Config.RomFolder best = null;
        for (Config.RomFolder f : Config.ROM_FOLDERS) {
            if (!path.startsWith(f.path + "/")) continue;
            if (best == null || f.path.length() > best.path.length()) best = f;
        }
        if (best == null) return null;
        String dir = best.path;
        if (best.allSystems()) {
            // the system folder is the first folder under the ROMs folder
            String rest = path.substring(dir.length() + 1);
            int slash = rest.indexOf('/');
            if (slash < 0) return null;
            dir = dir + "/" + rest.substring(0, slash);
        }
        String treeId = docId(dir);
        String fileId = docId(path);
        if (treeId == null || fileId == null) return null;
        Uri tree = DocumentsContract.buildTreeDocumentUri(AUTHORITY, treeId);
        return DocumentsContract.buildDocumentUriUsingTree(tree, fileId);
    }

    private static final String AUTHORITY = "com.android.externalstorage.documents";

    /** The storage document id for a path: "primary:Roms/n64" for internal storage, "1234-ABCD:Roms/n64" for an SD card. */
    private static String docId(String path) {
        String internal = "/storage/emulated/0";
        if (path.equals(internal)) return "primary:";
        if (path.startsWith(internal + "/")) return "primary:" + path.substring(internal.length() + 1);
        if (!path.startsWith("/storage/")) return null;
        String rest = path.substring("/storage/".length());
        int slash = rest.indexOf('/');
        if (slash < 0) return rest + ":";
        return rest.substring(0, slash) + ":" + rest.substring(slash + 1);
    }

    static boolean isContent(Uri u) {
        return "content".equals(u.getScheme());
    }
}
