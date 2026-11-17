// Achievement lists, custom ordering, the missable filter, and beaten achievements.

// Usually already filled by getEstimatedHours(), which fetches the same endpoint on load.
async function getAchievementsList(gameId){
  if(achievementsListCache[gameId]) return achievementsListCache[gameId];
  const stored = await readStoredAchList(gameId);
  if(stored){
    achievementsListCache[gameId] = stored;
    return stored;
  }
  const data = await raFetch('API_GetGameInfoAndUserProgress.php', { g: gameId, a: 1 });
  const list = (data && data.Achievements)
    ? Object.values(data.Achievements).sort((a,b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0))
    : [];
  achievementsListCache[gameId] = list;
  if(list.length) await storeAchList(gameId, list);
  return list;
}

// GetGameInfoAndUserProgress doesn't always carry each achievement's type (missable,
// progression, win condition), but GetGameExtended does, and the modal already has it.
function attachAchievementTypes(list, ext){
  const extAch = ext && ext.Achievements;
  if(!extAch) return list;
  (list || []).forEach(a => {
    const id = a.ID ?? a.id;
    const match = extAch[id] ?? extAch[String(id)];
    const t = match && (match.type || match.Type);
    if(t) a.type = t;
  });
  return list;
}

function isMissable(a){
  return String((a && (a.Type || a.type)) || '').toLowerCase() === 'missable';
}

function achRowHtml(a, isLocked, isHardcoreMode, reorderMode){
  const badge = imgUrl('/Badge/' + a.BadgeName + (isLocked ? '_lock' : '') + '.png');
  const earnedDate = isHardcoreMode ? a.DateEarnedHardcore : a.DateEarned;
  const reorderControls = reorderMode
    ? `<div class="ach-reorder-controls">
           <button class="ach-move-btn" data-dir="up" type="button" aria-label="Move up">▲</button>
           <button class="ach-move-btn" data-dir="down" type="button" aria-label="Move down">▼</button>
         </div>`
    : '';
  return `
      <div class="ach-row ${isLocked ? 'locked' : ''}" data-id="${esc(a.ID ?? a.id)}">
        ${reorderControls}
        <img src="${esc(badge)}" alt="">
        <div class="info">
          <p class="t">${esc(a.Title || 'Untitled')}</p>
          <p class="d">${esc(a.Description || '')}</p>
          ${!isLocked ? `<p class="when">Unlocked ${timeAgo(earnedDate)}</p>` : ''}
        </div>
        ${isMissable(a) ? '<span class="ach-missable-badge" title="Missable: can be missed for good during a playthrough">!</span>' : ''}
        ${(!reorderMode && (a.ID ?? a.id)) ? `<a class="ach-ra-link" href="https://retroachievements.org/achievement/${encodeURIComponent(a.ID ?? a.id)}" target="_blank" rel="noopener" title="Open this achievement on RetroAchievements (comments &amp; discussion)" aria-label="Open ${esc(a.Title || 'achievement')} on RetroAchievements">RA</a>` : ''}
        <div class="pts">${esc(a.Points ?? '')}</div>
      </div>
    `;
}

// Achievements as a list or as tiles. The choice is the same for every game and stays until you switch back.
// A pinch on the tiles sets how many fit in a row, 3 to 6. At 3 each tile also shows the name and points;
// smaller tiles are just the badge. Tapping a tile shows its details in a bubble under it.
const ACH_TILES_KEY = 'app-ach-tiles', ACH_COLS_KEY = 'app-ach-cols';
let achTileView = false;
let achTileCols = 5;
(async function(){
  let changed = false;
  try{
    const v = await window.storage.get(ACH_TILES_KEY, false);
    if(v && v.value === '1'){ achTileView = true; changed = true; }
    const c = await window.storage.get(ACH_COLS_KEY, false);
    const n = c ? parseInt(c.value, 10) : NaN;
    if(n >= 3 && n <= 6){ changed = changed || n !== achTileCols; achTileCols = n; }
  }catch(e){}
  if(changed) achRerenderOpen();
})();

