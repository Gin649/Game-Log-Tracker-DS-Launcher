// Glue between the tracker and the Android app (window.ThorBridge).
const thorBridge = window.ThorBridge || null;

// The WebView has no navigator.getBattery(), which the battery readout needs.
if(thorBridge && typeof navigator.getBattery !== 'function'){
  const battery = new EventTarget();
  battery.level = 1;
  battery.charging = false;
  const read = () => {
    try{
      const b = JSON.parse(thorBridge.battery());
      const before = battery.level;
      battery.level = b.level;
      battery.charging = !!b.charging;
      if(before !== battery.level) battery.dispatchEvent(new Event('levelchange'));
    }catch(e){}
  };
  read();
  setInterval(read, 30000);
  navigator.getBattery = () => Promise.resolve(battery);
}

let thorViewingInfo = null; // the game whose profile is open, as the top screen was told
function thorViewing(info){
  thorViewingInfo = info;
  try{ thorBridge.setViewing(JSON.stringify(info)); }catch(e){}
}

function thorClearViewing(){
  thorViewingInfo = null;
  try{ thorBridge.clearViewing(); }catch(e){}
}

// Games started from here. When the app is back in front, one that is still a Backlog entry has now
// been played, so it moves to the Library even if RetroAchievements has no playtime for it.
const thorLaunched = new Set();
// The game of the session running now, and its RetroAchievements playtime (in hours) when it started, so its
// profile can add the time played since (thorLivePlaytime).
let thorSession = null; // { id: '123', baseHours: number | null }
function thorMarkLaunched(gameId){
  if(gameId) thorLaunched.add(Number(gameId));
  if(gameId){
    const known = typeof estHoursCache !== 'undefined' ? estHoursCache[gameId] || estHoursCache[Number(gameId)] : null;
    thorSession = { id: String(gameId), baseHours: known && known.real && known.hours != null ? Number(known.hours) : null };
  }
}

async function thorPromoteLaunched(){
  const ids = [...thorLaunched];
  thorLaunched.clear();
  for(const id of ids){
    const entry = libraryData.find(g => Number(g.GameID) === id);
    if(!entry){
      // an RA game that isn't in the library yet (one with no achievements, opened from Recently played): playing it adds it
      if(id > 0 && typeof addLaunchedRealGame === 'function'){
        try{
          const data = await raFetch('API_GetGameInfoAndUserProgress.php', { g: id, a: 1 });
          if(data && (data.Title || data.ID)) addLaunchedRealGame(id, data);
        }catch(e){}
      }
      continue;
    }
    if(!entry.manual || entry.customConsole) continue;
    try{
      const data = await raFetch('API_GetGameInfoAndUserProgress.php', { g: id, a: 1 });
      if(data && (data.Title || data.ID)) await promoteManualGameToReal(id, data);
    }catch(e){}
  }
}

// A game has just started from here: move it out of the Backlog now, without waiting for it to close.
// An RA game is looked up and moved to the Library; a game RA doesn't list gets "Now Playing" ticked.
// When each game was last started from here (any game, RA or not), so Recently played can put it first at once.
function thorLaunchTimes(){
  try{ return JSON.parse(localStorage.getItem('glt-launch-times') || '{}') || {}; }catch(e){ return {}; }
}
function thorRecordLaunch(gameId){
  try{
    const t = thorLaunchTimes();
    t[String(gameId)] = new Date().toISOString();
    const keep = Object.entries(t).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 40);
    localStorage.setItem('glt-launch-times', JSON.stringify(Object.fromEntries(keep)));
  }catch(e){}
  try{ if(typeof recentGamesData !== 'undefined') renderRecentGames(recentGamesData); }catch(e){}
}

