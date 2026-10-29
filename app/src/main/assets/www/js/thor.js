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

// Coming back to the app (after quitting a game) clears the "Starting…" line under the Play button.
window.thorResumed = function(){
  document.querySelectorAll('.thor-play-msg').forEach(m => { m.style.display = 'none'; m.textContent = ''; });
  thorPromoteLaunched();
};
document.addEventListener('visibilitychange', () => { if(!document.hidden) window.thorResumed(); });

function thorPlayButtonHtml(){
  if(!thorBridge) return '';
  return `<button class="btn-view-achievements btn-play-thor" id="modal-play-btn"><span class="arrow">▶</span> Play on this device</button>
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
  btn.addEventListener('click', () => {
    let res;
    try{ res = JSON.parse(thorBridge.launch(JSON.stringify(info))); }
    catch(e){ res = { ok: false, message: 'Could not reach the launcher.' }; }
    if(res.ok) thorMarkLaunched(gameId);
    msg.style.display = 'block';
    msg.classList.toggle('error', !res.ok);
    msg.textContent = res.message || (res.ok ? 'Starting the game…' : 'Could not start the game.');
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
      + (!s.steamgriddb && s.launchbox ? ' Online art comes from the free LaunchBox database.' : ''));
  };

  b.style.display = '';
  b.addEventListener('click', () => {
    try{ thorBridge.scrapeAll(); }catch(e){ return; }
    idleReads = 0;
    show('Fetching art…', 'Starting…');
    timer = setTimeout(poll, 1500);
  });
});
