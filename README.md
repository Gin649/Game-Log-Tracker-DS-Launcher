# Game Log Tracker DS Launcher

Game Log Tracker DS Launcher is the Android app version you've been waiting for, built for two screen devices like the AYN Thor and the Retroid Pocket Duo. 

Track your RetroAchievements and completions on the bottom screen, see your game's art on the top screen, and start your games in RetroArch or a standalone emulator with one tap. It also works on single-screen Android devices or Phones. 

Everything you add is saved on your own device in your choice of local or default system folder.

Join the Gin649sRetroGameHub Discord: https://discord.gg/6dgZA4yD2

For all app related discussions and my Game of the Month Competition. Play some games with us.

## What it does

**Two screens, one app.** The bottom screen is the Game Log Tracker. The top screen shows art for the game you have open, or the logo on the main menu. Open a game, press Play, and it starts on the top screen, every emulator included, with a short old-TV start-up animation you can turn off in Display Options. The tracker remains on the bottom screen to keep track of your game. When the game closes, the top screen returns to showing fan art and menus etc.

**One screen only.** On a two-screen device, the setup wizard can run the app on just the top or the bottom screen, with the tracker and the game art together. Games and apps then open on the other screen.

**The tracker** is the full Game Log Tracker web app, bundled along with many improvements. 

- **Last Played** with your RetroAchievements profile, recently played games and your latest unlocks.
- **Game Library** with every game you've played on RA. Search it, filter by system, and see progress, awards and playtime. The three games you played most recently sit at the top under a Recently Played heading, then everything else is listed by name under All Games A–Z. All stays pinned at the left of the console row while the other consoles scroll beside it. Tap a column heading to sort by anything else. Pick a console and the top three are the last ones you played on that console. Game Library and Backlog can also be shown as tiles instead of a list: turn on Tile View under Display Options, Game view, and choose 3, 4 or 5 tiles per row.
- **Console tabs** can be put in your own order and renamed. Hold a tab in Game Library or Backlog, drag a tab to move it, tap it to rename it, and press the teal OK button to finish. Game Library and Backlog share one order, Beaten uses your names, and the app remembers them.
- **Backlog** is for games you plan to play, including games from systems RA doesn't track. It's sorted by name. Besides searching by title, Add game can pick games straight from your ROM files (several at once), or add every game in a system folder. Each is matched to its RetroAchievements entry by name, and one RA doesn't list is added as a plain entry, and its picture is filled in from your frontend's media, then LaunchBox, SteamGridDB (with a key), then IGDB. A game leaves the Backlog and goes to the Library as soon as you press Play. A game RA doesn't list gets Now Playing ticked for you at that moment. Games RA doesn't list, or that have no achievements, show in Recently played too, with their playtime counted by the app while the game is on screen (this uses the same usage access as the top-screen watcher).
- **Play log** for games on PlayStation 5, Xbox Series X|S, Nintendo Switch 2 and PC, which have no emulator to count your time. In the game's profile, open Play log (collapsed by default) and add each session with the date and the time in hours and minutes. Edit or delete one later. The total is kept as the game's Playtime, the newest session date decides where it sits in Last Played, and your first session ticks Now Playing.
- **Beaten** groups everything you've beaten or mastered by the year you did it.
- **Apps** lists the apps installed on your device, so you can open them without leaving the launcher. Tap the star on an app to add it to your favourites, which is what the tab shows by default. All apps shows everything, and the search box finds an app by name. On two screens, apps open on the top screen by default. Hold an app to choose the top or bottom screen for it, and your choice is remembered.
- **Social** shows the people you follow on RetroAchievements, what they're playing and the achievements they have in their last game. Tap someone to load their recent unlocks, their points for the mode you're in and their recently beaten or mastered games.
- **Casual / Hardcore** is one switch in the menu that flips every stat, list and progress bar.
- **A heading that stays put.** The tabs, console row, title, search bar and column headings stay in place while the list scrolls underneath them.

The web version has the full details: https://github.com/Gin649/Game-Log-Tracker

### Inside a game

