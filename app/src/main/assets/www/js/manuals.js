// Manual section of a game profile: finds the game's manual on gamesdatabase.org (through our
// own Worker), saves the PDF on this device, and reads it in a built-in viewer.

const MANUAL_WORKER = 'https://manuals-proxy.gin649.workers.dev';
const PDFJS_VERSION = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
const MANUAL_HIT_TTL = 30 * 24 * 60 * 60 * 1000;
const MANUAL_MISS_TTL = 7 * 24 * 60 * 60 * 1000;
const MANUAL_LIST_URL = 'https://www.gamesdatabase.org/list.aspx?manual=1';

// The site's system names (same list the scraper project uses).
const MANUAL_SYSTEM_NAMES = [
  'Acorn Atom', 'Amstrad CPC', 'Amstrad GX4000', 'Apple II', 'Arcade', 'Atari 2600', 'Atari 5200',
  'Atari 7800', 'Atari 8-bit', 'Atari Jaguar', 'Atari Jaguar CD', 'Atari Lynx', 'Atari ST',
  'Bally Astrocade', 'Coleco Vision', 'Commodore 64', 'Commodore Amiga', 'Commodore Amiga CD32',
  'Commodore VIC-20', 'Dragon 32-64', 'Emerson Arcadia 2001', 'Entex Adventure Vision',
  'Fairchild Channel F', 'GCE Vectrex', 'Laserdisc', 'Magnavox Odyssey 2', 'Mattel Intellivision',
  'Microsoft Xbox', 'Microsoft Xbox 360', 'MSX Laserdisc', 'NEC PC Engine', 'NEC TurboGrafx CD',
  'NEC TurboGrafx-16', 'Nintendo Arcade Systems', 'Nintendo DS', 'Nintendo Game Boy',
  'Nintendo Game Boy Color', 'Nintendo GameCube', 'Nintendo N64', 'Nintendo NES', 'Nintendo SNES',
  'Nintendo Virtual Boy', 'Panasonic 3DO', 'Philips CD-i', 'Sega 32X', 'Sega CD', 'Sega Dreamcast',
  'Sega Game Gear', 'Sega Genesis', 'Sega Master System', 'Sega Nomad', 'Sega Saturn', 'Sega SG-1000',
  'Sinclair ZX Spectrum', 'SNK Neo-Geo MVS', 'SNK Neo-Geo Pocket', 'SNK Neo-Geo Pocket Color',
  'Sony Playstation', 'Sony Playstation 2', 'Sony PSP', 'Texas Instruments TI 99/4A', 'VTech CreatiVision'
];

// RetroAchievements console name (lowercase) -> the site's system name(s), where the names differ.
const MANUAL_SYSTEM_ALIASES = {
  'nes/famicom': ['Nintendo NES'],
  'snes/super famicom': ['Nintendo SNES'],
  'nintendo 64': ['Nintendo N64'],
  'gamecube': ['Nintendo GameCube'],
  'genesis/mega drive': ['Sega Genesis'],
  'pc engine/turbografx-16': ['NEC TurboGrafx-16', 'NEC PC Engine'],
  'pc engine cd/turbografx-cd': ['NEC TurboGrafx CD'],
  'playstation': ['Sony Playstation'],
  'playstation 2': ['Sony Playstation 2'],
  'playstation portable': ['Sony PSP'],
  '3do interactive multiplayer': ['Panasonic 3DO'],
  'colecovision': ['Coleco Vision'],
  'intellivision': ['Mattel Intellivision'],
  'vectrex': ['GCE Vectrex'],
  'neo geo pocket': ['SNK Neo-Geo Pocket', 'SNK Neo-Geo Pocket Color'],
  'zx spectrum': ['Sinclair ZX Spectrum'],
  'vic-20': ['Commodore VIC-20'],
  'amiga': ['Commodore Amiga'],
  'xbox': ['Microsoft Xbox'],
  'xbox 360': ['Microsoft Xbox 360']
};

