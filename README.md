# Game Log Tracker DS Launcher

Game Log Tracker as an Android app, built for the AYN Thor and its two screens. Track your RetroAchievements and completions on the bottom screen, see your game's art on the top screen, and start your games in RetroArch or a standalone emulator with one tap. It also works on single-screen Android devices (Android 11 or newer). Everything you add is saved on your own device.

Join the Discord: https://discord.gg/6dgZA4yD2

Play some games with us.

## What it does

**Two screens, one app.** The bottom screen is the Game Log Tracker. The top screen shows art for the game you have open, or the logo on the main menu. Open a game, press Play, and it starts on the top screen. Emulators that draw both DS or 3DS screens themselves start on the bottom screen instead. When the game closes, the tracker comes back.

**The tracker** is the full Game Log Tracker, bundled inside the app. Everything in the web version is here:

- **Overview** with your RetroAchievements profile, recently played games and your latest unlocks.
- **Game Library** with every game you've played on RA. Search it, filter by system, and see progress, awards and playtime. The three games you played most recently sit at the top, then everything else is listed by name. Tap a column heading to sort by anything else. Pick a console and the top three are the last ones you played on that console.
- **Beaten by Year** groups everything you've beaten or mastered by the year you did it.
- **Backlog** is for games you plan to play, including games from systems RA doesn't track. It's sorted by name.
- **Social** shows the people you follow on RetroAchievements and what they've unlocked lately.
- **Casual / Hardcore** is one switch in the menu that flips every stat, list and progress bar.

The web version has the full details: https://github.com/Gin649/Game-Log-Tracker

### Inside a game

- Achievement list with points and unlock dates, missable achievements marked with a "!", and a Missable Only filter.
- Put achievements in your own order, and export or import an order as a file.
- Subsets, if the game has any, each with its own achievement list.
- **Game manuals.** Find and download a manual for the game, then read it in the built-in viewer. It's saved on your device and works with the controller too.
- **Walkthroughs.** Find a walkthrough opens a browser inside the app. Back, or a swipe from the edge, returns to the tracker, and Save video keeps the link in the game's profile.
- Game guides, a Need Cheats? button, review scores, and the time other players take to beat the game.
- **ROM Hacks.** The app finds your base ROM for you. The patched ROM is saved next to it, with a "Play patched ROM" button and an "Add to my backlog" option. Translations are listed in their own section. Hacks that were made for your exact ROM are found from a ready-made list that updates itself, so the search is quick. I don't host or supply any ROMs.
- **Disc games too.** ROM Hacks also works for CD and DVD games (PlayStation, Saturn, Sega CD, GameCube and so on). Discs are patched straight from storage, with a progress bar, and the patched copy is saved next to the original, which is never changed. It works with BIN/CUE, ISO, CSO, CHD and RVZ games, and with IPS, PPF, BPS, UPS and xdelta patches. CHD and RVZ games are unpacked, patched and packed again, which takes longer and needs free space for the whole disc.

### On the top screen

The top screen shows the game you have open, with its title and system underneath. It also carries your profile card and the menu, so the bottom screen stays free for the tracker.

The picture it shows is the best one available, in this order:

1. **Fan art or a finished miximage** from your frontend.
2. **Fan art online**: SteamGridDB first (if you gave the app a free key), then LaunchBox, which needs no account.
3. **A miximage built for you** from your frontend's screenshot, box art and marquee.
4. **A miximage built from LaunchBox's** box art, screenshot and logo.
5. **Your marquee, then box art**, if nothing better turns up.

Art you already have is never downloaded again. Opening a game that has no art fetches it in the background, and Fetch game art in the menu does your whole library.

### Playing your games

- **RetroArch** starts the game with the right core for the system.
- **Standalone emulators:** Dolphin (GameCube, Wii), DuckStation (PS1), PPSSPP (PSP), Mupen64Plus (N64), ARMSX2 (PS2), WatermelonDS (DS), Azahar (3DS), Eden (Switch), Cemu (Wii U), Vita3K (Vita) and HakuX (Xbox).
- You choose which emulator or RetroArch core each system uses, and you can change it any time from Launcher settings.
- The app reads your ROMs folder, whether you use ES-DE, Daijisho or no frontend at all. Folders named in full, like "Game Boy Advance" or "SNES", are recognised too.
- Some of the newer emulator setups are still being tested. If one opens but doesn't start your game, tell me on Discord.

### Controller controls

