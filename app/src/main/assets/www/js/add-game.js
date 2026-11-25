// Add Game: RA system search, IGDB search for other systems, and adding several at once.

function rankGames(games, query){
  const q = foldText(query.trim());
  if(!q || !games) return [];
  return games
    .map(g => {
      const title = foldText(g.Title ?? g.title ?? '');
      let score = -1;
      if(title === q) score = 3;
      else if(title.startsWith(q)) score = 2;
      else if(title.includes(q)) score = 1;
      return { g, score, len: title.length };
    })
    .filter(x => x.score >= 0)
    .sort((a, b) => (b.score - a.score) || (a.len - b.len))
    .slice(0, 20)
    .map(x => x.g);
}

async function openAddGameModal(){
  $('#addgame-backdrop').classList.add('open');
  $('#addgame-title').value = '';
  $('#addgame-results').innerHTML = '';
  addGameSelections.clear();
  renderAddGameSelectionBar();
  const sel = $('#addgame-system');
  sel.innerHTML = '<option>Loading systems…</option>';
  try{
    const consoles = await getConsoleList();
    const sorted = (consoles || [])
      .map(c => ({ id: c.ID ?? c.id, name: c.Name ?? c.name }))
      .filter(c => c.id != null && c.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="__custom__">Any console/system</option>`
      + sorted.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }catch(e){
    sel.innerHTML = '<option value="__custom__">Any console/system</option><option value="">Could not load systems</option>';
  }
  sel.value = '__custom__';
  syncAddGameSystem();
}

function syncAddGameSystem(){
  const isCustom = $('#addgame-system').value === '__custom__';
  const multiHint = $('#addgame-multi-hint');
  if(multiHint) multiHint.style.display = isCustom ? 'none' : 'block'; // ticking several is RA search only
}

$('#addgame-system').addEventListener('change', syncAddGameSystem);

// Shows how many games are ticked.
function renderAddGameSelectionBar(){
  const bar = $('#addgame-selection-bar');
  if(!bar) return;
  const n = addGameSelections.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  if(n > 0) $('#addgame-selection-count').textContent = `${n} game${n === 1 ? '' : 's'} selected`;
}

function closeAddGameModal(){
  $('#addgame-backdrop').classList.remove('open');
  addGameSelections.clear();
}

async function searchAddGame(){
  const sel = $('#addgame-system');
  const consoleId = sel.value;
  const query = $('#addgame-title').value.trim();
  const resultsEl = $('#addgame-results');

  if(consoleId === '__custom__'){
    if(!query){
      resultsEl.innerHTML = '<div class="ag-empty">Enter a title to search.</div>';
      return;
    }
    resultsEl.innerHTML = '<div class="loading">Searching</div>';
    try{
      const results = await searchIgdbGames(query);
      if(results.length === 0){
        resultsEl.innerHTML = '<div class="ag-empty">No matching games found.</div>';
        return;
      }
      // The platform is picked from IGDB's list for the game, so it's always spelled the same way.
      resultsEl.innerHTML = results.map(g => {
        const plats = Array.isArray(g.platforms) ? g.platforms.filter(Boolean) : [];
        const platOptions = plats.length
          ? plats.map(p => `<option value="${p}">${p}</option>`).join('')
          : `<option value="">Unknown platform</option>`;
        return `
            <div class="ag-result ag-result-custom" data-game-id="${g.id}">
              <img src="${g.cover || ''}" alt="">
              <span class="t">${g.name}</span>
              <span class="n">${g.released ? g.released.slice(0,4) : ''}</span>
              <span class="ag-ra-tag" title="On RetroAchievements on this console" hidden>RA</span>
              <select class="ag-platform-select">${platOptions}</select>
              <button class="ag-add-btn" type="button" title="Add game" aria-label="Add game">+</button>
            </div>
          `;
      }).join('');
      const rows = [...resultsEl.querySelectorAll('.ag-result-custom')];
      rows.forEach(row => {
        const id = Number(row.getAttribute('data-game-id'));
        const match = results.find(g => g.id === id);
        const select = row.querySelector('.ag-platform-select');
        const tag = row.querySelector('.ag-ra-tag');
        // the RA tag follows the platform picked: it shows when that console's RetroAchievements list has the game
        const showTag = () => { tag.hidden = !(row._ra && row._ra.get(select.value)); };
        select.addEventListener('change', showTag);
        row._showTag = showTag;
        row.querySelector('.ag-add-btn').addEventListener('click', () => {
          if(!match) return;
          const ra = row._ra && row._ra.get(select.value);
          // a game RetroAchievements has goes in as that game, with its achievements, straight away
          if(ra) addManualGamesBulk([{ g: ra.g, consoleId: ra.consoleId, consoleName: ra.consoleName }]);
          else addManualGameFromSearch(match, select.value || 'Unknown');
        });
      });
      tagRaResults(rows, results, () => sel.value === '__custom__' && resultsEl.contains(rows[0]));
    }catch(e){
      resultsEl.innerHTML = `<div class="error-box">Search failed: ${/abort/i.test(String(e && e.message)) ? 'The search took too long to answer. Try again in a moment.' : e.message}</div>`;
    }
    return;
  }

  if(!query || !consoleId){
    resultsEl.innerHTML = '<div class="ag-empty">Pick a system and enter a title.</div>';
    return;
  }
  resultsEl.innerHTML = '<div class="loading">Searching</div>';
  try{
    const list = await getGameListForConsole(consoleId);
    const matches = rankGames(list, query);
    if(matches.length === 0){
      resultsEl.innerHTML = '<div class="ag-empty">No matching games found on this system.</div>';
      return;
    }
    const consoleName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
    resultsEl.innerHTML = matches.map(g => {
      const id = Number(g.ID ?? g.id);
      const title = g.Title ?? g.title;
      const icon = g.ImageIcon ?? g.imageIcon;
      const numAch = g.NumAchievements ?? g.numAchievements ?? 0;
      const checked = addGameSelections.has(id);
      return `
          <div class="ag-result ${checked ? 'selected' : ''}" data-game-id="${id}">
            <input type="checkbox" class="ag-checkbox" ${checked ? 'checked' : ''} aria-label="Select ${title}">
            <img src="${imgUrl(icon)}" alt="">
            <span class="t">${title}</span>
            <span class="n">${numAch} ach.</span>
          </div>
        `;
    }).join('');
    resultsEl.querySelectorAll('.ag-result').forEach(row => {
      const id = Number(row.getAttribute('data-game-id'));
      const match = matches.find(g => Number(g.ID ?? g.id) === id);
      const checkbox = row.querySelector('.ag-checkbox');
      const applySelection = () => {
        if(checkbox.checked){
          addGameSelections.set(id, { g: match, consoleId, consoleName });
          row.classList.add('selected');
        }else{
          addGameSelections.delete(id);
          row.classList.remove('selected');
        }
        renderAddGameSelectionBar();
      };
      // Tapping anywhere on the row toggles the box.
      row.addEventListener('click', (e) => {
        if(e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        applySelection();
      });
      checkbox.addEventListener('change', applySelection);
    });
  }catch(e){
    resultsEl.innerHTML = `<div class="error-box">Search failed: ${/abort/i.test(String(e && e.message)) ? 'The search took too long to answer. Try again in a moment.' : e.message}</div>`;
  }
}

// A manually added RA game that hasn't been played yet.
// The RetroAchievements console id for a platform name from the search (IGDB's spelling), or null.
function raConsoleIdForPlatform(name){
  const hit = PLATFORM_TO_RA_CONSOLE[String(oneConsoleName(name) || '').toLowerCase()];
  return hit ? hit[0] : null;
}

// Marks the "Any console/system" results that RetroAchievements has, platform by platform. Each console's list is
// read once (and kept for a week), after the results are already on screen.
async function tagRaResults(rows, results, stillShown){
  let consoles = [];
  try{ consoles = (await getConsoleList()) || []; }catch(e){ return; }
  const lists = new Map(); // console id -> Map(title key -> game), or null when it could not be read
  const listFor = async (cid) => {
    if(!lists.has(cid)){
      let m = null;
      try{
        m = new Map();
        (await getGameListForConsole(cid) || []).forEach(g => {
          const raw = String(g.Title ?? g.title ?? '');
          const k = romMatchKey(raw);
          if(k && !/~hack~/i.test(raw) && !m.has(k)) m.set(k, g);
        });
      }catch(e){ m = null; }
      lists.set(cid, m);
    }
    return lists.get(cid);
  };
  for(const row of rows){
    if(!stillShown()) return;
    const g = results.find(x => x.id === Number(row.getAttribute('data-game-id')));
    if(!g) continue;
    const ra = new Map();
    for(const p of (Array.isArray(g.platforms) ? g.platforms.filter(Boolean) : [])){
      const cid = raConsoleIdForPlatform(p);
      if(cid == null) continue;
      const list = await listFor(cid);
      const hit = list && list.get(romMatchKey(g.name));
      if(hit){
        const c = consoles.find(x => Number(x.ID ?? x.id) === cid);
        ra.set(p, { g: hit, consoleId: cid, consoleName: c ? (c.Name ?? c.name) : p });
      }
    }
    row._ra = ra;
    if(ra.size){
      // start on a platform RetroAchievements has, so the game is added with its achievements
      const select = row.querySelector('.ag-platform-select');
      if(select && !ra.has(select.value)) select.value = ra.keys().next().value;
      row._showTag();
    }
  }
}

function buildManualRaEntry(g, consoleId, consoleName){
  return {
    GameID: Number(g.ID ?? g.id),
    Title: g.Title ?? g.title,
    ConsoleID: Number(consoleId),
    ConsoleName: g.ConsoleName ?? g.consoleName ?? consoleName,
    ImageIcon: g.ImageIcon ?? g.imageIcon,
    MaxPossible: g.NumAchievements ?? g.numAchievements ?? 0,
    Points: g.Points ?? g.points ?? null, // the set's total points, for the Backlog (filled in later when not known here)
    NumAwarded: 0,
    NumAwardedHardcore: 0,
    HighestAwardKind: null,
    HighestAwardDate: null,
    MostRecentAwardedDate: null,
    pct: 0,
    lastPlayed: null,
    manual: true,
  };
}

// Adds every ticked result with one save and one redraw.
async function addManualGamesBulk(selections){
  return enqueueTask(async () => {
    const manual = await loadManualGames();
    const existingIds = new Set(libraryData.map(x => x.GameID));
    const newEntries = [];
    selections.forEach(({ g, consoleId, consoleName }) => {
      const gameId = Number(g.ID ?? g.id);
      if(existingIds.has(gameId)) return;
      existingIds.add(gameId);
      newEntries.push(buildManualRaEntry(g, consoleId, consoleName));
    });
    if(newEntries.length){
      libraryData = [...libraryData, ...newEntries];
      await saveManualGames([...manual, ...newEntries]);
    }
    renderLibraryViews();
    closeAddGameModal();
  });
}

async function addManualGameFromSearch(found, customConsole){
  return enqueueTask(async () => {
    const gameId = -Date.now(); // negative, so it never clashes with a real RA GameID
    if(libraryData.some(x => x.GameID === gameId)){
      closeAddGameModal();
      return;
    }
    const genre = (found.genres && found.genres.length) ? found.genres.join(', ') : null;
    const entry = {
      GameID: gameId,
      Title: found.name,
      ConsoleID: null,
      ConsoleName: await raConsoleNameFor(customConsole),
      ImageIcon: found.cover || null,
      ImageBoxArt: found.cover || null,
      MaxPossible: 0,
      NumAwarded: 0,
      NumAwardedHardcore: 0,
      HighestAwardKind: null,
      HighestAwardDate: null,
      MostRecentAwardedDate: null,
      pct: 0,
      lastPlayed: null,
      manual: true,
      customConsole: true, // not on RA
      genre: genre,
      released: found.released || null,
      manualStarted: false,
      manualBeaten: false,
      manualBeatenDate: null,
    };
    libraryData = [...libraryData, entry];
    const manual = await loadManualGames();
    await saveManualGames([...manual, entry]);
    renderLibraryViews();
    closeAddGameModal();
  });
}

// Replaces a non-RA entry with a manually added RA game, which stays in the Backlog until RA sees progress.
async function convertCustomToRaGame(oldGameId, g, consoleId, consoleName){
  return enqueueTask(async () => {
    const gameId = Number(g.ID ?? g.id);
    await rememberPreRa(gameId, libraryData.find(x => x.GameID === oldGameId));
    libraryData = libraryData.filter(x => x.GameID !== oldGameId);
    let manual = (await loadManualGames()).filter(x => x.GameID !== oldGameId);

    if(!libraryData.some(x => x.GameID === gameId)){
      const entry = buildManualRaEntry(g, consoleId, consoleName);
      libraryData = [...libraryData, entry];
      manual = [...manual, entry];
    }
    await saveManualGames(manual);
    renderLibraryViews();
    closeGameModal();
  });
}

$('#btn-add-game').addEventListener('click', openAddGameModal);
$('#addgame-close-btn').addEventListener('click', closeAddGameModal);
$('#addgame-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'addgame-backdrop') closeAddGameModal();
});
$('#addgame-search-btn').addEventListener('click', searchAddGame);
$('#addgame-add-selected-btn').addEventListener('click', () => {
  if(addGameSelections.size === 0) return;
  addManualGamesBulk([...addGameSelections.values()]);
});
$('#addgame-title').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') searchAddGame();
});
