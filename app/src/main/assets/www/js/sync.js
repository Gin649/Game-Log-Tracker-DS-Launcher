// Loading the library from RA, connect/disconnect, and the casual/hardcore toggle.

const dashCacheKey = () => `ra-dash:${creds.username}`;

async function loadDashCache(){
  try{
    const r = await window.storage.get(dashCacheKey(), false);
    return r && r.value ? JSON.parse(r.value) : null;
  }catch(e){
    return null;
  }
}

async function saveDashCache(dash){
  try{ await window.storage.set(dashCacheKey(), JSON.stringify(dash), false); }catch(e){}
}

// Builds libraryData from RA's completion progress, plus manually added games RA doesn't show yet.
async function buildLibraryFromProgress(results){
  libraryData = results.map(g => ({
    ...g,
    pct: Number(g.MaxPossible) ? Math.round((Number(g.NumAwarded)/Number(g.MaxPossible))*100) : 0,
    lastPlayed: g.LastPlayed || g.MostRecentAwardedDate || null,
  }));

  // The progress list only knows the last unlock, not the last session; the recently played list
  // has the real time, so use whichever is newer (as ISO strings, so the column sorts right).
  const recentPlayed = new Map(recentGamesData.map(r => [String(r.GameID), r.LastPlayed]));
  libraryData.forEach(g => {
    const a = parseRADate(g.lastPlayed);
    const b = parseRADate(recentPlayed.get(String(g.GameID)));
    const best = (a && b) ? (b.getTime() > a.getTime() ? b : a) : (a || b);
    g.lastPlayed = best ? best.toISOString() : null;
  });

  // Manually added games not played yet; ones RA now lists are dropped.
  const realIds = new Set(libraryData.map(g => g.GameID));
  const manual = await loadManualGames();
  const stillManual = manual.filter(g => !realIds.has(g.GameID));
  const renamed = await normalizeCustomConsoleNames(stillManual);
  if(stillManual.length !== manual.length || renamed) await saveManualGames(stillManual);
  libraryData = [...libraryData, ...stillManual];

  // Games promoteManualGameToReal() saw progress on that this list doesn't have yet.
  const pendingReal = await loadPendingRealGames();
  const stillPending = pendingReal.filter(g => !realIds.has(g.GameID));
  if(stillPending.length !== pendingReal.length) await savePendingRealGames(stillPending);
  libraryData = [...libraryData, ...stillPending];
}

// Redraws everything that depends on the library. One view failing doesn't stop the others.
function renderLibraryViews(){
  const safe = (fn, wrapSel, what) => {
    try{ fn(); }
    catch(e){ if(wrapSel) $(wrapSel).innerHTML = `<div class="error-box">Couldn't display ${what}: ${e.message}</div>`; }
  };
  safe(renderSystemChips);
  safe(renderBacklog, '#backlog-table-wrap', 'your backlog');
  safe(renderLibrary, '#lib-table-wrap', 'your library');
  safe(() => { if(recentGamesData.length) renderRecentGames(recentGamesData); }); // award labels and hidden subsets
  safe(renderByYear, '#year-wrap', 'beaten by year');
  // games from systems RA doesn't have get their pictures filled in once they are on screen
  clearTimeout(renderLibraryViews.artTimer);
  renderLibraryViews.artTimer = setTimeout(() => { if(typeof fillMissingCustomArt === 'function') fillMissingCustomArt(); }, 3000);
}