function thorStarted(card, gameId){
  thorRecordLaunch(gameId);
  thorMarkLaunched(gameId);
  thorPromoteLaunched();
  const entry = libraryData.find(g => Number(g.GameID) === Number(gameId) || g.GameID === gameId);
  // a game added by hand: remember when it was played, so it moves to the top of Recently played
  if(entry && entry.manual && typeof updateManualGame === 'function') updateManualGame(entry.GameID, { lastPlayed: new Date().toISOString() });
  if(entry && entry.manual && entry.customConsole && !entry.manualStarted && !entry.manualBeaten){
    const cb = card && card.querySelector('#manual-started-checkbox');
    if(cb && !cb.checked){
      cb.checked = true;
      cb.dispatchEvent(new Event('change')); // saves it and refreshes the status line
    }else if(!cb){
      updateManualStartedStatus(entry.GameID, true);
    }
  }
}

// Coming back to the app (after quitting a game) clears the "Starting…" line under the Play button.
window.thorResumed = function(){
  document.querySelectorAll('.thor-play-msg').forEach(m => { m.style.display = 'none'; m.textContent = ''; });
  thorPromoteLaunched();
  thorRefreshPlayed();
};
document.addEventListener('visibilitychange', () => { if(!document.hidden) window.thorResumed(); });

// While a game runs, every 10 seconds the open profile looks for new unlocks (see liveCheckProfile in gestures.js)
// and Last Played's time on this device is brought up to date. Only while the tracker is on screen, so a
// single-screen device stops when you are in the game. The same check catches the game closing when the tracker
// never left the screen (two screens), which is when the Library's playtime and last played are brought up to date.
// Last Played and the Library only redraw when something on them has actually changed.
function thorRefreshPlayed(library){
  try{ if(recentGamesData.length || libraryData.some(g => g.customConsole && g.lastPlayed)) renderRecentGames(recentGamesData); }catch(e){}
  try{ if(library !== false && libraryData.length) renderLibrary(); }catch(e){}
}
if(thorBridge){
  let wasRunning = false;
  let playTicks = 0;
  setInterval(() => {
    if(document.hidden) return;
    let running = false;
    try{ running = thorBridge.gameRunning(); }catch(e){}
    if(running && typeof window.liveCheckProfile === 'function') window.liveCheckProfile();
    if(running) thorRefreshPlayed(false);
    if(running) thorLivePlaytime(++playTicks % 6 === 0);
    else if(wasRunning){
      thorRefreshPlayed();
      if(typeof window.cloudSyncSoon === 'function') window.cloudSyncSoon(3000); // the game's playtime goes to the cloud
    }
    wasRunning = running;
  }, 10000);
}

// While a game runs, the open profile's Playtime keeps up, checked every 10 seconds. Time counted on this device
// (games RetroAchievements doesn't track) is read as it is. For RetroAchievements games, RA only adds to its
// playtime every few minutes, so the profile shows RA's total from when the game started plus the time played
// since, as counted here (ArtWatch), and RA's own number once it is ahead. RA is asked again once a minute (withRa).
let thorPlaytimeBusy = false;
function thorLivePlaytime(withRa){
  const card = document.getElementById('modal-card');
  const backdrop = document.getElementById('modal-backdrop');
  if(!card || !backdrop || !backdrop.classList.contains('open')) return;
  const info = thorViewingInfo;
  if(info && card.querySelector('#manual-playtime-val')) thorFillPlaytime(card, info.title || '', info.console || '');
  const valEl = card.querySelector('#modal-playtime-val');
  const idText = card.dataset.gameId;
  if(!valEl || !idText) return;
  const hit = libraryData.find(g => String(g.GameID) === idText) || recentGamesData.find(g => String(g.GameID) === idText);
  const gameId = hit ? hit.GameID : (/^\d+$/.test(idText) ? Number(idText) : idText);
  const show = (fresh) => {
    if(card.dataset.gameId !== idText) return;
    let entry = fresh;
    const session = thorSession && thorSession.id === idText ? thorSession : null;
    if(session){
      // The game playing now counts up from RA's real playtime when the game started, or from nothing for a game
      // RA has no playtime for yet (its first session), and shows RA's own number once that is ahead.
      const raHours = fresh && fresh.real && fresh.hours != null ? Number(fresh.hours) : 0;
      if(session.baseHours == null) session.baseHours = raHours;
      let played = 0;
      try{ played = Number(thorBridge.sessionSeconds()) || 0; }catch(e){}
      const hours = Math.max(raHours, session.baseHours + played / 3600);
      entry = { hours, beaten: false, real: true };
    }
    if(!entry || entry.hours == null) return;
    const text = formatDuration(entry);
    if(valEl.textContent !== text) valEl.textContent = text;
    const labelEl = card.querySelector('#modal-playtime-label');
    const label = entry.real ? 'Playtime' : (entry.beaten ? 'Time to beat' : 'Est. playtime');
    if(labelEl && labelEl.textContent !== label) labelEl.textContent = label;
  };
  // Between RA checks, the last answer plus the time played since.
  const last = typeof estHoursCache !== 'undefined' ? estHoursCache[gameId] : null;
  show(last || null);
  if(!withRa || thorPlaytimeBusy || typeof getEstimatedHours !== 'function') return;
  thorPlaytimeBusy = true;
  getEstimatedHours(gameId, true, true).then(show).catch(() => {}).finally(() => { thorPlaytimeBusy = false; });
}