| Button | Action |
| --- | --- |
| D-pad / left stick | Move the highlight |
| Right stick | Scroll up and down (faster the further you push) |
| A | Confirm (can be swapped with B in the menu under Controller) |
| B | Back: closes the game profile, pop-ups, the manual, the menu or the on-screen keyboard |
| Select | Open or close the menu |
| X | Refresh the game profile or the main screen |
| L1 / R1 | Previous / next console |
| L2 / R2 | Previous / next tab |

When you switch console or tab, the highlight lands on the first game in the list.

In a manual, L1 / R1 turn a page up or down and L2 / R2 zoom out or in.

Touch works as normal and hides the highlight. The Android back button and edge swipe never close the app, so use Home for that.

### Other things

- Text size controls in the menu, and a tracker size setting for the bottom screen in Launcher settings.
- An optional clock and battery readout, with the battery shown as pixel hearts. Turn it on under Display in the menu.
- The app checks for new versions and offers to download and install them.
- About, at the bottom of the menu, shows the app version and links to GitHub and Discord.

## Getting started

1. Download the latest `.apk` from the Releases page: https://github.com/Gin649/Game-Log-Tracker-DS-Launcher/releases
2. Install it. Android will ask you to allow installing from your browser or file manager the first time.
3. Open the app on the **bottom screen**. The setup wizard opens on the top screen while the bottom screen shows the logo.
4. Follow the wizard. It asks for:
   - **File access** so the app can find your games and artwork, and **usage access** so the top screen returns to the tracker when a game closes.
   - Your RetroAchievements username and Web API key. You can find the key on RA under Control Panel, then Keys.
   - Optional: a free RAWG key for ratings and game details, and a free SteamGridDB key for fan art.
   - Which frontend you use (ES-DE, Daijisho or none), your ROMs folder, and the frontend's folder.
   - Which emulator to use for each system. Only systems found in your ROMs folder are listed.
   - Which screen is the top screen, and how big the tracker should be on the bottom screen.
5. Tap Finish. You can change any of it later from the tracker's menu, under Launcher settings.

**Coming from the web version?** The app keeps its own data, so move yours over once. In the web version choose Menu, then Data, then Export. In the app choose Menu, then Data, then Import.

## Your data

Everything is stored on your device: your RA login, keys, added games, playtime, custom achievement orders, guides, manuals and saved videos. Nothing syncs between devices.

The app keeps its own files (that saved data, plus fetched game art) in a folder you choose in the setup wizard, under Your folders. The default is a GameLogTracker folder in shared storage, so it survives uninstalling the app and switching between debug and release builds. Changing the folder moves what is already saved. Without file access the app falls back to its private folder.

Menu, then Data, then Export saves a backup file, and Import loads it again. The backup includes your API keys, so treat the file like a password.

## Privacy

None of your data is stored by me, and the app has no analytics or tracking. RetroAchievements requests go straight from the app to RetroAchievements. Your optional RAWG and SteamGridDB keys are only sent to those services.

Other sites the app contacts, and why:

- RetroAchievements and media.retroachievements.org, for your profile, achievements and images.
- RAWG, for ratings and game details (only if you added a key).
- SteamGridDB, for fan art (only if you added a key).
- LaunchBox's games database, for free fan art, box art, screenshots and logos. A small index per console is downloaded from this repo and the pictures from images.launchbox-app.com. This is on by default and can be switched off in Launcher settings.
- YouTube, for walkthrough videos.
- archive.org, for text guides.
- gamesdatabase.org, for game manuals. Those requests go through a private proxy I run on Cloudflare Workers that stores nothing.
- cdnjs.cloudflare.com, to load the manual viewer the first time you open a manual.
- GitHub, to check for new app versions and to find ROM patches and guides.

## Thanks

Joey (https://www.joeysretrohandhelds.com) helped make this possible, and his JoeyOS app inspired the guide lookup and the ROM patcher. I used his approach with his permission.

CHD and RVZ patching uses chdman (from MAME) and dolphin-tool (from Dolphin), both GPL-2.0, built with Joey's scripts. Licences are in the licences folder.

Achievement data comes from RetroAchievements and ratings and box art from RAWG. Fan art comes from SteamGridDB and the LaunchBox games database. Text guides come from the GameFAQs archive on archive.org, indexed by the Guide Watch project. I'm not affiliated with any of them.

## Contact

Questions or bugs: open an issue here, or find me on Discord.