// Full screen (fullscreen-panels.js): List or Tiles as anywhere else. The tiles are small squares, as many to a
// row as you pinch to (4 to 16, remembered apart from the profile's 3 to 6), each framed teal when unlocked in
// casual and gold in hardcore.
const ACH_FS_COLS_KEY = 'app-ach-fs-cols';
let achFsCols = 8;
(async function(){
  try{
    const c = await window.storage.get(ACH_FS_COLS_KEY, false);
    const n = c ? parseInt(c.value, 10) : NaN;
    if(n >= 4 && n <= 16) achFsCols = n;
  }catch(e){}
})();
// Whether the achievements or beaten achievements are shown full screen right now.
function achFsOn(){
  return !!document.querySelector('#modal-card .achievements-list.fs-panel');
}
function achFsStep(more){
  const n = Math.min(16, Math.max(4, achFsCols + (more ? 1 : -1)));
  if(n === achFsCols) return false;
  achFsCols = n;
  hideAchBubble();
  document.querySelectorAll('.fs-panel .ach-tiles').forEach(g => g.style.setProperty('--ach-cols', n));
  if(window.glFsFit) window.glFsFit();
  return true;
}
function achFsSave(){
  try{ window.storage.set(ACH_FS_COLS_KEY, String(achFsCols), false); }catch(e){}
}
// The award pill at the right end of the full-screen bar (Mastered / Beaten, gold or teal as in the library).
// Nothing outside full screen, or when the game has no award yet.
function achFsPill(){
  if(!achFsOn()) return '';
  const card = document.getElementById('modal-card');
  const info = card && typeof awardInfo === 'function' ? awardInfo(card.dataset.awardKind || null) : null;
  return info ? `<span class="pill ${info.cls} ach-fs-pill">${info.label}</span>` : '';
}
function achShowTiles(){
  return achTileView;
}
function achGridCols(){
  return achFsOn() ? achFsCols : achTileCols;
}

function achTileHtml(a, isLocked, isHardcoreMode){
  // Full screen frames what was unlocked in either mode, so a casual unlock shows (teal) in hardcore mode too.
  const fs = achFsOn();
  const hc = !!a.DateEarnedHardcore, sc = !hc && !!a.DateEarned;
  if(fs && (hc || sc)) isLocked = false;
  const frame = fs ? (hc ? ' earned-hc' : sc ? ' earned-sc' : '') : '';
  const badge = imgUrl('/Badge/' + a.BadgeName + (isLocked ? '_lock' : '') + '.png');
  const earnedDate = fs ? (a.DateEarnedHardcore || a.DateEarned) : isHardcoreMode ? a.DateEarnedHardcore : a.DateEarned;
  const id = a.ID ?? a.id;
  return `
      <button type="button" class="ach-tile ${isLocked ? 'locked' : ''}${frame}" data-id="${esc(id)}"
        data-title="${esc(a.Title || 'Untitled')}" data-desc="${esc(a.Description || '')}" data-pts="${esc(a.Points ?? '')}"
        data-when="${isLocked ? '' : esc(timeAgo(earnedDate))}"${isMissable(a) ? ' data-missable="1"' : ''} aria-label="${esc(a.Title || 'Achievement')}">
        <img src="${esc(badge)}" alt="" draggable="false">
        ${isMissable(a) ? '<span class="ach-missable-badge ach-tile-miss" aria-hidden="true">!</span>' : ''}
        <span class="ach-tile-name">${esc(a.Title || 'Untitled')}</span>
        <span class="ach-tile-pts">${esc(a.Points ?? '')}</span>
      </button>
    `;
}
function achItemHtml(a, isLocked, isHardcoreMode, reorderMode){
  return achShowTiles() ? achTileHtml(a, isLocked, isHardcoreMode) : achRowHtml(a, isLocked, isHardcoreMode, reorderMode);
}
function achTilesClass(reorderMode){
  return 'ach-tiles' + (!achFsOn() && achTileCols <= 3 ? ' named' : '') + (reorderMode ? ' reordering' : '');
}

const ACH_ICON_TILES = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>';
const ACH_ICON_LIST = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/></svg>';

// Every open achievements panel is drawn again: the game's own list, its beaten list and any open subsets.
function achRerenderOpen(){
  try{
    if(typeof openAchievementsGameId !== 'undefined' && openAchievementsGameId != null){
      const w = document.getElementById('modal-achievements');
      if(w) renderAchWrapContent(w, openAchievementsGameId);
    }
    if(typeof openBeatenAchievementsGameId !== 'undefined' && openBeatenAchievementsGameId != null){
      const list = achievementsListCache[openBeatenAchievementsGameId];
      const w = document.getElementById('modal-beaten-achievements');
      if(w && list) w.innerHTML = renderBeatenAchievementsList(list, statsMode === 'hardcore');
    }
    if(typeof refreshOpenSubsetPanels === 'function') refreshOpenSubsetPanels();
  }catch(e){}
}

// Called by pinch-tiles.js. The grids on screen are changed where they are, so the pinch isn't lost.
function achTilesStep(bigger){
  if(achFsOn()) return achFsStep(!bigger);
  const n = Math.min(6, Math.max(3, achTileCols + (bigger ? -1 : 1)));
  if(n === achTileCols) return false;
  achTileCols = n;
  hideAchBubble();
  document.querySelectorAll('.ach-tiles').forEach(g => {
    g.style.setProperty('--ach-cols', n);
    g.classList.toggle('named', n <= 3);
  });
  return true;
}
function achTilesSave(){
  if(achFsOn()){ achFsSave(); return; }
  try{ window.storage.set(ACH_COLS_KEY, String(achTileCols), false); }catch(e){}
}