// Systems that sometimes hold a different scan of the same game (a handheld model, a renamed
// console), used by the alternative-manual search.
const MANUAL_RELATED = {
  'Sega Genesis': ['Sega Nomad'],
  'Sega Nomad': ['Sega Genesis'],
  'NEC TurboGrafx-16': ['NEC PC Engine'],
  'NEC PC Engine': ['NEC TurboGrafx-16'],
  'Nintendo Game Boy': ['Nintendo Game Boy Color'],
  'Nintendo Game Boy Color': ['Nintendo Game Boy'],
  'SNK Neo-Geo Pocket': ['SNK Neo-Geo Pocket Color'],
  'SNK Neo-Geo Pocket Color': ['SNK Neo-Geo Pocket']
};

function manualNorm(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// The site's system names that could match a console name from RetroAchievements or RAWG.
function manualSystemsFor(consoleName){
  const key = String(consoleName || '').trim().toLowerCase();
  if(!key) return [];
  if(MANUAL_SYSTEM_ALIASES[key]) return MANUAL_SYSTEM_ALIASES[key];
  const want = manualNorm(consoleName);
  const hits = MANUAL_SYSTEM_NAMES.filter(name => {
    const n = manualNorm(name);
    return n === want || n.endsWith(' ' + want);
  });
  return hits.slice(0, 2);
}

// Title spellings to try on the site, best guess first. Follows the guide matcher's ideas:
// the article moved back to the front, "Version"/"Edition" dropped, accents folded, either
// half of a "Title: Subtitle", and the publisher brand ("Disney's") left off or put on.
function manualTitleVariants(title, strict){
  const full = (typeof cheatsCleanTitle === 'function' ? cheatsCleanTitle(title) : String(title || '')).trim();
  if(!full) return [];
  const fold = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const noArticle = t => t.replace(/^(the|a|an)\s+/i, '');
  const noNoise = t => t.replace(/\b(version|edition)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const noBrand = t => (typeof cheatsStripBrand === 'function' ? cheatsStripBrand(t) : t);

  const out = [];
  const add = t => {
    const v = String(t || '').replace(/\s+/g, ' ').trim();
    const key = manualNorm(v);
    if(v && key.length >= 3 && !out.some(o => manualNorm(o) === key)) out.push(v);
  };

  add(full);
  add(fold(full));
  add(noArticle(full));
  add(noNoise(fold(full)));
  add(noNoise(fold(noArticle(full))));
  add(noBrand(fold(full)));

  // Strict is for the alternative search, which collects every manual it finds, so it sticks to
  // spellings of this exact game and skips the looser guesses below.
  if(strict) return out.slice(0, 5);

  // Each side of a subtitle, when it still reads like a title (two words or more).
  [' - ', ': '].forEach(sep => {
    const i = full.indexOf(sep);
    if(i < 0) return;
    [full.slice(0, i), full.slice(i + sep.length)].forEach(part => {
      const p = noNoise(fold(noArticle(part.trim())));
      if(p.split(' ').length >= 2) add(p);
    });
  });

  // The archive-style "Disney's X" for a plain "X", as the last and least likely guess.
  const base = noNoise(noBrand(fold(noArticle(full))));
  if(base && !/^disney/i.test(base)) add("Disney's " + base);

  return out.slice(0, 6);
}

function manualAltSystemsFor(consoleName){
  const own = manualSystemsFor(consoleName);
  const all = [...own];
  own.forEach(s => (MANUAL_RELATED[s] || []).forEach(r => { if(!all.includes(r)) all.push(r); }));
  return all.slice(0, 4);
}

function manualSupported(title, consoleName){
  return !/^\s*~/.test(title || '') && manualSystemsFor(consoleName).length > 0;
}

function manualSizeLabel(bytes){
  if(!bytes) return '';
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// Downloaded PDFs live in their own IndexedDB database, so they stay out of the Data export
// (which would balloon with them) and out of the key/value store the app reads at startup.
let manualDbPromise = null;
function openManualDb(){
  if(manualDbPromise) return manualDbPromise;
  manualDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('GameLogTrackerManuals', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return manualDbPromise;
}
async function manualDbRun(mode, fn){
  const db = await openManualDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage write was blocked'));
  });
}
const manualFileGet = id => manualDbRun('readonly', s => s.get(String(id))).catch(() => null);
const manualFilePut = rec => manualDbRun('readwrite', s => s.put(rec));
const manualFileDelete = id => manualDbRun('readwrite', s => s.delete(String(id)));

function manualMetaKey(gameId){ return `manual-meta:${gameId}`; }
async function loadManualMeta(gameId){
  try{
    const r = await window.storage.get(manualMetaKey(gameId), false);
    if(r && r.value){
      const m = JSON.parse(r.value);
      const ttl = m.found ? MANUAL_HIT_TTL : MANUAL_MISS_TTL;
      if(m && Date.now() - (m.ts || 0) < ttl) return m;
    }
  }catch(e){ /* nothing saved yet */ }
  return null;
}
async function saveManualMeta(gameId, meta){
  try{ await window.storage.set(manualMetaKey(gameId), JSON.stringify({ ...meta, ts: Date.now() }), false); }
  catch(e){ /* non-fatal */ }
}

async function findManual(gameId, title, consoleName){
  const qs = new URLSearchParams();
  manualSystemsFor(consoleName).forEach(s => qs.append('system', s));
  manualTitleVariants(title).forEach(g => qs.append('game', g));
  // RA games usually have a release year and publisher, which lets the Worker rebuild the file name if the page lookup misses.
  const ext = typeof gameExtendedCache !== 'undefined' ? gameExtendedCache[gameId] : null;
  if(ext){
    const released = ext.Released ? parseRADate(ext.Released) : null;
    if(released) qs.set('year', String(released.getFullYear()));
    if(ext.Publisher) qs.set('pub', ext.Publisher);
  }
  const res = await fetchWithTimeout(`${MANUAL_WORKER}/manual/find?${qs}`, 30000);
  if(!res.ok) throw new Error('Manual lookup failed (HTTP ' + res.status + ')');
  return res.json();
}

async function findAlternatives(gameId, title, consoleName){
  const qs = new URLSearchParams();
  manualAltSystemsFor(consoleName).forEach(s => qs.append('system', s));
  manualTitleVariants(title, true).forEach(g => qs.append('game', g));
  qs.set('all', '1');
  const res = await fetchWithTimeout(`${MANUAL_WORKER}/manual/find?${qs}`, 30000);
  if(!res.ok) throw new Error('Alternative lookup failed (HTTP ' + res.status + ')');
  return res.json();
}

async function downloadManualPdf(path, onProgress){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try{
    const res = await fetch(`${MANUAL_WORKER}/manual/pdf?path=${encodeURIComponent(path)}`, { signal: ctrl.signal });
    if(!res.ok) throw new Error(res.status === 404 ? 'The manual is no longer on the site.' : 'Download failed (HTTP ' + res.status + ')');
    const total = Number(res.headers.get('Content-Length')) || 0;
    const chunks = [];
    let got = 0;
    if(res.body && res.body.getReader){
      const reader = res.body.getReader();
      for(;;){
        const { done, value } = await reader.read();
        if(done) break;
        chunks.push(value);
        got += value.length;
        onProgress(got, total);
      }
    }else{
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      got = buf.length;
    }
    const blob = new Blob(chunks, { type: 'application/pdf' });
    if(await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The site returned something that is not a PDF.');
    return blob;
  }finally{ clearTimeout(timer); }
}

// The section under a game's write-up. Starts from what's saved on the device: a downloaded
// manual shows Read / Save / Remove, otherwise there's one Download button.
function addManualSection(wrap, ctx){
  if(!ctx || !manualSupported(ctx.title, ctx.consoleName)) return;
  const section = document.createElement('div');
  section.className = 'gd-manual';
  section.innerHTML = '<div class="gd-label gd-about-label">MANUAL</div><div class="gd-manual-body"></div>';
  wrap.appendChild(section);
  setupManualUI(section.querySelector('.gd-manual-body'), ctx);
}

function setupManualUI(body, ctx){
  const { gameId, title, consoleName } = ctx;
  let busy = false;

  const btn = (label, act, primary) =>
    `<button class="gd-manual-btn${primary ? ' primary' : ''}" data-act="${act}">${label}</button>`;
  const set = html => { if(body.isConnected) body.innerHTML = html; };
  const note = text => `<div class="gd-manual-note">${text}</div>`;

  async function showIdle(extra){
    const file = await manualFileGet(gameId);
    const meta = await loadManualMeta(gameId);
    if(file){
      // "copy 2 of 3" only shows once an alternative search has found more than one manual.
      const alts = meta && meta.alts && meta.alts.length > 1 ? meta.alts : null;
      const at = alts ? alts.indexOf(file.path || meta.path) : -1;
      const copy = alts && at >= 0 ? `, copy ${at + 1} of ${alts.length}` : '';
      set(`${note('PDF, ' + manualSizeLabel(file.size) + ', saved on this device' + copy)}
        <div class="gd-manual-actions">${btn('Read manual', 'read', true)}${btn('Save PDF', 'save')}${btn('Look for Alternative Manual', 'alt')}${btn('Remove', 'remove')}</div>${extra || ''}`);
      return;
    }
    if(meta && !meta.found){
      set(`${note('No manual found on Games Database for this game.')}
        <div class="gd-manual-actions">${btn('Try again', 'find')}<a class="gd-manual-btn" href="${MANUAL_LIST_URL}" target="_blank" rel="noopener">Browse site ↗</a></div>${extra || ''}`);
      return;
    }
    set(`<div class="gd-manual-actions">${btn('Download manual', 'find', true)}</div>${note('From Games Database. Saved on this device so it works offline.')}${extra || ''}`);
  }

  function showProgress(text, frac){
    const bar = frac == null ? '<div class="gd-manual-bar indeterminate"><span></span></div>'
      : `<div class="gd-manual-bar"><span style="width:${Math.round(frac * 100)}%"></span></div>`;
    set(`${note(text)}${bar}`);
  }

  // Downloads a manual and keeps it as this game's one saved copy. Saving under the same id
  // replaces whatever was there, and only once the new download has finished, so a failed
  // attempt leaves the old manual alone and a swap never leaves two copies on the device.
  async function fetchAndKeep(path){
    showProgress('Downloading…', null);
    const blob = await downloadManualPdf(path, (got, total) => {
      const label = total ? `Downloading… ${manualSizeLabel(got)} of ${manualSizeLabel(total)}` : `Downloading… ${manualSizeLabel(got)}`;
      showProgress(label, total ? got / total : null);
    });
    const name = decodeURIComponent(path.split('/').pop()).replace(/_/g, ' ');
    try{
      await manualFilePut({ id: String(gameId), blob, name, size: blob.size, ts: Date.now(), path });
    }catch(e){
      return false;
    }
    return true;
  }

  const NO_ROOM = 'Downloaded, but there was no room to keep it on this device. Free some space and try again.';
  const FAILED = 'Could not get the manual right now. Check your connection and try again.';

  async function run(){
    if(busy) return;
    busy = true;
    try{
      let meta = await loadManualMeta(gameId);
      if(!meta || !meta.found){
        showProgress('Looking for the manual…', null);
        const found = await findManual(gameId, title, consoleName);
        meta = found && found.found ? { found: true, path: found.path } : { found: false };
        await saveManualMeta(gameId, meta);
      }
      if(!meta.found){ busy = false; return showIdle(); }

      const kept = await fetchAndKeep(meta.path);
      busy = false;
      if(!kept) return showIdle(note(NO_ROOM));
      await showIdle();
      if(body.isConnected) openManualReader(gameId, title);
    }catch(e){
      console.error('Manual failed:', e && e.message);
      busy = false;
      showIdle(note(FAILED));
    }
  }

  // Swaps the saved manual for another one the site has for this game (another region or
  // scan, possibly filed under a related system). Repeated taps cycle through what was found.
  async function runAlternative(){
    if(busy) return;
    busy = true;
    try{
      const file = await manualFileGet(gameId);
      const meta = await loadManualMeta(gameId);
      const current = (file && file.path) || (meta && meta.path) || '';
      let all = meta && meta.alts && meta.alts.length ? meta.alts : null;
      if(!all){
        showProgress('Looking for another manual…', null);
        const res = await findAlternatives(gameId, title, consoleName);
        all = (res && res.paths) || [];
        if(current && !all.includes(current)) all.unshift(current);
        await saveManualMeta(gameId, { found: true, path: current || all[0], alts: all });
      }
      const next = all.length > 1 ? all[(all.indexOf(current) + 1) % all.length] : null;
      if(!next){ busy = false; return showIdle(note('No alternative manual found for this game.')); }

      const kept = await fetchAndKeep(next);
      busy = false;
      if(!kept) return showIdle(note(NO_ROOM));
      await saveManualMeta(gameId, { found: true, path: next, alts: all });
      await showIdle();
      if(body.isConnected) openManualReader(gameId, title);
    }catch(e){
      console.error('Alternative manual failed:', e && e.message);
      busy = false;
      showIdle(note(FAILED));
    }
  }

  body.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-act]');
    if(!el || busy) return;
    const act = el.dataset.act;
    if(act === 'find') run();
    else if(act === 'alt') runAlternative();
    else if(act === 'read') openManualReader(gameId, title);
    else if(act === 'save'){
      const file = await manualFileGet(gameId);
      if(file) saveManualFile(file);
    }else if(act === 'remove'){
      await manualFileDelete(gameId).catch(() => {});
      showIdle();
    }
  });

  showIdle();
}