async function loadAll(opts){
  const forcePlaytimeRefresh = !!(opts && opts.forceRecentPlaytime);
  await enqueueTask(async () => {
    // Show the last saved copy while fresh data loads (not on an explicit refresh).
    const cached = forcePlaytimeRefresh ? null : await loadDashCache();
    const dash = cached ? { ...cached } : {};
    const fromCache = {};
    let gotFresh = false;

    if(cached){
      try{
        if(cached.profile){ renderProfile(cached.profile); fromCache.profile = true; }
        if(cached.points){ userPoints = cached.points; }
        if(cached.recent){ recentGamesData = cached.recent; renderRecentGames(recentGamesData); fromCache.recent = true; }
        if(cached.unlocks){ renderUnlocks(cached.unlocks); fromCache.unlocks = true; }
        if(cached.progress){
          await buildLibraryFromProgress(cached.progress);
          renderLibraryViews();
          fromCache.library = true;
        }
        if(lastProfile) renderProfile(lastProfile);
      }catch(e){
        console.error('Showing the saved dashboard failed:', e);
      }
    }

    if(!fromCache.recent) $('#recent-games').innerHTML = '<div class="loading">Loading</div>';
    if(!fromCache.unlocks) $('#recent-unlocks').innerHTML = '<div class="loading">Loading</div>';
    if(!fromCache.library){
      $('#backlog-table-wrap').innerHTML = '<div class="loading">Loading</div>';
      $('#lib-table-wrap').innerHTML = '<div class="loading">Loading</div>';
    }

    try{
      const profile = await raFetch('API_GetUserProfile.php', {});
      dash.profile = profile; gotFresh = true;
      renderProfile(profile);
    }catch(e){
      if(fromCache.profile) console.error('Profile refresh failed:', e);
      else $('#profile-hero').innerHTML = `<div class="error-box">Could not load profile: ${e.message}</div>`;
    }

    try{
      const points = await raFetch('API_GetUserPoints.php', {});
      userPoints = points;
      dash.points = points; gotFresh = true;
      if(lastProfile) renderProfile(lastProfile);
    }catch(e){
      console.error('Failed to load user points:', e);
    }

    try{
      const recent = await raFetch('API_GetUserRecentlyPlayedGames.php', { c: 12 });
      recentGamesData = recent || [];
      dash.recent = recentGamesData; gotFresh = true;
      renderRecentGames(recentGamesData);
    }catch(e){
      if(fromCache.recent) console.error('Recent games refresh failed:', e);
      else $('#recent-games').innerHTML = `<div class="error-box">Could not load recently played games: ${e.message}</div>`;
    }

    try{
      const unlocks = await raFetch('API_GetUserRecentAchievements.php', { m: 4320 });
      dash.unlocks = unlocks; gotFresh = true;
      renderUnlocks(unlocks);
    }catch(e){
      if(fromCache.unlocks) console.error('Recent unlocks refresh failed:', e);
      else $('#recent-unlocks').innerHTML = `<div class="error-box">Could not load recent unlocks: ${e.message}</div>`;
    }

    try{
      const progress = await raFetch('API_GetUserCompletionProgress.php', { c: 500 });
      const results = (progress && progress.Results) || [];
      dash.progress = results; gotFresh = true;
      await buildLibraryFromProgress(results);

      if(lastProfile) renderProfile(lastProfile);
    }catch(e){
      console.error('Failed to load live library data:', e);
      if(!fromCache.library){
        // Still show the manually added games.
        try{
          libraryData = await loadManualGames();
        }catch(e2){
          libraryData = [];
        }
        if(libraryData.length === 0){
          $('#lib-table-wrap').innerHTML = `<div class="error-box">Could not load your library: ${e.message}</div>`;
          $('#year-wrap').innerHTML = `<div class="error-box">Could not load completions: ${e.message}</div>`;
          return;
        }
        if(lastProfile) renderProfile(lastProfile);
      }
    }

    renderLibraryViews();
    if(gotFresh) await saveDashCache(dash);
  });

  // An explicit refresh fetches playtime again for recent games played in the last 24 hours.
  let forceIds;
  if(forcePlaytimeRefresh){
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    forceIds = new Set(
      recentGamesData
        .filter(g => { const d = parseRADate(g.LastPlayed); return d && d.getTime() >= cutoff; })
        .map(g => g.GameID)
    );
  }

  // Playtime loads most recently played first, so the games on screen fill in first.
  const recentIds = new Set(recentGamesData.map(g => g.GameID));
  const remainingByRecency = libraryData
    .filter(g => !recentIds.has(g.GameID))
    .slice()
    .sort((a, b) => {
      const ta = a.lastPlayed ? (parseRADate(a.lastPlayed) || 0).getTime?.() || 0 : 0;
      const tb = b.lastPlayed ? (parseRADate(b.lastPlayed) || 0).getTime?.() || 0 : 0;
      return tb - ta;
    });

  loadEstimatedHoursFor([...recentGamesData, ...remainingByRecency], () => {
    renderRecentGames(recentGamesData);
    try{ renderLibrary(); }catch(e){ console.error('renderLibrary failed:', e); }
  }, forceIds);
}