// One game per row (pinch the Library or Backlog down to 1): the highlighted game shows on the top screen as its
// profile would, and X plays it. Leaving the single view, or a tile that isn't one, puts the top screen back,
// unless a profile is open, which tells the top screen itself.
let thorTileShown = null;
function thorTileInfo(tile){
  const id = tile && tile.dataset.gameId;
  if(!id) return null;
  const local = typeof findGameLocal === 'function' ? findGameLocal(/^\d+$/.test(id) ? Number(id) : id) : null;
  if(!local) return null;
  const img = tile.querySelector('img.art');
  return { gameId: String(id), title: local.Title || '', console: local.ConsoleName || '', art: img ? img.src : '', file: local.romPath || '' };
}
window.thorTileFocus = function(el){
  if(!thorBridge) return;
  const profileOpen = document.getElementById('modal-backdrop')?.classList.contains('open');
  if(profileOpen) return;
  const single = el && el.matches && el.matches('.tile-grid.cols-1 > .cart');
  if(single){
    const info = thorTileInfo(el);
    if(info && (!thorTileShown || thorTileShown.gameId !== info.gameId)){
      thorTileShown = info;
      thorViewing(info);
    }
  }else if(thorTileShown){
    thorTileShown = null;
    thorClearViewing();
  }
};
// X on a game in the single view: its profile's Play, without opening the profile (so discs, ports and messages
// all work the same): the profile is opened out of sight, Play pressed, and the profile closed again.
window.thorQuickPlay = function(tile){
  const id = tile && tile.dataset.gameId;
  if(!id || typeof openGameModal !== 'function') return;
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.classList.add('quick-play');
  openGameModal(/^\d+$/.test(id) ? Number(id) : id);
  let tries = 0;
  const press = () => {
    const btn = document.getElementById('modal-play-btn');
    if(btn){
      btn.click();
      setTimeout(() => {
        // A question (which disc) or an error shows the profile with it; a game that started closes it again.
        const msg = document.getElementById('modal-play-msg');
        const asking = document.querySelector('.app-pop');
        const failed = msg && msg.classList.contains('error') && msg.style.display !== 'none';
        backdrop.classList.remove('quick-play');
        if(!asking && !failed && typeof closeGameModal === 'function') closeGameModal();
        thorTileShown = null; // the profile told the top screen itself; the next highlight tells it again
      }, 400);
      return;
    }
    if(++tries < 40) setTimeout(press, 75);
    else backdrop.classList.remove('quick-play');
  };
  setTimeout(press, 75);
};

function thorPlayButtonHtml(){
  if(!thorBridge) return '';
  return `<div class="play-row"><button class="btn-view-achievements btn-play-thor" id="modal-play-btn"><span class="arrow">▶</span> Play on this device</button>
    <button class="btn-emu" id="modal-emu-btn" aria-label="Emulator for this game" title="Emulator for this game"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7.5 6h9A5.5 5.5 0 0 1 22 11.5v2a4.5 4.5 0 0 1-8 2.8 1.6 1.6 0 0 0-1.2-.5h-1.6a1.6 1.6 0 0 0-1.2.5A4.5 4.5 0 0 1 2 13.5v-2A5.5 5.5 0 0 1 7.5 6zM7 9v1.5H5.5V12H7v1.5h1.5V12H10v-1.5H8.5V9H7zm9.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg></button></div>
      <div class="thor-play-msg" id="modal-play-msg" style="display:none;"></div>
      <div id="modal-port"></div>`;
}

