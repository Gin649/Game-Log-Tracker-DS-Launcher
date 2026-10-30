// Game profile screens (custom and RA games) and the box art zoom viewer.

function showError(msg){
  $('#connect-error').innerHTML = `<div class="error-box">${msg}</div>`;
}

async function getGameExtended(gameId){
  if(gameExtendedCache[gameId]) return gameExtendedCache[gameId];

  const cacheKey = `ra-gameinfo:${gameId}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000){
        gameExtendedCache[gameId] = parsed.data;
        return parsed.data;
      }
    }
  }catch(e){}

  const data = await raFetch('API_GetGameExtended.php', { i: gameId });
  gameExtendedCache[gameId] = data;
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}

function findGameLocal(gameId){
  return libraryData.find(g => g.GameID === gameId) || recentGamesData.find(g => g.GameID === gameId) || null;
}

async function attachRawgLookup(gameId, title, card){
  if(!rawgCreds) rawgCreds = await loadRawgCreds();
  if(!rawgCreds){
    const note = card.querySelector('.modal-note');
    if(note) note.insertAdjacentHTML('afterend', `<p class="rawg-setup-note"><a id="rawg-setup-link">Set up RAWG</a> to show review scores here.</p>`);
    const link = card.querySelector('#rawg-setup-link');
    if(link) link.addEventListener('click', () => { closeGameModal(); openRawgModal(); });
  }else{
    const badge = card.querySelector('#rawg-badge');
    if(badge) badge.innerHTML = `<span class="rawg-score tier-muted">…</span>`;

    const runRawgLookup = (force) => {
      getRawgRating(title, force).then(rating => {
        if(card.dataset.gameId !== String(gameId)) return; // another game was opened meanwhile
        const badgeEl = card.querySelector('#rawg-badge');
        if(!badgeEl) return;

        const label = rating ? String(rating.score) : 'NR'; // not rated
        const tier = !rating ? 'tier-muted' : rating.score >= 80 ? 'tier-green' : rating.score >= 50 ? 'tier-yellow' : 'tier-red';
        badgeEl.innerHTML = `<span class="rawg-score ${tier}" id="rawg-retry" title="Tap to look up again">${label}</span>`;

        const retryEl = card.querySelector('#rawg-retry');
        if(retryEl){
          retryEl.style.cursor = 'pointer';
          retryEl.addEventListener('click', () => {
            badgeEl.innerHTML = `<span class="rawg-score tier-muted">…</span>`;
            runRawgLookup(true);
          });
        }
      });
    };
    runRawgLookup(false);
  }
}

// Saves changes to a manually added game and redraws the lists.
function updateManualGame(gameId, changes){
  return enqueueTask(async () => {
    const idx = libraryData.findIndex(g => g.GameID === gameId);
    if(idx === -1) return;
    libraryData[idx] = { ...libraryData[idx], ...changes };

    const manual = await loadManualGames();
    const manualIdx = manual.findIndex(g => g.GameID === gameId);
    if(manualIdx !== -1){
      manual[manualIdx] = { ...manual[manualIdx], ...changes };
      await saveManualGames(manual);
    }
    renderLibraryViews();
  });
}
function updateManualBeatenStatus(gameId, beaten, dateStr){
  return updateManualGame(gameId, { manualBeaten: beaten, manualBeatenDate: beaten ? dateStr : null });
}
// "Now Playing" moves a non-RA game from the Backlog into the library, before it's beaten.
function updateManualStartedStatus(gameId, started){
  return updateManualGame(gameId, { manualStarted: started });
}

function renderCustomGameModal(gameId, local, card){
  const boxArt = imgUrl(local.ImageBoxArt || local.ImageIcon || '');
  card.querySelector('.modal-art').src = boxArt;

  let releasedLabel = '—';
  if(local.released){
    const d = new Date(local.released);
    releasedLabel = isNaN(d.getTime()) ? local.released : d.toLocaleDateString();
  }
  const beatenDateValue = local.manualBeatenDate || '';

  card.querySelector('.modal-body').innerHTML = `
      <h2>${local.Title}</h2>
      <p class="sub">${local.ConsoleName}</p>

      <div class="modal-meta">
        <div class="mi"><div class="k">GENRE</div><div class="v">${local.genre || '—'}</div></div>
        <div class="mi"><div class="k">RELEASED</div><div class="v">${releasedLabel}</div></div>
      </div>

      <div class="modal-progress">
        <div class="row"><span>Progress</span><span style="color:var(--muted)">—</span></div>
        <div class="row"><span>Playtime</span><span style="color:var(--muted)">—</span></div>
        <div class="row"><span>Status</span><span class="status-val" id="manual-status-val">${manualStatusHtml(local)}</span></div>
      </div>

      <div class="field" style="text-align:left;margin-bottom:14px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-family:inherit; font-size:0.8125rem; color:var(--text);">
          <input type="checkbox" id="manual-started-checkbox" ${(local.manualStarted || local.manualBeaten) ? 'checked' : ''} style="width:16px;height:16px;">
          <span>Now Playing</span>
        </label>
      </div>

      <div class="field" style="text-align:left;margin-bottom:14px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-family:inherit; font-size:0.8125rem; color:var(--text);">
          <input type="checkbox" id="manual-beaten-checkbox" ${local.manualBeaten ? 'checked' : ''} style="width:16px;height:16px;">
          <span>Mark as beaten</span>
        </label>
        <div id="manual-beaten-date-wrap" style="margin-top:10px; ${local.manualBeaten ? '' : 'display:none;'}">
          <label>Date beaten</label>
          <input type="date" id="manual-beaten-date" value="${beatenDateValue}">
        </div>
      </div>

      ${thorPlayButtonHtml()}

      <button class="btn-view-achievements" id="modal-details-btn"><span class="arrow">▸</span> Game Details</button>
      <div class="gd-wrap" id="modal-details" style="display:none;"></div>

      <button class="btn-view-achievements" id="modal-guide-btn"><span class="arrow">▸</span> Game Guide</button>
      <div class="guide-panel" id="modal-guide-panel" style="display:none;"></div>

      <button class="btn-view-achievements" id="modal-cheats-btn"><span class="arrow">↗</span> Need Cheats?</button>

      <button class="btn-view-achievements" id="modal-link-ra-btn"><span class="arrow">▸</span> Link to RetroAchievements</button>
      <div class="guide-panel" id="modal-link-ra-panel" style="display:none;"></div>

      ${canPatchConsole(local.ConsoleName) ? `
      <button class="btn-view-achievements" id="modal-patch-btn"><span class="arrow">▸</span> ROM Hacks</button>
      <div class="guide-panel" id="modal-patch-panel" style="display:none;"></div>
      ` : ''}

      <button class="btn-view-achievements" id="modal-yt-btn"><span class="arrow">▸</span> Search YouTube</button>
      <div class="guide-panel" id="modal-yt-panel" style="display:none;"></div>

      <div class="modal-links">
        <a href="https://howlongtobeat.com/?q=${encodeURIComponent(local.Title)}" target="_blank" rel="noopener">Search HowLongToBeat ↗</a>
      </div>

      <p class="modal-note">Not on RetroAchievements: tracked by hand and left out of RetroAchievements stats. Ratings via <a href="https://rawg.io" target="_blank" rel="noopener" style="color:var(--teal)">RAWG</a>.</p>
    `;

  const startedCheckbox = card.querySelector('#manual-started-checkbox');
  const checkbox = card.querySelector('#manual-beaten-checkbox');
  const dateWrap = card.querySelector('#manual-beaten-date-wrap');
  const dateInput = card.querySelector('#manual-beaten-date');

  const refreshManualStatus = () => {
    const el = card.querySelector('#manual-status-val');
    if(el) el.innerHTML = manualStatusHtml(local);
  };

  // Unticking Now Playing also clears Beaten, moving the game back to the Backlog.
  startedCheckbox.addEventListener('change', async () => {
    const nowStarted = startedCheckbox.checked;
    if(!nowStarted && checkbox.checked){
      checkbox.checked = false;
      dateWrap.style.display = 'none';
      await updateManualBeatenStatus(gameId, false, null);
      local.manualBeaten = false; local.manualBeatenDate = null;
    }
    await updateManualStartedStatus(gameId, nowStarted);
    local.manualStarted = nowStarted;
    refreshManualStatus();
  });

  checkbox.addEventListener('change', async () => {
    dateWrap.style.display = checkbox.checked ? 'block' : 'none';
    if(checkbox.checked && !dateInput.value){
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    // Beaten implies played.
    if(checkbox.checked && !startedCheckbox.checked){
      startedCheckbox.checked = true;
      await updateManualStartedStatus(gameId, true);
      local.manualStarted = true;
    }
    await updateManualBeatenStatus(gameId, checkbox.checked, dateInput.value || null);
    local.manualBeaten = checkbox.checked; local.manualBeatenDate = dateInput.value || null;
    refreshManualStatus();
  });
  dateInput.addEventListener('change', async () => {
    if(checkbox.checked){
      await updateManualBeatenStatus(gameId, true, dateInput.value || null);
      local.manualBeatenDate = dateInput.value || null;
      refreshManualStatus();
    }
  });

  thorWirePlay(card, gameId, local.Title, local.ConsoleName, boxArt);
  attachRawgLookup(gameId, local.Title, card);
  setupGameDetailsUI(gameId, local.Title, card, { aboutOnly: true, consoleName: local.ConsoleName });
  setupGameGuideUI(gameId, local.Title, card, local.ConsoleID);
  setupCheatsUI(gameId, local.Title, card, local.ConsoleName);
  setupWalkthroughUI(gameId, local.Title, card, local.ConsoleName);
  setupLinkRaUI(gameId, local, card);
  if(canPatchConsole(local.ConsoleName)) setupRomPatchUI(gameId, local.Title, card, local.ConsoleName);
}

// "Link to RetroAchievements": find a non-RA game on RA and convert it.
function setupLinkRaUI(gameId, local, card){
  const btn = card.querySelector('#modal-link-ra-btn');
  const panel = card.querySelector('#modal-link-ra-panel');
  if(!btn || !panel) return;
  let built = false;

  btn.addEventListener('click', async () => {
    const nowOpen = panel.style.display === 'none';
    panel.style.display = nowOpen ? 'block' : 'none';
    btn.classList.toggle('open', nowOpen);
    if(!nowOpen || built) return;
    built = true;

    panel.innerHTML = `
        <div class="field">
          <label>System</label>
          <select id="link-ra-system"><option>Loading systems…</option></select>
        </div>
        <div class="field">
          <label>Game title</label>
          <input id="link-ra-title" type="text" value="${local.Title.replace(/"/g, '&quot;')}" autocomplete="off">
        </div>
        <button class="btn-primary" id="link-ra-search-btn">Search</button>
        <div id="link-ra-results"></div>
      `;

    const sel = panel.querySelector('#link-ra-system');
    try{
      const consoles = await getConsoleList();
      const sorted = (consoles || [])
        .map(c => ({ id: c.ID ?? c.id, name: c.Name ?? c.name }))
        .filter(c => c.id != null && c.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      sel.innerHTML = sorted.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }catch(e){
      sel.innerHTML = '<option value="">Could not load systems</option>';
    }

    const runSearch = async () => {
      const consoleId = sel.value;
      const query = panel.querySelector('#link-ra-title').value.trim();
      const resultsEl = panel.querySelector('#link-ra-results');
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
          const id = g.ID ?? g.id;
          const title = g.Title ?? g.title;
          const icon = g.ImageIcon ?? g.imageIcon;
          const numAch = g.NumAchievements ?? g.numAchievements ?? 0;
          return `
              <div class="ag-result" data-game-id="${id}">
                <img src="${imgUrl(icon)}" alt="">
                <span class="t">${title}</span>
                <span class="n">${numAch} ach.</span>
              </div>
            `;
        }).join('');
        resultsEl.querySelectorAll('.ag-result').forEach(el => {
          el.addEventListener('click', () => {
            const id = Number(el.getAttribute('data-game-id'));
            const match = matches.find(g => Number(g.ID ?? g.id) === id);
            if(match) convertCustomToRaGame(gameId, match, consoleId, consoleName);
          });
        });
      }catch(e){
        resultsEl.innerHTML = `<div class="error-box">Search failed: ${e.message}</div>`;
      }
    };
    panel.querySelector('#link-ra-search-btn').addEventListener('click', runSearch);
    panel.querySelector('#link-ra-title').addEventListener('keydown', (e) => {
      if(e.key === 'Enter') runSearch();
    });
  });
}

let openAchievementsGameId = null; // game whose achievements panel is showing, so a mode switch can redraw it
let openBeatenAchievementsGameId = null; // same, for Beaten Achievements

// Opening a profile adds a history entry, so Back closes the profile instead of leaving the app.
// Closing it any other way removes the entry again.
let profileHistoryPushed = false;
function pushProfileHistory(){
  if(profileHistoryPushed) return; // already open (redrawn by pull-to-refresh)
  profileHistoryPushed = true;
  history.pushState({ gltProfile: true }, '');
}
window.addEventListener('popstate', () => {
  if(!profileHistoryPushed) return;
  profileHistoryPushed = false;
  if($('#modal-backdrop').classList.contains('open')) closeGameModal({ fromHistory: true });
});

// Ids of the profile's expanded section buttons.
function openProfilePanelIds(){
  return Array.from($('#modal-card').querySelectorAll('.btn-view-achievements.open'))
    .map(btn => btn.id)
    .filter(Boolean);
}

// Expands those sections again after the profile is redrawn.
function reopenProfilePanels(card, ids){
  ids.forEach(id => {
    const btn = card.querySelector('#' + id);
    if(btn && btn.style.display !== 'none' && !btn.classList.contains('open')) btn.click();
  });
}

// opts.restorePanels: ids from openProfilePanelIds(), to keep sections open across a pull-to-refresh.
async function openGameModal(gameId, opts){
  const restorePanels = (opts && opts.restorePanels) || [];
  const card = $('#modal-card');
  const local = findGameLocal(gameId);
  card.dataset.gameId = gameId;
  openAchievementsGameId = null;
  openBeatenAchievementsGameId = null;
  clearSubsetPanels();
  pushProfileHistory();
  $('#modal-backdrop').classList.add('open');
  card.innerHTML = `
      <button class="modal-close" id="modal-close-btn">✕</button>
      <div class="modal-art-wrap">
        <img class="modal-art" src="" alt="">
        <div class="rawg-badge-row"><span id="rawg-badge"></span></div>
      </div>
      <div class="modal-body"><div class="loading">Loading game info</div></div>
    `;
  $('#modal-close-btn').addEventListener('click', closeGameModal);

  if(local && local.customConsole){
    renderCustomGameModal(gameId, local, card);
    return;
  }

  let ext;
  try{
    ext = await getGameExtended(gameId);
  }catch(e){
    if(card.dataset.gameId !== String(gameId)) return;
    card.querySelector('.modal-body').innerHTML = `<div class="error-box">Could not load game details: ${e.message}</div>`;
    return;
  }
  if(card.dataset.gameId !== String(gameId)) return; // another game was opened meanwhile

  const title = ext.Title || (local && local.Title) || 'Unknown game';
  const console_ = ext.ConsoleName || (local && local.ConsoleName) || '—';
  const genre = ext.Genre || '—';
  const developer = ext.Developer || '—';
  const publisher = ext.Publisher || '—';
  const released = ext.Released ? parseRADate(ext.Released) : null;
  const releasedLabel = released ? released.toLocaleDateString(undefined, { year:'numeric', month:'long', day: ext.ReleasedAtGranularity === 'year' ? undefined : 'numeric' }) : '—';
  const boxArt = imgUrl(ext.ImageBoxArt || (local && local.ImageIcon));

  const totalAch = Number(ext.NumAchievements || (local && (local.MaxPossible || local.NumPossibleAchievements)) || 0);

  const isHardcoreMode = statsMode === 'hardcore';
  const earned = local ? (isHardcoreMode ? Number(local.NumAwardedHardcore ?? 0) : Number(local.NumAwarded ?? local.NumAchieved ?? 0)) : 0;
  const pct = totalAch ? Math.round((earned/totalAch)*100) : 0;
  const est = estHoursCache[gameId];
  const awardKind = local ? local.HighestAwardKind : null;
  // The award date shows only when the badge says done in the current mode.
  const raBeatenDateLabel = (local && local.HighestAwardDate && awardCountsInMode(awardKind))
    ? formatBeatenDate(parseRADate(local.HighestAwardDate)) : '';

  const raUrl = `https://retroachievements.org/game/${gameId}`;
  const hltbUrl = `https://howlongtobeat.com/?q=${encodeURIComponent(title)}`;

  card.querySelector('.modal-art').src = boxArt;
  card.dataset.gameId = gameId;
  card.querySelector('.modal-body').innerHTML = `
      <h2>${title}</h2>
      <p class="sub">${console_}</p>

      <div class="modal-meta">
        <div class="mi"><div class="k">GENRE</div><div class="v">${genre}</div></div>
        <div class="mi"><div class="k">RELEASED</div><div class="v">${releasedLabel}</div></div>
        <div class="mi"><div class="k">DEVELOPER</div><div class="v">${developer}</div></div>
        <div class="mi"><div class="k">PUBLISHER</div><div class="v">${publisher}</div></div>
      </div>

      <div class="modal-progress">
        <div class="row"><span>Your progress</span><span style="color:var(--gold)">${earned}/${totalAch || '?'} · ${pct}%</span></div>
        <div class="row"><span>Status</span><span class="status-val">${awardPill(awardKind)}${beatenDateHtml(raBeatenDateLabel)}</span></div>
        <div class="row">
          <span id="modal-playtime-label">${est && est.real ? 'Playtime' : (est && est.beaten ? 'Time to beat' : 'Est. playtime')}</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span id="modal-playtime-val" style="color:var(--gold)">${est ? formatDuration(est) : '—'}</span>
            <button id="modal-playtime-refresh" class="pt-refresh-btn" title="Re-check playtime with RetroAchievements" aria-label="Refresh playtime">⟳</button>
          </span>
        </div>
      </div>

      ${thorPlayButtonHtml()}

      <button class="btn-view-achievements" id="modal-details-btn"><span class="arrow">▸</span> Game Details</button>
      <div class="gd-wrap" id="modal-details" style="display:none;"></div>

      <button class="btn-view-achievements" id="modal-view-ach-btn"><span class="arrow">▸</span> View Achievements</button>
      <div class="achievements-list" id="modal-achievements" style="display:none;"></div>

      <button class="btn-view-achievements" id="modal-view-beaten-ach-btn"><span class="arrow">▸</span> View Beaten Achievements</button>
      <div class="achievements-list" id="modal-beaten-achievements" style="display:none;"></div>

      <button class="btn-view-achievements" id="modal-subsets-btn" style="display:none;"><span class="arrow">▸</span> Subsets</button>
      <div class="subsets-list" id="modal-subsets"></div>

      <button class="btn-view-achievements" id="modal-guide-btn"><span class="arrow">▸</span> Game Guide</button>
      <div class="guide-panel" id="modal-guide-panel" style="display:none;"></div>

      <button class="btn-view-achievements" id="modal-cheats-btn"><span class="arrow">↗</span> Need Cheats?</button>

      ${canPatchConsole(console_) ? `
      <button class="btn-view-achievements" id="modal-patch-btn"><span class="arrow">▸</span> ROM Hacks</button>
      <div class="guide-panel" id="modal-patch-panel" style="display:none;"></div>
      ` : ''}

      <button class="btn-view-achievements" id="modal-yt-btn"><span class="arrow">▸</span> Search YouTube</button>
      <div class="guide-panel" id="modal-yt-panel" style="display:none;"></div>

      <div class="modal-links">
        <a href="${raUrl}" target="_blank" rel="noopener">RetroAchievements page ↗</a>
        <a href="${hltbUrl}" target="_blank" rel="noopener">Search HowLongToBeat ↗</a>
      </div>

      <p class="modal-note">Ratings via <a href="https://rawg.io" target="_blank" rel="noopener" style="color:var(--teal)">RAWG</a>.</p>
    `;

  const ptRefreshBtn = card.querySelector('#modal-playtime-refresh');
  if(ptRefreshBtn){
    ptRefreshBtn.addEventListener('click', async () => {
      ptRefreshBtn.disabled = true;
      ptRefreshBtn.classList.add('spinning');
      try{
        const fresh = await getEstimatedHours(gameId, true);
        if(card.dataset.gameId !== String(gameId)) return;
        const valEl = card.querySelector('#modal-playtime-val');
        const labelEl = card.querySelector('#modal-playtime-label');
        if(valEl) valEl.textContent = formatDuration(fresh);
        if(labelEl) labelEl.textContent = fresh.real ? 'Playtime' : (fresh.beaten ? 'Time to beat' : 'Est. playtime');
        renderRecentGames(recentGamesData);
        try{ renderLibrary(); }catch(e){}
      }catch(e){
      }finally{
        if(card.dataset.gameId === String(gameId)){
          ptRefreshBtn.disabled = false;
          ptRefreshBtn.classList.remove('spinning');
        }
      }
    });
  }

  attachRawgLookup(gameId, title, card);
  setupGameDetailsUI(gameId, title, card, { consoleName: console_ });
  setupGameGuideUI(gameId, title, card, ext.ConsoleID || (local && local.ConsoleID));
  setupCheatsUI(gameId, title, card, console_);
  setupWalkthroughUI(gameId, title, card, console_);
  if(canPatchConsole(console_)) setupRomPatchUI(gameId, title, card, console_);

  const achBtn = card.querySelector('#modal-view-ach-btn');
  const achWrap = card.querySelector('#modal-achievements');
  let achLoaded = false;
  achBtn.addEventListener('click', async () => {
    const nowOpen = achWrap.style.display === 'none';
    achWrap.style.display = nowOpen ? 'flex' : 'none';
    achWrap.style.flexDirection = 'column';
    achBtn.classList.toggle('open', nowOpen);
    if(nowOpen && !achLoaded){
      achLoaded = true;
      resetAchState(gameId);
      achWrap.innerHTML = '<div class="achievements-list-loading">Loading achievements…</div>';
      try{
        const list = await getAchievementsList(gameId);
        attachAchievementTypes(list, ext);
        await loadAchOrder(gameId);
        if(card.dataset.gameId !== String(gameId)) return;
        renderAchWrapContent(achWrap, gameId);
        openAchievementsGameId = gameId;
      }catch(e){
        if(card.dataset.gameId !== String(gameId)) return;
        achWrap.innerHTML = `<div class="achievements-list-loading">Could not load achievements: ${e.message}</div>`;
        achLoaded = false;
      }
    }
  });

  const beatenAchBtn = card.querySelector('#modal-view-beaten-ach-btn');
  thorWirePlay(card, gameId, title, console_, boxArt);
  const beatenAchWrap = card.querySelector('#modal-beaten-achievements');
  let beatenAchLoaded = false;
  beatenAchBtn.addEventListener('click', async () => {
    const nowOpen = beatenAchWrap.style.display === 'none';
    beatenAchWrap.style.display = nowOpen ? 'flex' : 'none';
    beatenAchWrap.style.flexDirection = 'column';
    beatenAchBtn.classList.toggle('open', nowOpen);
    if(nowOpen && !beatenAchLoaded){
      beatenAchLoaded = true;
      beatenAchWrap.innerHTML = '<div class="achievements-list-loading">Loading achievements…</div>';
      try{
        const list = await getAchievementsList(gameId);
        attachAchievementTypes(list, ext);
        if(card.dataset.gameId !== String(gameId)) return;
        beatenAchWrap.innerHTML = renderBeatenAchievementsList(list, statsMode === 'hardcore');
        openBeatenAchievementsGameId = gameId;
      }catch(e){
        if(card.dataset.gameId !== String(gameId)) return;
        beatenAchWrap.innerHTML = `<div class="achievements-list-loading">Could not load achievements: ${e.message}</div>`;
        beatenAchLoaded = false;
      }
    }
  });

  // The Subsets button only appears once its lookup finishes, so wait for it if it was open.
  const subsetsReady = setupSubsetsUI(card, gameId, ext);
  if(restorePanels.includes('modal-subsets-btn')) await subsetsReady.catch(() => {});
  if(card.dataset.gameId !== String(gameId)) return;
  reopenProfilePanels(card, restorePanels);
  // Put the profile back where it was. Sections (the achievements list, for one) fill in after a moment,
  // so the position is set again a few times until the page is tall enough, unless you scroll yourself.
  if(opts && opts.restoreScroll > 0){
    const scroller = $('#modal-backdrop');
    const target = opts.restoreScroll;
    let touched = false;
    const stop = () => { touched = true; };
    scroller.addEventListener('touchstart', stop, { once: true, passive: true });
    scroller.addEventListener('wheel', stop, { once: true, passive: true });
    [0, 100, 300, 600, 1000, 1600].forEach(ms => setTimeout(() => {
      if(!touched && card.dataset.gameId === String(gameId) && scroller.scrollTop !== target) scroller.scrollTop = target;
    }, ms));
  }
}

