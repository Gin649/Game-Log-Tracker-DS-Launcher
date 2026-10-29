package com.gin649.gltdslauncher.database;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

/**
 * All queries are blocking. Call them from a background thread (GameRepository does this for you).
 * ThorBridge methods called from JavaScript already run on a background thread.
 */
@Dao
public interface GameDao {

    // From the spec
    @Query("SELECT * FROM game_library WHERE system_id = :systemId ORDER BY title COLLATE NOCASE")
    List<GameEntity> getGamesBySystem(String systemId);

    @Query("SELECT * FROM game_library ORDER BY title COLLATE NOCASE")
    List<GameEntity> getAllGames();

    /**
     * Insert or replace by primary key. Careful: REPLACE deletes the old row first, so passing a
     * new entity for an existing file resets favorite and play_count. For rescans use
     * GameRepository.syncSystem(), which uses insertIfAbsent() instead.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertGame(GameEntity game);

    @Query("UPDATE game_library SET play_count = play_count + 1 WHERE id = :id")
    void incrementPlayCount(int id);

    // Lookups
    @Query("SELECT * FROM game_library WHERE id = :id")
    GameEntity getById(int id);

    @Query("SELECT * FROM game_library WHERE system_id = :systemId AND rom_path = :romPath LIMIT 1")
    GameEntity findByRom(String systemId, String romPath);

    @Query("SELECT * FROM game_library WHERE title LIKE '%' || :text || '%' ORDER BY title COLLATE NOCASE LIMIT :limit")
    List<GameEntity> searchByTitle(String text, int limit);

    @Query("SELECT * FROM game_library WHERE favorite = 1 ORDER BY title COLLATE NOCASE")
    List<GameEntity> getFavorites();

    @Query("SELECT * FROM game_library WHERE play_count > 0 ORDER BY play_count DESC, title COLLATE NOCASE LIMIT :limit")
    List<GameEntity> getMostPlayed(int limit);

    @Query("SELECT DISTINCT system_id FROM game_library ORDER BY system_id")
    List<String> getSystemIds();

    @Query("SELECT COUNT(*) FROM game_library")
    int countAll();

    @Query("SELECT COUNT(*) FROM game_library WHERE local_miximage_path IS NOT NULL")
    int countWithMiximage();

    // Scanning
    /** Returns the new row id, or -1 if this system/ROM pair is already in the table (row left untouched). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    long insertIfAbsent(GameEntity game);

    @Query("DELETE FROM game_library WHERE id IN (:ids)")
    void deleteByIds(List<Integer> ids);

    // Online art search status (the column is still called screenscraper_id)
    /** screenscraper_id: 0 = not searched yet, -1 = searched and nothing found. (Older builds stored a ScreenScraper id above 0.) */
    @Query("SELECT * FROM game_library WHERE screenscraper_id = 0 AND local_miximage_path IS NULL ORDER BY id LIMIT :limit")
    List<GameEntity> getUnmatched(int limit);

    @Query("UPDATE game_library SET screenscraper_id = -1 WHERE id = :id")
    void markNoMatch(int id);

    /** Lets the next scrape try the games that had no match again. */
    @Query("UPDATE game_library SET screenscraper_id = 0 WHERE screenscraper_id = -1")
    void resetNoMatch();

    @Query("UPDATE game_library SET screenscraper_id = :screenscraperId, title = :title WHERE id = :id")
    void setScreenscraperMatch(int id, int screenscraperId, String title);

    @Query("SELECT * FROM game_library WHERE screenscraper_id > 0 AND local_miximage_path IS NULL ORDER BY id LIMIT :limit")
    List<GameEntity> getNeedingMiximage(int limit);

    @Query("UPDATE game_library SET local_miximage_path = :path WHERE id = :id")
    void setMiximagePath(int id, String path);
}
