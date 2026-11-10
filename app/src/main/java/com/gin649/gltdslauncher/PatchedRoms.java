package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The patched copies ROM Hacks has saved, and the ROM each was made from. A patched copy often carries the game's own
 * name, so without this list Play could not tell it from the original. With it, Play opens the original and the
 * patched copies are offered as a choice.
 */
final class PatchedRoms {

    private PatchedRoms() {}

    private static final String KEY = "patchedRoms";
    private static final Map<String, String> BASE_OF = new ConcurrentHashMap<String, String>(); // patched path -> base path
    private static volatile boolean loaded;

    static synchronized void load(Context c) {
        if (loaded) return;
        loaded = true;
        try {
            JSONObject o = new JSONObject(Prefs.get(c, KEY, "{}"));
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String path = it.next();
                BASE_OF.put(path, o.optString(path));
            }
        } catch (Exception ignored) {
        }
    }

    /** Remembers that this file is a patched copy of that ROM. */
    static synchronized void note(Context c, File patched, File base) {
        load(c);
        if (patched.getPath().equals(base.getPath())) return; // the patch changed nothing: that is the original
        String had = BASE_OF.put(patched.getPath(), base.getPath());
        if (base.getPath().equals(had)) return;
        try {
            JSONObject o = new JSONObject();
            for (Map.Entry<String, String> e : BASE_OF.entrySet()) {
                if (new File(e.getKey()).isFile()) o.put(e.getKey(), e.getValue()); // copies deleted since drop out here
            }
            Prefs.put(c, KEY, o.toString());
        } catch (Exception ignored) {
        }
        MatchCache.reset(); // a game that matched this copy before must be looked up again
    }

    static boolean is(File f) {
        return BASE_OF.containsKey(f.getPath());
    }

    /** The patched copies made from this ROM that are still there, oldest name first. */
    static List<File> of(File base) {
        List<File> out = new ArrayList<File>();
        for (Map.Entry<String, String> e : BASE_OF.entrySet()) {
            File f = new File(e.getKey());
            if (e.getValue().equals(base.getPath()) && f.isFile()) out.add(f);
        }
        java.util.Collections.sort(out);
        return out;
    }
}