// Tells the app which game is open (for the top-screen art) and wires the Play button.
// Other names IGDB knows a game by, joined the way the matcher reads RetroAchievements' own "Name | Other name".
function thorMatchTitle(title, alts){
  return alts && alts.length ? title + ' | ' + alts.join(' | ') : title;
}

// The time played on this device (for games RetroAchievements has no playtime for), in the profile's Playtime row.
function thorFillPlaytime(card, title, consoleName){
  try{
    const sec = (thorBridge && thorBridge.playtime) ? Number(thorBridge.playtime(title, consoleName)) : 0;
    const el = card.querySelector('#manual-playtime-val');
    if(el && sec >= 60){
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      el.textContent = (h ? h + 'h ' : '') + m + 'm';
      el.style.color = 'var(--gold)';
    }
  }catch(e){}
}

function thorWirePlay(card, gameId, title, consoleName, artUrl, romPath){
  if(!thorBridge) return;
  const info = { gameId: String(gameId), title: title, console: consoleName, art: artUrl || '', file: romPath || '' };
  thorViewing(info);

  const btn = card.querySelector('#modal-play-btn');
  const msg = card.querySelector('#modal-play-msg');
  if(!btn || !msg) return;
  if(typeof thorWirePorts === 'function') thorWirePorts(card, title, consoleName);
  const play = (disc) => {
    let res;
    try{ res = JSON.parse(thorBridge.launch(JSON.stringify(Object.assign({}, info, { disc: disc || '' })))); }
    catch(e){ res = { ok: false, message: 'Could not reach the launcher.' }; }
    if(res.needDisc){
      thorChoice('Which disc?', 'This emulator plays one disc at a time. Swap discs from its own menu.',
        res.discs.map((n, i) => [n.replace(/\.[^.]+$/, ''), () => play('pick:' + i)]));
      return;
    }
    if(res.needM3u){
      thorChoice('Multi-disc game', 'This game has ' + res.discs + ' discs. A playlist (.m3u) lets the emulator switch discs in-game.', [
        ['Create playlist and play', () => play('create')],
        ['Play disc 1 only', () => play('first')],
      ]);
      return;
    }
    if(res.ok) thorStarted(card, gameId);
    msg.style.display = 'block';
    msg.classList.toggle('error', !res.ok);
    msg.textContent = res.message || (res.ok ? 'Starting the game…' : 'Could not start the game.');
  };
  // Play opens the original game, from the preferred ROM folder when it is in more than one. The other copies and
  // patched copies made in ROM Hacks are a choice: hold Play (by touch, or the confirm button) to pick one.
  const patchedCopies = () => {
    try{ return typeof thorBridge.patchedList === 'function' ? (JSON.parse(thorBridge.patchedList(JSON.stringify(info))) || []) : []; }
    catch(e){ return []; }
  };
  const playFile = (path) => {
    let res;
    try{ res = JSON.parse(thorBridge.launchFile(path)); }catch(e){ res = { ok: false, message: 'Could not reach the launcher.' }; }
    if(res.ok) thorStarted(card, gameId);
    msg.style.display = 'block';
    msg.classList.toggle('error', !res.ok);
    msg.textContent = res.message || (res.ok ? 'Starting the game…' : 'Could not start the game.');
  };
  const chooseCopy = () => {
    const list = patchedCopies();
    if(!list.length || btn.disabled) return false;
    const main = list.find(c => c.kind === 'main');
    const others = list.filter(c => c.kind === 'copy');
    const patched = list.filter(c => c.kind !== 'main' && c.kind !== 'copy'); // older builds sent no kind: all patched
    const where = (c) => c.where ? ' (' + c.where + ')' : '';
    let note;
    if(others.length && patched.length) note = 'Play opens the copy in your preferred ROM folder. Pick another copy, or a patched copy made in ROM Hacks.';
    else if(others.length) note = 'This game is in more than one ROM folder. Play opens the copy in your preferred folder.';
    else note = 'Play opens the original game. These are the patched copies made from it in ROM Hacks.';
    const choices = [[main ? 'Original game' + where(main) : 'Original game', () => play('')]]
      .concat(others.map(c => [c.name + where(c), () => playFile(c.path)]))
      .concat(patched.map(c => [c.name, () => playFile(c.path)]));
    thorChoice('Which one?', note, choices);
    return true;
  };
  let holdTimer = null, held = false;
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  btn.addEventListener('pointerdown', () => {
    held = false; // a new press: an earlier hold whose tap never arrived must not swallow this one
    stopHold();
    holdTimer = setTimeout(() => { holdTimer = null; held = chooseCopy(); }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stopHold));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('padhold', chooseCopy); // the controller's confirm button held down (see gamepad.js)
  btn.addEventListener('click', () => {
    if(held){ held = false; return; } // the tap that ends a hold
    play('');
  });
  setTimeout(() => {
    const list = card.isConnected ? patchedCopies() : [];
    if(!list.length) return;
    btn.setAttribute('data-hold', '1');
    const hasCopies = list.some(c => c.kind === 'main');
    if(msg.style.display === 'none'){ msg.style.display = 'block'; msg.textContent = hasCopies ? 'Hold Play to choose another copy.' : 'Hold Play to choose a patched copy.'; }
  }, 0);

  // No ROM for this game on the device: say so instead of offering Play.
  const emuBtn0 = card.querySelector('#modal-emu-btn');
  setTimeout(() => {
    let has = true;
    try{ has = typeof thorBridge.hasRom !== 'function' || thorBridge.hasRom(JSON.stringify(info)); }catch(e){}
    if(has || !card.isConnected) return;
    btn.disabled = true;
    btn.classList.add('no-rom');
    btn.innerHTML = 'Not located on this device';
    if(emuBtn0) emuBtn0.style.display = 'none';

    // Not found under the game's own name: try the other names IGDB has for it (regional and alternative titles).
    if(typeof getIgdbInfo !== 'function' || (typeof isHackTitle === 'function' && isHackTitle(title))) return;
    getIgdbInfo(title).then(g => {
      if(!g || !g.alts || !g.alts.length || !card.isConnected) return;
      let found = false;
      try{ found = thorBridge.hasRom(JSON.stringify(Object.assign({}, info, { alts: g.alts }))); }catch(e){}
      if(!found) return;
      info.alts = g.alts; // used by Play and the emulator choice from here on
      btn.disabled = false;
      btn.classList.remove('no-rom');
      btn.innerHTML = '<span class="arrow">\u25b6</span> Play on this device';
      if(emuBtn0) emuBtn0.style.display = '';
      thorFillPlaytime(card, thorMatchTitle(title, g.alts), consoleName);
    }).catch(() => {});
  }, 0);

  const emuBtn = card.querySelector('#modal-emu-btn');
  if(emuBtn) emuBtn.addEventListener('click', () => {
    let r;
    try{ r = JSON.parse(thorBridge.emuOptions(JSON.stringify(info))); }catch(e){ r = { ok: false, message: 'Could not reach the launcher.' }; }
    if(!r.ok){
      msg.style.display = 'block'; msg.classList.add('error');
      msg.textContent = r.message || 'Could not list emulators.';
      return;
    }
    const mark = v => (v === r.current ? '\u25cf ' : '');
    const rows = [[mark('') + 'Default for ' + r.system, () => thorSetEmu(info, '', msg)]];
    (r.options || []).forEach(o => rows.push([mark(o.value) + o.label, () => thorSetEmu(info, o.value, msg)]));
    thorChoice('Emulator for this game', 'Only this game uses it. Other games keep the system setting.', rows);
  });
}

function thorSetEmu(info, value, msg){
  let ok = false;
  try{ ok = thorBridge.setEmu(JSON.stringify(Object.assign({}, info, { value: value }))); }catch(e){}
  msg.style.display = 'block';
  msg.classList.toggle('error', !ok);
  msg.textContent = ok ? (value ? 'This game will now use the chosen emulator.' : 'This game uses the system default again.') : 'Could not save the choice.';
}

// A small list popup: rows of [label, action], plus Cancel.
function thorChoice(title, sub, rows){
  const old = document.getElementById('thor-choice'); if(old) old.remove();
  const e = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pop = document.createElement('div');
  pop.id = 'thor-choice';
  pop.className = 'app-pop';
  pop.innerHTML = '<div class="app-pop-card"><div class="app-pop-title">' + e(title) + '</div><div class="app-pop-sub">' + e(sub) + '</div>' +
    rows.map((r, i) => '<button class="btn-primary" data-i="' + i + '">' + e(r[0]) + '</button>').join('') +
    '<button class="btn-ghost" data-i="x">Cancel</button></div>';
  document.body.appendChild(pop);
  pop.addEventListener('click', (ev) => {
    if(ev.target === pop){ pop.remove(); return; }
    const b = ev.target.closest('button'); if(!b) return;
    pop.remove();
    if(b.dataset.i !== 'x') rows[+b.dataset.i][1]();
  });
}

// A WebView can't save blob downloads itself, so exports go to the app, which writes them to Downloads.
function thorSaveBlobUrl(url, name){
  fetch(url)
    .then(r => r.blob())
    .then(blob => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    }))
    .then(b64 => { thorBridge.saveFile(name, b64); })
    .catch(() => { alert('Could not save the file.'); });
}

