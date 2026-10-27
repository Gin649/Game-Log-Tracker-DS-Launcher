// Walkthrough videos: saved links, the embedded player, and resume position.

// Walkthrough videos (YouTube)
// "Find a walkthrough" opens a YouTube search in the browser; the user pastes
// links back here, which are saved per game (so they're part of Data backups)
// and played in a built-in embedded player that can be maximised.
function walkthroughKey(gameId){
  return `walkthroughs:${creds.username.trim().toLowerCase()}:${gameId}`;
}
async function loadWalkthroughs(gameId){
  try{
    const r = await window.storage.get(walkthroughKey(gameId), false);
    if(r && r.value){ const a = JSON.parse(r.value); if(Array.isArray(a)) return a; }
  }catch(e){ /* none saved yet */ }
  return [];
}
async function saveWalkthroughs(gameId, list){
  try{
    if(list.length) await window.storage.set(walkthroughKey(gameId), JSON.stringify(list), false);
    else await window.storage.delete(walkthroughKey(gameId), false);
  }catch(e){ /* non-fatal */ }
}
function ytEsc(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Accepts watch / youtu.be / shorts / embed / live / playlist links (with or without a timestamp).
// Returns { vid, list, start } or null if it isn't a YouTube link we can play.
function parseYouTubeLink(raw){
  let text = String(raw || '').trim();
  if(!text) return null;
  if(!/^https?:\/\//i.test(text)) text = 'https://' + text;
  let u; try{ u = new URL(text); }catch(e){ return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let vid = null;
  if(host === 'youtu.be'){
    vid = u.pathname.slice(1).split('/')[0];
  }else if(host === 'youtube.com' || host === 'youtube-nocookie.com'){
    if(u.pathname === '/watch') vid = u.searchParams.get('v');
    else{
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if(m) vid = m[1];
    }
  }else return null;
  if(vid && !/^[\w-]{11}$/.test(vid)) vid = null;
  let list = u.searchParams.get('list');
  if(list && !/^[\w-]+$/.test(list)) list = null;
  if(!vid && !list) return null;
  let start = 0;
  const t = u.searchParams.get('t') || u.searchParams.get('start');
  if(t){
    if(/^\d+$/.test(t)) start = Number(t);
    else{
      const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      if(m) start = (Number(m[1]||0) * 3600) + (Number(m[2]||0) * 60) + Number(m[3]||0);
    }
  }
  return { vid, list, start };
}
function ytEmbedUrl(e){
  const p = new URLSearchParams({ rel:'0', playsinline:'1', autoplay:'1' });
  if(e.start) p.set('start', String(e.start));
  if(e.list) p.set('list', e.list);
  return `https://www.youtube-nocookie.com/embed/${e.vid || 'videoseries'}?${p.toString()}`;
}
function ytWatchUrl(e){
  if(e.vid) return `https://www.youtube.com/watch?v=${e.vid}${e.list ? '&list=' + e.list : ''}${e.start ? '&t=' + e.start + 's' : ''}`;
  return `https://www.youtube.com/playlist?list=${e.list}`;
}
async function fetchYouTubeTitle(e){
  try{
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(ytWatchUrl(e)), { signal: ctl.signal });
    clearTimeout(timer);
    if(!res.ok) return null;
    const j = await res.json();
    return j && j.title ? String(j.title) : null;
  }catch(err){ return null; }
}
// Resume position: playback goes through the YouTube IFrame API so we can read the
// current time. It is saved on the video entry (it.resume in seconds, plus
// it.resumeIndex for playlists), so it is included in Data backups. If the API can't
// load, the plain embed is used and only saving new positions is lost.
const ytLive = new Set(); // active playback sessions: { flush(), destroy() }
let ytApiPromise = null;
function loadYouTubeApi(){
  if(window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if(ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try{ if(prev) prev(); }catch(e){} resolve(window.YT); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => { ytApiPromise = null; reject(new Error('YouTube player API failed to load')); };
    document.head.appendChild(tag);
    setTimeout(() => {
      if(!(window.YT && window.YT.Player)){ ytApiPromise = null; reject(new Error('YouTube player API timed out')); }
    }, 8000);
  });
  return ytApiPromise;
}
// Where to restart a video: a few seconds before where it was left (for context), or from the
// link's own timestamp if nothing has been watched yet. Under 10s watched counts as not started.
function ytStartSeconds(it){
  const r = Number(it.resume) || 0;
  if(r >= 10) return Math.max(0, r - 3);
  return Number(it.start) || 0;
}
function ytFlushAll(){ ytLive.forEach(sess => { try{ sess.flush(); }catch(e){} }); }
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') ytFlushAll(); });
window.addEventListener('pagehide', ytFlushAll);

// Clears every walkthrough player (called when the game profile closes) so audio never
// keeps playing behind a closed screen, and leaves full screen if it was on.
function stopWalkthroughPlayers(){
  Array.from(ytLive).forEach(sess => { try{ sess.flush(); sess.destroy(); }catch(e){} }); // save positions before clearing
  document.querySelectorAll('.yt-player-wrap').forEach(w => {
    w.classList.remove('yt-max');
    const b = w.querySelector('.yt-player-box');
    if(b) b.innerHTML = '';
  });
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if(fs && fs.classList && fs.classList.contains('yt-player-wrap')){
    try{ (document.exitFullscreen || document.webkitExitFullscreen).call(document); }catch(e){}
  }
}

function setupWalkthroughUI(gameId, title, card, consoleName){
  const btn = card.querySelector('#modal-yt-btn');
  const panel = card.querySelector('#modal-yt-panel');
  if(!btn || !panel) return;
  // RA hack titles carry a tag like "~Hack~", drop the tildes and everything between them,
  // since YouTube can't handle them in the search.
  const cleanTitle = String(title || '').replace(/~[^~]*~/g, ' ').replace(/~/g, ' ');
  const searchQuery = `${cleanTitle} ${consoleName || ''} walkthrough`.replace(/\s+/g, ' ').trim();
  const searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(searchQuery);
  let items = [];
  let built = false;
  let playingId = null;
  let els = {};

  function renderList(){
    if(!items.length){
      els.list.innerHTML = '<div class="yt-empty">No saved links yet.</div>';
      return;
    }
    els.list.innerHTML = items.map(it => `
        <div class="yt-item ${it.id === playingId ? 'playing' : ''}" data-id="${ytEsc(it.id)}">
          <button class="yt-item-main" type="button">
            ${it.vid ? `<img class="yt-thumb" src="https://i.ytimg.com/vi/${it.vid}/mqdefault.jpg" alt="" loading="lazy">` : '<span class="yt-thumb yt-thumb-list">☰</span>'}
            <span class="yt-item-title">${ytEsc(it.title)}</span>
          </button>
          <button class="yt-item-del" type="button" aria-label="Remove link">✕</button>
        </div>`).join('');
  }

  function setMax(on){
    els.wrap.classList.toggle('yt-max', on);
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if(on){
      const req = els.wrap.requestFullscreen || els.wrap.webkitRequestFullscreen;
      if(req && !fsEl){ try{ const p = req.call(els.wrap); if(p && p.catch) p.catch(() => {}); }catch(e){} }
    }else if(fsEl === els.wrap){
      try{ (document.exitFullscreen || document.webkitExitFullscreen).call(document); }catch(e){}
    }
  }

  let session = null;   // the active API-driven playback session, if any
  let playToken = 0;    // bumped on every play/stop so a slow API load can't start a stale video

  function endSession(){
    if(!session) return;
    try{ session.flush(); }catch(e){}
    try{ session.destroy(); }catch(e){}
    session = null;
  }

  function startSession(YTapi, it, startAt){
    const target = els.box.querySelector('.yt-api-target');
    if(!target) return;
    const vars = { rel: 0, playsinline: 1, autoplay: 1 };
    const opts = { host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', playerVars: vars, events: {} };
    if(it.vid){
      opts.videoId = it.vid;
      if(it.list) vars.list = it.list;
      if(startAt) vars.start = startAt;
    }else{
      vars.listType = 'playlist';
      vars.list = it.list;
    }
    let player = null, timer = null, ended = false, lastWrite = 0;
    const persist = () => { lastWrite = Date.now(); saveWalkthroughs(gameId, items); };
    const snap = () => {
      try{
        const t = player.getCurrentTime();
        if(isFinite(t)){
          it.resume = Math.floor(t);
          if(!it.vid){ const i = player.getPlaylistIndex(); if(i >= 0) it.resumeIndex = i; }
        }
      }catch(e){ /* player not ready or already gone */ }
    };
    const sess = {
      flush(){ if(!player || ended) return; snap(); persist(); },
      destroy(){
        clearInterval(timer);
        ytLive.delete(sess);
        try{ player && player.destroy(); }catch(e){}
      }
    };
    opts.events.onReady = (ev) => {
      try{
        if(!it.vid && (startAt || it.resumeIndex)){
          ev.target.loadPlaylist({ listType: 'playlist', list: it.list, index: it.resumeIndex || 0, startSeconds: startAt || 0 });
        }else{
          ev.target.playVideo();
        }
      }catch(e){}
    };
    opts.events.onStateChange = (ev) => {
      const st = ev.data;
      if(st === 1){ // playing
        ended = false;
        clearInterval(timer);
        timer = setInterval(() => {
          try{ if(!player.getIframe().isConnected){ sess.destroy(); return; } }catch(e){ sess.destroy(); return; }
          snap();
          if(Date.now() - lastWrite > 15000) persist();
        }, 5000);
      }else if(st === 2){ // paused
        clearInterval(timer); snap(); persist();
      }else if(st === 0){ // finished
        clearInterval(timer);
        let lastInList = true;
        try{ if(!it.vid){ const n = (player.getPlaylist() || []).length; lastInList = n === 0 || player.getPlaylistIndex() >= n - 1; } }catch(e){}
        if(lastInList){ ended = true; delete it.resume; delete it.resumeIndex; persist(); } // watched to the end: next time starts over
      }
    };
    ytLive.add(sess);
    player = new YTapi.Player(target, opts);
    sess.player = player;
    session = sess;
  }

  async function play(it){
    const token = ++playToken;
    endSession();
    playingId = it.id;
    const startAt = ytStartSeconds(it);
    els.box.innerHTML = '<div class="yt-api-target"></div>';
    els.maxTitle.textContent = it.title;
    els.tools.style.display = '';
    els.ytLink.href = ytWatchUrl(it);
    renderList();
    els.wrap.scrollIntoView({ behavior:'smooth', block:'nearest' });
    let YTapi = null;
    try{ YTapi = await loadYouTubeApi(); }catch(e){ console.error(e); }
    if(token !== playToken || playingId !== it.id) return; // another video or Stop was chosen meanwhile
    if(YTapi){
      try{ startSession(YTapi, it, startAt); return; }catch(e){ console.error('YouTube player API failed, using plain player:', e); }
    }
    // Fallback: plain embed (no position tracking), still starting from the last saved position.
    els.box.innerHTML = `<iframe src="${ytEmbedUrl({ ...it, start: startAt })}" title="Walkthrough video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  function stopPlayer(){
    playToken++;
    endSession();
    playingId = null;
    setMax(false);
    els.box.innerHTML = '';
    els.tools.style.display = 'none';
  }

  function msg(text, isError){
    els.msg.textContent = text || '';
    els.msg.className = 'yt-msg' + (isError ? ' err' : '');
  }

  async function addLink(){
    const parsed = parseYouTubeLink(els.input.value);
    if(!parsed){ msg('That doesn\'t look like a YouTube link. Copy the link from the video\'s Share button (or the address bar) and paste it here.', true); return; }
    const id = parsed.vid || ('pl-' + parsed.list);
    const dup = items.find(it => it.id === id);
    if(dup){ msg('That link is already saved.', true); els.input.value = ''; play(dup); return; }
    els.saveBtn.disabled = true;
    msg('Saving…');
    const entry = { id, vid: parsed.vid, list: parsed.list, start: parsed.start, title: '', added: Date.now() };
    entry.title = (await fetchYouTubeTitle(entry)) || (parsed.vid ? `Walkthrough video ${items.length + 1}` : `Walkthrough playlist ${items.length + 1}`);
    items.push(entry);
    await saveWalkthroughs(gameId, items);
    els.input.value = '';
    els.saveBtn.disabled = false;
    msg('');
    renderList();
  }

  function build(){
    built = true;
    panel.innerHTML = `
        <a class="guide-btn guide-btn-primary yt-find" href="${ytEsc(searchUrl)}" target="_blank" rel="noopener">Find a walkthrough ↗</a>
        <p class="yt-hint">Opens a YouTube search for “${ytEsc(searchQuery)}”. On a video, tap <b>Share</b> → <b>Copy link</b>, come back here, and paste it below.</p>
        <div class="yt-add-row">
          <input type="url" class="yt-input" placeholder="Paste a YouTube link" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
          <button class="yt-save-btn" type="button">Save</button>
        </div>
        <div class="yt-msg"></div>
        <div class="yt-list"><div class="yt-empty">Loading…</div></div>
        <div class="yt-player-wrap">
          <div class="yt-max-bar"><span class="yt-max-title"></span><button class="yt-max-close" type="button">✕ Close</button></div>
          <div class="yt-player-box"></div>
          <div class="yt-player-tools" style="display:none;">
            <button class="yt-max-btn" type="button">⛶ Full screen</button>
            <a class="yt-open-link" href="#" target="_blank" rel="noopener">Open on YouTube ↗</a>
          </div>
        </div>`;
    els = {
      input: panel.querySelector('.yt-input'), saveBtn: panel.querySelector('.yt-save-btn'), msg: panel.querySelector('.yt-msg'),
      list: panel.querySelector('.yt-list'), wrap: panel.querySelector('.yt-player-wrap'), box: panel.querySelector('.yt-player-box'),
      tools: panel.querySelector('.yt-player-tools'), ytLink: panel.querySelector('.yt-open-link'), maxTitle: panel.querySelector('.yt-max-title')
    };
    els.saveBtn.addEventListener('click', addLink);
    els.input.addEventListener('keydown', (ev) => { if(ev.key === 'Enter'){ ev.preventDefault(); addLink(); } });
    els.list.addEventListener('click', async (ev) => {
      const row = ev.target.closest('.yt-item');
      if(!row) return;
      const it = items.find(x => x.id === row.dataset.id);
      if(!it) return;
      if(ev.target.closest('.yt-item-del')){
        if(!confirm('Remove this saved link?')) return;
        items = items.filter(x => x.id !== it.id);
        if(playingId === it.id) stopPlayer();
        await saveWalkthroughs(gameId, items);
        renderList();
        return;
      }
      play(it);
    });
    panel.querySelector('.yt-max-btn').addEventListener('click', () => setMax(true));
    panel.querySelector('.yt-max-close').addEventListener('click', () => setMax(false));
    // Leaving native full screen with the system gesture/Esc should also drop the maximised layout.
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if(!fsEl && els.wrap.classList.contains('yt-max')) els.wrap.classList.remove('yt-max');
    };
    els.wrap.addEventListener('fullscreenchange', onFsChange);
    els.wrap.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', (ev) => {
      if(ev.key === 'Escape' && els.wrap.isConnected && els.wrap.classList.contains('yt-max')) setMax(false);
    });
    loadWalkthroughs(gameId).then(list => { items = list; renderList(); });
  }

  btn.addEventListener('click', () => {
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    btn.classList.toggle('open', opening);
    if(opening){ if(!built) build(); }
    else if(built){ stopPlayer(); renderList(); } // collapsing the panel stops playback
  });
}
