package com.gin649.gltdslauncher;

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

    /** Real path of a file picked with the system file picker, or null when it doesn't live on storage we can name. */
    static String fromDocument(Uri doc) {
        try {
            if (!"com.android.externalstorage.documents".equals(doc.getAuthority())) return null;
            String id = DocumentsContract.getDocumentId(doc);
            int colon = id.indexOf(':');
            if (colon < 0) return null;
            String volume = id.substring(0, colon);
            String base = "primary".equals(volume) ? "/storage/emulated/0" : "/storage/" + volume;
            return base + "/" + id.substring(colon + 1);
        } catch (Exception e) {
            return null;
        }
    }
}