// The details bubble. It lives inside the grid, so it scrolls with it and goes when the grid is redrawn.
function hideAchBubble(){
  document.querySelectorAll('.ach-bubble').forEach(b => { const g = b.parentElement; b.remove(); if(g) g.style.paddingBottom = ''; });
  document.querySelectorAll('.ach-tile.on').forEach(t => t.classList.remove('on'));
}
function showAchBubble(tile){
  const grid = tile.closest('.ach-tiles');
  if(!grid) return;
  const wasOn = tile.classList.contains('on');
  hideAchBubble();
  if(wasOn) return; // tapping the same tile again closes it
  tile.classList.add('on');
  const d = tile.dataset;
  const locked = tile.classList.contains('locked');
  const bubble = document.createElement('div');
  bubble.className = 'ach-bubble';
  bubble.innerHTML = `
      <div class="ach-bubble-head">
        <p class="t">${esc(d.title)}</p>
        <span class="pts${locked ? ' locked' : ''}">${esc(d.pts)}</span>
      </div>
      ${d.desc ? `<p class="d">${esc(d.desc)}</p>` : ''}
      <div class="ach-bubble-foot">
        <span class="${locked ? 'locked' : 'when'}">${locked ? 'Locked' : 'Unlocked ' + esc(d.when)}</span>
        ${d.missable ? '<span class="ach-bubble-miss"><span class="ach-missable-badge ach-filter-icon" aria-hidden="true">!</span> Missable</span>' : ''}
        ${d.id ? `<a class="ach-ra-link" href="https://retroachievements.org/achievement/${encodeURIComponent(d.id)}" target="_blank" rel="noopener" aria-label="Open ${esc(d.title)} on RetroAchievements">RA</a>` : ''}
      </div>`;
  grid.appendChild(bubble);
  // Under the tile, kept inside the grid, with the little arrow pointing at the tile.
  const gw = grid.clientWidth;
  const bw = Math.min(gw - 8, 300);
  const centre = tile.offsetLeft + tile.offsetWidth / 2;
  const left = Math.max(4, Math.min(gw - bw - 4, centre - bw / 2));
  bubble.style.width = bw + 'px';
  bubble.style.left = left + 'px';
  bubble.style.setProperty('--arrow-x', Math.round(centre - left) + 'px');
  // The list cuts off anything past its edge, so a bubble under the bottom row goes above the tile instead,
  // or, when there's no room there either (a single row), the grid grows a little to fit it.
  const bh = bubble.offsetHeight;
  const below = tile.offsetTop + tile.offsetHeight + 8;
  const room = grid.clientHeight - 4;
  if(below + bh <= room){
    bubble.style.top = below + 'px';
  }else if(tile.offsetTop - bh - 8 >= 4){
    bubble.classList.add('above');
    bubble.style.top = (tile.offsetTop - bh - 8) + 'px';
  }else{
    bubble.style.top = below + 'px';
    grid.style.paddingBottom = (below + bh + 12 - grid.clientHeight + 8) + 'px';
  }
}

// One set of handlers for every list: the List / Tiles switch, tapping a tile, and tapping away from a bubble.
document.addEventListener('click', (e) => {
  const t = e.target;
  if(!t || !t.closest) return;
  const toggle = t.closest('.ach-view-toggle');
  if(toggle){
    const want = toggle.dataset.view ? toggle.dataset.view === 'tiles' : !achTileView;
    if(want === achTileView) return;
    achTileView = want;
    try{ window.storage.set(ACH_TILES_KEY, want ? '1' : '0', false); }catch(err){}
    achRerenderOpen();
    return;
  }
  const tile = t.closest('.ach-tile');
  if(tile && !tile.closest('.reordering')){ showAchBubble(tile); return; }
  if(!t.closest('.ach-bubble')) hideAchBubble();
});

// Custom achievement order, per game: an array of achievement IDs under its own key, so backups
// include it. Achievements added to the set later go at the end; IDs that no longer exist are ignored.
const achOrderCache = {}; // gameId -> array of IDs, or null

