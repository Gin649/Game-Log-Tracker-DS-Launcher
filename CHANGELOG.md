# Changelog

Notable changes to Game Log Tracker DS Launcher, newest first.

## v1.1.8

### Changed
- The Library and Backlog open and scroll faster. Covers load as they come into view, not all at once, and a list that is already on screen is no longer rebuilt after every sync.
- Searching the Library or Backlog redraws the list a moment after you stop typing, not on every letter.
- The Apps tab opens faster. App names are read in the background when the launcher starts.
- Finding a game's ROM is quicker, which speeds up the Play button, the Add from ROMs list and playtime for games RetroAchievements doesn't track. The app remembers which ROM each game matched until the next time it scans your folders.
- Backups now include the playtime counted on this device for games RetroAchievements doesn't track. Restoring one keeps whichever time is longer.
- Backups are smaller: lists that can be downloaded again are left out, and so are base ROMs remembered for the ROM patcher (pick the ROM again after restoring). Older backups still restore.
- The app looks for a new version once a day, not only when it starts, so a launcher left open still hears about updates. It never asks while a game is running.
- Coming back to the launcher and long play sessions use less of the device: rescanning your ROM folders and watching for a game closing both do less work.
- Saved data is written more safely, so a crash or power loss in the middle of a save can't leave a value missing.
- Opening an app from the Apps tab while a game is running now puts the app on the bottom screen, so it never covers the game. With no game running it opens on the screen you set for it. (Knowing a game is running needs Usage access.)

### Fixed
- Games RetroAchievements doesn't track (3DS, for example) now show their playtime and when they were last played in the Game Library, in both the table and tile views. They showed a dash and Never before, even after you played them from the launcher. The time is brought up to date when you come back from the game.
- Beaten games with no playtime from RetroAchievements now show Time to beat (first unlock to last), as intended. They were being estimated as if still in progress.
- Libraries with more than 500 games on RetroAchievements now load in full. Games past the first 500 were missing from the Game Library and Beaten.
- Mark as beaten fills in today's date. In the evening it could fill in tomorrow's.
- Beaten dates and release dates no longer show a day early, and a game beaten on January 1 no longer lands in the year before on Beaten.
- The Backlog no longer stays on Loading when the library can't be reached.
- ROMs added while the launcher is open are found when you come back to it, or when you refresh, without restarting the app.
- Putting the device to sleep in the middle of a game no longer stops its playtime being counted, or adds the time asleep.
- A multi-disc game keeps one playtime total whether you start it from a disc or from its playlist.
- Game and achievement names with characters such as quotes, & or < now show correctly in the lists and profiles.
- When a game you track by hand turns out to be on RetroAchievements and becomes a RetroAchievements entry, it keeps what it had: its profile shows Playtime before RetroAchievements, and a game you had already beaten gets an asterisk beside its name with the date you beat it. This was lost before.
- Moving the app's data folder can no longer put an older copy over something saved while the move was running.
- A disc patch that was cut short (the app closed in the middle of it) no longer leaves its hidden working folder, which could be several gigabytes, next to the game for good. Leftovers are removed the next time your folders are scanned.
- An IPS patch for a disc game that changes the byte at one particular spot (offset 0x454F46) is now applied in full. The rest of the patch was skipped before.
- Getting a ROM ready for an Android port can no longer overwrite or delete the game's own file when the port's folder is also where you keep that ROM.
- The Social tab shows all of a friend's beaten games, not only those among their first 500.
- The backup file is named with today's date. In the evening it could carry tomorrow's.
- An IPS patch for a cartridge game that changes the byte at offset 0x454F46 is now applied in full, the same as for disc games. An IPS patch whose download was cut short is refused, not applied in part.
- Opening ROM Hacks on a very large game (a 3DS game, for example) no longer stalls or closes the tracker. A file over 1 GB is not read in, and a message says so.
- A patched ROM is no longer reported as not matching RetroAchievements when it does. SNES ROMs with a copier header, and Famicom Disk System, Nintendo DS, Atari Lynx, Atari 7800 and PC Engine games, are now checked the way RetroAchievements checks them.
- A UPS patch that makes a disc image smaller is now applied. It was refused as damaged.
- A damaged xdelta or PPF patch for a disc game now says the patch is damaged. It could show a line of program text.
- Reading a long manual no longer uses more memory with every page. Pages you have scrolled well past are let go and drawn again when you come back.
- A manual that has moved on Games Database is looked up again. Download manual kept failing with a message about your connection.
- Fan art: adding or correcting a SteamGridDB key later now brings in more fan art for games you had already opened. A game with no fan art online is no longer asked about every time you open it.
- LaunchBox art for a console no longer disappears until the app is restarted after a brief problem on the server.
- Apps tab: after holding an app to choose its screen, the next tap on an app works. It was ignored.
- The guide reader keeps your place when you close it right after scrolling.
- A game title with & or < now shows correctly in the Game Guide panel's GameFAQs link.
- Setup: pressing Next on the emulator step before it has finished looking now saves the RetroArch you have installed. Opening Setup a day or more after it was left half done starts from your saved settings, not from what was typed back then.
- Social: a person's page no longer jumps back to the top when the rest of it loads.
- Box art picker: when IGDB can't be reached, the covers are looked up again next time. The shorter list was kept for a month.
- A TV or cast display is no longer counted as a second screen when deciding whether to fetch top-screen fan art.
- A patch zip you imported that can't be opened no longer offers a Download button that goes nowhere.
- Manual viewer: the "Open in browser viewer" button is gone. It did nothing on the device. The message now says to check your connection and open the manual again.
- Setup: the Cancel button on the first page is now "Finish later", since folders you have already chosen stay chosen.
- Controller: moving up and down through your games no longer lands on a game's ✕ (remove) button, so pressing confirm opens the game. In a list, press right on a game to reach its ✕ and left to go back. In tile view the ✕, and in Apps the star, are now for touch only.
- The row of console names is easier to scroll by touch. A swipe on it now always scrolls the row, not the page, and it no longer gets slower after you have reordered the consoles.