function saveManualFile(file){
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (file.name || 'manual').replace(/[\\/:*?"<>|]/g, '').replace(/\.pdf$/i, '') + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Viewer
// PDF.js loads from cdnjs the first time a manual is opened. Pages are drawn as canvases only
// when they scroll near the screen, so a 100-page manual doesn't render all at once.
let pdfjsPromise = null;
function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_URL;
    s.onload = () => {
      if(!window.pdfjsLib) return reject(new Error('PDF viewer failed to start'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('PDF viewer could not be loaded')); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

const manualReader = { el: null, doc: null, zoom: 1, pages: [], observer: null, token: 0, blobUrl: null, file: null };

function buildManualReader(){
  if(manualReader.el) return manualReader.el;
  const el = document.createElement('div');
  el.className = 'manual-reader';
  el.innerHTML = `
    <div class="manual-reader-head">
      <span class="manual-reader-title"></span>
      <span class="manual-reader-pages"></span>
      <button class="manual-reader-btn" data-act="zout" aria-label="Zoom out">−</button>
      <button class="manual-reader-btn" data-act="zin" aria-label="Zoom in">+</button>
      <button class="manual-reader-btn" data-act="close">Close</button>
    </div>
    <div class="manual-reader-body"></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', ev => {
    const act = ev.target.closest('[data-act]');
    if(!act) return;
    if(act.dataset.act === 'close') closeManualReader();
    else if(act.dataset.act === 'zin') setManualZoom(manualReader.zoom + 0.25);
    else if(act.dataset.act === 'zout') setManualZoom(manualReader.zoom - 0.25);
    else if(act.dataset.act === 'external') openManualExternally();
  });
  document.addEventListener('keydown', ev => {
    if(ev.key === 'Escape' && el.classList.contains('open')) closeManualReader();
  });
  // Back closes the profile behind the viewer, so close the viewer with it.
  window.addEventListener('popstate', () => { if(el.classList.contains('open')) closeManualReader(); });
  manualReader.el = el;
  return el;
}

function openManualExternally(){
  if(manualReader.file) window.open(URL.createObjectURL(manualReader.file.blob), '_blank');
}

function closeManualReader(){
  const el = manualReader.el;
  if(!el) return;
  manualReader.token++;
  if(manualReader.observer){ manualReader.observer.disconnect(); manualReader.observer = null; }
  if(manualReader.doc){ manualReader.doc.destroy().catch(() => {}); manualReader.doc = null; }
  manualReader.pages = [];
  manualReader.file = null;
  el.classList.remove('open');
  el.querySelector('.manual-reader-body').innerHTML = '';
  document.documentElement.classList.remove('manual-reader-open');
}

async function openManualReader(gameId, title){
  const file = await manualFileGet(gameId);
  if(!file) return;
  const el = buildManualReader();
  const body = el.querySelector('.manual-reader-body');
  const token = ++manualReader.token;
  manualReader.file = file;
  manualReader.zoom = 1;
  el.querySelector('.manual-reader-title').textContent = file.name || title;
  el.querySelector('.manual-reader-pages').textContent = '';
  body.innerHTML = '<div class="manual-reader-msg">Opening manual…</div>';
  el.classList.add('open');
  document.documentElement.classList.add('manual-reader-open');

  try{
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    if(token !== manualReader.token){ doc.destroy().catch(() => {}); return; }
    manualReader.doc = doc;
    await layoutManualPages(token);
  }catch(e){
    console.error('Manual viewer failed:', e && e.message);
    if(token !== manualReader.token) return;
    body.innerHTML = `<div class="manual-reader-msg">The built-in viewer could not start (it needs a connection the first time).<br><br>
      <button class="gd-manual-btn primary" data-act="external">Open in browser viewer</button></div>`;
  }
}

async function layoutManualPages(token){
  const { doc, el } = manualReader;
  const body = el.querySelector('.manual-reader-body');
  body.innerHTML = '';
  const width = Math.max(200, body.clientWidth - 16);
  const sizes = await Promise.all(Array.from({ length: doc.numPages }, (_, i) =>
    doc.getPage(i + 1).then(p => ({ page: p, vp: p.getViewport({ scale: 1 }) }))));
  if(token !== manualReader.token) return;

  if(manualReader.observer) manualReader.observer.disconnect();
  manualReader.pages = sizes.map(({ page, vp }, i) => {
    const box = document.createElement('div');
    box.className = 'manual-page';
    const scale = (width / vp.width) * manualReader.zoom;
    box.style.width = Math.floor(vp.width * scale) + 'px';
    box.style.height = Math.floor(vp.height * scale) + 'px';
    box.dataset.index = String(i);
    body.appendChild(box);
    return { box, page, scale, rendered: false, rendering: false };
  });

  manualReader.observer = new IntersectionObserver(entries => {
    entries.forEach(en => { if(en.isIntersecting) renderManualPage(Number(en.target.dataset.index), token); });
  }, { root: body, rootMargin: '600px 0px' });
  manualReader.pages.forEach(p => manualReader.observer.observe(p.box));

  const label = el.querySelector('.manual-reader-pages');
  const updateLabel = () => {
    const mid = body.getBoundingClientRect().top + body.clientHeight / 2;
    let current = 1;
    manualReader.pages.forEach((p, i) => { if(p.box.getBoundingClientRect().top <= mid) current = i + 1; });
    label.textContent = `${current} / ${doc.numPages}`;
  };
  body.onscroll = updateLabel;
  updateLabel();
}

async function renderManualPage(index, token){
  const p = manualReader.pages[index];
  if(!p || p.rendered || p.rendering || token !== manualReader.token) return;
  p.rendering = true;
  try{
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const vp = p.page.getViewport({ scale: p.scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if(token !== manualReader.token) return;
    p.box.innerHTML = '';
    p.box.appendChild(canvas);
    p.rendered = true;
  }catch(e){
    if(!(e && e.name === 'RenderingCancelledException')) console.error('Manual page failed:', e && e.message);
  }finally{ p.rendering = false; }
}

async function setManualZoom(z){
  const next = Math.min(3, Math.max(0.5, z));
  if(next === manualReader.zoom || !manualReader.doc) return;
  const body = manualReader.el.querySelector('.manual-reader-body');
  const frac = body.scrollHeight ? body.scrollTop / body.scrollHeight : 0; // keep roughly the same spot in the manual
  manualReader.zoom = next;
  const token = manualReader.token;
  await layoutManualPages(token);
  body.scrollTop = frac * body.scrollHeight;
}
