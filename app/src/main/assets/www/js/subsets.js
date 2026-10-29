// Subsets: extra RetroAchievements sets named "Title [Subset - Name]". They're listed under the base
// game's Subsets button and kept out of Overview and the library, since they can't be played on their own.

const SUBSET_TITLE = /^(.*?)\s*\[Subset\s*-\s*(.+?)\]\s*$/i;
const subsetListCache = {};          // base game ID -> its subsets
const openSubsetPanels = new Map();  // subset ID -> { wrap, title, meta, subset }, lists that are open
const subsetMetaEls = new Map();     // subset ID -> { meta, subset }, rows in the open Subsets list

function subsetParts(title){
  const m = SUBSET_TITLE.exec(String(title || ''));
  return m ? { base: m[1], name: m[2] } : null;
}

function isSubsetGame(g){
  return !g.customConsole && subsetParts(g.Title) !== null;
}

// RA has no "subsets of this game" call, so match titles in the console's game list (cached by Add Game).
async function findSubsets(baseId, baseTitle, consoleId){
  if(subsetListCache[baseId]) return subsetListCache[baseId];
  const all = await getGameListForConsole(consoleId);
  const target = foldText(baseTitle);
  const found = (all || [])
    .filter(g => {
      const parts = subsetParts(g.Title);
      return parts && Number(g.ID) !== Number(baseId) && foldText(parts.base) === target;
    })
    .map(g => ({
      id: Number(g.ID),
      title: g.Title,
      name: subsetParts(g.Title).name,
      icon: g.ImageIcon,
      count: Number(g.NumAchievements || 0),
      points: Number(g.Points || 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  subsetListCache[baseId] = found;
  return found;
}

// "earned/total (pct)", with "?" for earned until the list has loaded.
function subsetMetaText(subset, list){
  if(!list) return `?/${subset.count} achievements earned \u00b7 ${subset.points} pts`;
  const hardcore = statsMode === 'hardcore';
  const earned = list.filter(a => hardcore ? a.DateEarnedHardcore : a.DateEarned).length;
  const pct = list.length ? Math.round(earned / list.length * 100) : 0;
  return `${earned}/${list.length} achievements earned (${pct}%) \u00b7 ${subset.points} pts`;
}

// Loads every subset's achievements in the background so progress shows without opening each one.
function loadSubsetProgress(subsets){
  subsets.forEach(async subset => {
    try{
      const list = await getAchievementsList(subset.id);
      const row = subsetMetaEls.get(subset.id);
      if(row && row.meta.isConnected) row.meta.textContent = subsetMetaText(subset, list);
    }catch(e){
      const row = subsetMetaEls.get(subset.id);
      if(row && row.meta.isConnected) row.meta.textContent = `${subset.count} achievements \u00b7 ${subset.points} pts`;
    }
  });
}

function subsetRowHtml(s){
  const local = findGameLocal(s.id);
  const award = local && isGameAwarded(local) ? awardPill(local.HighestAwardKind) : '';
  return `<div class="subset-item" data-subset-id="${s.id}">
      <button class="subset-head" type="button">
        <span class="arrow">▸</span>
        <img class="subset-icon" src="${imgUrl(s.icon)}" alt="">
        <span class="subset-text">
          <span class="subset-name">${esc(s.name)}</span>
          <span class="subset-meta">${subsetMetaText(s, achievementsListCache[s.id])}</span>
        </span>
        ${award}
      </button>
      <div class="achievements-list subset-body" style="display:none;"></div>
    </div>`;
}

async function toggleSubset(item, subset){
  const head = item.querySelector('.subset-head');
  const body = item.querySelector('.subset-body');
  const nowOpen = body.style.display === 'none';
  body.style.display = nowOpen ? 'flex' : 'none';
  body.style.flexDirection = 'column';
  head.classList.toggle('open', nowOpen);
  if(!nowOpen || item.dataset.loaded) return;
  item.dataset.loaded = '1';
  body.innerHTML = '<div class="achievements-list-loading">Loading achievements…</div>';
  try{
    const list = await getAchievementsList(subset.id);
    try{ attachAchievementTypes(list, await getGameExtended(subset.id)); }catch(e){}
    await loadAchOrder(subset.id);
    if(!body.isConnected) return; // the profile was closed
    resetAchState(subset.id);
    const meta = item.querySelector('.subset-meta');
    openSubsetPanels.set(subset.id, { wrap: body, title: subset.title, meta, subset });
    meta.textContent = subsetMetaText(subset, list);
    renderAchWrapContent(body, subset.id, subset.title);
  }catch(e){
    if(!body.isConnected) return;
    body.innerHTML = `<div class="achievements-list-loading">Could not load achievements: ${esc(e.message)}</div>`;
    delete item.dataset.loaded;
  }
}

// Runs once the profile has loaded. The button only appears if the game has subsets.
async function setupSubsetsUI(card, gameId, ext){
  if(!ext || ext.ParentGameID || subsetParts(ext.Title)) return;
  let subsets;
  try{ subsets = await findSubsets(gameId, ext.Title, ext.ConsoleID); }
  catch(e){ return; }
  if(!subsets.length || card.dataset.gameId !== String(gameId)) return;
  const btn = card.querySelector('#modal-subsets-btn');
  const wrap = card.querySelector('#modal-subsets');
  if(!btn || !wrap) return;
  btn.innerHTML = `<span class="arrow">▸</span> Subsets (${subsets.length})`;
  btn.style.display = 'flex';
  let built = false;
  btn.addEventListener('click', () => {
    const nowOpen = wrap.style.display === 'none';
    wrap.style.display = nowOpen ? 'flex' : 'none';
    btn.classList.toggle('open', nowOpen);
    if(built) return;
    built = true;
    wrap.innerHTML = subsets.map(subsetRowHtml).join('');
    subsetMetaEls.clear();
    wrap.querySelectorAll('.subset-item').forEach(item => {
      const subset = subsets.find(s => s.id === Number(item.dataset.subsetId));
      subsetMetaEls.set(subset.id, { meta: item.querySelector('.subset-meta'), subset });
      item.querySelector('.subset-head').addEventListener('click', () => toggleSubset(item, subset));
    });
    loadSubsetProgress(subsets);
  });
}

// The casual/hardcore toggle redraws any subset lists that are open.
function refreshOpenSubsetPanels(){
  subsetMetaEls.forEach((row, id) => {
    if(!row.meta.isConnected){ subsetMetaEls.delete(id); return; }
    const list = achievementsListCache[id];
    if(list) row.meta.textContent = subsetMetaText(row.subset, list);
  });
  openSubsetPanels.forEach((entry, id) => {
    if(!entry.wrap.isConnected){ openSubsetPanels.delete(id); return; }
    const list = achievementsListCache[id];
    entry.meta.textContent = subsetMetaText(entry.subset, list);
    renderAchWrapContent(entry.wrap, id, entry.title);
  });
}

function clearSubsetPanels(){
  openSubsetPanels.clear();
  subsetMetaEls.clear();
}
