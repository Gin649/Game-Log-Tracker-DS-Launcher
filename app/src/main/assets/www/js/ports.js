// Native Android ports of a game (recompiled or reimplemented), offered in the game profile.
// The list of ports is ports.json. Downloading, checking and installing are done by the app (ThorBridge port*).

// The list lives in the app's GitHub repo (data/ports.json), so a port can be added without a new release. The app
// keeps the last copy it downloaded, checks again at most every six hours, and falls back to the copy bundled in the app.
const PORTS_URL = 'https://raw.githubusercontent.com/Gin649/Game-Log-Tracker-DS-Launcher/main/data/ports.json';
const PORTS_CACHE_KEY = 'ports-catalog:v1';
const PORTS_MAX_AGE = 6 * 60 * 60 * 1000;

let portsCatalog = null;
let portsLoading = null;

async function fetchRemotePorts(){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try{
    const r = await fetch(PORTS_URL, { signal: ctl.signal, cache: 'no-store' });
    if(!r.ok) return null;
    const list = ((await r.json()).ports) || [];
    return Array.isArray(list) && list.length ? list : null;
  }catch(e){ return null; }
  finally{ clearTimeout(t); }
}

async function loadPortsCatalog(){
  if(portsCatalog) return portsCatalog;
  if(portsLoading) return portsLoading;
  portsLoading = (async () => {
    let saved = null;
    try{
      const r = await window.storage.get(PORTS_CACHE_KEY, false);
      if(r && r.value) saved = JSON.parse(r.value);
    }catch(e){}
    const savePorts = async list => {
      try{ await window.storage.set(PORTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), ports: list }), false); }catch(e){}
    };

    let list = saved && Array.isArray(saved.ports) && saved.ports.length ? saved.ports : null;
    const fresh = !!(list && Date.now() - (saved.ts || 0) < PORTS_MAX_AGE);
    if(list && !fresh){
      // Show what we have now and look for a newer list in the background.
      fetchRemotePorts().then(l => { if(l){ portsCatalog = l; savePorts(l); } });
    }else if(!list){
      list = await fetchRemotePorts();
      if(list) savePorts(list);
    }
    if(!list){
      try{ list = ((await (await fetch('./ports.json')).json()).ports) || []; }catch(e){ list = []; }
    }
    portsCatalog = list;
    return list;
  })();
  return portsLoading;
}

// "The Legend of Zelda: Majora's Mask" and "Legend of Zelda, The - Majora's Mask (USA)" compare equal.
function portTitleKey(t){
  return foldText(String(t || ''))
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/,\s*the\b/g, ' ')
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

async function portsForGame(title){
  if(isHackTitle(title)) return [];
  const key = portTitleKey(title);
  if(key.length < 3) return [];
  const list = await loadPortsCatalog();
  return list.filter(p => (p.games || []).some(g => portTitleKey(g) === key));
}

// A port that needs more than this device has (CPU type, Android version, Vulkan) is not offered at all.
let portDeviceInfo = null;
function portRunsHere(p){
  const r = p.requirements;
  if(!r) return true;
  if(!portDeviceInfo){
    try{ portDeviceInfo = JSON.parse(window.ThorBridge.portDevice()); }catch(e){ return true; }
  }
  const d = portDeviceInfo;
  if(r.abi && r.abi.length && d.abis && d.abis.length && !r.abi.some(a => d.abis.indexOf(a) >= 0)) return false;
  if(r.min_sdk && d.sdk && d.sdk < r.min_sdk) return false;
  if(r.vulkan && d.vulkan === false) return false;
  return true;
}

function thorWirePorts(card, title, consoleName){
  const host = card.querySelector('#modal-port');
  if(!host || !window.ThorBridge || typeof window.ThorBridge.portState !== 'function') return;
  portsForGame(title).then(async ports => {
    ports = ports.filter(portRunsHere);
    // Installed ports always show. The others show only when they really have an Android build; that check runs
    // in the background and takes a moment.
    const isInstalled = q => {
      try{ return !!JSON.parse(window.ThorBridge.portState(q.id, q.name, q.package || '')).installed; }catch(e){ return false; }
    };
    if(typeof window.ThorBridge.portAvailable === 'function'){
      const verdict = await Promise.all(ports.map(async q => {
        if(isInstalled(q)) return true;
        for(let i = 0; i < 20; i++){
          if(!card.isConnected) return false;
          let a = 'unknown';
          try{ a = window.ThorBridge.portAvailable(q.repo, q.pattern || ''); }catch(e){}
          if(a === 'yes') return true;
          if(a === 'no' || a === 'unknown') return false;
          await new Promise(r => setTimeout(r, 600));
        }
        return false;
      }));
      ports = ports.filter((q, i) => verdict[i]);
    }
    if(!ports.length || !card.isConnected) return;
    host.innerHTML = ports.length > 1 ? '<div class="gd-port-multi">Multiple Android ports available</div>' : '';
    ports.forEach((p, i) => wirePort(card, host, p, ports.length > 1, i === 0, title, consoleName, i === ports.length - 1));
  });
}

