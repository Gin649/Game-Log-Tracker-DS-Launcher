package com.gin649.gltdslauncher.database;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * One row per ROM file in the library.
 *
 * Columns match the implementation spec. The unique index on (system_id, rom_path) is an addition:
 * it stops a rescan from creating duplicate rows for the same file.
 */
@Entity(
        tableName = "game_library",
        indices = {
                @Index(value = {"system_id", "rom_path"}, unique = true),
                @Index(value = {"screenscraper_id"}),
                @Index(value = {"title"})
        })
public class GameEntity {

    @PrimaryKey(autoGenerate = true)
    public int id;

    /** 0 = not searched on ScreenScraper yet, -1 = searched with no match, above 0 = the ScreenScraper game id. */
    @ColumnInfo(name = "screenscraper_id")
    public int screenscraperId;

    @NonNull
    @ColumnInfo(name = "title")
    public String title = "";

    @NonNull
    @ColumnInfo(name = "rom_path")
    public String romPath = "";

    /** ES-DE style system folder, e.g. "snes", "psx", "gba". */
    @NonNull
    @ColumnInfo(name = "system_id")
    public String systemId = "";

    /** Flattened miximage in app storage, or null until one is built. */
    @Nullable
    @ColumnInfo(name = "local_miximage_path")
    public String localMiximagePath;

    @ColumnInfo(name = "favorite")
    public boolean favorite;

    @ColumnInfo(name = "play_count")
    public int playCount;

    /** Room uses this constructor. */
    public GameEntity() {}

    /** A freshly scanned ROM: no ScreenScraper match, no art, not a favorite, never played. */
    public static GameEntity scanned(@NonNull String title, @NonNull String romPath, @NonNull String systemId) {
        GameEntity g = new GameEntity();
        g.title = title;
        g.romPath = romPath;
        g.systemId = systemId;
        return g;
    }
}