function closeGameModal(opts){
  $('#modal-backdrop').classList.remove('open');
  thorClearViewing();
  openAchievementsGameId = null;
  openBeatenAchievementsGameId = null;
  clearSubsetPanels();
  stopWalkthroughPlayers();
  closeGuideReader();
  // Closed by something other than Back: drop the history entry (opts may be a click event).
  if(profileHistoryPushed && !(opts && opts.fromHistory === true)){
    profileHistoryPushed = false;
    history.back();
  }
}

// Box art viewer with pinch zoom and pan. Tap the box art to open it.
(function(){
  const overlay = $('#img-zoom-overlay');
  const img = $('#img-zoom-target');
  const closeBtn = $('#img-zoom-close');
  const hint = $('#img-zoom-hint');
  if(!overlay || !img || !closeBtn) return;

  const MIN_SCALE = 1, MAX_SCALE = 5;
  let scale = 1, panX = 0, panY = 0;
  const pointers = new Map();
  let lastDist = null, lastMid = null, dragStart = null, lastTapTime = 0;

  function applyTransform(){
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
  function resetTransform(){
    scale = 1; panX = 0; panY = 0; applyTransform();
  }
  function openZoom(src){
    if(!src) return;
    img.src = src;
    resetTransform();
    overlay.classList.add('open');
    if(hint) hint.classList.remove('hidden');
  }
  function closeZoom(){
    overlay.classList.remove('open');
    pointers.clear();
    lastDist = null; lastMid = null; dragStart = null;
  }

  document.addEventListener('click', (e) => {
    const art = e.target.closest('.modal-art');
    if(art && art.src) openZoom(art.src);
  });

  closeBtn.addEventListener('click', closeZoom);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) closeZoom(); });

  function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b){ return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  img.addEventListener('pointerdown', (e) => {
    img.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if(pointers.size === 1){
      const now = Date.now();
      if(now - lastTapTime < 320){ // double-tap: toggle zoom
        if(scale > MIN_SCALE){ resetTransform(); }
        else { scale = 2.5; applyTransform(); }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
      dragStart = { x: e.clientX - panX, y: e.clientY - panY };
    } else if(pointers.size === 2){
      if(hint) hint.classList.add('hidden');
      const pts = [...pointers.values()];
      lastDist = dist(pts[0], pts[1]);
      lastMid = mid(pts[0], pts[1]);
      dragStart = null;
    }
  });

  img.addEventListener('pointermove', (e) => {
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if(pointers.size === 2){
      const pts = [...pointers.values()];
      const newDist = dist(pts[0], pts[1]);
      const newMid = mid(pts[0], pts[1]);
      if(lastDist){
        const factor = newDist / lastDist;
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
        panX += newMid.x - lastMid.x;
        panY += newMid.y - lastMid.y;
        applyTransform();
      }
      lastDist = newDist; lastMid = newMid;
    } else if(pointers.size === 1 && dragStart && scale > MIN_SCALE){
      panX = e.clientX - dragStart.x;
      panY = e.clientY - dragStart.y;
      applyTransform();
    }
  });

  function endPointer(e){
    pointers.delete(e.pointerId);
    if(pointers.size < 2){ lastDist = null; lastMid = null; }
    if(pointers.size === 1){
      const [p] = pointers.values();
      dragStart = { x: p.x - panX, y: p.y - panY };
    } else if(pointers.size === 0){
      dragStart = null;
      if(scale <= MIN_SCALE + 0.02) resetTransform();
    }
  }
  img.addEventListener('pointerup', endPointer);
  img.addEventListener('pointercancel', endPointer);

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && overlay.classList.contains('open')) closeZoom();
  });
})();

$('#modal-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'modal-backdrop') closeGameModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){ closeGameModal(); closeAddGameModal(); closeRawgModal(); closeRaConnectModal(); closeDataModal(); closeAboutModal(); closeSocialModal(); closeDropdownMenu(); }
});

// Only one section of a game profile is open at a time: opening one closes the one that was open.
// (Capture phase, so the open one is closed before the new one starts opening.)
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest && ev.target.closest('#modal-card .btn-view-achievements');
  if(!btn || btn.classList.contains('open') || btn.classList.contains('btn-play-thor') || btn.id === 'modal-cheats-btn') return;
  $('#modal-card').querySelectorAll('.btn-view-achievements.open').forEach(other => { if(other !== btn) other.click(); });
}, true);