### Security
- Your RetroAchievements login is only ever sent to RetroAchievements or to the app's own service. The public proxies that were tried as a last resort have been removed.
- Achievement names and descriptions are shown as plain text, so nothing written into one can run inside the app. Ones with & or < also show correctly now.

## v1.1.7

### Added
- In a game's profile, the About section now always has a See more button (it was Read more, and only on long write-ups). It opens the rest of a long write-up and shows a ScreenScraper screenshot of the game under the text. Games with a short write-up, or none, get the button too. The screenshot is only looked up the first time you tap See more, never when the profile opens.
- Android ports you have installed now tell you when a newer build is out: an Update button appears in the ports section, and it downloads and installs the new version the same way as the first install. The app looks up the newest release in the background (at most every six hours per port) and counts a build as newer when it was published after you last installed or updated the port.
- About 130 more Android ports, and the list now keeps itself up to date: new ports are added, renamed projects are followed, and projects that disappear are hidden unless you installed them, so an installed port stays in its game's profile.
- Choose your own box art. Tap the cover in a game's profile to see it full screen, then swipe left or right (or use the arrows, or left and right on the controller) to browse other covers: the one you have now, your frontend's box art, LaunchBox's front cover, ScreenScraper's covers for each region, and IGDB's cover. Press Use this one (the confirm button on the controller) to keep it; Automatic goes back to the app's own choice. It works for every game, not only RetroAchievements ones, and your choice is saved in your backup. The covers are only looked up the first time you swipe, never when a profile opens, and swiping is off while the picture is zoomed in.

### Changed
- In a game's profile, Android ports now have their own section, Android Ports Available, closed until you open it. Download, Play and Update are inside it, so they can't be tapped by mistake under the game's own Play button. The section's name shows how many ports there are and how many you have installed.

## v1.1.6

