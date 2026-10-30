// Game guides: the GameFAQs text guide lookup on archive.org, the reader (search, bookmarks, text
// size) and the Game Guide panel.

// Length of a guide's readable text (HTML without its tags), to catch an empty guide.
function guideVisibleTextLength(guide){
  if(!guide || !guide.content) return 0;
  if(guide.kind === 'html'){
    const d = new DOMParser().parseFromString(guide.content, 'text/html');
    return (d.body ? d.body.textContent : '').trim().length;
  }
  return String(guide.content).trim().length;
}

// GameFAQs blocks automated requests, so guides come from archive.org's copy of its text guides.
// A per-console index (from the Guide Watch project, guides.retromodlab.com) maps a game name to a
// file in the archive, and archive.org extracts just that file from its 7z.
const ARCHIVE_ITEM = 'Gamespot_Gamefaqs_TXTs';
const ARCHIVE_INDEX_SITE = 'https://guides.retromodlab.com/app/guides-index';
// RetroAchievements console id -> the index's platform names, best first.
const ARCHIVE_PLATFORMS = {
  7:['nes'], 81:['famicomds','nes'], 3:['snes'], 2:['n64'], 4:['gameboy'], 6:['gbc','gameboy'],
  5:['gba'], 18:['ds'], 28:['virtualboy'], 1:['genesis'], 9:['segacd'], 10:['sega32x'],
  11:['sms'], 15:['gamegear','sms'], 39:['saturn'], 40:['dreamcast'], 33:['sg1000'], 12:['ps'],
  21:['ps2'], 41:['psp'], 8:['tg16'], 76:['tg16'], 14:['ngp','ngpocket'], 13:['lynx'],
  17:['jaguar'], 25:['atari2600'], 50:['atari5200'], 51:['atari7800'], 53:['wonderswan','wsc'],
  29:['msx'], 30:['c64'], 35:['amiga'], 43:['3do'], 44:['colecovision'], 45:['intellivision'],
  16:['gamecube'], 19:['wii']
};
const ARCHIVE_ROMAN = {};
['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv','xvi'].forEach((n, i) => { ARCHIVE_ROMAN[n] = String(i + 1); });
const archiveIndexMem = {};

// Must match the index's rules exactly: lowercase, (tags) and [tags] dropped, apostrophes removed,
// other punctuation spaced, leading articles and "and" dropped, roman numerals as figures.
function archiveKey(name){
  let text = String(name || '').toLowerCase().replace(/~[^~]*~/g, ' ');
  for(;;){
    const next = text.replace(/\([^()]*\)/g, ' ').replace(/\[[^\[\]]*\]/g, ' ');
    if(next === text) break;
    text = next;
  }
  text = text.replace(/['’]/g, '');
  return text.replace(/[^\p{L}\p{N}]/gu, ' ').split(' ')
    .filter(w => w && !['the','a','an','and'].includes(w))
    .map(w => ARCHIVE_ROMAN[w] || w).join(' ');
}

async function archiveFetch(url, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try{
    const res = await fetch(url, { signal: controller.signal });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  }catch(e){
    if(e.name === 'AbortError') throw new Error('timed out');
    throw e;
  }finally{
    clearTimeout(timer);
  }
}

async function archiveIndex(platform){
  if(archiveIndexMem[platform]) return archiveIndexMem[platform];
  const cacheKey = 'guide-archive-index:' + platform;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const cached = JSON.parse(r.value);
      if(cached && cached.data && Date.now() - cached.ts < 30 * 24 * 60 * 60 * 1000){
        archiveIndexMem[platform] = cached.data;
        return cached.data;
      }
    }
  }catch(e){}
  let data;
  try{
    const res = await archiveFetch(ARCHIVE_INDEX_SITE + '/' + platform + '.json', 30000);
    data = await res.json();
  }catch(e){
    throw new Error('Could not load the guide index (' + e.message + ')');
  }
  archiveIndexMem[platform] = data;
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}