if(thorBridge){
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    if(this.download && /^blob:/.test(this.href)){
      thorSaveBlobUrl(this.href, this.download);
      return;
    }
    return nativeClick.apply(this, arguments);
  };
}

// Older versions kept a copy of the keys in the tracker's storage (a plain-text file in shared storage). Move any
// key that exists only there into the app's private settings, then delete the copy.
async function thorSeedCredentials(){
  if(!thorBridge || typeof thorBridge.setRaCreds !== 'function') return;
  let cfg = null;
  try{ cfg = JSON.parse(thorBridge.getConfig()); }catch(e){ return; }
  if(!cfg) return;
  try{
    const r = await window.storage.get('ra-credentials', false).catch(() => null);
    if(r && r.value){
      if(!(cfg.raUser && cfg.raKey)){
        const old = JSON.parse(r.value);
        if(old && old.username && old.apiKey) thorBridge.setRaCreds(old.username, old.apiKey);
      }
      await window.storage.delete('ra-credentials', false);
    }
  }catch(e){}
  try{ await window.storage.delete('rawg-credentials', false); }catch(e){} // RAWG isn't used any more
}

function onDomReady(fn){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

// "Launcher settings" reopens the app's setup wizard.
onDomReady(() => {
  const b = document.getElementById('btn-thor-settings');
  if(!thorBridge || !b) return;
  b.style.display = '';
  b.addEventListener('click', () => { try{ thorBridge.openSettings(); }catch(e){} });
});

// Game art is found game by game as each profile opens (no "fetch all": it would use up the art sources'
// daily limits).

// Pins the hamburger menu button to the top right of the screen (see .thor-app in the stylesheet).
onDomReady(() => { if(thorBridge) document.body.classList.add('thor-app'); });

// "Exit app" closes the launcher completely. It's hidden while the launcher is the home app, since Android would
// only open it again; checked again on coming back, in case the home app was changed in Launcher settings.
onDomReady(() => {
  const b = document.getElementById('btn-thor-exit');
  if(!thorBridge || !b) return;
  const update = () => {
    let home = false;
    try{ home = !!(thorBridge.isHomeApp && thorBridge.isHomeApp()); }catch(e){}
    const want = home ? 'none' : '';
    if(b.style.display === want) return;
    b.style.display = want;
    if(typeof colorMenuItems === 'function') colorMenuItems(); // keep the gold/white stripes in step
  };
  update();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) update(); });
  window.addEventListener('focus', update);
  b.addEventListener('click', () => { try{ thorBridge.exitApp(); }catch(e){} });
  if(typeof colorMenuItems === 'function') colorMenuItems();
});