### Added
- Play log for games on PlayStation 5, Xbox Series X|S, Nintendo Switch 2 and PC, which have no emulator to count your time. In the game's profile, open Play log and add each session with the date you played and the time in hours and minutes. Edit or delete a session at any time. The total becomes the game's Playtime, and the newest session date puts the game in Last Played, so an older session doesn't push it above games you played more recently. Logging your first session ticks Now Playing for you, which moves the game from the Backlog to the Library.

### Fixed
- A game that is the next number in a series (for example Grand Theft Auto VI) no longer gets the box art or review score of the earlier game (Grand Theft Auto V). If nothing matches exactly, the app keeps the cover it already has. This fix is in the app's online service, so it applies as soon as the service is updated.

## v1.1.5

### Added
- A small arrow appears at the right of the console row (Library, Beaten and Backlog) when there are more consoles to scroll to, and goes away once you reach the end.

### Changed
- Beaten: the game icons are bigger (72 instead of 48) and sit closer together, so more of your games are visible at once.
- While a game is playing on the top screen, you can still use the bottom screen by touch (scroll a guide, tap around) and the controller stays with the game, so you no longer have to tap the top screen to get the controls back. It needs Usage access, like the top-screen game watcher, and lets go when the game closes.

### Fixed
- On the top screen, the larger Game Log Tracker logo in the Retro theme no longer overlaps the profile card.
- Opening a game that isn't on RetroAchievements no longer freezes the screen, and going back is quick again. The description is now looked up in the background and fills in when it arrives.
- A game on a system you have no ROM for (for example Dr. Mario on NES when you only have the Game Boy version) no longer takes the box art from the same title on another system. It looks only in that system's ES-DE media, then ScreenScraper, then LaunchBox.
- ScreenScraper no longer returns the same title from another system (the Game Boy Dr. Mario for the NES one). It returns nothing instead, so the next source is used.
- Opening another app such as Chrome or Files on the top screen after you start a game no longer brings the art screen back over it a few seconds later. The art still comes back when the game closes to the home screen or to your frontend.

## v1.1.4

### Added
- ScreenScraper: games are now looked up on ScreenScraper as you browse, with no ES-DE needed. It supplies the game's description, box art for games RetroAchievements doesn't list, and top-screen fan art. It comes after your own ES-DE media and before LaunchBox, and what it finds is saved on your device, so a game is only asked for once. It works through the app's own service, so there is nothing to set up. Fetch game art in the menu uses it too.

### Changed
- New Nintendo, Playstation and Xbox logos for the themes.
- The Game Log Tracker logo in the Retro theme is bigger, so it looks as large as the console logos.
- Game profile box art now comes from your ES-DE media first, then ScreenScraper, then LaunchBox, then RetroAchievements.
- Game Details description now comes from your ES-DE gamelist, then ScreenScraper, then LaunchBox, then IGDB.
- Top-screen fan art now comes from your ES-DE media first, then ScreenScraper, then SteamGridDB (with a key), then LaunchBox.

## v1.1.3

### Added
- Themes: Display Options, Theme lets you switch the look of the whole app, and the top screen, between Retro (the current look and the default), Nintendo, Playstation and Xbox. Each changes the colours, the font and the shape of buttons and cards, and the header logo becomes the console's logo. Xbox uses a true black background with the green of the Xbox logo. The logos live in the new logos folder, with the app logo.
- Start-up animation: when you press Play, old-TV static with a soft crackle and "GAME STARTING" plays for a second while the emulator opens, then goes straight into the game. On two screens it plays on the top screen, and on both screens for a game that uses both. On a single screen it covers the launcher. Turn it off in Display Options, Start-up animation.
- Playtime for games RetroAchievements doesn't have: the launcher counts how long the game is on screen and shows it as Playtime in the game's profile. It needs Usage access, the same as the top-screen game watcher.
- Games that aren't on RetroAchievements, or have no achievements, now move into the Game Library when you play them and show in Recently played, with their playtime.
- Arcade games: the cryptic ROM names (like "sfa3") are matched to their real titles, so they show Play instead of "not on this device".
- Time to beat and time to 100% for games RetroAchievements doesn't know, in Game Details, from IGDB.
- Alternative names from IGDB help match ROM files, so a game with a regional or alternate title still finds its ROM for Play.
- Social: each person in the list shows how many achievements they have in their last game. Their profile shows their points for the mode you are in (casual or hardcore) and a new "Recently beaten or mastered" list.

