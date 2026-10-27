package com.gin649.gltthor;

import android.net.Uri;
import android.provider.DocumentsContract;

final class PathUtil {

    private PathUtil() {}

    /** Real path of a folder picked with the system folder picker, such as /storage/40E5-C676/Roms. */
    static String fromTree(Uri tree) {
        try {
            String id = DocumentsContract.getTreeDocumentId(tree);
            int colon = id.indexOf(':');
            String volume = colon < 0 ? id : id.substring(0, colon);
            String rel = colon < 0 ? "" : id.substring(colon + 1);
            String base = "primary".equals(volume) ? "/storage/emulated/0" : "/storage/" + volume;
            return rel.isEmpty() ? base : base + "/" + rel;
        } catch (Exception e) {
            return null;
        }
    }
}