// archive.org extracts one file from inside a 7z on request; an HTML answer is an error page.
async function archiveExtract(archive, inside){
  const number = parseInt(String(archive).replace(/^gen/, '').replace(/\.7z$/, ''), 10);
  if(!Number.isFinite(number)) return null;
  const member = `gamefaqs.gamespot.com.txt.faqs.${number}.gen.7z`;
  // Encoded like Java's URLEncoder (what the index was built against): also escape ! ' ( ) ~
  const encInside = encodeURIComponent(inside).replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const url = `https://archive.org/download/${ARCHIVE_ITEM}/${ARCHIVE_ITEM}%2F${member}/${encInside}`;
  let buf;
  try{
    const res = await archiveFetch(url, 90000);
    buf = await res.arrayBuffer();
  }catch(e){
    throw new Error('Could not download from archive.org (' + e.message + ')');
  }
  if(buf.byteLength < 200) return null;
  let text;
  try{ text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch(e){ text = new TextDecoder('windows-1252').decode(buf); } // older guides aren't UTF-8
  if(text.trimStart().startsWith('<')) return null; // an error page, not a guide
  return text;
}

async function downloadGuideFromArchive(gameId, title, consoleId, onStatus){
  const platforms = ARCHIVE_PLATFORMS[consoleId];
  if(!platforms) throw new Error("The archive doesn't cover this console.");

  const names = [];
  const add = n => { const k = archiveKey(n); if(k && !names.includes(k)) names.push(k); };
  add(title);
  [' - ', ': '].forEach(sep => {
    const i = title.indexOf(sep);
    if(i >= 0){ add(title.slice(i + sep.length)); add(title.slice(0, i)); }
  });

  let lastErr = null;
  for(const platform of platforms){
    if(onStatus) onStatus('Loading the ' + platform + ' guide index…');
    let index;
    try{ index = await archiveIndex(platform); }
    catch(e){ lastErr = e; continue; }

    // Exact keys first; then, for each name, the closest key containing all its words
    // plus at most two more (RA says "Aladdin", the archive files "Disney's Aladdin").
    const keys = Object.keys(index);
    const tryKeys = [...names];
    names.forEach(name => {
      const words = new Set(name.split(' '));
      let best = null;
      keys.forEach(k => {
        const kw = k.split(' ');
        const extra = kw.length - words.size;
        if(extra >= 1 && extra <= 2 && [...words].every(w => kw.includes(w)) && (!best || k.length < best.length)) best = k;
      });
      if(best) tryKeys.push(best);
    });

    for(const name of [...new Set(tryKeys)]){
      const entries = index[name];
      if(!entries) continue;
      // An entry is [title, archive, path inside, size KB]; several are nested when a game has more.
      const candidates = (Array.isArray(entries[0]) ? entries : [entries])
        .filter(c => Array.isArray(c) && c[1] && c[2])
        .sort((a, b) => (Number(b[3]) || 0) - (Number(a[3]) || 0)); // longest first: a walkthrough, not a cheat list
      for(const c of candidates){
        if(onStatus) onStatus('Downloading the guide…');
        let text;
        try{ text = await archiveExtract(c[1], c[2]); }
        catch(e){ lastErr = e; continue; }
        if(!text) continue;
        const guide = { filename: `${title}.txt`, kind: 'text', content: text, scrollFrac: 0, savedAt: Date.now() };
        await addGuide(gameId, guide);
        return guide;
      }
    }
  }
  if(lastErr) throw lastErr;
  throw new Error(`No guide for “${title}” in the archive. Try “Paste Guide Text” instead.`);
}

function openInExternalBrowser(url){
  window.open(url, '_blank', 'noopener');
}

function renderGuideSearchStep(title){
  return `
    <p style="font-size:0.7688rem;color:var(--muted);margin:0;line-height:1.55;">Find your own guide on GameFAQs: click the link, choose your guide, select and copy all text, hit that Paste Guide Text button, then Paste and Save.</p>
    <a href="https://gamefaqs.gamespot.com/search?game=${encodeURIComponent(title)}" id="guide-gf-link" target="_blank" rel="noopener" style="font-size:0.7063rem;color:var(--teal);text-decoration:none;align-self:flex-start;">Search GameFAQs for "${title}" ↗</a>
  `;
}
function renderGuideNoGuidePanel(gameId, title, consoleId, isAdding){
  const archiveSection = ARCHIVE_PLATFORMS[consoleId] ? `
      <button class="guide-btn guide-btn-primary" id="guide-archive-btn">Download from GameFAQs Archive</button>
      <p class="guide-status-text" id="guide-archive-status">Use the guide saved on the GameFAQs Archive. To use a different guide, see below.</p>
      <div class="guide-divider">or</div>` : '';
  return `
    <div style="display:flex;flex-direction:column;gap:10px;" id="guide-empty-wrap">
      ${isAdding ? '<button class="guide-btn guide-btn-ghost" id="guide-cancel-btn" style="flex:none;">‹ Back to saved guides</button>' : ''}
      ${archiveSection}
      ${renderRaGuideSection()}
      ${renderGuideSearchStep(title)}
      <button class="guide-btn guide-btn-outline" id="guide-paste-btn">Paste Guide Text</button>
      <div id="guide-paste-box" style="display:none;flex-direction:column;gap:8px;">
        <textarea id="guide-paste-text" rows="8" placeholder="Paste the guide text here…" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:9px 10px;font-family:'Space Mono',monospace;font-size:0.75rem;"></textarea>
        <button class="guide-btn guide-btn-primary" id="guide-paste-save">Save Guide</button>
        <p class="guide-status-text err" id="guide-paste-error" style="display:none;"></p>
      </div>
      <div class="guide-divider">or</div>
      <input type="file" id="guide-file-input" accept=".txt,.md,.html,.htm,.pdf" style="display:none;">
      <button class="guide-btn guide-btn-outline" id="guide-import-btn">Import your own saved Guide File (pdf, text, html)</button>
      <div id="guide-import-error"></div>
    </div>
  `;
}

// One row per saved guide: name, kind, and how far in the reading position is (not for PDFs).
function renderGuideListItem(guide){
  const pct = Math.round((guide.scrollFrac || 0) * 100);
  const pctLabel = guide.kind === 'pdf' ? '' : `${pct}% read`;
  const kind = guide.source === 'ra-guides' ? 'RA GUIDE' : String(guide.kind || 'text').toUpperCase();
  return `
    <div class="guide-list-item" data-guide-id="${esc(guide.id)}">
      <div class="guide-list-item-info">
        <span class="guide-list-item-name">${esc(guide.filename || 'Untitled guide')}</span>
        <span class="guide-list-item-meta">${kind}${pctLabel ? ' · ' + pctLabel : ''}</span>
      </div>
      <div class="guide-list-item-actions">
        <button class="guide-list-item-btn" data-action="read" type="button">Read</button>
        <button class="guide-list-item-btn" data-action="rename" type="button">Rename</button>
        <button class="guide-list-item-btn danger" data-action="remove" type="button">Remove</button>
      </div>
    </div>
  `;
}

function renderGuidePanelInner(gameId, title, guides, consoleId){
  if(!guides || guides.length === 0){
    return renderGuideNoGuidePanel(gameId, title, consoleId);
  }
  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div class="guide-list">${guides.map(renderGuideListItem).join('')}</div>
      <button class="guide-btn guide-btn-outline" id="guide-add-another-btn">+ Add another guide</button>
      <div id="guide-import-error"></div>
    </div>
  `;
}

// Used by both RA and non-RA game profiles.
function setupGameGuideUI(gameId, title, card, consoleId){
  const guideBtn = card.querySelector('#modal-guide-btn');
  const guideWrap = card.querySelector('#modal-guide-panel');
  if(!guideBtn || !guideWrap) return;

  let guides = []; // every guide saved for this game
  let guideLoaded = false;

  const refreshList = async () => {
    guides = await loadGuides(gameId);
    guideWrap.innerHTML = renderGuidePanelInner(gameId, title, guides, consoleId);
    wireGuidePanelButtons();
  };

  function wireGuidePanelButtons(){
    const fileInput = guideWrap.querySelector('#guide-file-input');
    const importBtn = guideWrap.querySelector('#guide-import-btn');
    const addAnotherBtn = guideWrap.querySelector('#guide-add-another-btn');
    const errorEl = guideWrap.querySelector('#guide-import-error');
    const triggerBtn = importBtn;
    const cancelBtn = guideWrap.querySelector('#guide-cancel-btn');

    const archiveBtn = guideWrap.querySelector('#guide-archive-btn');
    const archiveStatus = guideWrap.querySelector('#guide-archive-status');
    if(archiveBtn) archiveBtn.addEventListener('click', async () => {
      archiveBtn.disabled = true;
      archiveStatus.className = 'guide-status-text';
      archiveStatus.textContent = 'Looking in the archive…';
      try{
        await downloadGuideFromArchive(gameId, title, consoleId, msg => { archiveStatus.textContent = msg; });
        await refreshList();
      }catch(e){
        archiveBtn.disabled = false;
        archiveStatus.className = 'guide-status-text err';
        archiveStatus.textContent = e.message;
      }
    });

    wireRaGuideSection(guideWrap, gameId, title, consoleId, refreshList);

    const gfLink = guideWrap.querySelector('#guide-gf-link');
    // Goes straight to the game's own GameFAQs guides page when its GameFAQs number can be found (the same lookup
    // "Need Cheats?" uses); otherwise to a search for the title.
    if(gfLink) gfLink.addEventListener('click', async (e) => {
      e.preventDefault();
      let target = gfLink.href;
      const label = gfLink.textContent;
      gfLink.textContent = 'Finding the guides page…';
      try{
        const entry = (typeof libraryData !== 'undefined' ? libraryData : []).find(g => Number(g.GameID) === Number(gameId));
        const r = await resolveCheatsUrl(gameId, title, entry ? entry.ConsoleName : '');
        const m = /\/-\/(\d+)-\/cheats$/.exec(r.url || '');
        if(m) target = `https://gamefaqs.gamespot.com/-/${m[1]}-/faqs`;
      }catch(err){ /* keep the search link */ }
      gfLink.textContent = label;
      openInExternalBrowser(target);
    });

    const pasteBtn = guideWrap.querySelector('#guide-paste-btn');
    const pasteBox = guideWrap.querySelector('#guide-paste-box');
    const pasteText = guideWrap.querySelector('#guide-paste-text');
    const pasteSave = guideWrap.querySelector('#guide-paste-save');
    const pasteErr = guideWrap.querySelector('#guide-paste-error');
    if(pasteBtn && pasteBox) pasteBtn.addEventListener('click', () => {
      pasteBox.style.display = pasteBox.style.display === 'none' ? 'flex' : 'none';
      if(pasteBox.style.display === 'flex' && pasteText) pasteText.focus();
    });
    if(pasteSave) pasteSave.addEventListener('click', async () => {
      const text = (pasteText.value || '').trim();
      if(text.length < 50){
        pasteErr.textContent = 'Paste the guide text first.';
        pasteErr.style.display = 'block';
        return;
      }
      pasteSave.disabled = true;
      try{
        const guide = { filename: `${title}.txt`, kind: 'text', content: text, scrollFrac: 0, savedAt: Date.now() };
        await addGuide(gameId, guide);
        await refreshList();
      }catch(e){
        pasteSave.disabled = false;
        pasteErr.textContent = 'Could not save: ' + e.message;
        pasteErr.style.display = 'block';
      }
    });

    if(triggerBtn && fileInput) triggerBtn.addEventListener('click', () => fileInput.click());
    if(addAnotherBtn) addAnotherBtn.addEventListener('click', () => {
      guideWrap.innerHTML = renderGuideNoGuidePanel(gameId, title, consoleId, true);
      wireGuidePanelButtons();
    });
    if(cancelBtn) cancelBtn.addEventListener('click', () => {
      guideWrap.innerHTML = renderGuidePanelInner(gameId, title, guides, consoleId);
      wireGuidePanelButtons();
    });
    if(fileInput) fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if(!file) return;
      if(errorEl) errorEl.innerHTML = '';
      const prevLabel = triggerBtn.textContent;
      triggerBtn.textContent = 'Importing…';
      triggerBtn.disabled = true;
      try{
        await importGuideFile(gameId, file);
        await refreshList();
      }catch(e){
        triggerBtn.textContent = prevLabel;
        triggerBtn.disabled = false;
        if(errorEl) errorEl.innerHTML = `<p style="font-size:0.725rem;color:var(--danger);margin:6px 0 0;">Could not import that file: ${e.message}</p>`;
      }
    });

    const listEl = guideWrap.querySelector('.guide-list');
    if(listEl) listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if(!btn) return;
      const row = btn.closest('[data-guide-id]');
      const guideId = row && row.getAttribute('data-guide-id');
      const guide = guides.find(g => g.id === guideId);
      if(!guide) return;
      if(btn.dataset.action === 'read'){
        openGuideReader(gameId, title, guide);
      }else if(btn.dataset.action === 'rename'){
        // Swap the row's name for an editable box with Save / Cancel.
        const info = row.querySelector('.guide-list-item-info');
        const actions = row.querySelector('.guide-list-item-actions');
        row.classList.add('renaming');
        info.innerHTML = `<input type="text" class="guide-rename-input" maxlength="120" value="${esc(guide.filename || '')}" aria-label="Guide name">`;
        actions.innerHTML = `
          <button class="guide-list-item-btn" data-action="rename-save" type="button">Save</button>
          <button class="guide-list-item-btn danger" data-action="rename-cancel" type="button">Cancel</button>`;
        const input = info.querySelector('input');
        input.focus(); input.select();
        input.addEventListener('keydown', (ev) => {
          if(ev.key === 'Enter'){ ev.preventDefault(); actions.querySelector('[data-action="rename-save"]').click(); }
          else if(ev.key === 'Escape'){ ev.preventDefault(); actions.querySelector('[data-action="rename-cancel"]').click(); }
        });
      }else if(btn.dataset.action === 'rename-save'){
        const input = row.querySelector('.guide-rename-input');
        const name = (input && input.value || '').trim();
        if(!name){ if(input) input.focus(); return; }
        btn.disabled = true;
        guides = await renameGuide(gameId, guideId, name);
        guideWrap.innerHTML = renderGuidePanelInner(gameId, title, guides, consoleId);
        wireGuidePanelButtons();
      }else if(btn.dataset.action === 'rename-cancel'){
        guideWrap.innerHTML = renderGuidePanelInner(gameId, title, guides, consoleId);
        wireGuidePanelButtons();
      }else if(btn.dataset.action === 'remove'){
        btn.disabled = true;
        guides = await deleteGuide(gameId, guideId);
        guideWrap.innerHTML = renderGuidePanelInner(gameId, title, guides, consoleId);
        wireGuidePanelButtons();
      }
    });
  }

  guideBtn.addEventListener('click', async () => {
    const nowOpen = guideWrap.style.display === 'none';
    guideWrap.style.display = nowOpen ? 'block' : 'none';
    guideBtn.classList.toggle('open', nowOpen);
    if(nowOpen && !guideLoaded){
      guideLoaded = true;
      guideWrap.innerHTML = '<div class="achievements-list-loading">Loading…</div>';
      guides = await loadGuides(gameId);
      if(card.dataset.gameId !== String(gameId)) return; // user moved on
      guideWrap.innerHTML = renderGuidePanelInner(gameId, title, guides, consoleId);
      wireGuidePanelButtons();
    }
  });
}

