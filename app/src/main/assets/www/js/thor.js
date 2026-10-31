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

function thorViewing(info){
  try{ thorBridge.setViewing(JSON.stringify(info)); }catch(e){}
}

function thorClearViewing(){
  try{ thorBridge.clearViewing(); }catch(e){}
}

// Games started from here. When the app is back in front, one that is still a Backlog entry has now
// been played, so it moves to the Library even if RetroAchievements has no playtime for it.
const thorLaunched = new Set();
function thorMarkLaunched(gameId){
  if(gameId) thorLaunched.add(Number(gameId));
}

async function thorPromoteLaunched(){
  const ids = [...thorLaunched];
  thorLaunched.clear();
  for(const id of ids){
    const entry = libraryData.find(g => Number(g.GameID) === id);
    if(!entry || !entry.manual || entry.customConsole) continue;
    try{
      const data = await raFetch('API_GetGameInfoAndUserProgress.php', { g: id, a: 1 });
      if(data && (data.Title || data.ID)) await promoteManualGameToReal(id, data);
    }catch(e){}
  }
}

// A game has just started from here: move it out of the Backlog now, without waiting for it to close.
// An RA game is looked up and moved to the Library; a game RA doesn't list gets "Now Playing" ticked.
function thorStarted(card, gameId){
  thorMarkLaunched(gameId);
  thorPromoteLaunched();
  const entry = libraryData.find(g => Number(g.GameID) === Number(gameId) || g.GameID === gameId);
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
};
document.addEventListener('visibilitychange', () => { if(!document.hidden) window.thorResumed(); });

// While a game runs, the open profile looks for new unlocks once a minute (see liveCheckProfile in gestures.js).
// Only while the tracker is on screen, so a single-screen device stops when you are in the game.
if(thorBridge){
  setInterval(() => {
    if(document.hidden || typeof window.liveCheckProfile !== 'function') return;
    let running = false;
    try{ running = thorBridge.gameRunning(); }catch(e){}
    if(running) window.liveCheckProfile();
  }, 60000);
}

function thorPlayButtonHtml(){
  if(!thorBridge) return '';
  return `<div class="play-row"><button class="btn-view-achievements btn-play-thor" id="modal-play-btn"><span class="arrow">▶</span> Play on this device</button>
    <button class="btn-emu" id="modal-emu-btn" aria-label="Emulator for this game" title="Emulator for this game"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7.5 6h9A5.5 5.5 0 0 1 22 11.5v2a4.5 4.5 0 0 1-8 2.8 1.6 1.6 0 0 0-1.2-.5h-1.6a1.6 1.6 0 0 0-1.2.5A4.5 4.5 0 0 1 2 13.5v-2A5.5 5.5 0 0 1 7.5 6zM7 9v1.5H5.5V12H7v1.5h1.5V12H10v-1.5H8.5V9H7zm9.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg></button></div>
      <div class="thor-play-msg" id="modal-play-msg" style="display:none;"></div>`;
}

// Tells the app which game is open (for the top-screen art) and wires the Play button.
function thorWirePlay(card, gameId, title, consoleName, artUrl){
  if(!thorBridge) return;
  const info = { gameId: String(gameId), title: title, console: consoleName, art: artUrl || '' };
  thorViewing(info);

  const btn = card.querySelector('#modal-play-btn');
  const msg = card.querySelector('#modal-play-msg');
  if(!btn || !msg) return;
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
  btn.addEventListener('click', () => play(''));

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

// Copies the keys typed into the app's setup wizard into the tracker's storage, when the wizard
// changed them or the tracker has none yet.
async function thorSeedCredentials(){
  if(!thorBridge) return;
  let cfg = null;
  try{ cfg = JSON.parse(thorBridge.getConfig()); }catch(e){ return; }
  if(!cfg) return;

  let seenRev = '';
  try{ seenRev = localStorage.getItem('glt-thor-creds-rev') || ''; }catch(e){}
  const changed = !!cfg.rev && cfg.rev !== seenRev;

  try{
    if(cfg.raUser && cfg.raKey && (changed || !(await loadCreds()))) await saveCreds(cfg.raUser, cfg.raKey);
    if(cfg.rawgKey && (changed || !(await loadRawgCreds()))) await saveRawgCreds(cfg.rawgKey);
    if(cfg.rev){
      try{ localStorage.setItem('glt-thor-creds-rev', cfg.rev); }catch(e){}
    }
  }catch(e){}
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

// "Fetch game art": the app finds or builds top-screen art for every game in the ROM library, in the
// background. This starts it and shows progress.
onDomReady(() => {
  const b = document.getElementById('btn-thor-art');
  if(!thorBridge || !b) return;
  let timer = null;
  let idleReads = 0;

  const show = (label, note) => {
    const l = document.getElementById('thor-art-label');
    const n = document.getElementById('thor-art-note');
    if(l) l.textContent = label;
    if(n) n.textContent = note || '';
  };

  const poll = () => {
    clearTimeout(timer);
    let s = null;
    try{ s = JSON.parse(thorBridge.scrapeStatus()); }catch(e){ show('Fetch game art', 'The app could not be reached.'); return; }
    if(!s.configured){
      show('Fetch game art', 'No art source is on. Turn on the free LaunchBox art in Launcher settings, or add a SteamGridDB key.');
      return;
    }
    if(s.running){
      idleReads = 0;
      show('Fetching art…', s.withArt + ' of ' + s.games + ' games have art' + (s.failed ? ', ' + s.failed + ' not found' : ''));
      timer = setTimeout(poll, 3000);
      return;
    }
    // "running" drops briefly between batches, so wait for a few quiet reads before calling it done.
    if(++idleReads < 3){ timer = setTimeout(poll, 1500); return; }
    show('Fetch game art', (s.message ? s.message + ' ' : '') + s.withArt + ' of ' + s.games + ' games have art'
      + (s.usingEsdeMedia ? ' (art you already have is used where it exists)' : '')
      + (!s.steamgriddb && s.launchbox ? ' Online art comes from the free LaunchBox database.' : '')
      + (s.notes && s.notes.length ? ' Not found: ' + s.notes.join(' | ') : ''));
  };

  const field = document.getElementById('thor-art-field');
  if(field) field.style.display = '';
  b.addEventListener('click', () => {
    const games = libraryData.map(g => ({ title: g.Title, console: g.ConsoleName }));
    try{ thorBridge.scrapeAll(JSON.stringify(games)); }catch(e){ return; }
    idleReads = 0;
    show('Fetching art…', 'Starting…');
    timer = setTimeout(poll, 1500);
  });
});

// Pins the hamburger menu button to the top right of the screen (see .thor-app in the stylesheet).
onDomReady(() => { if(thorBridge) document.body.classList.add('thor-app'); });

// "Exit app" closes the launcher completely.
onDomReady(() => {
  const b = document.getElementById('btn-thor-exit');
  if(!thorBridge || !b) return;
  b.style.display = '';
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