// Safety net: if a selection ever does appear outside a text box, drop it so the page never stays tinted.
document.addEventListener('selectionchange', () => {
  if(!thorBridge) return;
  const sel = window.getSelection && window.getSelection();
  if(!sel || sel.isCollapsed) return;
  const a = document.activeElement;
  if(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  sel.removeAllRanges();
});

// Display Options: the old-TV start-up animation on the top screen when a game starts.
(function(){
  const row = document.getElementById('startup-anim-row'), sw = document.getElementById('startup-anim-switch');
  if(!row || !sw || typeof thorBridge === 'undefined' || !thorBridge || typeof thorBridge.startupAnim !== 'function') return;
  row.style.display = '';
  const show = on => { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); };
  let on = true;
  try{ on = !!thorBridge.startupAnim(); }catch(e){}
  show(on);
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    show(on);
    try{ thorBridge.setStartupAnim(on); }catch(err){}
  });
})();

// Display Options: "Tracker on top screen" swaps the screens while you are in the menus (two-screen devices only).
// It is a setting of this device, kept by the app rather than the page, so cloud sync never carries it to a phone.
(function(){
  const row = document.getElementById('tracker-top-row'), sw = document.getElementById('tracker-top-switch');
  if(!row || !sw || typeof thorBridge === 'undefined' || !thorBridge || typeof thorBridge.trackerOnTop !== 'function') return;
  try{ if(!thorBridge.canSwapScreens()) return; }catch(e){ return; }
  row.style.display = '';
  const show = on => { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); };
  let on = false;
  try{ on = !!thorBridge.trackerOnTop(); }catch(e){}
  show(on);
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    show(on);
    try{ thorBridge.setTrackerOnTop(on); }catch(err){}
  });
})();