let guideReaderScrollGameId = null; // which game's guide the reader is currently showing, for the debounced scroll-position save below
let guideReaderScrollTimer = null;

function setupGuideScrollTracking(body, gameId, guide){
  body.onscroll = () => {
    clearTimeout(guideReaderScrollTimer);
    guideReaderScrollTimer = setTimeout(async () => {
      if(guideReaderScrollGameId !== gameId) return; // reader moved on since this fired
      const max = body.scrollHeight - body.clientHeight;
      guide.scrollFrac = max > 0 ? body.scrollTop / max : 0;
      await updateGuide(gameId, guide);
    }, 600);
  };
}

// Search and bookmarks work on text and HTML guides. Positions are character offsets into the text,
// so they survive text size changes and rotation.
let readerGuide = null, readerGameId = null, readerIndex = null;
const findState = { ranges: [], starts: [], idx: -1, origin: null, capped: false, timer: null };
const hasHighlightAPI = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
const isReaderOpen = () => $('#guide-reader-overlay').classList.contains('open');

function getReaderIndex(){
  if(readerIndex) return readerIndex;
  const body = $('#guide-reader-body');
  const nodes = [], parts = [], starts = new Map();
  let pos = 0;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n;
  while((n = walker.nextNode())){
    const len = n.data.length;
    if(!len) continue;
    nodes.push({ node: n, start: pos, len });
    starts.set(n, pos);
    parts.push(n.data);
    pos += len;
  }
  readerIndex = { nodes, starts, text: parts.join(''), total: pos };
  return readerIndex;
}
function locateOffset(off){
  const { nodes } = getReaderIndex();
  if(!nodes.length) return null;
  let lo = 0, hi = nodes.length - 1;
  while(lo < hi){
    const mid = (lo + hi + 1) >> 1;
    if(nodes[mid].start <= off) lo = mid; else hi = mid - 1;
  }
  const e = nodes[lo];
  return { node: e.node, offset: Math.min(Math.max(off - e.start, 0), e.len) };
}
// Text offset of the line at the top of the reading area.
function offsetAtViewportTop(){
  const body = $('#guide-reader-body');
  const idx = getReaderIndex();
  const r = body.getBoundingClientRect();
  const x = r.left + 18, y = r.top + 24; // just inside the left padding, so it lands at the start of the line
  let node = null, off = 0;
  if(document.caretRangeFromPoint){
    const cr = document.caretRangeFromPoint(x, y);
    if(cr){ node = cr.startContainer; off = cr.startOffset; }
  }else if(document.caretPositionFromPoint){
    const cp = document.caretPositionFromPoint(x, y);
    if(cp){ node = cp.offsetNode; off = cp.offset; }
  }
  if(node && idx.starts.has(node)) return idx.starts.get(node) + off;
  const max = body.scrollHeight - body.clientHeight;
  return max > 0 ? Math.floor((body.scrollTop / max) * idx.total) : 0;
}
// Scrolls so the range sits about a third of the way down the reading area.
function scrollBodyToRange(range){
  const body = $('#guide-reader-body');
  const rr = range.getBoundingClientRect();
  if(!rr.height && !rr.width) return;
  const target = body.scrollTop + (rr.top - body.getBoundingClientRect().top) - body.clientHeight * 0.3;
  body.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
}
function rangeAtOffset(off){
  const loc = locateOffset(off);
  if(!loc) return null;
  const len = loc.node.data.length;
  const s = Math.min(loc.offset, Math.max(0, len - 1));
  const r = document.createRange();
  r.setStart(loc.node, s);
  r.setEnd(loc.node, Math.min(s + 1, len));
  return r;
}
function setHighlight(name, ranges, priority){
  if(!hasHighlightAPI) return;
  if(!ranges.length){ CSS.highlights.delete(name); return; }
  const h = new Highlight(...ranges);
  if(priority) h.priority = priority;
  CSS.highlights.set(name, h);
}

