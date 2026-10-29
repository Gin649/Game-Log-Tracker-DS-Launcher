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
      <div class="ach-row ${isLocked ? 'locked' : ''}" data-id="${a.ID ?? a.id}">
        ${reorderControls}
        <img src="${badge}" alt="">
        <div class="info">
          <p class="t">${a.Title || 'Untitled'}</p>
          <p class="d">${a.Description || ''}</p>
          ${!isLocked ? `<p class="when">Unlocked ${timeAgo(earnedDate)}</p>` : ''}
        </div>
        ${isMissable(a) ? '<span class="ach-missable-badge" title="Missable: can be missed for good during a playthrough">!</span>' : ''}
        ${(!reorderMode && (a.ID ?? a.id)) ? `<a class="ach-ra-link" href="https://retroachievements.org/achievement/${encodeURIComponent(a.ID ?? a.id)}" target="_blank" rel="noopener" title="Open this achievement on RetroAchievements (comments &amp; discussion)" aria-label="Open ${String(a.Title || 'achievement').replace(/"/g,'&quot;')} on RetroAchievements">RA</a>` : ''}
        <div class="pts">${a.Points ?? ''}</div>
      </div>
    `;
}

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
    return applyAchOrder(list, order).map(a => achRowHtml(a, !isEarned(a), isHardcoreMode, reorderMode)).join('');
  }
  const { earned, locked } = splitEarnedLocked(list, isHardcoreMode);
  return earned.map(a => achRowHtml(a, false, isHardcoreMode, reorderMode)).join('') + locked.map(a => achRowHtml(a, true, isHardcoreMode, reorderMode)).join('');
}

// The list with its filter bar (Reorder, Missable, Locked) and the export / import footer.
function renderAchievementsPanel(list, isHardcoreMode, missableOnly, lockedOnly, order, reorderMode, importError){
  if(!list || list.length === 0) return '<div class="achievements-list-loading">No achievement data available.</div>';
  const missableCount = list.filter(isMissable).length;
  const showMissable = missableCount > 0 && !reorderMode;
  const lockedCount = splitEarnedLocked(list, isHardcoreMode).locked.length;
  const showLocked = lockedCount > 0 && !reorderMode;
  const leftBtns = reorderMode
    ? `<button class="ach-filter-btn active" id="ach-reorder-toggle" type="button">✓ Done</button>`
    : `<button class="ach-filter-btn" id="ach-reorder-toggle" type="button">⇅ Reorder</button>`
      + (order ? `<button class="ach-filter-btn" id="ach-reorder-reset" type="button">Reset order</button>` : '');
  const filterBar = `<div class="ach-filter-row">
        <div class="ach-filter-left">${leftBtns}</div>
        <div class="ach-filter-right">
        ${showMissable ? `<button class="ach-filter-btn ${missableOnly ? 'active' : ''}" id="ach-missable-toggle" type="button">
             <span class="ach-missable-badge ach-filter-icon" aria-hidden="true">!</span> Missable (<span class="ach-filter-count">${missableCount}</span>)
           </button>` : ''}
        ${showLocked ? `<button class="ach-filter-btn ${lockedOnly ? 'active' : ''}" id="ach-locked-toggle" type="button" title="Show only locked achievements">
             <svg class="ach-lock-icon ach-filter-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V7z"/></svg> Locked (<span class="ach-filter-count">${lockedCount}</span>)
           </button>` : ''}
        </div>
      </div>
      ${reorderMode ? '<div class="ach-reorder-hint">Press and hold a row, then drag it. Or use ▲▼. Your order saves automatically.</div>' : ''}`;
  let rows = list;
  if(!reorderMode){
    if(missableOnly && showMissable) rows = rows.filter(isMissable);
    if(lockedOnly && showLocked){
      const lockedIds = new Set(splitEarnedLocked(list, isHardcoreMode).locked);
      rows = rows.filter(a => lockedIds.has(a));
    }
  }
  const filterLabel = (missableOnly && lockedOnly) ? 'locked missable' : lockedOnly ? 'locked' : 'missable';
  const body = rows.length === 0
    ? `<div class="achievements-list-loading">No ${filterLabel} achievements in this set.</div>`
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
  if(state.reorderMode) wireAchReorder(achWrap, gameId);
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
  return earned.map(a => achRowHtml(a, false, isHardcoreMode)).join('') + locked.map(a => achRowHtml(a, true, isHardcoreMode)).join('');
}