// When the tracker can't be moved to the other screen as it is, the app opens it again there. These carry over the
// tab, the open game and how far down the page was.
window.thorSaveView = function(){
  const card = document.getElementById('modal-card');
  const open = document.getElementById('modal-backdrop').classList.contains('open');
  return JSON.stringify({ tab: activeTab, game: open && card ? (card.dataset.gameId || '') : '', y: window.scrollY || 0 });
};
window.thorRestoreView = function(json){
  let v = null;
  try{ v = JSON.parse(json); }catch(e){ return; }
  if(!v) return;
  const btn = document.querySelector('.tab-btn[data-tab="' + v.tab + '"]');
  if(btn && v.tab !== activeTab) btn.click();
  const started = Date.now();
  // the games load a moment after the page does, so wait for the open game to be there
  (function tryRestore(){
    if(!v.game){ window.scrollTo(0, v.y || 0); return; }
    const all = (typeof libraryData !== 'undefined' ? libraryData : []).concat(typeof recentGamesData !== 'undefined' ? recentGamesData : []);
    const hit = all.find(g => String(g.GameID) === String(v.game));
    if(hit){ window.scrollTo(0, v.y || 0); openGameModal(hit.GameID); return; }
    if(Date.now() - started < 15000) setTimeout(tryRestore, 300);
  })();
};

// Display Options: the game's cartridge or disc floating on the top screen (devices with a top screen only).
(function(){
  const row = document.getElementById('float-cart-row'), sw = document.getElementById('float-cart-switch');
  if(!row || !sw || typeof thorBridge === 'undefined' || !thorBridge || typeof thorBridge.floatCart !== 'function') return;
  try{ if(typeof thorBridge.hasTopScreen === 'function' && !thorBridge.hasTopScreen()) return; }catch(e){}
  row.style.display = '';
  const show = on => { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); };
  let on = true;
  try{ on = !!thorBridge.floatCart(); }catch(e){}
  show(on);
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    show(on);
    try{ thorBridge.setFloatCart(on); }catch(err){}
  });
})();
