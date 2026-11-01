// Native Android ports of a game (recompiled or reimplemented), offered in the game profile.
// The list of ports is ports.json. Downloading, checking and installing are done by the app (ThorBridge port*).

let portsCatalog = null;
async function loadPortsCatalog(){
  if(portsCatalog) return portsCatalog;
  try{
    const r = await fetch('./ports.json');
    portsCatalog = ((await r.json()).ports) || [];
  }catch(e){ portsCatalog = []; }
  return portsCatalog;
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

function thorWirePorts(card, title){
  const host = card.querySelector('#modal-port');
  if(!host || !window.ThorBridge || typeof window.ThorBridge.portState !== 'function') return;
  portsForGame(title).then(ports => {
    if(!ports.length || !card.isConnected) return;
    host.innerHTML = '';
    ports.forEach(p => wirePort(card, host, p));
  });
}

function wirePort(card, host, p){
  const b = window.ThorBridge;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = document.createElement('div');
  box.className = 'gd-port';
  box.innerHTML = `<div class="gd-label">ANDROID PORT</div>
    <div class="gd-port-name">${esc(p.name)}</div>
    <button class="btn-view-achievements btn-play-thor gd-port-btn"></button>
    <div class="thor-play-msg gd-port-msg" style="display:none;"></div>
    <div class="gd-port-note">A native Android version of this game. It needs your own copy of the game.</div>`;
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
    try{ return JSON.parse(b.portState(p.id, p.name)); }catch(e){ return { installed: false, state: 'idle' }; }
  };

  const render = () => {
    const s = read();
    if(s.installed){
      btn.disabled = false;
      btn.innerHTML = '<span class="arrow">▶</span> Play installed Android port';
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
    btn.innerHTML = s.state === 'error' ? 'Try again' : '⬇ Get the Android port';
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
      try{ res = JSON.parse(b.portPlay(p.id, p.name)); }catch(e){ res = { ok: false, message: 'Could not open the port.' }; }
      say(res.message || '', !res.ok);
      return;
    }
    try{ b.portGet(p.id, p.repo); }catch(e){ say('Could not start the download.', true); return; }
    render();
    start();
  });

  render();
  const s0 = read();
  if(s0.state === 'working' || s0.state === 'ready') start();
}
