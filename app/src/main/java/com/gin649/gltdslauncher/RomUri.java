package com.gin649.gltdslauncher;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.File;

/** Builds the address of a ROM that other apps can be given permission to read. */
final class RomUri {

    private RomUri() {}

    /**
     * A content:// address inside the ROMs folder you picked in setup, or a plain path address when
     * no folder grant is saved. Never a file:// address, which Android refuses to hand to other apps.
     */
    static Uri forRom(Context c, File rom) {
        String tree = Prefs.get(c, "romsTree", "");
        String root = Config.ROMS_ROOT;
        String path = rom.getPath();
        if (!tree.isEmpty() && !root.isEmpty() && path.startsWith(root + "/")) {
            try {
                Uri t = Uri.parse(tree);
                String rel = path.substring(root.length() + 1);
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