function wirePort(card, host, p, several, first, title, consoleName, last){
  const b = window.ThorBridge;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tag = ' (' + esc(String(p.repo || p.name).split('/').pop()) + ')'; // the project's own name (Ghostship, sm64coopdx), shown for one port too
  const box = document.createElement('div');
  box.className = 'gd-port';
  const romBtnHtml = first ? `<button class="btn-emu gd-port-rom-btn" aria-label="Get this game's ROM ready for the port" title="Get this game's ROM ready for the port (unzips it and saves it to Downloads/Roms for Ports)"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-1 3h2v4h2.5L13 19.5 8.5 16H11v-4z"/></svg></button>` : '<span class="btn-emu-spacer"></span>'; // other ports get an empty space so their buttons are the same width
  box.innerHTML = `<div class="play-row"><button class="btn-view-achievements btn-play-thor gd-port-btn"></button>${romBtnHtml}</div>
    <div class="thor-play-msg gd-port-msg" style="display:none;"></div>
    ${last ? '<div class="gd-port-note">A native Android version of this game. It needs your own copy of the game.</div>' : ''}`;
  host.appendChild(box);
  const btn = box.querySelector('.gd-port-btn');
  const msg = box.querySelector('.gd-port-msg');
  let timer = null;
  let waited = 0;

  const say = (text, error) => {
    msg.style.display = text ? 'block' : 'none';
    msg.classList.toggle('error', !!error);
    msg.textContent = text || '';
  };

  const read = () => {
    try{ return JSON.parse(b.portState(p.id, p.name, p.package || '')); }catch(e){ return { installed: false, state: 'idle' }; }
  };

  const render = () => {
    const s = read();
    if(s.installed){
      btn.disabled = false;
      btn.innerHTML = '<span class="arrow">▶</span> Play installed Android port' + tag;
      btn.dataset.mode = 'play';
      if(s.state === 'ready') say('');
      stop();
      return;
    }
    if(s.state === 'working'){
      btn.disabled = true;
      btn.innerHTML = 'Getting the port…';
      say((s.message || 'Working…') + (s.percent >= 0 && s.percent < 100 ? ' ' + s.percent + '%' : ''), false);
      return;
    }
    btn.disabled = false;
    btn.dataset.mode = 'get';
    btn.innerHTML = s.state === 'error' ? 'Try again' + tag : (several ? 'Download and Install' : 'Download and Install the Android Port') + tag;
    if(s.state === 'error') say(s.message || 'Could not get the port.', true);
    else if(s.state === 'ready'){
      say(s.message || '', false);
      waited++;
      if(waited > 180) stop();
      return;
    }
    else say('');
    if(s.state !== 'ready') stop();
  };

  const start = () => {
    if(timer) return;
    waited = 0;
    timer = setInterval(() => { if(!card.isConnected){ stop(); return; } render(); }, 1000);
  };
  const stop = () => { if(timer){ clearInterval(timer); timer = null; } };

  btn.addEventListener('click', () => {
    if(btn.dataset.mode === 'play'){
      let res;
      try{ res = JSON.parse(b.portPlay(p.id, p.name, p.package || '')); }catch(e){ res = { ok: false, message: 'Could not open the port.' }; }
      say(res.message || '', !res.ok);
      return;
    }
    try{ b.portGet(p.id, p.repo, p.pattern || '', p.zip || ''); }catch(e){ say('Could not start the download.', true); return; }
    render();
    start();
  });

  // Ports can't open .zip, .chd or .rvz files, so this unpacks the game's ROM into Downloads/Roms for Ports.
  const romBtn = box.querySelector('.gd-port-rom-btn');
  if(romBtn){
    let busy = false;
    romBtn.addEventListener('click', () => {
      if(busy) return;
      let r;
      try{ r = JSON.parse(b.portRomStart(JSON.stringify(Object.assign({ title: title, console: consoleName }, p.delivery || {})))); }
      catch(e){ r = { ok: false, message: 'Could not start.' }; }
      if(!r.ok){ say(r.message || 'Could not start.', true); return; }
      busy = true;
      romBtn.disabled = true;
      const poll = () => {
        if(!card.isConnected){ busy = false; return; }
        let s;
        try{ s = JSON.parse(b.discPatchStatus(r.job)); }catch(e){ s = { state: 'error', message: 'Lost contact with the app.' }; }
        if(s.state === 'running'){
          const pct = s.total > 0 ? Math.min(100, Math.round(s.done * 100 / s.total)) : -1;
          say((s.phase || 'Working') + (pct >= 0 ? ' ' + pct + '%' : '…'), false);
          setTimeout(poll, 700);
          return;
        }
        busy = false;
        romBtn.disabled = false;
        if(s.state === 'done') say('Saved to ' + String(s.path || s.name || '').replace('/storage/emulated/0/', '') + (p.delivery && p.delivery.mode === 'shared_folder' ? '' : '. Pick it inside the port.'), false);
        else say(s.message || 'Could not prepare the ROM.', true);
      };
      say('Starting…', false);
      setTimeout(poll, 500);
    });
  }

  render();
  const s0 = read();
  if(s0.state === 'working' || s0.state === 'ready') start();
}