// search
function updateFindButtons(){
  const has = findState.ranges.length > 0;
  $('#guide-find-prev').disabled = !has;
  $('#guide-find-next').disabled = !has && !$('#guide-find-input').value.trim();
  $('#guide-find-back').disabled = findState.origin === null;
}
function clearFind(){
  findState.ranges = []; findState.starts = []; findState.idx = -1; findState.capped = false;
  if(hasHighlightAPI){ CSS.highlights.delete('guide-find'); CSS.highlights.delete('guide-find-current'); }
  $('#guide-find-count').textContent = '';
  updateFindButtons();
}
function showMatch(i){
  const n = findState.ranges.length;
  if(!n) return;
  i = ((i % n) + n) % n;
  findState.idx = i;
  const r = findState.ranges[i];
  if(hasHighlightAPI){
    // Painting thousands of highlights at once locks the page up, so only the matches around this one are painted.
    setHighlight('guide-find', findState.ranges.slice(Math.max(0, i - 60), i + 60), 0);
    setHighlight('guide-find-current', [r], 1);
  }else{
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  scrollBodyToRange(r);
  $('#guide-find-count').textContent = `${i + 1} of ${n}${findState.capped ? '+' : ''}`;
}
function runFind(){
  const prevStart = findState.idx >= 0 ? findState.starts[findState.idx] : null;
  clearFind();
  const raw = $('#guide-find-input').value.trim();
  if(!raw){ updateFindButtons(); return; }
  if(raw.length < 2){ $('#guide-find-count').textContent = 'Type 2+ letters'; return; }
  const needle = raw.toLowerCase();
  const idx = getReaderIndex();
  const CAP = 400; // a short search matches everywhere; more than this is never useful to step through
  const ranges = [], starts = [];
  outer: for(const e of idx.nodes){
    const t = e.node.data.toLowerCase();
    let i = t.indexOf(needle);
    while(i !== -1){
      const r = document.createRange();
      r.setStart(e.node, i);
      r.setEnd(e.node, i + needle.length);
      ranges.push(r); starts.push(e.start + i);
      if(ranges.length >= CAP){ findState.capped = true; break outer; }
      i = t.indexOf(needle, i + needle.length);
    }
  }
  findState.ranges = ranges; findState.starts = starts;
  if(!ranges.length){ $('#guide-find-count').textContent = 'No matches'; updateFindButtons(); return; }
  // Start at the first match at or after where you are reading, not the top of the guide.
  const here = prevStart !== null ? prevStart : offsetAtViewportTop();
  let lo = 0, hi = starts.length;
  while(lo < hi){ const mid = (lo + hi) >> 1; if(starts[mid] < here) lo = mid + 1; else hi = mid; }
  updateFindButtons();
  showMatch(lo >= ranges.length ? 0 : lo);
}
function stepMatch(delta){
  if(!findState.ranges.length){
    if(delta > 0 && $('#guide-find-input').value.trim()) runFind();
    return;
  }
  showMatch(findState.idx + delta);
}

// bookmarks
function renderBookmarkMarks(){
  const body = $('#guide-reader-body');
  body.querySelectorAll('.guide-bm-mark').forEach(el => el.remove());
  if(hasHighlightAPI) CSS.highlights.delete('guide-bookmark');
  if(!readerGuide || readerGuide.kind === 'pdf' || !(readerGuide.bookmarks || []).length) return;
  const idx = getReaderIndex();
  if(!idx.nodes.length) return;
  const bodyTop = body.getBoundingClientRect().top;
  const tints = [];
  readerGuide.bookmarks.forEach(b => {
    const loc = locateOffset(b.o);
    const r = rangeAtOffset(b.o);
    if(!loc || !r) return;
    const rect = r.getBoundingClientRect();
    if(!rect.height) return;
    const mark = document.createElement('div');
    mark.className = 'guide-bm-mark';
    mark.style.top = (rect.top - bodyTop + body.scrollTop) + 'px';
    mark.style.height = rect.height + 'px';
    body.appendChild(mark);
    // Tint the rest of that line of text too.
    let end = idx.text.indexOf('\n', b.o);
    if(end < 0) end = idx.text.length;
    end = Math.min(end, b.o + 160);
    const tEnd = Math.min(loc.offset + (end - b.o), loc.node.data.length);
    if(tEnd > loc.offset){
      const tr = document.createRange();
      tr.setStart(loc.node, loc.offset);
      tr.setEnd(loc.node, tEnd);
      tints.push(tr);
    }
  });
  setHighlight('guide-bookmark', tints, 0);
}
function renderMarksList(){
  const list = $('#guide-marks-list');
  list.innerHTML = '';
  const marks = (readerGuide && readerGuide.bookmarks) || [];
  if(!marks.length){
    const p = document.createElement('p');
    p.className = 'guide-marks-empty';
    p.textContent = 'No bookmarks yet. Scroll to the spot you want, then tap “Bookmark top of screen”.';
    list.appendChild(p);
    return;
  }
  const total = getReaderIndex().total || 1;
  marks.forEach(m => {
    const row = document.createElement('div');
    row.className = 'guide-marks-row';
    const go = document.createElement('button');
    go.className = 'guide-marks-go';
    const pct = document.createElement('span');
    pct.className = 'pct';
    pct.textContent = Math.round((m.o / total) * 100) + '%';
    go.appendChild(pct);
    go.appendChild(document.createTextNode(m.s || '(bookmark)'));
    go.addEventListener('click', () => {
      const r = rangeAtOffset(m.o);
      closeToolPanels();
      if(r) scrollBodyToRange(r);
    });
    const del = document.createElement('button');
    del.className = 'guide-marks-del';
    del.setAttribute('aria-label', 'Delete bookmark');
    del.textContent = '×';
    del.addEventListener('click', async () => {
      readerGuide.bookmarks = readerGuide.bookmarks.filter(x => x !== m);
      renderBookmarkMarks();
      renderMarksList();
      await updateGuide(readerGameId, readerGuide);
    });
    row.appendChild(go);
    row.appendChild(del);
    list.appendChild(row);
  });
}
async function addBookmarkHere(){
  if(!readerGuide) return;
  const idx = getReaderIndex();
  const msg = $('#guide-marks-msg');
  if(!idx.total) return;
  let o = Math.min(offsetAtViewportTop(), idx.total - 1);
  while(o < idx.total - 1 && /\s/.test(idx.text[o])) o++; // land on real text, not a blank line
  const marks = readerGuide.bookmarks = readerGuide.bookmarks || [];
  if(marks.some(m => Math.abs(m.o - o) < 30)){ msg.textContent = 'Already bookmarked here.'; return; }
  if(marks.length >= 30){ msg.textContent = 'You can keep up to 30 bookmarks. Delete one to add another.'; return; }
  msg.textContent = '';
  marks.push({ o, s: idx.text.substr(o, 70).replace(/\s+/g, ' ').trim(), t: Date.now() });
  marks.sort((a, b) => a.o - b.o);
  renderBookmarkMarks();
  renderMarksList();
  await updateGuide(readerGameId, readerGuide);
}

// panels
function closeToolPanels(){
  const findWasOpen = $('#guide-find-bar').classList.contains('open');
  $('#guide-find-bar').classList.remove('open');
  $('#guide-marks-panel').classList.remove('open');
  $('#guide-text-panel').classList.remove('open');
  $('#guide-find-btn').classList.remove('active');
  $('#guide-marks-btn').classList.remove('active');
  $('#guide-text-btn').classList.remove('active');
  if(findWasOpen){ clearTimeout(findState.timer); clearFind(); findState.origin = null; }
  $('#guide-marks-msg').textContent = '';
}
function toggleFindBar(){
  const willOpen = !$('#guide-find-bar').classList.contains('open');
  closeToolPanels();
  if(!willOpen) return;
  $('#guide-find-bar').classList.add('open');
  $('#guide-find-btn').classList.add('active');
  findState.origin = $('#guide-reader-body').scrollTop; // where you were before searching
  updateFindButtons();
  const input = $('#guide-find-input');
  input.focus();
  input.select();
}
function toggleMarksPanel(){
  const willOpen = !$('#guide-marks-panel').classList.contains('open');
  closeToolPanels();
  if(!willOpen) return;
  $('#guide-marks-panel').classList.add('open');
  $('#guide-marks-btn').classList.add('active');
  renderMarksList();
}
$('#guide-find-btn').addEventListener('click', toggleFindBar);
$('#guide-marks-btn').addEventListener('click', toggleMarksPanel);
$('#guide-find-close').addEventListener('click', closeToolPanels);
$('#guide-find-prev').addEventListener('click', () => stepMatch(-1));
$('#guide-find-next').addEventListener('click', () => stepMatch(1));
$('#guide-find-go').addEventListener('click', () => { clearTimeout(findState.timer); runFind(); });
$('#guide-find-back').addEventListener('click', () => {
  if(findState.origin !== null) $('#guide-reader-body').scrollTo({ top: findState.origin, behavior: 'auto' });
});
// Nothing is searched while you type: finish the word, then tap the → button. That avoids hunting for
// thousands of matches on the first couple of letters. The → button beside the box searches (handhelds have no Enter key).
$('#guide-find-input').addEventListener('input', () => {
  clearTimeout(findState.timer);
  clearFind();
  const has = $('#guide-find-input').value.trim().length > 0;
  $('#guide-find-count').textContent = has ? 'Tap → to search' : '';
  updateFindButtons();
});
$('#guide-find-input').addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    clearTimeout(findState.timer);
    if(findState.ranges.length) stepMatch(e.shiftKey ? -1 : 1); else runFind();
  }
});
$('#guide-marks-add').addEventListener('click', addBookmarkHere);
// Re-place the bookmark marks when the reading area changes shape (rotation, keyboard).
let readerResizeTimer = null;
new ResizeObserver(() => {
  if(!isReaderOpen() || !readerGuide) return;
  clearTimeout(readerResizeTimer);
  readerResizeTimer = setTimeout(renderBookmarkMarks, 120);
}).observe($('#guide-reader-body'));

