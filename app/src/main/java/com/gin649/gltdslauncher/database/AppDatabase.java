package com.gin649.gltdslauncher.database;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

/**
 * The app's SQLite database. Bump {@code version} and add a Migration whenever GameEntity changes.
 * There is deliberately no fallbackToDestructiveMigration(): it would wipe favorites and play counts.
 */
@Database(entities = {GameEntity.class}, version = 1, exportSchema = true)
public abstract class AppDatabase extends RoomDatabase {

    private static final String NAME = "glt_thor.db";
    private static volatile AppDatabase instance;

    public abstract GameDao gameDao();

    public static AppDatabase get(Context context) {
        AppDatabase db = instance;
        if (db == null) {
            synchronized (AppDatabase.class) {
                db = instance;
                if (db == null) {
                    db = Room.databaseBuilder(context.getApplicationContext(), AppDatabase.class, NAME).build();
                    instance = db;
                }
            }
        }
        return db;
    }
}