function updateRaConnectionView(){
  const hasRa = !!creds;
  $('#ra-placeholder').style.display = hasRa ? 'none' : 'block';
  $('#ra-content').style.display = hasRa ? 'block' : 'none';
}
function showDashboard(){
  $('#dashboard').style.display = 'block';
  $('#menu-wrap').style.display = 'block';
  updateRaConnectionView();
}

async function connectToRa(username, apiKey){
  creds = { username, apiKey };
  try{
    const profile = await raFetch('API_GetUserProfile.php', {});
    if(!profile || !profile.User){ throw new Error('Unexpected response. Check your username and key.'); }
    await saveCreds(username, apiKey);
    showDashboard();
    loadAll();
    return true;
  }catch(e){
    creds = null;
    throw e;
  }
}

function openRaConnectModal(){
  $('#connect-error').innerHTML = '';
  $('#ra-connect-backdrop').classList.add('open');
}
function closeRaConnectModal(){
  $('#ra-connect-backdrop').classList.remove('open');
}
$('#ra-connect-close-btn').addEventListener('click', closeRaConnectModal);
$('#ra-connect-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'ra-connect-backdrop') closeRaConnectModal();
});

$('#btn-connect').addEventListener('click', async () => {
  const username = $('#in-user').value.trim();
  const apiKey = $('#in-key').value.replace(/\s+/g, '');
  $('#connect-error').innerHTML = '';
  if(!username || !apiKey){ showError('Enter both a username and an API key.'); return; }

  const btn = $('#btn-connect');
  btn.disabled = true; btn.textContent = 'Connecting…';
  try{
    await connectToRa(username, apiKey);
    closeRaConnectModal();
  }catch(e){
    showError(`Connection failed: ${e.message}. Double-check your username and Web API key.`);
  }finally{
    btn.disabled = false; btn.textContent = 'Connect';
  }
});

$('#btn-hardcore-toggle').addEventListener('click', () => {
  statsMode = statsMode === 'hardcore' ? 'casual' : 'hardcore';
  applyStatsModeLabel();
  saveStatsMode(statsMode);
  if(lastProfile) renderProfile(lastProfile);
  renderRecentGames(recentGamesData);
  renderLibraryViews();
  if(openAchievementsGameId != null){
    const achWrap = document.getElementById('modal-achievements');
    renderAchWrapContent(achWrap, openAchievementsGameId);
  }
  if(openBeatenAchievementsGameId != null){
    const list = achievementsListCache[openBeatenAchievementsGameId];
    const beatenAchWrap = document.getElementById('modal-beaten-achievements');
    if(beatenAchWrap && list) beatenAchWrap.innerHTML = renderBeatenAchievementsList(list, statsMode === 'hardcore');
  }
  refreshOpenSubsetPanels();
});
$('#lib-search').addEventListener('input', renderLibrary);

// Game Library: Hide beaten / Show beaten. Remembered between visits.
function syncHideDoneButton(){
  const btn = $('#btn-hide-done');
  btn.textContent = libraryHideDone ? 'Show beaten' : 'Hide beaten';
  btn.classList.toggle('active', libraryHideDone);
  btn.setAttribute('aria-pressed', String(libraryHideDone));
}
$('#btn-hide-done').addEventListener('click', async () => {
  libraryHideDone = !libraryHideDone;
  syncHideDoneButton();
  renderSystemChips();
  // Hiding can leave the picked system empty; fall back to All.
  if(systemFilter !== 'All' && !$('#system-chips .chip.active')){ systemFilter = 'All'; renderSystemChips(); }
  renderLibrary();
  try{ await window.storage.set('library-hide-done', libraryHideDone ? '1' : '0', false); }catch(e){}
});
(async () => {
  try{
    const saved = await window.storage.get('library-hide-done', false);
    if(saved && saved.value === '1'){
      libraryHideDone = true;
      syncHideDoneButton();
      if(libraryData && libraryData.length){ renderSystemChips(); renderLibrary(); }
    }
  }catch(e){}
})();
$('#backlog-search').addEventListener('input', renderBacklog);