- **Retro Achievements** list with points and unlock dates, missable achievements marked with a "!", and a Missable Only filter. Put achievements in your own order, and export or import an order as a file. Also included are Subsets, if the game has any, each with its own achievement list.
- **Live achievements.** While a game you started from the app is running, the open profile checks RetroAchievements about once a minute. When you unlock something, the progress and the achievement lists update without reloading the page. It needs Usage access and only checks while the tracker is on screen.
- **Game Details** More information about a game, including its time to beat and master (from RA, or from IGDB for games RA doesn't list), and a description. The description comes from your ES-DE gamelist, then ScreenScraper, then LaunchBox, then IGDB. Box art comes from your ES-DE media, then ScreenScraper, then LaunchBox, then RetroAchievements. ScreenScraper is asked through the app's own service as you browse, so it works without ES-DE and nothing needs setting up; what it finds is saved on the device.
- **Game manuals.** Find and download a manual for the game, then read it in the built-in viewer. It's saved on your device and works with the controller too.
- **Guides and Walkthroughs.** Find a walkthrough opens a browser inside the app. Back, or a swipe from the edge, returns to the tracker, and Save video keeps the link in the game's profile.
- **ROM Hacks.** The app finds your base ROM for you. The patched ROM is saved next to it, with a "Play patched ROM" button and an "Add to my backlog" option. Translations are listed in their own section. Hacks that were made for your exact ROM are found from a ready-made list that updates itself, so the search is quick. I don't host or supply any ROMs.
- **Disc games too.** ROM Hacks also works for CD and DVD games (PlayStation, Saturn, Sega CD, GameCube and so on). Discs are patched straight from storage, with a progress bar, and the patched copy is saved next to the original, which is never changed. It works with BIN/CUE, ISO, CSO, CHD and RVZ games, and with IPS, PPF, BPS, UPS and xdelta patches. CHD and RVZ games are unpacked, patched and packed again, which takes longer and needs free space for the whole disc.

### On the top screen

The top screen shows the game you have open, with its title and system underneath. It also carries your profile card and the menu, so the bottom screen stays free for the tracker.

Art you already have is never downloaded again. Opening a game that has no art fetches it in the background, and Fetch game art (in the menu under Data) does the games in your Library and Backlog.

When a game has several fan arts online (up to six), swipe left or right on the top screen to pick one; the choice is remembered. 

### Playing your games

- **RetroArch** starts the game with the right core for the system.
- **Standalone emulators:** Dolphin (GameCube, Wii), DuckStation (PS1), PPSSPP (PSP), Mupen64Plus (N64), ARMSX2 (PS2), ARMSX3 and aPS3e (PS3), WatermelonDS (DS), Azahar (3DS), Eden (Switch), Cemu (Wii U), Vita3K and Vita3K+ (Vita), Flycast (Dreamcast), HakuX (Xbox) and XenDroid (Xbox 360). DuckStation has a newer version too, and Dolphin CS is available for GameCube and Wii.
- You choose which emulator or RetroArch core each system uses, and you can change it any time from Launcher settings.
- **A different emulator for one game.** The controller button next to Play on this device opens a list of the emulators and RetroArch cores that can play that game. Pick one and only that game uses it, for example the 32-bit RetroArch for a game that won't run in the 64-bit one. Choose Default to go back to the system's emulator.
- **Android ports.** Some games have a native Android version, made from the game's code. When a game has one, its profile shows a Download and Install the Android Port button. The app downloads the port and installs it (Android asks you to confirm), and the same button then becomes Play installed Android port, which opens it on the top screen. If a game has more than one port, each is named on its button. Ports are only shown if they have an Android build and your device can run them, and the list updates itself, so new ports appear without an app update. You need your own copy of the game.
- **Prepare ROM for a port.** Ports can't open zip, CHD or RVZ files. The button beside the port button unpacks your ROM (and turns CHD and RVZ discs into plain files, and N64 files into .z64) and saves it to Downloads, in a "Roms for Ports" folder, so you can pick it inside the port. Your original is never changed.
- **Multi-disc games** show as one entry in your backlog and library, whichever disc you pick. In RetroArch the game's .m3u playlist is used, and if there isn't one, the first time you play the app offers to create it for you. Standalone emulators can't read playlists, so they ask which disc to start.
- Arcade games are matched by their real titles, even when the ROM is named by its MAME code (like "sfa3").
- A game with no ROM on the device shows "Not located on this device" instead of Play.
- The app reads your ROMs folder, whether you use ES-DE or no frontend at all. Folders named in full, like "Game Boy Advance" or "SNES", are recognised too.
- Some of the newer emulator setups are still being tested. If one opens but doesn't start your game, tell me on Discord.

### Controller controls

| Button | Action |
| --- | --- |
| D-pad / left stick | Move the highlight |
| Right stick | Scroll up and down (faster the further you push) |
| A | Confirm (can be swapped with B in the menu under Controller) |
| B | Back: closes the open section of a game profile, then the profile, pop-ups, the manual, the menu or the on-screen keyboard |
| Select | Open or close the menu |
| X | Refresh the game profile or the main screen |
| L1 / R1 | Previous / next console (wraps around at either end) |
| L2 / R2 | Previous / next tab (wraps around at either end) |
| Left / right on the tabs or the console row | Switch tab or console straight away, like L2 / R2 and L1 / R1 |

In Tile View, up and down move through the first tile of each row. Going up from the first game goes to the column heading, then the console you are on, then your tab.


### Other things

- Themes under Display Options: Retro (the original look), Nintendo, Playstation and Xbox. Each changes the colours, the font and the header logo, on both screens.
- Text size controls and the List / Tile view choice under Display Options in the menu, and a tracker size setting for the bottom screen in Launcher settings.
- An optional clock and battery readout, with the battery shown as pixel hearts. Turn it on under Display in the menu.
- The app checks for new versions and offers to download and install them. The prompt shows the new version and points to GitHub or Discord for details.
- About, at the bottom of the menu, shows the app version and links to GitHub and Discord.

## Screenshots

A game profile on the Thor, with the fan art and title on the top screen and the tracker on the bottom screen.

<table>
  <tr>
    <td><img src="docs/screenshots/game-profile-1.jpg" alt="Game profile with game details" width="100%"></td>
    <td><img src="docs/screenshots/game-profile-2.jpg" alt="Game profile with progress and options" width="100%"></td>
  </tr>
</table>

## Getting started

1. Download the latest `.apk` from the Releases page: https://github.com/Gin649/Game-Log-Tracker-DS-Launcher/releases
2. Install it. Android will ask you to allow installing from your browser or file manager the first time.
3. Open the app. The setup wizard will open.
4. Follow the wizard. It asks for:
   - **File access** so the app can find your games and artwork, and **usage access** so the top screen returns to the tracker when a game closes.
   - Mandatory: Your RetroAchievements username and Web API key. You can find the key on RA under Control Panel, then Keys.
   - Optional but recommended to get full experience: a free SteamGridDB key for fan art. Ratings, game search and details come from IGDB through the app's own service, with no key needed. Launchbox artwork doesn't need a key and will be used by default if you don't give one.
   - For single screen devices uncheck launchbox and leave the steamgriddb blank. All artwork scraped is for the top screen and not needed for single screen devices.
   - Which frontend you use (ES-DE or none), your ROMs folder, and the frontend's media folder if you use ESDE. If you you select none, new fan art will be scraped as you navigate game library.
   - Which emulator to use for each system. Only systems found in your Roms folder and emulators/cores on your device are listed.
   - On a two-screen device, whether to use one screen only (top or bottom), which screen is the top screen, and how big the text on the tracker should be on the bottom screen. This is automatically configured. For single screen just leave it on automatic. 
5. Tap Finish. You can change any of it later from the tracker's menu, under Launcher settings.

**Coming from the web version?** The app keeps its own data, so move yours over once. In the web version choose Menu, then Data, then Export. In the app choose Menu, then Data, then Import.

## Your data

Everything is stored on your device: your RA login, keys, added games, playtime, custom achievement orders, guides, manuals and saved videos. Nothing syncs between devices.

The app keeps its own files (that saved data, plus fetched game art) in a folder you choose in the setup wizard, under Your folders. The default is a GameLogTracker folder in shared storage, so it survives uninstalling the app and switching between debug and release builds. Changing the folder moves what is already saved. Without file access the app falls back to its private folder.

## Privacy

None of your data is stored by me. RetroAchievements requests go straight from the app to RetroAchievements. Your optional SteamGridDB key is only sent to that service.

Other sites the app contacts, and why:

- RetroAchievements and media.retroachievements.org, for your profile, achievements and images.
- IGDB, for review scores, game search and details (through the app's service).
- ScreenScraper, through the app's service, for descriptions, box art and fan art.
- SteamGridDB, for fan art (only if you added a key).
- LaunchBox's games database, for free fan art, box art, screenshots and logos. A small index per console is downloaded from this repo and the pictures from images.launchbox-app.com. This is on by default and can be switched off in Launcher settings.
- YouTube, for walkthrough videos.
- archive.org, for text guides.
- gamesdatabase.org, for game manuals. Those requests go through a private proxy I run on Cloudflare Workers that stores nothing.
- cdnjs.cloudflare.com, to load the manual viewer the first time you open a manual.
- GitHub, to check for new app versions and to find ROM patches and guides.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Contact

Questions or bugs: find me on Discord or 
Email: ginsretrogamehub@gmail.com   
