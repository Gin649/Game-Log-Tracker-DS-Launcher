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

## What the wizard asks for
1. Welcome: allow "All files access" and "Usage access" (lets the app return to the tracker when a game closes).
2. RetroAchievements username and Web API key, and an optional RAWG key.
3. Your folders: frontend (ES-DE, Daijisho or none), ROMs folder, and the frontend's folder.
4. Your Emulators: per system, pick a standalone emulator or a RetroArch core. Change it any time from Launcher settings.
5. Your screens: top screen and tracker size on the bottom screen.
The wizard removes itself from the recent apps list when it finishes.

## Emulators
- RetroArch: launched with the ROM, core and config paths, the same way ES-DE does it.
- Standalone: Dolphin (GameCube, Wii), DuckStation (PS1), PPSSPP (PSP), Mupen64Plus AE/FZ (N64), ARMSX2 (PS2).
  The recipes are in `assets/emulators.json`. If an emulator opens but does not start the game, its recipe may need a fix:
  put a copy of the entry in `<ES-DE folder>/gltthor/emulators.json` (same `id`) and edit it, no rebuild needed.
- Also set up: Watermelon DS (DS), Azahar (3DS), Eden / Eden nightly (Switch), Cemu (Wii U), Vita3K (Vita), HakuX (Xbox).
  Several of these recipes are best guesses (HakuX package and intent, Azahar/Eden activity names; Vita3K needs title-ID
  file names and games installed in it first). If one opens without starting the game, override it as described above.
- Walkthroughs: "Find a walkthrough" opens an in-app browser; back or swipe returns to the tracker, and "Save video" sends the link over.
- ROM hacks: the base ROM is the one Play finds. The patched ROM is saved beside it, with "Play patched ROM" and "Add to my backlog".
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
Art is looked up in this order and the first hit wins:
1. **Art you already have.** ES-DE: `downloaded_media` (fan art first). Daijisho: your DaijishoMedia folder or wherever SkraperUI /
   another scraper saved images and `gamelist.xml` (Daijisho keeps its own scraped pictures in private app storage, which no
   other app can read, so point the wizard at a folder it can share). Pictures next to your ROMs (`rom.png`, `images/`, `media/`,
   `gamelist.xml`) are found in every mode. Games with art there are never downloaded again.
2. **Free libretro thumbnails, no account or keys.** Box art, in-game screenshot (or title screen) and logo from
   thumbnails.libretro.com. There is no fan art there, so the screenshot is the background of the mix image. On by default; switch it off
   in the wizard. Systems and their libretro folder names are in `assets/libretro.json` (add yours in
   `<frontend folder>/gltthor/libretro.json`). Each system's file list is cached for 30 days.
Opening a game with no art fetches it in the background; tracker menu > "Fetch game art" does the whole library. One 1280x720 JPEG
per game is built in the app's own storage (`MiximageCompositor`).

## Frontends (wizard, step "Your folders")
- **ES-DE**: choose the ES-DE folder. Media and `custom_systems/es_systems.xml` (your systems and cores) are used.
- **Daijisho**: choose a media folder it can share (see above). Exported platform `.json` files in that folder are read for your
  cores; a platform is matched to the folder in your ROMs folder with the same short name, id or name.
- **None / other**: only the ROMs folder is needed. Everything else (emulators, screens, accounts) has its own step.
- ROM folders named in full ("Game Boy Advance", "PS1", "SNES") are matched to the built-in systems by name (`assets/folder_aliases.json`).

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
