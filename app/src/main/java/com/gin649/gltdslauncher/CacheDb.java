package com.gin649.gltdslauncher;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/**
 * The tracker's rebuildable caches (one entry per game for hours, achievements, game info and so on) in one small
 * database in the app's private storage, instead of one file each. A library of thousands of games would otherwise mean
 * tens of thousands of files in shared storage, which is slow to open and to list. Anything here can be fetched again,
 * so losing it on uninstall costs nothing. Your own data (backlog, guides, notes, settings) stays as files.
 */
final class CacheDb extends SQLiteOpenHelper {

    /** Names (after the "priv:" or "shared:" part) that belong here. */
    private static final String[] PREFIXES = {
            "ra-hours:", "ra-gameinfo:", "ra-ach:", "ra-snap:", "ra-playtime-stats:", "ra-dash:", "ra-gamelist:",
            "ra-gamelist-h:", "ra-consoles-supported", "rawg-desc:", "rating-avg:", "guide-archive-index:",
            "rapatches-tree-cache-v4", "social-cache:", "cheatsauto:", "ports-catalog:",
    };

    private static CacheDb instance;

    private CacheDb(Context ctx) {
        super(ctx.getApplicationContext(), "gltcache.db", null, 1);
    }

    static synchronized CacheDb get(Context ctx) {
        if (instance == null) instance = new CacheDb(ctx);
        return instance;
    }

    /** True for a stored name ("priv:ra-hours:...") that is kept in the database. */
    static boolean isCache(String name) {
        if (name == null) return false;
        String n = name.startsWith("priv:") ? name.substring(5) : name.startsWith("shared:") ? name.substring(7) : name;
        for (String p : PREFIXES) {
            if (n.startsWith(p)) return true;
        }
        return false;
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE kv (name TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldV, int newV) {
    }

    String read(String name) {
        Cursor c = null;
        try {
            c = getReadableDatabase().rawQuery("SELECT value FROM kv WHERE name = ?", new String[]{name});
            return c.moveToFirst() ? c.getString(0) : null;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.close();
        }
    }

    boolean write(String name, String value) {
        try {
            ContentValues v = new ContentValues();
            v.put("name", name);
            v.put("value", value);
            v.put("ts", System.currentTimeMillis());
            getWritableDatabase().insertWithOnConflict("kv", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    boolean remove(String name) {
        try {
            getWritableDatabase().delete("kv", "name = ?", new String[]{name});
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    List<String> names(String prefix) {
        List<String> out = new ArrayList<String>();
        Cursor c = null;
        try {
            c = getReadableDatabase().rawQuery("SELECT name FROM kv", null);
            while (c.moveToNext()) {
                String n = c.getString(0);
                if (n.startsWith(prefix)) out.add(n);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    /** The most recently written entries, newest first, until about maxTotal characters. */
    void preloadInto(StringBuilder out, int maxEach, int maxTotal) {
        Cursor c = null;
        try {
            c = getReadableDatabase().rawQuery("SELECT name, value FROM kv ORDER BY ts DESC", null);
            int total = 0;
            while (c.moveToNext()) {
                String v = c.getString(1);
                if (v.length() > maxEach) continue;
                String n = c.getString(0);
                if (hasSeparator(n) || hasSeparator(v)) continue;
                total += v.length();
                if (total > maxTotal) break;
                out.append(n).append('\u0001').append(v).append('\u0002');
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
    }

    static boolean hasSeparator(String s) {
        return s.indexOf('\u0001') >= 0 || s.indexOf('\u0002') >= 0;
    }

    /** Puts many entries in at once (used to move the old cache files in). */
    boolean writeAll(List<String[]> rows) {
        SQLiteDatabase db;
        try {
            db = getWritableDatabase();
        } catch (Exception e) {
            return false;
        }
        db.beginTransaction();
        try {
            long now = System.currentTimeMillis();
            for (String[] r : rows) {
                ContentValues v = new ContentValues();
                v.put("name", r[0]);
                v.put("value", r[1]);
                v.put("ts", now);
                db.insertWithOnConflict("kv", null, v, SQLiteDatabase.CONFLICT_IGNORE);
            }
            db.setTransactionSuccessful();
            return true;
        } catch (Exception ignored) {
            return false;
        } finally {
            db.endTransaction();
        }
    }
}