// Reader text size, font and bold, one setting for all guides. Two monospace fonts (ASCII art stays
// lined up) and two easier-reading ones.
const GUIDE_FONT_MIN = 10, GUIDE_FONT_MAX = 32, GUIDE_FONT_DEFAULT = 14;
const GUIDE_FONTS = {
  space:   { label: 'Space Mono',  css: "'Space Mono', monospace" },
  sysmono: { label: 'System Mono', css: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Roboto Mono', 'Courier New', monospace" },
  sans:    { label: 'Sans',        css: "'Inter', system-ui, Roboto, sans-serif" },
  serif:   { label: 'Serif',       css: "Georgia, 'Noto Serif', 'Times New Roman', serif" }
};
const GUIDE_THEMES = {
  default: { label: 'Default' },
  retro:   { label: 'Retro' }
};
let guideFontSize = GUIDE_FONT_DEFAULT, guideFontKey = 'space', guideBold = false, guideTheme = 'default';
async function loadReaderPref(key){
  try{ const r = await window.storage.get(key, false); return r && r.value ? r.value : null; }
  catch(e){ return null; /* nothing saved yet */ }
}
async function saveReaderPref(key, val){
  try{ await window.storage.set(key, String(val), false); }catch(e){}
}
(async () => {
  const n = parseInt(await loadReaderPref('guide-font-size'), 10);
  if(n >= GUIDE_FONT_MIN && n <= GUIDE_FONT_MAX) guideFontSize = n;
  const f = await loadReaderPref('guide-font-family');
  if(f && GUIDE_FONTS[f]) guideFontKey = f;
  guideBold = (await loadReaderPref('guide-bold')) === '1';
  const th = await loadReaderPref('guide-theme');
  if(th && GUIDE_THEMES[th]) guideTheme = th;
})();

function updateTextPanel(){
  $('#guide-font-size-label').textContent = guideFontSize;
  $('#guide-font-dec').disabled = guideFontSize <= GUIDE_FONT_MIN;
  $('#guide-font-inc').disabled = guideFontSize >= GUIDE_FONT_MAX;
  $('#guide-bold-btn').classList.toggle('active', guideBold);
  $('#guide-bold-btn').setAttribute('aria-pressed', guideBold ? 'true' : 'false');
  document.querySelectorAll('#guide-font-options button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === guideFontKey);
  });
  document.querySelectorAll('#guide-theme-options button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === guideTheme);
  });
}
// With keepPlace, the line at the top of the screen stays there after the text reflows.
function applyGuideTextStyle(keepPlace){
  const body = $('#guide-reader-body');
  let anchor = null;
  if(keepPlace && readerGuide && readerGuide.kind !== 'pdf'){
    try{ anchor = offsetAtViewportTop(); }catch(e){}
  }
  body.style.setProperty('--guide-font-size', guideFontSize + 'px');
  body.style.setProperty('--guide-font', GUIDE_FONTS[guideFontKey].css);
  body.style.setProperty('--guide-weight', guideBold ? '700' : '400');
  $('#guide-reader-overlay').dataset.theme = guideTheme;
  updateTextPanel();
  if(keepPlace){
    requestAnimationFrame(() => {
      if(anchor !== null){
        const r = rangeAtOffset(anchor);
        const rr = r && r.getBoundingClientRect();
        if(rr && rr.height) body.scrollTop += rr.top - body.getBoundingClientRect().top - 6;
      }
      renderBookmarkMarks();
    });
  }
}
async function changeGuideFontSize(delta){
  const next = Math.min(GUIDE_FONT_MAX, Math.max(GUIDE_FONT_MIN, guideFontSize + delta));
  if(next === guideFontSize) return;
  guideFontSize = next;
  applyGuideTextStyle(true);
  await saveReaderPref('guide-font-size', next);
}
(function buildFontOptions(){
  const box = $('#guide-font-options');
  Object.keys(GUIDE_FONTS).forEach(key => {
    const btn = document.createElement('button');
    btn.dataset.font = key;
    btn.textContent = GUIDE_FONTS[key].label;
    btn.style.fontFamily = GUIDE_FONTS[key].css; // each choice previews in its own font
    btn.addEventListener('click', async () => {
      if(guideFontKey === key) return;
      guideFontKey = key;
      applyGuideTextStyle(true);
      await saveReaderPref('guide-font-family', key);
    });
    box.appendChild(btn);
  });
})();
(function buildThemeOptions(){
  const box = $('#guide-theme-options');
  Object.keys(GUIDE_THEMES).forEach(key => {
    const btn = document.createElement('button');
    btn.dataset.theme = key;
    btn.textContent = GUIDE_THEMES[key].label;
    btn.addEventListener('click', async () => {
      if(guideTheme === key) return;
      guideTheme = key;
      applyGuideTextStyle(false); // a color change doesn't reflow text, so no need to keep scroll anchor
      await saveReaderPref('guide-theme', key);
    });
    box.appendChild(btn);
  });
})();
$('#guide-font-dec').addEventListener('click', () => changeGuideFontSize(-1));
$('#guide-font-inc').addEventListener('click', () => changeGuideFontSize(1));
$('#guide-bold-btn').addEventListener('click', async () => {
  guideBold = !guideBold;
  applyGuideTextStyle(true);
  await saveReaderPref('guide-bold', guideBold ? '1' : '0');
});
$('#guide-text-btn').addEventListener('click', () => {
  const willOpen = !$('#guide-text-panel').classList.contains('open');
  closeToolPanels();
  if(!willOpen) return;
  $('#guide-text-panel').classList.add('open');
  $('#guide-text-btn').classList.add('active');
  updateTextPanel();
});

