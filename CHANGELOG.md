# Changelog

Notable changes to Game Log Tracker DS Launcher, newest first.

## v1.0.9

### Added
- ARMSX3 (PS3) and XenDroid (Xbox 360) emulators, with PS3 and Xbox 360 systems.
- Dolphin CS as an emulator choice for GameCube and Wii.

### Changed
- ROM hacks no longer show the original game's description. They show "Hack" and a "Click here for details" link to the hack's page on RomHacking.net.
- A cartridge ROM you pick for the backlog is now matched to its RetroAchievements game by its file hash first, whatever the file is called, then by name. Play starts the file you picked.
- Setup, Your Emulators: the page now lists only the systems you have ROMs for, each with its installed emulators and RetroArch cores. When the app can see which cores you have installed, it lists just those. Otherwise it lists every core RetroArch has for that system, hack folders included. RetroArch counts as an emulator, and installed and not installed emulators sit in their own dropdowns.
- Setup: "Tracker size" is now "Display size". A single-screen device still gets the screens page, with a note that you are on one screen and the Display size option.
- Setup no longer asks about using existing pictures or LaunchBox art. On a dual-screen device both are turned on, and on a single-screen device both are turned off, since the art is only for the top screen. This also resets your earlier choice once, on the first start of this version.
- Exported backups no longer include your RetroAchievements and RAWG keys.
- Improved efficiency and startup time by moving game data into a database file.

### Fixed
- A game could start a different game with a similar name, such as Kirby's Dream Land for Kirby's Pinball Land. Titles now only match when the words that differ are things like a version or region. A game added from a ROM you picked also starts that exact file.
- The setup wizard no longer loses what you entered when you leave the app to look up a key and come back.
- Coming back to the app while the setup wizard was open could leave a "Setup is open" screen. It now brings the wizard back.
- The setup wizard's emulator page could hang or load slowly. It now looks for emulators in the background.
- The menu button no longer sits under the clock and battery hearts when they are on.

## v1.0.8

### Changed
- Game Library now labels its two groups. The three games you played most recently sit under a gold RECENTLY PLAYED heading, and the rest are under ALL GAMES A–Z, so they are no longer mixed together.

## v1.0.7

### Added
- Live achievement updates. While a game you started from the app is running, the open game profile checks RetroAchievements about once a minute. When you unlock something, the progress numbers and the Achievements and Beaten Achievements lists update, without reloading the rest of the profile. It only checks while the tracker is on screen, and needs Usage access.
- Reorder and rename the console tabs. Hold a tab in Game Library or Backlog to start, then drag a tab to move it, tap it to rename it, and press the teal OK button to finish. Game Library and Backlog share one order, and Beaten uses your names. Your order and names are remembered.
- Use one screen only. On a two-screen device, the Your screens step of the setup wizard has a checkbox to run the app on just the top or the bottom screen, with the tracker and the game art together. Games and apps still open on the other screen.

### Changed
- Games now move out of the Backlog when you press Play, instead of after the game closes. Games on RetroAchievements move to the Library, and games RetroAchievements doesn't list get Now Playing ticked, so they move too.
- The tabs are now in the order Last Played, Game Library, Backlog, Beaten, Apps. Beaten by Year is now called Beaten.
- On the controller, the tab buttons and the console buttons wrap around. Going past the last one returns to the first, and going back from the first goes to the last.
- The console tabs in Game Library and Backlog no longer show a game count. The count beside the heading now reads, for example, (35 games), in bold gold. Apps shows (88 Apps).
- Headings are bold, as are the years in Beaten. Hide beaten is now Hide Beaten, and Exit app is now Close App.
- The update prompt is shorter. It shows the new version and points you to GitHub or Discord for details, instead of repeating the release notes.

## v1.0.6

### Added
- Choose which fan art to use for a game. Swipe left or right on the top screen to change it. A small counter in the title bar, for example 1 / 5, shows which one you're on, and it appears briefly when you swipe or when more fan art has finished downloading. When you open a game's profile, the app now also downloads fan art from SteamGridDB and LaunchBox, even if ES-DE already has one, so you have more to pick from. Your choice is remembered.
- An Apps tab next to Backlog lists the apps installed on your device, so you can open them from the launcher. Tap the star on an app to add it to your favourites, which is what the tab shows by default. All apps shows everything, and the search box finds an app by name. On two screens, apps open on the top screen by default. Hold an app to choose the top or bottom screen for it, and your choice is remembered.
- A controller button next to Play on this device lets you choose the emulator for that one game only. For example, run one game in the 32-bit RetroArch while the rest use the 64-bit one. Pick Default to go back to the system's emulator.
- Multi-disc games now show as one entry in the backlog and library. In RetroArch the game's .m3u playlist is used. If there isn't one, the first time you play it the app offers to create the .m3u for you, or to play disc 1 only.
- Standalone emulators, such as Dolphin and DuckStation, can't read .m3u playlists, so for a multi-disc game they ask which disc to start.
- Game descriptions fall back to LaunchBox when no other source has one.

### Changed
- The Overview tab is now called Last Played, since that is what it shows.
- Start-up is faster. The app no longer searches your ES-DE media folders for every game when it opens. A game's art is looked up when you open its profile and then saved, so it isn't searched for again. Fetch game art is now the only thing that re-checks every game.
- Only one section is open at a time in a game profile. Opening ROM Hacks closes Game Guide, for example.
- Only one section is open at a time in the hamburger menu, and the section you open scrolls to the top so you can see all of it.
- Social now fills the whole bottom screen instead of a small window, so it is easier to read.
- Guide search no longer runs while you type. Type the full word, then tap the new → button beside the search box.
- Manuals no longer have a Save PDF button, since the PDF is already saved in your storage folder.

### Fixed
- A game with no ROM on the device now shows "Not located on this device" in place of Play on this device.
- In a game profile, Back now closes the open section first (achievements, guides, ROM hacks and so on). Pressing it again closes the profile.
- Picking any disc of a multi-disc game for the backlog adds the whole game once, using its .m3u playlist if there is one, instead of one entry per disc.
- Picking a ROM file for the backlog now opens the file chooser in your ROMs folder instead of the last place you browsed.
- Refreshing a game profile now keeps your place on the page, and the controller highlight stays where it was instead of jumping back to Play on this device.
- Searching for a short word in a long guide no longer freezes the app. It stops at 400 matches and only highlights the ones near the one you're on.

## v1.0.5

### Added
- NetherSX2 is now on the list of PS2 emulators.

### Changed
- The setup wizard is simpler. Daijishō has been removed as a front end choice, because its media folder is buried in the Android data folders and can't be accessed. Choose None / something else unless you have already scraped ES-DE media.
- Confirmed that N64 games launch in the Mupen64 AE RetroAchievements fork.

### Fixed
- The Android security prompt about the app being built for an older version of Android no longer appears when installing on newer devices.

## v1.0.0 - v1.0.4

### Added
- Initial release. Install the latest APK from Releases to get started.
- These first four releases contain all the changes to get it ready for public release. That includes testing to make sure it's equal to the Game Log Tracker PWA version, game launching, setup wizard testing, automatic updates, and more...