### Changed
- All emulators now open on the top screen, including Nintendo DS games (Watermelon DS, Azahar), so they no longer launch on the wrong screen.
- In Game Library and Backlog, All stays pinned at the left of the console row while the other consoles scroll beside it, with the first console right next to it.
- The tabs (Last Played, Game Library, Backlog, Beaten) have more room, so the controller's square no longer covers the words.
- In a game profile, Up and Down on the controller follow the left edge (Play, then Play port, and so on) instead of the buttons beside them.
- The Display menu now opens on the selected display, and you move down from there to the other settings.
- Game profile box art now comes from your ES-DE media first, then LaunchBox, then RetroAchievements. For games RA doesn't list, SteamGridDB is used only as a last resort. The picture is remembered, so a game opens with its better art straight away.
- Game Details description now comes from your ES-DE gamelist (the description ES-DE scraped), then LaunchBox, then IGDB.
- RAWG is gone completely. Review scores, the Add a game search for games RA doesn't list, backlog art and descriptions now all use IGDB, and the RAWG key box in setup is removed. Games you added earlier are kept.
- Add a game waits longer for a search and tries twice if it is slow.
- Game Details opens faster: playtime and times show straight away, and the description fills in when it arrives.
- On a single-screen device (or with the single-screen setting on), LaunchBox fan art and the miximages made from it are no longer downloaded, since only the top screen uses them.
- Social opens a person's details only when you tap them, and the recent unlocks list is shorter (5).
- Setup: the system list now shows "Scanning ROMs..." while the ROM scan is still running, instead of listing every system on a fresh install.
- The note under Download manual ("From Games Database. Saved on this device...") is gone.

### Fixed
- A game whose name ends in a minus number, like "Super Mario Bros. -2", is no longer mixed up with the plain game ("Super Mario Bros. 2"), so each gets its own description and box art from LaunchBox.
- Non-RA games with ES-DE box art showed a screenshot instead of the box art. They now use the ES-DE box art.
- A rating lookup that failed is no longer remembered, so the badge tries again instead of staying empty.

## v1.1.2

### Added
- Android ports: when a game has a native Android port, its profile offers "Download and Install the Android Port". Once installed, the same button becomes "Play installed Android port" and opens it on the top screen. The list of ports comes from two community catalogues. A port is shown only if it has an Android build and your device can run it. If a game has more than one, each is named on its button.
- Prepare ROM button beside the port button: unzips the game's ROM (and turns CHD, RVZ and other disc formats into plain files, and N64 files into .z64) and saves it to Downloads, in "Roms for Ports", ready to pick inside the port.
- Display Options, Game view: choose List View (the default) or Tile View for the Game Library and Backlog. Tile View shows the Last Played style tiles, with the three most recent first and the rest A-Z, and you can set 3, 4 or 5 tiles per row.

### Changed
- Easier navigation: the tabs, console row, search bar and column headings now stay in place while the list scrolls, and the controller moves through them more naturally.
- Console chips no longer show a name cut in half at the edge, and the console you are on is always in view, including the last one.
- Pull to refresh needs a shorter pull, starts only near the top edge, and its bar is smaller.

## v1.1.1

### Added
- New emulators: DuckStation (new) for PlayStation, Vita3K+ for PS Vita, aPS3e for PS3 and Flycast for Dreamcast.

### Changed
- Faster start-up: the Last Played tab loads its playtime first and is usable straight away. The rest of the library loads in the background, and the library list is redrawn only when you open it.

## v1.1.0

### Fixed
- Leftover cache files from earlier versions (guide archive indexes and auto-fetched cheats, one small file each) are now moved into the database file on start, so the data folder no longer fills up with them. Auto-fetched cheats are now kept in the database too.

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