// Filter and reorder state per list, keyed by game ID (a game's list and its subsets' lists can be
// open together). The Missable / Locked toggles are remembered in localStorage.
const achPanelStates = {};
function achFilterKey(gameId){
  return `ach-filters:${(creds && creds.username ? creds.username : '').trim().toLowerCase()}:${gameId}`;
}
function loadAchFilters(gameId){
  try{
    const v = JSON.parse(localStorage.getItem(achFilterKey(gameId)) || '{}');
    return { missableOnly: !!v.missableOnly, lockedOnly: !!v.lockedOnly };
  }catch(e){ return { missableOnly: false, lockedOnly: false }; }
}
function saveAchFilters(gameId){
  const st = achPanelStates[gameId];
  if(!st) return;
  try{
    if(st.missableOnly || st.lockedOnly) localStorage.setItem(achFilterKey(gameId), JSON.stringify({ missableOnly: st.missableOnly, lockedOnly: st.lockedOnly }));
    else localStorage.removeItem(achFilterKey(gameId));
  }catch(e){}
}
function achState(gameId){
  if(!achPanelStates[gameId]) achPanelStates[gameId] = { ...loadAchFilters(gameId), reorderMode: false, importError: '' };
  return achPanelStates[gameId];
}
function resetAchState(gameId){
  delete achPanelStates[gameId];
}
function achOrderKey(gameId){
  return `ach-order:${creds.username.trim().toLowerCase()}:${gameId}`;
}
async function loadAchOrder(gameId){
  try{
    const r = await window.storage.get(achOrderKey(gameId), false);
    if(r && r.value){
      const arr = JSON.parse(r.value);
      if(Array.isArray(arr)){ achOrderCache[gameId] = arr; return arr; }
    }
  }catch(e){}
  achOrderCache[gameId] = null;
  return null;
}
async function saveAchOrder(gameId, ids){
  achOrderCache[gameId] = ids;
  try{ await window.storage.set(achOrderKey(gameId), JSON.stringify(ids), false); }
  catch(e){}
}
async function clearAchOrder(gameId){
  achOrderCache[gameId] = null;
  try{ await window.storage.delete(achOrderKey(gameId), false); }catch(e){}
}
// Export / import a custom order as a .json file. IDs, not positions, so it survives set changes.
function downloadAchOrderFile(gameId, gameTitle, ids){
  const payload = { type: 'glt-achievement-order', version: 1, gameId, gameTitle: gameTitle || '', order: ids };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = String(gameTitle || 'achievement').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 60);
  a.download = `${safeName || 'achievement'}-order.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
async function readAchOrderFile(file){
  const text = await file.text();
  let payload;
  try{ payload = JSON.parse(text); }
  catch(e){ throw new Error("That file isn't valid JSON."); }
  if(!payload || payload.type !== 'glt-achievement-order' || !Array.isArray(payload.order)){
    throw new Error("This doesn't look like an achievement-order file.");
  }
  return { gameId: Number(payload.gameId), ids: payload.order.map(String) };
}
function pickAchOrderFile(onFile){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    document.body.removeChild(input);
    if(file) onFile(file);
  });
  document.body.appendChild(input);
  input.click();
}

function applyAchOrder(list, order){
  if(!order) return list;
  const pos = new Map(order.map((id, i) => [String(id), i]));
  const idOf = (a) => String(a.ID ?? a.id);
  const known = list.filter(a => pos.has(idOf(a))).sort((a, b) => pos.get(idOf(a)) - pos.get(idOf(b)));
  const fresh = list.filter(a => !pos.has(idOf(a)));
  return known.concat(fresh);
}

// Default order: earned first, latest unlock on top, then locked in the set's order.
function splitEarnedLocked(list, isHardcoreMode){
  const date = (a) => isHardcoreMode ? a.DateEarnedHardcore : a.DateEarned;
  const unlockTime = (a) => {
    const t = Date.parse(String(date(a)).replace(' ', 'T') + 'Z');
    return isNaN(t) ? 0 : t;
  };
  return {
    earned: list.filter(a => date(a)).sort((a, b) => unlockTime(b) - unlockTime(a)),
    locked: list.filter(a => !date(a))
  };
}

function renderAchievementsList(list, isHardcoreMode, order, reorderMode){
  if(!list || list.length === 0) return '<div class="achievements-list-loading">No achievement data available.</div>';
  // Hardcore only counts hardcore unlocks; casual counts any (DateEarned is set on every unlock).
  const isEarned = (a) => isHardcoreMode ? a.DateEarnedHardcore : a.DateEarned;
  if(order){
    return applyAchOrder(list, order).map(a => achItemHtml(a, !isEarned(a), isHardcoreMode, reorderMode)).join('');
  }
  const { earned, locked } = splitEarnedLocked(list, isHardcoreMode);
  return earned.map(a => achItemHtml(a, false, isHardcoreMode, reorderMode)).join('') + locked.map(a => achItemHtml(a, true, isHardcoreMode, reorderMode)).join('');
}

// The list with its filter bar (Reorder, Missable, Locked) and the export / import footer.
function renderAchievementsPanel(list, isHardcoreMode, missableOnly, lockedOnly, order, reorderMode, importError){
  if(!list || list.length === 0) return '<div class="achievements-list-loading">No achievement data available.</div>';
  const missableCount = list.filter(isMissable).length;
  const showMissable = missableCount > 0 && !reorderMode;
  // Full screen counts an unlock in either mode, as its frames do, so a mastered game has no Locked button.
  const fs = achFsOn();
  const lockedList = fs ? list.filter(a => !a.DateEarned && !a.DateEarnedHardcore) : splitEarnedLocked(list, isHardcoreMode).locked;
  const lockedCount = lockedList.length;
  const showLocked = lockedCount > 0 && !reorderMode;
  const leftBtns = reorderMode
    ? `<button class="ach-filter-btn active" id="ach-reorder-toggle" type="button">✓ Done</button>`
    : `<button class="ach-filter-btn" id="ach-reorder-toggle" type="button">⇅ Reorder</button>`;
  const viewBtn = `<button class="ach-filter-btn ach-view-toggle${achTileView ? ' active' : ''}" type="button" aria-label="${achTileView ? 'Show as a list' : 'Show as tiles'}" title="${achTileView ? 'Show as a list' : 'Show as tiles'}">${ACH_ICON_TILES}</button>`;
  const resetBtn = (!reorderMode && order) ? `<button class="ach-filter-btn" id="ach-reorder-reset" type="button">Reset order</button>` : '';
  const filterBtns = `${showMissable ? `<button class="ach-filter-btn ${missableOnly ? 'active' : ''}" id="ach-missable-toggle" type="button">
             <span class="ach-missable-badge ach-filter-icon" aria-hidden="true">!</span> Missable (<span class="ach-filter-count">${missableCount}</span>)
           </button>` : ''}
        ${showLocked ? `<button class="ach-filter-btn ${lockedOnly ? 'active' : ''}" id="ach-locked-toggle" type="button" title="Show only locked achievements">
             <svg class="ach-lock-icon ach-filter-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V7z"/></svg> Locked (<span class="ach-filter-count">${lockedCount}</span>)
           </button>` : ''}`;
  // Full screen keeps the right end for the award pill, so the filters sit with the other buttons.
  const filterBar = `<div class="ach-filter-row">
        <div class="ach-filter-left">${leftBtns}${fs ? filterBtns + viewBtn : viewBtn}${resetBtn}</div>
        <div class="ach-filter-right">${fs ? achFsPill() : filterBtns}</div>
      </div>
      ${reorderMode ? `<div class="ach-reorder-hint">${achShowTiles() ? 'Press and hold a tile, then drag it.' : 'Press and hold a row, then drag it. Or use ▲▼.'} Your order saves automatically.</div>` : ''}`;
  let rows = list;
  if(!reorderMode){
    if(missableOnly && showMissable) rows = rows.filter(isMissable);
    if(lockedOnly && showLocked){
      const lockedIds = new Set(lockedList);
      rows = rows.filter(a => lockedIds.has(a));
    }
  }
  const filterLabel = (missableOnly && lockedOnly) ? 'locked missable' : lockedOnly ? 'locked' : 'missable';
  const body = rows.length === 0
    ? `<div class="achievements-list-loading">No ${filterLabel} achievements in this set.</div>`
    : achShowTiles()
      ? `<div class="${achTilesClass(reorderMode)}" id="ach-rows" style="--ach-cols:${achGridCols()}">${renderAchievementsList(rows, isHardcoreMode, order, reorderMode)}</div>`
      : `<div class="ach-rows${reorderMode ? ' reordering' : ''}" id="ach-rows">${renderAchievementsList(rows, isHardcoreMode, order, reorderMode)}</div>`;

  const shareFooterBtns = (order ? `<button class="ach-share-footer-btn" id="ach-share-download" type="button">⇪ Export order (file)</button>` : '')
    + `<button class="ach-share-footer-btn" id="ach-import-file-btn" type="button">⇩ Import order (file)</button>`;
  const shareFooter = `<div class="ach-share-footer-row">${shareFooterBtns}</div>
      ${importError ? `<div class="ach-share-footer-error">${importError}</div>` : ''}`;

  return filterBar + body + shareFooter;
}

// Renders (or re-renders after a mode switch) one achievements panel, keeping its filters.
function renderAchWrapContent(achWrap, gameId, gameTitle){
  const list = achievementsListCache[gameId];
  if(!achWrap || !list) return;
  const state = achState(gameId);
  const order = achOrderCache[gameId] || null;
  const local = findGameLocal(gameId);
  const title = gameTitle || (local ? local.Title : '');
  achWrap.innerHTML = renderAchievementsPanel(list, statsMode === 'hardcore', state.missableOnly, state.lockedOnly, order, state.reorderMode, state.importError);
  const toggleBtn = achWrap.querySelector('#ach-missable-toggle');
  if(toggleBtn){
    toggleBtn.addEventListener('click', () => {
      state.missableOnly = !state.missableOnly;
      saveAchFilters(gameId);
      renderAchWrapContent(achWrap, gameId, title);
    });
  }
  const lockedBtn = achWrap.querySelector('#ach-locked-toggle');
  if(lockedBtn){
    lockedBtn.addEventListener('click', () => {
      state.lockedOnly = !state.lockedOnly;
      saveAchFilters(gameId);
      renderAchWrapContent(achWrap, gameId, title);
    });
  }
  const reorderBtn = achWrap.querySelector('#ach-reorder-toggle');
  if(reorderBtn){
    reorderBtn.addEventListener('click', () => {
      state.reorderMode = !state.reorderMode; // reordering shows the whole list; the filters come back on Done
      renderAchWrapContent(achWrap, gameId, title);
    });
  }
  const resetBtn = achWrap.querySelector('#ach-reorder-reset');
  if(resetBtn){
    resetBtn.addEventListener('click', async () => {
      await clearAchOrder(gameId);
      renderAchWrapContent(achWrap, gameId, title);
    });
  }
  const shareDownloadBtn = achWrap.querySelector('#ach-share-download');
  if(shareDownloadBtn){
    shareDownloadBtn.addEventListener('click', () => {
      const saved = achOrderCache[gameId];
      if(!saved) return;
      downloadAchOrderFile(gameId, title, saved);
    });
  }
  const importFileBtn = achWrap.querySelector('#ach-import-file-btn');
  if(importFileBtn){
    importFileBtn.addEventListener('click', () => {
      pickAchOrderFile(async (file) => {
        try{
          const parsed = await readAchOrderFile(file);
          if(parsed.gameId !== Number(gameId)){
            state.importError = 'This order file is for a different game.';
          }else{
            await saveAchOrder(gameId, parsed.ids);
            state.importError = '';
            state.reorderMode = false;
          }
        }catch(e){
          state.importError = e.message;
        }
        renderAchWrapContent(achWrap, gameId, title);
      });
    });
  }
  if(state.reorderMode){
    if(achShowTiles()) wireAchTileReorder(achWrap, gameId);
    else wireAchReorder(achWrap, gameId);
  }
}

// Tile view reordering: press and hold a tile, then drag it. The other tiles slide into the slots they would
// end up in, and the tiles are only moved for real when you let go (as with the rows).
function wireAchTileReorder(achWrap, gameId){
  const grid = achWrap.querySelector('#ach-rows');
  if(!grid) return;
  const scroller = document.getElementById('modal-backdrop');
  const tilesEl = () => Array.from(grid.querySelectorAll('.ach-tile'));
  const persist = () => saveAchOrder(gameId, tilesEl().map(t => t.dataset.id));
  const HOLD_MS = 350;
  const HOLD_SLOP = 10;
  let dragActive = false;
  grid.addEventListener('touchmove', (ev) => { if(dragActive) ev.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', (ev) => ev.preventDefault());

  tilesEl().forEach(tile => {
    tile.addEventListener('pointerdown', (e) => {
      if(dragActive) return;
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      const pointerId = e.pointerId;
      let px = e.clientX, py = e.clientY;
      const downX = e.clientX, downY = e.clientY;
      let timer = 0;
      const cancelPending = () => {
        clearTimeout(timer);
        tile.removeEventListener('pointermove', pendingMove);
        tile.removeEventListener('pointerup', cancelPending);
        tile.removeEventListener('pointercancel', cancelPending);
      };
      const pendingMove = (ev) => {
        px = ev.clientX; py = ev.clientY;
        if(Math.abs(ev.clientX - downX) > HOLD_SLOP || Math.abs(ev.clientY - downY) > HOLD_SLOP) cancelPending();
      };
      tile.addEventListener('pointermove', pendingMove);
      tile.addEventListener('pointerup', cancelPending);
      tile.addEventListener('pointercancel', cancelPending);
      timer = setTimeout(() => { cancelPending(); startDrag(tile, pointerId, px, py); }, e.pointerType === 'mouse' ? 0 : HOLD_MS);
    });
  });

  function startDrag(tile, pointerId, x0, y0){
    const tiles = tilesEl();
    const startIdx = tiles.indexOf(tile);
    // Where every slot is before anything moves (relative to the grid, so scrolling doesn't change it).
    const slots = tiles.map(t => ({ x: t.offsetLeft, y: t.offsetTop, w: t.offsetWidth, h: t.offsetHeight }));
    const g0 = grid.getBoundingClientRect();
    const startX = x0 - g0.left, startY = y0 - g0.top;
    let px = x0, py = y0, newIdx = startIdx, shownIdx = startIdx, raf = 0;

    dragActive = true;
    if(navigator.vibrate){ try{ navigator.vibrate(15); }catch(err){} }
    tile.classList.add('dragging');
    tiles.forEach(t => { if(t !== tile) t.classList.add('ach-shifting'); });
    try{ tile.setPointerCapture(pointerId); }catch(err){}

    const slideOthers = () => {
      const order = tiles.filter(t => t !== tile);
      order.splice(newIdx, 0, tile);
      order.forEach((t, k) => {
        if(t === tile) return;
        const i = tiles.indexOf(t);
        const dx = slots[k].x - slots[i].x, dy = slots[k].y - slots[i].y;
        t.style.transform = (dx || dy) ? `translate(${dx}px, ${dy}px)` : '';
      });
    };

    const tick = () => {
      const edge = 90;
      if(py < edge) scroller.scrollTop -= Math.ceil((edge - py) / 5);
      else if(py > window.innerHeight - edge) scroller.scrollTop += Math.ceil((py - (window.innerHeight - edge)) / 5);

      const g = grid.getBoundingClientRect();
      const dx = (px - g.left) - startX, dy = (py - g.top) - startY;
      tile.style.transform = `translate(${dx}px, ${dy}px)`;

      // Its new slot is the one whose middle is nearest to the middle of the tile being dragged.
      const s = slots[startIdx];
      const cx = s.x + s.w / 2 + dx, cy = s.y + s.h / 2 + dy;
      let best = startIdx, bestD = Infinity;
      slots.forEach((o, i) => {
        const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
        if(d < bestD){ bestD = d; best = i; }
      });
      newIdx = best;
      if(newIdx !== shownIdx){ shownIdx = newIdx; slideOthers(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMove = (ev) => { px = ev.clientX; py = ev.clientY; };
    const onEnd = () => {
      cancelAnimationFrame(raf);
      tile.removeEventListener('pointermove', onMove);
      tile.removeEventListener('pointerup', onEnd);
      tile.removeEventListener('pointercancel', onEnd);
      dragActive = false;
      tiles.forEach(t => { t.style.transform = ''; t.classList.remove('ach-shifting'); });
      tile.classList.remove('dragging');
      if(newIdx !== startIdx){
        const others = tiles.filter(t => t !== tile);
        if(newIdx >= others.length) grid.appendChild(tile);
        else grid.insertBefore(tile, others[newIdx]);
        persist();
      }
    };
    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onEnd);
    tile.addEventListener('pointercancel', onEnd);
  }
}

// Drag to reorder (touch or mouse), or the ▲▼ buttons. Every change saves the whole order.
function wireAchReorder(achWrap, gameId){
  const container = achWrap.querySelector('#ach-rows');
  if(!container) return;
  const scroller = document.getElementById('modal-backdrop'); // the profile view is the scrolling element
  const rowsEl = () => Array.from(container.querySelectorAll('.ach-row'));
  const persist = () => saveAchOrder(gameId, rowsEl().map(r => r.dataset.id));

  container.querySelectorAll('.ach-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.ach-row');
      if(btn.dataset.dir === 'up'){
        const prev = row.previousElementSibling;
        if(prev) container.insertBefore(row, prev);
      }else{
        const next = row.nextElementSibling;
        if(next) container.insertBefore(next, row);
      }
      persist();
    });
  });

  // Press and hold a row to pick it up; moving before the hold completes is a scroll. The held row
  // follows the finger with a transform and the DOM is only reordered on release (moving the
  // element mid-drag makes the browser drop the pointer).
  const HOLD_MS = 350;
  const HOLD_SLOP = 10; // px of movement that means "this is a scroll, not a hold"
  let dragActive = false;
  container.addEventListener('touchmove', (ev) => { if(dragActive) ev.preventDefault(); }, { passive: false });
  container.addEventListener('contextmenu', (ev) => ev.preventDefault()); // no long-press menu on badge images

  container.querySelectorAll('.ach-row').forEach(row => {
    row.addEventListener('pointerdown', (e) => {
      if(dragActive) return;
      if(e.target.closest('.ach-move-btn')) return;
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      const pointerId = e.pointerId;
      let pointerY = e.clientY;
      const downX = e.clientX, downY = e.clientY;
      let timer = 0;

      const cancelPending = () => {
        clearTimeout(timer);
        row.removeEventListener('pointermove', pendingMove);
        row.removeEventListener('pointerup', cancelPending);
        row.removeEventListener('pointercancel', cancelPending);
      };
      const pendingMove = (ev) => {
        pointerY = ev.clientY;
        if(Math.abs(ev.clientX - downX) > HOLD_SLOP || Math.abs(ev.clientY - downY) > HOLD_SLOP) cancelPending();
      };
      row.addEventListener('pointermove', pendingMove);
      row.addEventListener('pointerup', cancelPending);
      row.addEventListener('pointercancel', cancelPending);

      // Mouse picks up instantly; touch needs the hold.
      timer = setTimeout(() => { cancelPending(); startDrag(row, pointerId, pointerY); }, e.pointerType === 'mouse' ? 0 : HOLD_MS);
    });
  });

  function startDrag(row, pointerId, initialY){
    const rows = rowsEl();
    const startIdx = rows.indexOf(row);
    // Layout snapshot (offsetTop is relative to the container, so scrolling doesn't change it).
    const tops = rows.map(r => r.offsetTop);
    const heights = rows.map(r => r.offsetHeight);
    const dragH = heights[startIdx] + 1; // +1 for the 1px gap between rows
    const contentY = (clientY) => clientY - container.getBoundingClientRect().top;
    const startContentY = contentY(initialY);
    let pointerY = initialY;
    let newIdx = startIdx;
    let raf = 0;

    dragActive = true;
    if(navigator.vibrate){ try{ navigator.vibrate(15); }catch(err){} }
    row.classList.add('dragging');
    rows.forEach(r => { if(r !== row) r.classList.add('ach-shifting'); });
    try{ row.setPointerCapture(pointerId); }catch(err){}

    const tick = () => {
      // Auto-scroll near the screen edges, faster closer to the edge.
      const edge = 90;
      if(pointerY < edge) scroller.scrollTop -= Math.ceil((edge - pointerY) / 5);
      else if(pointerY > window.innerHeight - edge) scroller.scrollTop += Math.ceil((pointerY - (window.innerHeight - edge)) / 5);

      let dy = contentY(pointerY) - startContentY;
      const minDy = tops[0] - tops[startIdx];
      const maxDy = tops[rows.length - 1] + heights[rows.length - 1] - tops[startIdx] - heights[startIdx];
      dy = Math.max(minDy, Math.min(maxDy, dy));
      row.style.transform = `translateY(${dy}px)`;

      // Its new slot: how many other rows have their middle above its centre.
      const centre = tops[startIdx] + heights[startIdx] / 2 + dy;
      let idx = 0;
      rows.forEach((r, i) => { if(i !== startIdx && tops[i] + heights[i] / 2 < centre) idx++; });
      newIdx = idx;

      // Slide the passed rows out of the way.
      rows.forEach((r, i) => {
        if(i === startIdx) return;
        let shift = 0;
        if(startIdx < newIdx && i > startIdx && i <= newIdx) shift = -dragH;
        else if(startIdx > newIdx && i >= newIdx && i < startIdx) shift = dragH;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMove = (ev) => { pointerY = ev.clientY; };
    const onEnd = () => {
      cancelAnimationFrame(raf);
      row.removeEventListener('pointermove', onMove);
      row.removeEventListener('pointerup', onEnd);
      row.removeEventListener('pointercancel', onEnd);
      dragActive = false;
      rows.forEach(r => { r.style.transform = ''; r.classList.remove('ach-shifting'); });
      row.classList.remove('dragging');
      if(newIdx !== startIdx){
        const others = rows.filter(r => r !== row);
        if(newIdx >= others.length) container.appendChild(row);
        else container.insertBefore(row, others[newIdx]);
        persist();
      }
    };
    row.addEventListener('pointermove', onMove);
    row.addEventListener('pointerup', onEnd);
    row.addEventListener('pointercancel', onEnd);
  }
}

// RA counts a game as beaten once every progression achievement and one win condition (if any)
// are earned. Many sets aren't typed yet, so an empty result doesn't mean it can't be beaten.
function getBeatenAchievements(list){
  return (list || []).filter(a => {
    const t = String(a.Type || a.type || '').toLowerCase();
    return t === 'progression' || t === 'win_condition' || t === 'win';
  });
}

function renderBeatenAchievementsList(list, isHardcoreMode){
  const beaten = getBeatenAchievements(list);
  if(beaten.length === 0){
    return '<div class="achievements-list-loading">This game\'s achievement set hasn\'t been marked with progression/win-condition achievements on RetroAchievements yet.</div>';
  }
  const { earned, locked } = splitEarnedLocked(beaten, isHardcoreMode);
  const bar = `<div class="ach-filter-row"><div class="ach-filter-left">
        <button class="ach-filter-btn ach-view-toggle${achTileView ? '' : ' active'}" data-view="list" type="button">${ACH_ICON_LIST} List</button>
        <button class="ach-filter-btn ach-view-toggle${achTileView ? ' active' : ''}" data-view="tiles" type="button">${ACH_ICON_TILES} Tiles</button>
      </div><div class="ach-filter-right">${achFsPill()}</div></div>`;
  const items = earned.map(a => achItemHtml(a, false, isHardcoreMode)).join('') + locked.map(a => achItemHtml(a, true, isHardcoreMode)).join('');
  return bar + (achShowTiles() ? `<div class="${achTilesClass(false)}" style="--ach-cols:${achGridCols()}">${items}</div>` : items);
}
