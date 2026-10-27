// Add Game modal: RA system search, RAWG search, and the bulk add.

// Add game (manual + RAWG search)
// Add game manually
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
  $('#addgame-custom-console-field').style.display = 'none';
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
    sel.innerHTML = `<option value="__custom__">Other system (not on RetroAchievements)…</option>`
      + sorted.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }catch(e){
    sel.innerHTML = '<option value="__custom__">Other system (not on RetroAchievements)…</option><option value="">Could not load systems</option>';
  }
  // "Other" is the first option and starts selected, so a non-RA game is just a title away.
  sel.value = '__custom__';
  syncAddGameSystem();
}

function syncAddGameSystem(){
  const isCustom = $('#addgame-system').value === '__custom__';
  $('#addgame-custom-console-field').style.display = isCustom ? 'block' : 'none';
  const multiHint = $('#addgame-multi-hint');
  if(multiHint) multiHint.style.display = isCustom ? 'none' : 'block'; // the multi-select checkboxes are RA-search only
}

$('#addgame-system').addEventListener('change', syncAddGameSystem);

// Reflects addGameSelections (checked but not yet committed) in the modal.
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
    resultsEl.innerHTML = '<div class="loading">Searching RAWG</div>';
    try{
      const results = await searchRawgForAddGame(query);
      if(results.length === 0){
        resultsEl.innerHTML = '<div class="ag-empty">No matching games found on RAWG.</div>';
        return;
      }
      // Platform choices come straight from each result's own RAWG data
      // instead of being typed in, no typos, and the same real-world
      // platform (e.g. "PlayStation 4") always ends up spelled the same
      // way across every custom game, which keeps the System filter tidy.
      resultsEl.innerHTML = results.map(g => {
        const plats = (g.platforms || [])
          .map(p => p && p.platform && p.platform.name)
          .filter(Boolean);
        const platOptions = plats.length
          ? plats.map(p => `<option value="${p}">${p}</option>`).join('')
          : `<option value="">Unknown platform</option>`;
        return `
            <div class="ag-result ag-result-custom" data-rawg-id="${g.id}">
              <img src="${g.background_image || ''}" alt="">
              <span class="t">${g.name}</span>
              <span class="n">${g.released ? g.released.slice(0,4) : ''}</span>
              <select class="ag-platform-select">${platOptions}</select>
              <button class="ag-add-btn" type="button" title="Add game" aria-label="Add game">+</button>
            </div>
          `;
      }).join('');
      resultsEl.querySelectorAll('.ag-result-custom').forEach(row => {
        const id = Number(row.getAttribute('data-rawg-id'));
        const match = results.find(g => g.id === id);
        const select = row.querySelector('.ag-platform-select');
        row.querySelector('.ag-add-btn').addEventListener('click', () => {
          if(match) addManualGameFromRawg(match, select.value || 'Unknown');
        });
      });
    }catch(e){
      resultsEl.innerHTML = `<div class="error-box">Search failed: ${e.message}</div>`;
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
      // Checking the box toggles it natively; clicking elsewhere on the row
      // toggles it manually, either way applySelection reads the box's
      // resulting state, so the two paths never fight each other.
      row.addEventListener('click', (e) => {
        if(e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        applySelection();
      });
      checkbox.addEventListener('change', applySelection);
    });
  }catch(e){
    resultsEl.innerHTML = `<div class="error-box">Search failed: ${e.message}</div>`;
  }
}