// Hide the top menu for a full-screen read; a small button in the corner brings it back.
function setReaderMenuHidden(hidden){
  closeToolPanels();
  $('#guide-reader-overlay').classList.toggle('menu-hidden', hidden);
}
$('#guide-menu-hide').addEventListener('click', () => setReaderMenuHidden(true));
$('#guide-menu-show').addEventListener('click', () => setReaderMenuHidden(false));

// In HTML guides, "#section" links scroll the reader and web links open in the browser.
function guideBodyLinkClick(e){
  const a = e.target.closest ? e.target.closest('a[href]') : null;
  if(!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if(href.charAt(0) === '#'){
    const body = $('#guide-reader-body');
    let id = href.slice(1);
    try{ id = decodeURIComponent(id); }catch(err){}
    const el = id ? Array.from(body.querySelectorAll('[id]')).find(n => n.id === id) : null;
    if(el) body.scrollTo({ top: Math.max(0, body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8), behavior: 'auto' });
    return;
  }
  if(/^https?:/i.test(a.href)) openInExternalBrowser(a.href);
}

function openGuideReader(gameId, title, guide){
  if(!guide) return;
  const overlay = $('#guide-reader-overlay');
  const body = $('#guide-reader-body');
  $('#guide-reader-fn').textContent = guide.filename;
  body.onscroll = null;
  body.onclick = null;
  body.className = 'guide-reader-body';
  guideReaderScrollGameId = gameId;
  closeToolPanels();
  readerGuide = guide; readerGameId = gameId; readerIndex = null;
  guide.bookmarks = guide.bookmarks || [];
  // No reader tools for a PDF or an empty guide.
  $('#guide-reader-toolbar').style.display = (guide.kind === 'pdf' || !guide.content) ? 'none' : 'flex';
  applyGuideTextStyle(false);
  $('#guide-reader-overlay').classList.remove('menu-hidden');

  const showReaderMessage = (msg) => {
    body.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'guide-reader-empty';
    d.textContent = msg;
    body.appendChild(d);
  };

  if(!guide.content || (guide.kind !== 'pdf' && guideVisibleTextLength(guide) === 0)){
    showReaderMessage('This saved guide is empty. Tap Close, remove it, and download it again.');
  }else if(guide.kind === 'pdf'){
    body.innerHTML = `<iframe src="${guide.content}" title="${esc(guide.filename)}"></iframe>`;
  }else if(guide.kind === 'html'){
    body.classList.add('html-guide');
    try{
      body.innerHTML = guide.content;
      body.onclick = guideBodyLinkClick;
      setupGuideScrollTracking(body, gameId, guide);
    }catch(e){
      showReaderMessage('Could not display this guide: ' + e.message);
    }
  }else{
    const pre = document.createElement('pre');
    pre.textContent = guide.content;
    body.innerHTML = '';
    body.appendChild(pre);
    setupGuideScrollTracking(body, gameId, guide);
  }

  overlay.classList.add('open');
  requestAnimationFrame(() => {
    if(guide.scrollFrac && body.scrollHeight > body.clientHeight){
      body.scrollTop = guide.scrollFrac * (body.scrollHeight - body.clientHeight);
    }
    renderBookmarkMarks();
  });
}

function closeGuideReader(){
  closeToolPanels();
  if(hasHighlightAPI) CSS.highlights.delete('guide-bookmark');
  readerGuide = null; readerGameId = null; readerIndex = null;
  $('#guide-reader-overlay').classList.remove('open', 'menu-hidden');
  $('#guide-reader-body').innerHTML = '';
  $('#guide-reader-body').onscroll = null;
  $('#guide-reader-body').onclick = null;
  guideReaderScrollGameId = null;
}
$('#guide-reader-close').addEventListener('click', closeGuideReader);
