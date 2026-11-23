// The words of the Help guide. Help (help.js) shows them in the app, and the same file builds the web version
// (tools/build-help-page.py), so there is only one copy to keep up to date.
//
// Each chapter is a list of sections. A section's html can use:
//   <span class="hk">B</span>       a face button (round)        <span class="hk sh">L1</span>  a shoulder or other button
//   <div class="hp-tip">...</div>    a Tip box                    <div class="hp-note">...</div> a Note box
//   <table class="hp-keys">          a button table (first column buttons, second what they do)
//   <div data-diagram="thor"></div>  the drawing of the controller
window.HELP_GUIDE = {
  title: 'Game Log Tracker DS Launcher',
  subtitle: 'Instruction Booklet',
  chapters: [

  // ------------------------------------------------------------------------------------------------------------
  { id: 'start', title: 'Getting Started', sections: [
    { h: 'Welcome', html: `
      <p>Game Log Tracker DS Launcher is a game launcher and a RetroAchievements tracker in one. It's made for two-screen
      handhelds like the AYN Thor, and it works on one-screen devices too.</p>
      <p>Instead of browsing every ROM you own, you <b>pick the games you want to play</b>. You add a game to your
      <b>Backlog</b> and press Play. Once you've played it, it moves to your <b>Game Library</b>, where your
      achievements, playtime and progress are tracked.</p>
      <p>On a two-screen device the tracker sits on the bottom screen, and the top screen shows the game's fan art, its
      cartridge or disc, and the game itself once it starts.</p>` },
    { h: 'The setup wizard', html: `
      <figure class="hp-shot"><img src="help/img/setup-folders.webp" alt="Step 3 of the setup wizard: Your folders" loading="lazy"><figcaption>Step 3 of the setup wizard: Your folders</figcaption></figure>
      <p>The first time you open the app, a short setup wizard walks you through six steps. Everything can be changed
      later from the menu under <b>Launcher Settings</b>.</p>
      <ol>
        <li><b>Welcome:</b> allow file access, so the app can find your games and their artwork.</li>
        <li><b>Your accounts:</b> your RetroAchievements username and Web API key (the key is on your RetroAchievements
        settings page, and the wizard has a button that opens it). A SteamGridDB API key is optional. Without one, the
        free LaunchBox art is used.</li>
        <li><b>Your folders:</b> pick your frontend (ES-DE, or None / something else), the ES-DE data folder if you use
        ES-DE, the app data folder, and your ROM folders.</li>
        <li><b>Your Emulators:</b> choose the emulator for each system you have ROMs for. You can also add your own
        launch commands here.</li>
        <li><b>Your screens:</b> which screen is the top screen, whether to use one screen only, and the display size
        (Compact, Normal, Large or Extra large).</li>
        <li><b>Finish:</b> a summary of your choices. Tap Finish to start the tracker.</li>
      </ol>
      <div class="hp-tip">You can skip RetroAchievements in the wizard and connect later with the <b>Connect</b> button
      in the tracker.</div>` },
    { h: 'Setting up your ROM folders', html: `
      <p>Add the folder that holds one folder per system, like <code>gba</code>, <code>snes</code> and
      <code>psx</code>. Folders named in full, like "Game Boy Advance" or "PS1", are recognised too. You can also add a
      folder that holds only one console's games and pick that console for it.</p>
      <p>You can add more than one ROM folder (internal storage and an SD card, for example). When a game is in more
      than one folder, Play uses the first folder in the list. Use <b>Make preferred</b> to move a folder to the top.</p>
      <div class="hp-tip">Hold the Play button in a game's profile to pick another copy of the game.</div>` },
    { h: 'ES-DE and other frontends', html: `
      <p>If you use ES-DE, choose its data folder (the one that contains <code>downloaded_media</code>). The launcher
      then uses the box art, fan art, cartridge pictures and descriptions you already scraped there.</p>
      <p>Without ES-DE, choose <b>None / something else</b>. Art comes from LaunchBox and ScreenScraper instead, and is
      fetched game by game as you browse, so nothing has to be downloaded all at once.</p>` },
    { h: 'Connecting RetroAchievements', html: `
      <p>Your username and <b>Web API key</b> let the tracker read your achievements, points and playtime. Enter them
      in the wizard, or tap <b>Connect</b> in the tracker. The key is on the settings page of your RetroAchievements
      account.</p>
      <div class="hp-note">Your login and API keys stay on your device. They are never included in cloud sync or in
      exported backups.</div>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'controls', title: 'Controls', sections: [
    { h: 'The controller', html: `
      <div data-diagram="thor"></div>
      <p>Buttons in this booklet are named by the letters <b>printed on the device</b>:</p>
      <ul>
        <li><span class="hk">B</span> is the bottom button. It confirms.</li>
        <li><span class="hk">A</span> is the right button. It goes back.</li>
        <li><span class="hk">X</span> is the top button.</li>
        <li><span class="hk">Y</span> is the left button.</li>
      </ul>
      <div class="hp-note">Android itself names these the other way round. If you'd rather confirm with
      <span class="hk">A</span>, open the menu, then <b>Gamepad Config</b>, and switch on <b>Swap A and B</b>.</div>` },
    { h: 'Everywhere', html: `
      <table class="hp-keys">
        <tr><td><span class="hk sh">D-pad</span> <span class="hk sh">Left stick</span></td><td>Move the highlight. The first press only shows where the highlight is.</td></tr>
        <tr><td><span class="hk sh">Right stick</span></td><td>Scroll quickly. The further you push, the faster it goes.</td></tr>
        <tr><td><span class="hk">B</span></td><td>Confirm: open, press or pick what is highlighted</td></tr>
        <tr><td><span class="hk">A</span></td><td>Go back: close the window, panel or menu that is open</td></tr>
        <tr><td><span class="hk sh">Select</span></td><td>Open or close the menu</td></tr>
        <tr><td><span class="hk">Y</span></td><td>Refresh (the same as pulling down)</td></tr>
        <tr><td><span class="hk">X</span></td><td>Jump to the search box of the Library, Backlog or Apps tab. In a game's profile, Play.</td></tr>
        <tr><td><span class="hk sh">L1</span> <span class="hk sh">R1</span></td><td>Previous / next console</td></tr>
        <tr><td><span class="hk sh">L2</span> <span class="hk sh">R2</span></td><td>Previous / next tab</td></tr>
      </table>
      
      <div class="hp-tip">Touching the screen hides the highlight. Press any direction to bring it back.</div>` },
    { h: 'Tabs and the console bar', html: `
      <table class="hp-keys">
        <tr><td><span class="hk sh">Left</span> <span class="hk sh">Right</span> on the tab headings</td><td>Switch tab straight away</td></tr>
        <tr><td><span class="hk sh">Left</span> <span class="hk sh">Right</span> on the console bar</td><td>Change console straight away</td></tr>
        <tr><td><span class="hk">B</span> on a console</td><td>Pick it and jump to its first game</td></tr>
        <tr><td><span class="hk">A</span> while reordering consoles</td><td>Finish reordering</td></tr>
      </table>
      <p>Tabs and consoles wrap around: going past the last one brings you back to the first.</p>` },
    { h: 'Game Library and Backlog', html: `
      <table class="hp-keys">
        <tr><td><span class="hk">X</span></td><td>Search your games (opens the keyboard)</td></tr>
        <tr><td><span class="hk">B</span> on a game</td><td>Open its profile</td></tr>
        <tr><td><span class="hk">B</span> on a column heading</td><td>Sort by that column (list view)</td></tr>
        <tr><td><span class="hk">A</span> in the search box</td><td>Close the keyboard</td></tr>
      </table>
      <p><b>One game per row:</b> pinch the Library or Backlog down to a single game per row. Then
      <span class="hk sh">Left</span> and <span class="hk sh">Right</span> go to the previous or next game, the top screen
      shows the highlighted game, and <span class="hk">X</span> starts it straight away.</p>` },
    { h: 'In a game profile', html: `
      <table class="hp-keys">
        <tr><td><span class="hk">X</span></td><td>Play the game</td></tr>
        <tr><td>Hold <span class="hk">B</span> on Play</td><td>Choose another copy or a patched copy of the game</td></tr>
        <tr><td><span class="hk">A</span></td><td>Leave full screen first, then close the open section, then close the profile</td></tr>
        <tr><td><span class="hk">Y</span></td><td>Refresh the profile</td></tr>
      </table>` },
    { h: 'Reading a game guide', html: `
      <table class="hp-keys">
        <tr><td><span class="hk sh">L2</span> <span class="hk sh">R2</span></td><td>Smaller / larger text</td></tr>
        <tr><td><span class="hk">X</span></td><td>Search the guide</td></tr>
        <tr><td><span class="hk">Y</span></td><td>Hide or show the menu for a full-screen read</td></tr>
        <tr><td><span class="hk sh">Right stick</span></td><td>Scroll</td></tr>
        <tr><td><span class="hk">A</span></td><td>Close search, bookmarks or the text panel, then the guide</td></tr>
      </table>` },
    { h: 'Reading a game manual', html: `
      <table class="hp-keys">
        <tr><td><span class="hk sh">L1</span> <span class="hk sh">R1</span></td><td>Page up / page down</td></tr>
        <tr><td><span class="hk sh">L2</span> <span class="hk sh">R2</span></td><td>Zoom out / zoom in</td></tr>
        <tr><td><span class="hk">A</span></td><td>Close the manual</td></tr>
      </table>` },
    { h: 'Choosing box art', html: `
      <table class="hp-keys">
        <tr><td><span class="hk sh">Left</span> <span class="hk sh">Right</span></td><td>Browse other covers for the game</td></tr>
        <tr><td><span class="hk">B</span></td><td>Use this one</td></tr>
        <tr><td><span class="hk">A</span></td><td>Close the viewer</td></tr>
      </table>` },
    { h: 'In this Help booklet', html: `
      <table class="hp-keys">
        <tr><td><span class="hk">X</span></td><td>Search the booklet</td></tr>
        <tr><td><span class="hk sh">L1</span> <span class="hk sh">R1</span></td><td>Previous / next chapter</td></tr>
        <tr><td><span class="hk sh">L2</span> <span class="hk sh">R2</span></td><td>Smaller / larger text</td></tr>
        <tr><td><span class="hk">Y</span></td><td>Hide or show the top bar for a full-screen read</td></tr>
        <tr><td><span class="hk">A</span></td><td>Close the search, then Help</td></tr>
      </table>` },
    { h: 'Touch gestures', html: `
      <table class="hp-keys">
        <tr><td>Pull down</td><td>Refresh your data (not the whole page)</td></tr>
        <tr><td>Swipe left or right on a profile</td><td>Close the profile</td></tr>
        <tr><td>Pinch on a tab</td><td>Change how many tiles fit in a row: game tiles 2 to 6 (or 1 in the Library and
        Backlog), the Beaten tab 2 to 10, and the Apps tab</td></tr>
        <tr><td>Pinch on achievement tiles</td><td>3 to 6 tiles in a row</td></tr>
        <tr><td>Hold a console</td><td>Reorder the console bar: drag a console to move it, tap its name to rename it,
        then tap OK</td></tr>
        <tr><td>Hold a Beaten tile</td><td>Show the game's title</td></tr>
        <tr><td>Hold an app</td><td>Choose which screen the app opens on</td></tr>
        <tr><td>Tap the top screen's fan art</td><td>Load every fan art picture for the game, then swipe to browse them</td></tr>
      </table>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'screens', title: 'The Screens', sections: [
    { h: 'The header and your profile', html: `
      <p>The top of the tracker shows your RetroAchievements profile: your points, the achievements you've unlocked and
      how many of your started games you've beaten. These follow the mode you're in (Casual or Hardcore).</p>
      <p>On devices without an Android status bar, the clock and a battery made of hearts sit at the top. You can turn
      them off in Display Options.</p>
      <p>On a two-screen device the header and the menu are shown on the top screen while it shows no game art.</p>` },
    { h: 'Last Played', html: `
      <ul>
        <li><b>Recently played:</b> your latest games, newest first. A game started from the launcher jumps to the
        front straight away.</li>
        <li><b>Achievement Tracker:</b> points earned and achievements unlocked in the last 24 hours, 3 days, week and
        month, and in the current year.</li>
        <li><b>Recent unlocks:</b> your latest achievements.</li>
      </ul>` },
    { h: 'Game Library', html: `
      <p>Every game you've played. The search box, the <b>Hide Beaten</b> button and the game count sit at the top.</p>
      <p>In <b>List View</b>, tap a column heading to sort by it, and tap again to sort the other way. The Game column
      has a third tap that goes back to the usual order (your three most recently played games, then A to Z).</p>
      <figure class="hp-shot"><img src="help/img/library-list.webp" alt="The Game Library in List View, with the PlayStation chosen on the console bar" loading="lazy"><figcaption>The Game Library in List View, with the PlayStation chosen on the console bar</figcaption></figure>
      <p>In <b>Tile View</b> the games show as covers, or as cartridges and discs with Cart view.</p>
      <figure class="hp-shot"><img src="help/img/library-tiles.webp" alt="Tile View with Cart view: each game shows its real cartridge" loading="lazy"><figcaption>Tile View with Cart view: each game shows its real cartridge</figcaption></figure>` },
    { h: 'Backlog', html: `
      <figure class="hp-shot"><img src="help/img/add-game.webp" alt="The Add a game window" loading="lazy"><figcaption>The Add a game window</figcaption></figure>
      <p>The games you've added but haven't played yet. Use <b>+ Add game</b> to add more
      (see <a href="#hp-adding">Adding and Tracking Games</a>). Play a game and it moves to the Game Library by itself.</p>` },
    { h: 'Beaten', html: `
      <figure class="hp-shot"><img src="help/img/beaten.webp" alt="The Beaten tab: every game you beat this year" loading="lazy"><figcaption>The Beaten tab: every game you beat this year</figcaption></figure>
      <p>Every game you've beaten, grouped by year. Mastered games get a <b>Mastered</b> pill. Hold a cover to see the
      game's title, and pinch to fit more covers in a row.</p>` },
    { h: 'Apps', html: `
      <figure class="hp-shot"><img src="help/img/apps.webp" alt="The Apps tab showing your Favourites" loading="lazy"><figcaption>The Apps tab showing your Favourites</figcaption></figure>
      <p>Your installed Android apps, on devices where the launcher runs. Tap the star on an app to keep it in your
      <b>Favourites</b>, which show by default. <b>All apps</b> shows everything.</p>
      <p>Apps open on the top screen when there are two. Hold an app to choose its screen, and the choice is remembered.
      While a game is running, apps open on the bottom screen instead.</p>` },
    { h: 'The console bar', html: `
      <p>The Library, Backlog and Beaten tabs share a console bar for showing one system at a time. It can show
      console <b>Logos</b> or <b>Names</b> (Display Options, Console bar).</p>
      <p>Hold a console to put the bar in your own order or rename a console. Your order is shared by all three tabs.</p>` },
    { h: 'The top screen', html: `
      <figure class="hp-shot"><img src="help/img/top-screen.webp" alt="The top screen with fan art and the floating cartridge" loading="lazy"><figcaption>The top screen with fan art and the floating cartridge</figcaption></figure>
      <p>While you browse, the top screen shows the open game's <b>fan art</b>. Tap it to load every fan art picture
      for the game and swipe to choose one. When you leave the game, the picture on show is kept and the rest are
      deleted to save space.</p>
      <p>With a profile open, the game's <b>cartridge or disc floats</b> in the corner. When you press Play it goes in,
      an old TV switches on, and the game starts. Both can be turned off in Display Options.</p>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'profile', title: 'Game Profiles', sections: [
    { h: 'What a profile shows', html: `
      <figure class="hp-shot"><img src="help/img/profile.webp" alt="A game profile: fan art and cartridge on top, the profile underneath, with the review score on the cover" loading="lazy"><figcaption>A game profile: fan art and cartridge on top, the profile underneath, with the review score on the cover</figcaption></figure>
      <p>Tap any game to open its profile: the cover, genre, release date, developer and publisher, your progress,
      its status (beaten or mastered, and when) and the playtime. Tap <b>⟳</b> next to the playtime to check it again
      with RetroAchievements.</p>
      <p>While a game started from the launcher is running, the open profile checks for new achievements every 10
      seconds, and the playtime keeps counting up.</p>` },
    { h: 'Play on this device', html: `
      <figure class="hp-shot"><img src="help/img/profile-play.webp" alt="Play on this device, with the emulator button beside it" loading="lazy"><figcaption>Play on this device, with the emulator button beside it</figcaption></figure>
      <p><b>Play on this device</b> starts the game in its emulator, on the top screen. If the game isn't found in
      your ROM folders, the button says <b>Not located on this device</b>. The app also tries the game's other
      regional names before it gives up.</p>
      <ul>
        <li><b>Hold Play</b> to choose another copy of the game, or a patched copy made in ROM Hacks.</li>
        <li>For <b>multi-disc games</b> the app asks which disc to start, or offers a playlist (.m3u) so the emulator can
        switch discs during the game.</li>
        <li>The <b>controller button</b> next to Play chooses an emulator for this game only. Other games keep the
        system's setting.</li>
      </ul>` },
    { h: 'Android Ports Available', html: `
      <p>Some games have a native Android version (a recompilation or a reimplementation). When one can run on your
      device, the profile has an <b>Android Ports Available</b> section. Open it to download and play the port. When a
      newer version of an installed port is out, an <b>Update available</b> button appears.</p>` },
    { h: 'Review score', html: `
      <p>The badge on the cover is an average review score from IGDB (critics and players), ScreenScraper, LaunchBox
      and, for PC games, Steam. Tap it to see each source's score and number of votes, with a <b>Look up again</b>
      button. A <b>*</b> means the score is based on only a few reviews.</p>` },
    { h: 'Choosing box art', html: `
      <p>Tap the cover to see it full screen. Swipe left or right (or use the arrows) to browse other covers for the
      game, then press <b>Use this one</b>. <b>Automatic</b> goes back to the app's own choice. Covers from other
      regions are listed too.</p>` },
    { h: 'Achievements', html: `
      <p><b>View Achievements</b> lists every achievement in the game, unlocked or not.</p>
      <ul>
        <li><b>Reorder</b> puts them in your own order (<b>Reset order</b> undoes it).</li>
        <li>The button next to Reorder switches to <b>tiles</b>. Pinch to change how many fit in a row; at 3 per row
        each tile also shows its name and points. Tap a tile to see its name, unlock time and description. Unlocked
        tiles have a gold frame for hardcore and teal for casual.</li>
        <li>The <b>expand icon</b> on the section's bar fills the screen with it. Game Details and View Beaten
        Achievements have one too.</li>
      </ul>
      
      <figure class="hp-shot"><img src="help/img/achievements.webp" alt="Achievements in tile view, full screen" loading="lazy"><figcaption>Achievements in tile view, full screen</figcaption></figure>
      <p><b>View Beaten Achievements</b> shows the ones that count towards beating the game. <b>Subsets</b> lists any
      extra achievement sets for the game.</p>` },
    { h: 'Game Details', html: `
      <figure class="hp-shot"><img src="help/img/game-details.webp" alt="Game Details, full screen" loading="lazy"><figcaption>Game Details, full screen</figcaption></figure>
      <p>Other players' average playtime, your own times, a write-up about the game (from ES-DE, LaunchBox or IGDB) with
      <b>See more</b> for a screenshot, and the game's <b>manual</b> when one can be found. Manuals open in a built-in
      viewer and are saved on the device.</p>` },
    { h: 'Game Guide', html: `
      <figure class="hp-shot"><img src="help/img/guide.webp" alt="A text guide open in the reader" loading="lazy"><figcaption>A text guide open in the reader</figcaption></figure>
      <p>Finds text guides for the game from GameFAQs (through archive.org) and RetroAchievements' own guides. You can
      also import your own guide file (PDF, text or HTML), or find a walkthrough video on YouTube and paste its link
      to keep it with the game.</p>
      <p>The guide reader has <b>search</b>, <b>bookmarks</b>, and <b>Aa</b> for text size, font and theme. The menu
      can be hidden for a full-screen read.</p>
      <div class="hp-tip">Pick a monospace font in Aa to keep ASCII maps and tables lined up.</div>` },
    { h: 'Need Cheats? and Search YouTube', html: `
      <p><b>Need Cheats?</b> opens the game's cheats page on GameFAQs. <b>Search YouTube</b> looks the game up on
      YouTube.</p>` },
    { h: 'ROM Hacks', html: `
      <figure class="hp-shot"><img src="help/img/rom-hacks.webp" alt="The ROM Hacks section" loading="lazy"><figcaption>The ROM Hacks section</figcaption></figure>
      <p>Find patches for the game on RAPatches, or use your own patch file. BPS, IPS, UPS, PPF, APS and xdelta
      patches are supported, disc images included. The patched game is saved as a copy, so the original stays as it
      is. Hold Play to start a patched copy.</p>` },
    { h: 'Play log', html: `
      <p>For games on consoles with no emulator to count time (PlayStation 5, Xbox Series X|S, Nintendo Switch 2 and
      PC), open <b>Play log</b> and add each session by hand: the date played and the time in hours and minutes.
      The total becomes the game's playtime, and your newest session decides where it shows in Last Played.</p>` },
    { h: 'Games that are not on RetroAchievements', html: `
      <p>Games added from IGDB have a simpler profile. Tick <b>Now Playing</b> to move one to the Library, and
      <b>Mark as beaten</b> when you finish it. If the game is added to RetroAchievements later, use
      <b>Link to RetroAchievements</b> to connect it. Playtime before then is kept.</p>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'adding', title: 'Adding and Tracking Games', sections: [
    { h: 'How games move through the app', html: `
      <ol>
        <li>Add a game to your <b>Backlog</b>.</li>
        <li>Open it and press <b>Play</b>.</li>
        <li>The game moves to your <b>Game Library</b> as soon as it starts.</li>
        <li>Beat it and it shows on the <b>Beaten</b> tab under that year.</li>
      </ol>
      <p>Games you play outside the launcher show up too, once RetroAchievements has your progress.</p>` },
    { h: 'Adding games', html: `
      <p>Go to <b>Backlog</b> and press <b>+ Add game</b>.</p>
      <ul>
        <li><b>Search:</b> pick the system, type the title and press Search. Tick several results to add them all at
        once with <b>Add selected</b>.</li>
        <li><b>Systems RetroAchievements doesn't track:</b> the game is found on IGDB instead. It won't count towards
        your RetroAchievements stats.</li>
        <li><b>From your ROM files:</b> <b>Pick ROM files…</b> adds the games you choose. <b>Add all from a system…</b>
        adds every game in a system folder. Each one is matched to RetroAchievements by its title.</li>
      </ul>` },
    { h: 'Removing a game', html: `
      <p>Games you added by hand have a small <b>✕</b>. In a list it's at the end of the game's row (press
      <span class="hk sh">Right</span> on the game to reach it with the controller); on a tile it's for touch only.</p>` },
    { h: 'Casual and Hardcore', html: `
      <p>Open the menu, then <b>RetroAchievements</b>, then <b>Switch to Hardcore Mode</b> (or back to Casual). This
      changes which points, awards and unlocks the tracker shows. It doesn't change how your emulators run.</p>` },
    { h: 'Playtime', html: `
      <p>For RetroAchievements games, playtime comes from RetroAchievements. For other games, the launcher counts the
      time the emulator is open itself. Consoles with no emulator use the Play log.</p>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'emulators', title: 'Emulators', sections: [
    { h: 'Supported emulators', html: `
      <p>RetroArch and its cores cover most systems. These standalone emulators are supported as well:</p>
      <p class="hp-cols">Dolphin · Dolphin CS · DuckStation · PPSSPP · Mupen64Plus AE · Joey64 · Xnes3D+ · ARMSX2 ·
      NetherSX2 / AetherSX2 · WatermelonDS · Azahar · Eden · Eden Nightly · Cemu · Vita3K · Vita3K+ · hakuX · ARMSX3 ·
      XenDroid · aPS3e · Flycast · GBA DS</p>
      <p>The setup wizard (step 4, <b>Your Emulators</b>) only lists the systems you have ROMs for, each with the
      emulators and RetroArch cores that are installed.</p>` },
    { h: 'One emulator for one game', html: `
      <p>Press the controller button next to Play in a game's profile and pick an emulator. Only that game uses it.
      Choose <b>Default</b> to go back to the system's setting.</p>` },
    { h: 'Your own launch commands', html: `
      <p>For an emulator the app doesn't know, or to start a console a different way, add a launch command in
      <b>Your Emulators</b>. Commands use ES-DE's format. Tick <b>Shows both screens itself</b> for emulators that draw
      on both screens.</p>` },
    { h: 'Xnes3D+', html: `
      <p>Xnes3D+ plays NES games in 3D, and the launcher can start games in it directly. Many games have a 3D profile,
      and Smart 3D works out the 3D for games without one. For 3D profiles, ask on the community Discord.</p>` },
    { h: 'After a game closes', html: `
      <p>With <b>Back to tracker after a game</b> on, the top screen goes back to the tracker's art when you quit the
      emulator, and your playtime and progress are brought up to date. This needs <b>usage access</b>, which is only
      used to see whether the emulator is still open. Turn it on in Launcher Settings.</p>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'display', title: 'Display Options', sections: [
    { h: 'Text size and theme', html: `
      <figure class="hp-shot"><img src="help/img/display-options.webp" alt="Display Options, opened from the menu" loading="lazy"><figcaption>Display Options, opened from the menu</figcaption></figure>
      <p><b>Text size</b> makes all the text smaller or larger (A− and A+), and Reset puts it back to 100%.</p>
      <p><b>Theme</b> changes the colours and fonts: <b>Retro</b> (the default), <b>Nintendo</b>, <b>Playstation</b> or
      <b>Xbox</b>.</p>` },
    { h: 'Console bar and game view', html: `
      <ul>
        <li><b>Console bar:</b> show console <b>Logos</b> or <b>Names</b>.</li>
        <li><b>Game view:</b> <b>List View</b> (a sortable table) or <b>Tile View</b> (covers).</li>
        <li><b>Tile View Options</b> (Tile View only): <b>Art view</b> shows the cover, <b>Cart view</b> shows the game's
        real cartridge or disc. Games without a cartridge picture get one made from the console's blank shell and the
        cover.</li>
      </ul>` },
    { h: 'Switches', html: `
      <ul>
        <li><b>Clock and battery:</b> the time and a battery of hearts at the top of the screen.</li>
        <li><b>Tracker on top screen</b> (two-screen devices): the tracker sits on the top screen and the fan art,
        cartridge and header go on the bottom one while you browse. When a game starts, the screens swap back so the
        game plays on top, and they swap again when it closes.</li>
        <li><b>Floating cartridge:</b> the game's cartridge or disc floats on the top screen while its profile is open.</li>
        <li><b>Start-up animation:</b> when a game starts, its cartridge or disc goes in, then an old TV switches on.</li>
      </ul>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'settings', title: 'Launcher Settings', sections: [
    { h: 'Opening Launcher Settings', html: `
      <p>Open the menu and choose <b>Launcher Settings</b>. It opens the setup wizard again with your current choices,
      so you can change your accounts, folders, emulators and screens.</p>` },
    { h: 'On the first page', html: `
      <ul>
        <li><b>File access:</b> needed to find your games and artwork.</li>
        <li><b>Back to tracker after a game:</b> needs usage access (see <a href="#hp-emulators">Emulators</a>).</li>
        <li><b>Home app:</b> <b>Set as home app</b> makes the launcher open when you press Home or start the device.
        <b>Change home app</b> switches back.</li>
      </ul>
      <div class="hp-note">While the launcher is your home app, <b>Close App</b> is hidden from the menu, since Android
      would only open it again.</div>` },
    { h: 'Screens and display size', html: `
      <p>Under <b>Your screens</b>: choose the top screen (Automatic picks the screen the app is not on), tick
      <b>Use one screen only</b> to keep the tracker and game art on one screen, and pick a <b>Display size</b>.
      Compact fits the most.</p>` },
    { h: 'Updates', html: `
      <p>When a new version is released, the launcher offers to download and install it the next time it starts.</p>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'data', title: 'Data and Cloud Sync', sections: [
    { h: 'Cloud sync', html: `
      <figure class="hp-shot"><img src="help/img/data.webp" alt="The Data window" loading="lazy"><figcaption>The Data window</figcaption></figure>
      <p>Open the menu, then <b>Data</b>. <b>Cloud sync</b> keeps the launcher the same on every device signed in to
      the same Google account. Your games are kept in a hidden folder in your own Google Drive that only this app can
      see.</p>
      <p>If both devices have changed, you're asked which copy to keep, and a safety backup is made first.</p>
      <div class="hp-note">Logins and API keys are never synced, and neither are settings that belong to one device,
      such as Tracker on top screen.</div>` },
    { h: 'Backups on this device', html: `
      <p>A backup is made automatically each day you use the app, and the last 3 days are kept. <b>Back up now</b>
      makes one straight away and <b>List all backups</b> lets you go back to one. Backups include the launcher's
      settings too (ROM folders, emulator picks, launch commands and picked art), but never your logins or keys.</p>` },
    { h: 'Import and export', html: `
      <p><b>Download backup (.json)</b> saves everything the app stores to a file, to keep or move to another device.
      <b>Choose backup file…</b> loads one. Anything already on the device with the same name is replaced.</p>` },
  ]},

  // ------------------------------------------------------------------------------------------------------------
  { id: 'more', title: 'Social, About and Troubleshooting', sections: [
    { h: 'Social', html: `
      <p>The people you follow on RetroAchievements, with what they're playing now. Tap someone to see their recent
      unlocks.</p>` },
    { h: 'About', html: `
      <p>The app's version, links to GitHub and the community Discord, an email address for questions, and credits.</p>` },
    { h: 'Play says "Not located on this device"', html: `
      <p>The game's ROM wasn't found. Check that its ROM folder is added in Launcher Settings, that the system folder
      has a recognised name (like <code>snes</code> or "Super Nintendo"), and that the file name is close to the game's
      title.</p>` },
    { h: 'The top screen doesn’t come back after a game', html: `
      <p>Allow usage access in Launcher Settings (<b>Back to tracker after a game</b>).</p>` },
    { h: 'A game has no art', html: `
      <p>Art is fetched game by game as you open profiles. With ES-DE, check that its data folder is chosen and that
      the game was scraped there. Tap the top screen to look for more fan art.</p>` },
    { h: 'My achievements haven’t updated', html: `
      <p>Pull down or press <span class="hk">Y</span> to refresh. RetroAchievements can take a few minutes to add
      playtime.</p>` },
    { h: 'Text is too small or too large', html: `
      <p>Use <b>Text size</b> in Display Options, or <b>Display size</b> in Launcher Settings.</p>` },
    { h: 'Getting more help', html: `
      <p>Ask in the community Discord (<a href="https://discord.gg/6dgZA4yD2" target="_blank" rel="noopener">discord.gg/6dgZA4yD2</a>)
      or email <a href="mailto:ginsretrogamehub@gmail.com">ginsretrogamehub@gmail.com</a>.</p>` },
  ]},

  ]
};