async function searchRawgForAddGame(title){
  if(!rawgCreds) rawgCreds = await loadRawgCreds();
  if(!rawgCreds || !rawgCreds.apiKey) throw new Error('RAWG isn\'t set up — add a key under RAWG Ratings in the menu first.');
  const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(rawgCreds.apiKey)}&search=${encodeURIComponent(title)}&page_size=10`;
  const json = await rawgGet(url);
  return (json && json.results) || [];
}

// Shared by addManualGamesBulk (fresh adds) and convertCustomToRaGame (linking an
// existing custom entry to its real RA game), same shape of "tracked but
// not yet actually played" entry either way.
function buildManualRaEntry(g, consoleId, consoleName){
  return {
    GameID: Number(g.ID ?? g.id),
    Title: g.Title ?? g.title,
    ConsoleID: Number(consoleId),
    ConsoleName: g.ConsoleName ?? g.consoleName ?? consoleName,
    ImageIcon: g.ImageIcon ?? g.imageIcon,
    MaxPossible: g.NumAchievements ?? g.numAchievements ?? 0,
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

// Adds every checked search result in one shot: a single manual-games
// read/write and a single set of re-renders, rather than the old
// one-at-a-time flow's read/write/render/close per game, that's what
// made checking off several games and adding them together practical.
async function addManualGamesBulk(selections){
  return enqueueTask(async () => {
    const manual = await loadManualGames();
    const existingIds = new Set(libraryData.map(x => x.GameID));
    const newEntries = [];
    selections.forEach(({ g, consoleId, consoleName }) => {
      const gameId = Number(g.ID ?? g.id);
      if(existingIds.has(gameId)) return; // already tracked for real, or a duplicate selection
      existingIds.add(gameId);
      newEntries.push(buildManualRaEntry(g, consoleId, consoleName));
    });
    if(newEntries.length){
      libraryData = [...libraryData, ...newEntries];
      await saveManualGames([...manual, ...newEntries]);
    }
    renderSystemChips();
    renderBacklog();
    renderLibrary();
    renderByYear();
    closeAddGameModal();
  });
}

async function addManualGameFromRawg(rawgGame, customConsole){
  return enqueueTask(async () => {
    const gameId = -Date.now(); // synthetic, always negative, never collides with a real RA GameID
    if(libraryData.some(x => x.GameID === gameId)){
      closeAddGameModal();
      return;
    }
    const genre = (rawgGame.genres && rawgGame.genres.length) ? rawgGame.genres.map(g => g.name).join(', ') : null;
    const entry = {
      GameID: gameId,
      Title: rawgGame.name,
      ConsoleID: null,
      ConsoleName: await raConsoleNameFor(customConsole),
      ImageIcon: rawgGame.background_image || null,
      ImageBoxArt: rawgGame.background_image || null,
      MaxPossible: 0,
      NumAwarded: 0,
      NumAwardedHardcore: 0,
      HighestAwardKind: null,
      HighestAwardDate: null,
      MostRecentAwardedDate: null,
      pct: 0,
      lastPlayed: null,
      manual: true,
      customConsole: true, // not on RA at all, no achievement data will ever exist for this entry
      genre: genre,
      released: rawgGame.released || null,
      manualStarted: false,
      manualBeaten: false,
      manualBeatenDate: null,
    };
    libraryData = [...libraryData, entry];
    const manual = await loadManualGames();
    await saveManualGames([...manual, entry]);
    renderSystemChips();
    renderBacklog();
    renderLibrary();
    renderByYear();
    closeAddGameModal();
  });
}

// Turns a customConsole entry into a real RA-tracked one once it shows up on RA.
// Replaces the synthetic entry with a normal manual RA entry (same shape as
// addManualGamesBulk makes), so it stays in the Backlog until RA reports progress.
async function convertCustomToRaGame(oldGameId, g, consoleId, consoleName){
  return enqueueTask(async () => {
    const gameId = Number(g.ID ?? g.id);
    libraryData = libraryData.filter(x => x.GameID !== oldGameId);
    let manual = (await loadManualGames()).filter(x => x.GameID !== oldGameId);

    if(!libraryData.some(x => x.GameID === gameId)){
      const entry = buildManualRaEntry(g, consoleId, consoleName);
      libraryData = [...libraryData, entry];
      manual = [...manual, entry];
    }
    await saveManualGames(manual);
    renderSystemChips();
    renderBacklog();
    renderLibrary();
    renderByYear();
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
