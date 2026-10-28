// Hooks for the GLT Thor Android app. Inside the app it exposes window.ThorBridge; in a
// normal browser none of this does anything and the Play button never shows.
const thorBridge = window.ThorBridge || null;

// The app's WebView has no navigator.getBattery(), which the clock and battery readout needs,
// so provide one backed by the Android battery.
if(thorBridge && typeof navigator.getBattery !== 'function'){
  const thorBattery = new EventTarget();
  thorBattery.level = 1;
  thorBattery.charging = false;
  const readThorBattery = () => {
    try{
      const b = JSON.parse(thorBridge.battery());
      const before = thorBattery.level;
      thorBattery.level = b.level;
      thorBattery.charging = !!b.charging;
      if(before !== thorBattery.level) thorBattery.dispatchEvent(new Event('levelchange'));
    }catch(e){}
  };
  readThorBattery();
  setInterval(readThorBattery, 30000);
  navigator.getBattery = () => Promise.resolve(thorBattery);
}

function thorAvailable(){
  return !!thorBridge;
}

function thorViewing(info){
  if(!thorBridge) return;
  try{ thorBridge.setViewing(JSON.stringify(info)); }catch(e){}
}

function thorClearViewing(){
  if(!thorBridge) return;
  try{ thorBridge.clearViewing(); }catch(e){}
}

function thorPlayButtonHtml(){
  if(!thorBridge) return '';
  return `<button class="btn-view-achievements btn-play-thor" id="modal-play-btn"><span class="arrow">▶</span> Play on this device</button>
      <div class="thor-play-msg" id="modal-play-msg" style="display:none;"></div>`;
}

// Tells the app which game is open (for the top-screen art) and makes the Play button work.
function thorWirePlay(card, gameId, title, consoleName, artUrl){
  if(!thorBridge) return;
  const info = { gameId: String(gameId), title: title, console: consoleName, art: artUrl || '' };
  thorViewing(info);

  const btn = card.querySelector('#modal-play-btn');
  const msg = card.querySelector('#modal-play-msg');
  if(!btn || !msg) return;
  btn.addEventListener('click', () => {
    let res;
    try{
      res = JSON.parse(thorBridge.launch(JSON.stringify(info)));
    }catch(e){
      res = { ok: false, message: 'Could not reach the launcher.' };
    }
    msg.style.display = 'block';
    msg.classList.toggle('error', !res.ok);
    msg.textContent = res.message || (res.ok ? 'Starting the game…' : 'Could not start the game.');
  });
}

// A WebView can't save blob downloads on its own, so exports (backups, manuals, patched ROMs)
// are handed to the app, which writes them to the Downloads folder.
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

// Keys typed into the app's setup wizard. They are copied into the tracker's own storage when the
// wizard changes them (or when the tracker has none yet), so there is nothing to type twice.
async function thorSeedCredentials(){
  if(!thorBridge) return;
  let cfg = null;
  try{ cfg = JSON.parse(thorBridge.getConfig()); }catch(e){ return; }
  if(!cfg) return;

  let seenRev = '';
  try{ seenRev = localStorage.getItem('glt-thor-creds-rev') || ''; }catch(e){}
  const changed = !!cfg.rev && cfg.rev !== seenRev;

  try{
    if(cfg.raUser && cfg.raKey){
      if(changed || !(await loadCreds())) await saveCreds(cfg.raUser, cfg.raKey);
    }
    if(cfg.rawgKey){
      if(changed || !(await loadRawgCreds())) await saveRawgCreds(cfg.rawgKey);
    }
    if(cfg.rev){
      try{ localStorage.setItem('glt-thor-creds-rev', cfg.rev); }catch(e){}
    }
  }catch(e){}
}

// "Thor settings" menu item reopens the app's setup wizard.
(function(){
  function wire(){
    if(!thorBridge) return;
    const b = document.getElementById('btn-thor-settings');
    if(!b) return;
    b.style.display = '';
    b.addEventListener('click', () => { try{ thorBridge.openSettings(); }catch(e){} });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

// "Fetch game art" menu item: the app finds the top-screen art for every game in your ROM library (your frontend's art first, then online) and builds
// the top-screen art for it. It runs in the background; this just starts it and shows how far it has got.
(function(){
  let timer = null;
  let idleReads = 0;

  function show(label, note){
    const l = document.getElementById('thor-art-label');
    const n = document.getElementById('thor-art-note');
    if(l) l.textContent = label;
    if(n) n.textContent = note || '';
  }

  function poll(){
    clearTimeout(timer);
    let s = null;
    try{ s = JSON.parse(thorBridge.scrapeStatus()); }catch(e){ show('Fetch game art', 'The app could not be reached.'); return; }
    if(!s.configured){
      show('Fetch game art', 'No art source is on. Turn on the free libretro thumbnails in Launcher settings, or add a SteamGridDB key.');
      return;
    }
    if(s.running){
      idleReads = 0;
      show('Fetching art\u2026', s.withArt + ' of ' + s.games + ' games have art' + (s.failed ? ', ' + s.failed + ' not found' : ''));
      timer = setTimeout(poll, 3000);
      return;
    }
    // "running" blinks off briefly between batches, so wait for a few quiet reads before calling it finished.
    if(++idleReads < 3){ timer = setTimeout(poll, 1500); return; }
    show('Fetch game art', (s.message ? s.message + ' ' : '') + s.withArt + ' of ' + s.games + ' games have art' + (s.usingEsdeMedia ? ' (art you already have is used where it exists)' : '') + (!s.steamgriddb && s.libretro ? ' Online art comes from the free libretro thumbnails.' : ''));
  }

  function wire(){
    if(!thorBridge) return;
    const b = document.getElementById('btn-thor-art');
    if(!b) return;
    b.style.display = '';
    b.addEventListener('click', () => {
      try{ thorBridge.scrapeAll(); }catch(e){ return; }
      idleReads = 0;
      show('Fetching art\u2026', 'Starting\u2026');
      timer = setTimeout(poll, 1500);
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
