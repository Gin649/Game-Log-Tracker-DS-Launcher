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

    static boolean isContent(Uri u) {
        return "content".equals(u.getScheme());
    }
}
