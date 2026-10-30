# Changelog

Notable changes to Game Log Tracker DS Launcher, newest first.

## v1.0.6

### Added
- Choose which fan art to use for a game. Swipe left or right on the top screen to change it. A small counter in the title bar, for example 1 / 5, shows which one you're on, and it appears briefly when you swipe or when more fan art has finished downloading. When you open a game's profile, the app now also downloads fan art from SteamGridDB and LaunchBox, even if ES-DE already has one, so you have more to pick from. Your choice is remembered.
- An Apps tab next to Backlog lists the apps installed on your device, so you can open them from the launcher. Tap the star on an app to add it to your favourites, which is what the tab shows by default. All apps shows everything, and the search box finds an app by name. On two screens, apps open on the top screen by default. Hold an app to choose the top or bottom screen for it, and your choice is remembered.

### Changed
- The Overview tab is now called Last Played, since that is what it shows.
- Start-up is faster. The app no longer searches your ES-DE media folders for every game when it opens. A game's art is looked up when you open its profile and then saved, so it isn't searched for again. Fetch game art is now the only thing that re-checks every game.
- Only one section is open at a time in a game profile. Opening ROM Hacks closes Game Guide, for example.
- Only one section is open at a time in the hamburger menu, and the section you open scrolls to the top so you can see all of it.
- Social now fills the whole bottom screen instead of a small window, so it is easier to read.
- Guide search no longer runs while you type. Type the full word, then tap the new → button beside the search box.
- Manuals no longer have a Save PDF button, since the PDF is already saved in your storage folder.

### Fixed
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
