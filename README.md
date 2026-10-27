# Game Log - Tracker DS Launcher

One Android app for the AYN Thor (works on other devices too, with one screen).
- Bottom screen: the Game Log Tracker, bundled inside the APK (no website to host, works offline).
- Top screen: art for the game open in the tracker, or the logo on the main menu.
- Play button in each game profile: starts the game in RetroArch or a standalone emulator on the top screen.
- Setup wizard on first run (reopen it any time from the tracker menu, "Launcher settings").

## Build and install
1. Create a repo for this project, upload everything here (keep the `.github` folder), open the Actions tab, run "Build APK".
2. Download the `glt-ds-launcher-apk` artifact, unzip, install `app-debug.apk`.
3. Open the app on the BOTTOM screen. The wizard opens on the top screen while the bottom screen shows the logo.
4. Moving from the old website version: the bundled tracker has its own storage. In the old one use Data > Export,
   in this one Data > Import. Do this once.
5. Update the two Cloudflare workers once so they accept the app (see `cloudflare/` in the hand-off, or add
   `https://appassets.androidplatform.net` to `ALLOWED_ORIGINS` in both).

## The bundled tracker
- The tracker's files live in `app/src/main/assets/www/` and are served to the WebView at
  `https://appassets.androidplatform.net/assets/www/` (WebViewAssetLoader). It is a normal https page to the WebView, so
  IndexedDB, fetch and the Cloudflare workers behave as they do in a browser.
- To change the tracker, replace the files in `assets/www/` with the new version of the frontend repo and rebuild.
  `sw.js` is not needed there: the service worker is switched off inside the app.
- Each build refreshes `ra-patches-index.json` and `ra-guides-index.json` (`tools/`, see the workflow). If GitHub is
  unreachable during the build, the copies already in the repo are used.
- The wizard's "Tracker address" can still point at your own hosted copy. Leave it blank for the bundled one.

## What the wizard asks for
1. Allow "All files access" for the app.
2. RetroAchievements username and Web API key, and an optional RAWG key. They are copied into the tracker, so you do not type them twice.
3. ROMs folder (folder picker) and ES-DE folder (folder picker, optional). The ES-DE folder is where `downloaded_media` and
   `custom_systems/es_systems.xml` live. Your custom systems and their cores are imported from that file.
4. Which RetroArch is installed, which standalone emulators were found, and, per system, standalone or RetroArch.
5. Top screen, tracker size on the bottom screen, and the tracker address.

## Emulators
- RetroArch: launched with the ROM, core and config paths, the same way ES-DE does it.
- Standalone: Dolphin (GameCube, Wii), DuckStation (PS1), PPSSPP (PSP), Mupen64Plus AE/FZ (N64), ARMSX2 (PS2).
  The recipes are in `assets/emulators.json`. If an emulator opens but does not start the game, its recipe may need a fix:
  put a copy of the entry in `<ES-DE folder>/gltthor/emulators.json` (same `id`) and edit it, no rebuild needed.
- DS and 3DS are not launched from here.
- Cores per system are in `assets/systems.json`. Cores for systems you defined in ES-DE come from your own file, the rest are
  common defaults. Override any of them in `<ES-DE folder>/gltthor/systems.json`.

## Library database
- `database/` holds the Room database: `GameEntity` (table `game_library`), `GameDao`, `AppDatabase`, `GameRepository`.
- Every ROM scan syncs into it (`LibrarySync`): new files are added, files that are gone are removed, and favorites, play
  counts, ScreenScraper matches and art are kept. If storage can't be read, or a system folder is missing (SD card out),
  nothing is deleted.
- Starting a game adds one to its play count. The tracker can read the library with `ThorBridge.libraryGames(systemId)`
  and set favorites with `ThorBridge.setFavorite(id, true)`.
- `screenscraper_id` is 0 when a game has not been searched, -1 when it was searched with no match, and above 0 when matched.
- Room needs AndroidX, so `android.useAndroidX` is true in `gradle.properties`. The first build downloads Room.

## Game art for the top screen
1. **Fan art is always the first choice.** Your ES-DE media first. In the wizard's folders step, if the ES-DE folder has `downloaded_media`, a box "Use my ES-DE
   media" is on by default. Games with art there use it as it is and are never sent to ScreenScraper. Turn it off to
   ignore ES-DE's art completely.
2. **ScreenScraper for the rest.** Opening a game that has no art fetches it in the background. Tracker menu > "Fetch game
   art" does the whole library, one game at a time. The app searches by cleaned-up title (tags, regions and punctuation
   ignored; "Game 2" never matches "Game"), downloads fan art (or a screenshot when there is none), box art and logo, and builds one 1280x720 JPEG per
   game in the app's own storage (`MiximageCompositor`). Calls go straight from the device with OkHttp, not through Cloudflare.
3. **ScreenScraper needs developer keys.** Put your `devid` and `devpassword` in `assets/screenscraper.json` before building,
   or, without rebuilding, in `<ES-DE folder>/gltthor/screenscraper.json` (same format, only the keys you set are used).
   Your own login goes in the wizard (or is read from ES-DE's settings). Without the keys, "Fetch game art" says so and nothing is sent.
   System ids per folder are in the same file; add yours there if a folder is missing.

## Notes
- Bottom screen too zoomed or too small: Launcher settings, Screens, Tracker size. The tracker's own Text Size menu also works.
- Standalone emulators are given read access to the ROM through the ROMs folder you picked, the same way ES-DE does.
- Written without an Android SDK: the new code was type-checked against stubs and its title matching and ES-DE lookup were run on test data, but the first real build and the standalone launch recipes are untested on a device. Expect a few fixes.


## Controller controls

| Button | Action |
| --- | --- |
| D-pad / left stick | Move the highlight |
| Right stick | Scroll up and down (faster the further you push) |
| A | Confirm (swappable with B in the menu: Controller) |
| B | Back: closes the game profile, pop-ups, the menu, or the on-screen keyboard |
| Select | Open or close the hamburger menu |
| X | Refresh the game profile, or the main screen |
| L1 / R1 | Previous / next console (Game Library, Beaten by Year, Backlog) |
| L2 / R2 | Previous / next tab |

Touch works as before. The Android back button and edge-swipe never close the app; use Home for that.
