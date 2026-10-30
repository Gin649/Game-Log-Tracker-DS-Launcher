// Pull to refresh (reloads the data, not the page), the X button refresh, and swipe to close a profile.
(function(){
  let touchStartY = 0;
  let pulling = false;
  let currentPull = 0;
  const PULL_THRESHOLD = 70;
  const MAX_PULL = 100;

  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh-indicator';
  indicator.textContent = 'Pull to refresh';
  document.body.insertBefore(indicator, document.body.firstChild);

  // dataset.gameId is text; the game data uses the real value, so look it up.
  const resolveGameId = (idText) => {
    const hit = libraryData.find(g => String(g.GameID) === idText)
      || recentGamesData.find(g => String(g.GameID) === idText);
    if(hit) return hit.GameID;
    return /^\d+$/.test(idText) ? Number(idText) : idText;
  };
  async function refreshOpenGameProfile(idText){
    const gameId = resolveGameId(idText);
    let fresh;
    try{
      // One call for this game: progress, award, achievements and playtime.
      fresh = await raFetch('API_GetGameInfoAndUserProgress.php', { g: gameId, a: 1 });
    }catch(e){
      return; // offline: leave the profile as it is
    }
    if(!fresh || fresh.ID === undefined && fresh.Title === undefined) return;

    const maxPossible = Number(fresh.NumAchievements ?? 0);
    const numAwarded = Number(fresh.NumAwardedToUser ?? 0);
    const numAwardedHC = Number(fresh.NumAwardedToUserHardcore ?? 0);
    const idx = libraryData.findIndex(g => g.GameID === gameId);
    if(idx !== -1){
      const old = libraryData[idx];
      libraryData[idx] = {
        ...old,
        MaxPossible: maxPossible || old.MaxPossible,
        NumAwarded: numAwarded,
        NumAwardedHardcore: numAwardedHC,
        HighestAwardKind: fresh.HighestAwardKind ?? null,
        HighestAwardDate: fresh.HighestAwardDate ?? null,
        pct: maxPossible ? Math.round((numAwarded / maxPossible) * 100) : 0,
      };
    }
    const rIdx = recentGamesData.findIndex(g => g.GameID === gameId);
    if(rIdx !== -1){
      recentGamesData[rIdx] = {
        ...recentGamesData[rIdx],
        NumPossibleAchievements: maxPossible || recentGamesData[rIdx].NumPossibleAchievements,
        NumAchieved: numAwarded,
        NumAchievedHardcore: numAwardedHC,
      };
    }

    // Drop this game's caches so the profile redraws with fresh data.
    delete gameExtendedCache[gameId];
    try{ await window.storage.delete(`ra-gameinfo:${gameId}`, false); }catch(e){}
    if(fresh.Achievements){
      achievementsListCache[gameId] = Object.values(fresh.Achievements)
        .sort((a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0));
    }else{
      delete achievementsListCache[gameId];
      try{ await window.storage.delete(achCacheKey(gameId), false); }catch(e){}
    }
    try{ await getEstimatedHours(gameId, true); }catch(e){}

    try{ renderRecentGames(recentGamesData); }catch(e){}
    renderLibraryViews();

    const card = $('#modal-card');
    if(!profileOpen() || card.dataset.gameId !== String(gameId)) return; // closed or another game opened
    const openPanels = openProfilePanelIds();
    const scrollTop = $('#modal-backdrop').scrollTop; // the profile scrolls itself; keep your place in it
    const padSpot = window.padHoldFocus ? window.padHoldFocus() : null; // and the controller's highlight
    stopWalkthroughPlayers(); // saves the watch position before the redraw
    try{
      await openGameModal(gameId, { restorePanels: openPanels, restoreScroll: scrollTop });
    }finally{
      if(window.padRestoreFocus){
        window.padRestoreFocus(padSpot);
        // a spot with no id of its own (a row in a list) is found by position once the lists have filled in
        if(padSpot && padSpot.sig && !padSpot.sig.id && !padSpot.sig.gid) setTimeout(() => window.padRestoreFocus(padSpot, true), 1800);
      }
    }
  }

  // The profile scrolls itself (#modal-backdrop), so pulls there use its scrollTop.
  let profileMode = false;
  const profileEl = () => $('#modal-backdrop');
  const profileOpen = () => profileEl().classList.contains('open');
  // A touch inside a list that is itself scrolled down scrolls that list instead of refreshing.
  const insideScrolledChild = (node) => {
    for(let el = node; el && el !== profileEl(); el = el.parentElement){
      if(el.scrollTop > 1) return true;
    }
    return false;
  };

  // Controller X: the same refresh as a pull.
  let padRefreshing = false;
  window.padRefresh = () => {
    if(padRefreshing || !creds) return;
    let job;
    const onProfile = profileOpen() && $('#modal-card').dataset.gameId;
    if(onProfile){
      job = refreshOpenGameProfile($('#modal-card').dataset.gameId);
    }else if(!profileOpen() && $('#dashboard').style.display === 'block'){
      job = loadAll({ forceRecentPlaytime: true });
    }else{
      return;
    }
    padRefreshing = true;
    indicator.classList.toggle('over-profile', !!onProfile);
    indicator.textContent = 'Refreshing…';
    indicator.style.height = '44px';
    Promise.resolve(job).catch(() => {}).finally(() => {
      padRefreshing = false;
      indicator.style.height = '0px';
      indicator.classList.remove('over-profile');
    });
  };

  document.addEventListener('touchstart', (e) => {
    profileMode = false;
    if(profileOpen()){
      const card = $('#modal-card');
      pulling = !!creds && !!card.dataset.gameId
        && e.touches.length === 1
        && profileEl().contains(e.target)
        && profileEl().scrollTop <= 1 // offsets can be fractional on scaled screens
        && !insideScrolledChild(e.target);
      profileMode = pulling;
    }else{
      pulling = window.scrollY === 0 && !!creds && $('#dashboard').style.display === 'block';
    }
    if(pulling) touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if(!pulling) return;
    // An achievement being dragged has already claimed this gesture.
    if(e.defaultPrevented){ pulling = false; currentPull = 0; indicator.style.height = '0px'; return; }
    const atTop = profileMode ? profileEl().scrollTop <= 1 : window.scrollY === 0;
    const delta = e.touches[0].clientY - touchStartY;
    if(delta > 0 && atTop){
      currentPull = Math.min(delta, MAX_PULL);
      indicator.classList.toggle('over-profile', profileMode);
      indicator.style.height = currentPull + 'px';
      indicator.textContent = currentPull > PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if(!pulling) return;
    pulling = false;
    const wasProfile = profileMode;
    profileMode = false;
    if(currentPull > PULL_THRESHOLD){
      indicator.textContent = 'Refreshing…';
      let job;
      if(wasProfile && profileOpen()){
        job = refreshOpenGameProfile($('#modal-card').dataset.gameId);
      }else{
        job = loadAll({ forceRecentPlaytime: true });
      }
      Promise.resolve(job).catch(() => {}).finally(() => {
        indicator.style.height = '0px';
        indicator.classList.remove('over-profile');
      });
    } else {
      indicator.style.height = '0px';
      indicator.classList.remove('over-profile');
    }
    currentPull = 0;
  }, { passive: true });
})();

// Swipe left or right on a profile to close it.
(function(){
  const MIN_DISTANCE = 80; // px
  const MAX_TIME = 700;    // ms; a slow drag isn't a swipe
  const profile = $('#modal-backdrop');
  let start = null;

  // Not over things that use sideways movement: fields, the video player, reordering, sideways lists.
  function ignoresSwipe(target){
    if(target.closest('input, textarea, select, iframe, .yt-player-wrap')) return true;
    const row = target.closest('.ach-row');
    if(row && row.querySelector('.ach-reorder-controls')) return true;
    for(let el = target; el && el !== profile; el = el.parentElement){
      const overflowX = getComputedStyle(el).overflowX;
      if((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
    }
    return false;
  }
  const pageIsZoomed = () => window.visualViewport && window.visualViewport.scale > 1.05;

  profile.addEventListener('touchstart', (e) => {
    start = null;
    if(e.touches.length !== 1 || pageIsZoomed() || ignoresSwipe(e.target)) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
  }, { passive: true });
  profile.addEventListener('touchmove', (e) => {
    if(e.touches.length > 1 || e.defaultPrevented) start = null;
  }, { passive: true });
  profile.addEventListener('touchend', (e) => {
    if(!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const quick = Date.now() - start.time < MAX_TIME;
    start = null;
    if(quick && Math.abs(dx) >= MIN_DISTANCE && Math.abs(dy) < Math.abs(dx) * 0.5) closeGameModal();
  }, { passive: true });
})();
