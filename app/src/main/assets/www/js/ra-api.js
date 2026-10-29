// RetroAchievements requests, the saved login, and playtime lookups.

function fetchWithTimeout(url, ms){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// The app calls RetroAchievements itself (no CORS), at /ra/<endpoint>. If that fails for any reason
// other than a rejected login, the request goes through the Cloudflare Worker instead.
async function raFetch(endpoint, params){
  const qs = new URLSearchParams({ u: creds.username, ...params, y: creds.apiKey }).toString(); // params.u lets Social ask about another user

  async function attempt(label, url, ms){
    let res;
    try{ res = await fetchWithTimeout(url, ms); }
    catch(e){ throw new Error(`${label}: blocked (${e.message})`); }
    if(res.status === 401 || res.status === 403){
      const err = new Error('RetroAchievements rejected the username or API key (HTTP ' + res.status + ').');
      err.authFailure = true;
      throw err;
    }
    if(!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    let data;
    try{ data = await res.json(); }
    catch(e){ throw new Error(`${label}: response wasn't valid JSON`); }
    if(data && data.Error) throw new Error(data.Error);
    if(data === null || (Array.isArray(data) && data.length === 0 && endpoint.includes('Profile'))){
      throw new Error(`${label}: empty response`);
    }
    return data;
  }

  let nativeErr = null;
  if(thorBridge){
    try{ return await attempt('app', `/ra/${endpoint}?${qs}`, 20000); }
    catch(e){
      if(e.authFailure) throw e;
      nativeErr = e;
    }
  }
  try{
    return await attempt('worker', `https://ra-proxy.gin649.workers.dev/${endpoint}?${qs}`, 12000);
  }catch(e){
    if(e.authFailure || !nativeErr) throw e;
    throw new Error('Could not reach RetroAchievements (' + nativeErr.message + '; ' + e.message + ')');
  }
}

function imgUrl(path){
  if(!path) return '';
  return path.startsWith('http') ? path : MEDIA + path;
}

// The login is stored on this device only.
async function saveCreds(username, apiKey){
  try{ await window.storage.set('ra-credentials', JSON.stringify({ username, apiKey }), false); }
  catch(e){}
}
async function loadCreds(){
  try{
    const r = await window.storage.get('ra-credentials', false);
    if(r && r.value) return JSON.parse(r.value);
  }catch(e){ /* none stored yet */ }
  return null;
}
async function clearCreds(){
  try{ await window.storage.delete('ra-credentials', false); }catch(e){}
}

// Casual/Hardcore mode is remembered across restarts.
async function saveStatsMode(mode){
  try{ await window.storage.set('stats-mode', mode, false); }catch(e){}
}
async function loadStatsMode(){
  try{
    const r = await window.storage.get('stats-mode', false);
    if(r && (r.value === 'hardcore' || r.value === 'casual')) return r.value;
  }catch(e){ /* none stored yet */ }
  return 'casual';
}
function applyStatsModeLabel(){
  const btn = document.getElementById('btn-hardcore-toggle');
  if(btn) btn.textContent = statsMode === 'hardcore' ? 'Switch to Casual Mode' : 'Switch to Hardcore Mode';
}

// Playtime: RA reports UserTotalPlaytime (seconds) in GetGameInfoAndUserProgress, but some
// emulators never send it. Then it is estimated from unlock times: for a beaten game, first unlock
// to last; otherwise unlocks grouped into sessions (gaps under 30 minutes count as one) and summed.
const SESSION_GAP_MIN = 30;
const SESSION_START_MIN = 5;

function estimateHoursFromTimestamps(msTimestamps){
  if(!msTimestamps || msTimestamps.length === 0) return null;
  const sorted = [...new Set(msTimestamps)].sort((a,b) => a - b);
  let totalMin = SESSION_START_MIN;
  for(let i = 1; i < sorted.length; i++){
    const diffMin = (sorted[i] - sorted[i-1]) / 60000;
    totalMin += diffMin <= SESSION_GAP_MIN ? diffMin : SESSION_START_MIN;
  }
  return totalMin / 60;
}

function beatenSpanHoursFromTimestamps(msTimestamps){
  if(!msTimestamps || msTimestamps.length === 0) return null;
  const sorted = [...new Set(msTimestamps)].sort((a,b) => a - b);
  return (sorted[sorted.length - 1] - sorted[0]) / 3600000;
}

function formatDuration(entry, short){
  if(!entry || entry.hours == null) return '—';
  const totalMinutes = Math.round(entry.hours * 60);
  if(totalMinutes < 60){
    return short ? `${totalMinutes}m` : `${totalMinutes} min${totalMinutes === 1 ? '' : 's'}`;
  }
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  if(days > 0){
    if(short) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    const hrPart = hours > 0 ? ` ${hours} hr${hours === 1 ? '' : 's'}` : '';
    return `${days} day${days === 1 ? '' : 's'}${hrPart}`;
  }
  if(short) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const minPart = mins > 0 ? ` ${mins} min${mins === 1 ? '' : 's'}` : '';
  return `${hours} hr${hours === 1 ? '' : 's'}${minPart}`;
}

const CACHE_TTL_ACTIVE = 12 * 60 * 60 * 1000;
const CACHE_TTL_IDLE = 7 * 24 * 60 * 60 * 1000;
const IDLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

function findLibraryGame(gameId){
  return libraryData.find(g => g.GameID === gameId) || null;
}

// A game not played for a few days can't gain playtime, so its cache lasts longer.
// New unlocks still show up through awardedCountChanged().
function cachedDataTtl(gameId){
  const g = findLibraryGame(gameId);
  const played = g && g.lastPlayed ? Date.parse(g.lastPlayed) : NaN;
  const idle = !isNaN(played) && Date.now() - played > IDLE_AFTER_MS;
  return idle ? CACHE_TTL_IDLE : CACHE_TTL_ACTIVE;
}

// Cached entries keep the library's unlock count from when they were saved; a different count now means they are stale.
function awardedCountChanged(entry, gameId){
  if(entry.libAwarded == null) return false;
  const g = findLibraryGame(gameId);
  if(!g || g.NumAwarded == null) return false;
  return Number(g.NumAwarded) !== entry.libAwarded;
}

function libraryAwardedFor(gameId){
  const g = findLibraryGame(gameId);
  return g && g.NumAwarded != null ? Number(g.NumAwarded) : null;
}

const achCacheKey = (gameId) => `ra-ach:${creds.username}:${gameId}`;

async function readStoredAchList(gameId){
  try{
    const r = await window.storage.get(achCacheKey(gameId), false);
    if(!r || !r.value) return null;
    const entry = JSON.parse(r.value);
    if(!entry || !Array.isArray(entry.list)) return null;
    if(Date.now() - entry.ts >= cachedDataTtl(gameId)) return null;
    if(awardedCountChanged(entry, gameId)) return null;
    return entry.list;
  }catch(e){
    return null;
  }
}

async function storeAchList(gameId, list){
  const entry = { list, ts: Date.now(), libAwarded: libraryAwardedFor(gameId) };
  try{ await window.storage.set(achCacheKey(gameId), JSON.stringify(entry), false); }
  catch(e){}
}

// RA only reports playtime as of now, so the playtime at the moment a game was beaten or mastered
// is saved the first time a fresh award is seen. It can't be rebuilt later, so backups keep it.
const SNAP_WINDOW_MS = 24 * 60 * 60 * 1000;
const SNAP_SLOTS_BY_AWARD = {
  'beaten-softcore': ['beatCasual'],
  'beaten-hardcore': ['beatCasual', 'beatHardcore'],
  'completed': ['masterCasual'],
  'mastered': ['masterCasual', 'masterHardcore'],
};
const snapKey = (gameId) => `ra-snap:${creds.username}:${gameId}`;

// Slots the game's top award could fill, only while the award is new.
function recentAwardSlots(gameId){
  const g = findLibraryGame(gameId);
  if(!g || !g.HighestAwardKind || !g.HighestAwardDate) return [];
  const at = parseRADate(g.HighestAwardDate);
  if(!at || Date.now() - at.getTime() > SNAP_WINDOW_MS) return [];
  return SNAP_SLOTS_BY_AWARD[g.HighestAwardKind] || [];
}

async function readSnap(gameId){
  try{
    const r = await window.storage.get(snapKey(gameId), false);
    return r && r.value ? JSON.parse(r.value) : null;
  }catch(e){
    return null;
  }
}

// 0 means RA had no playtime when the award was seen, so it isn't asked again.
async function saveSnap(gameId, existing, slots, hours){
  const next = { ...(existing || {}) };
  slots.forEach(s => { next[s] = hours; });
  try{ await window.storage.set(snapKey(gameId), JSON.stringify(next), false); }
  catch(e){}
}

async function getEstimatedHours(gameId, force){
  if(!force && estHoursCache[gameId] !== undefined) return estHoursCache[gameId];

  const localGame = libraryIndex[gameId];
  const officialAward = !!(localGame && localGame.HighestAwardKind);
  // Many sets have no "beaten" award at all, so a 100% game counts as beaten for the estimate.
  const fullyCompleted = !!(localGame && Number(localGame.MaxPossible) > 0 &&
    Number(localGame.NumAwarded) >= Number(localGame.MaxPossible));
  const beaten = officialAward || fullyCompleted;
  const cacheKey = `ra-hours:${creds.username}:${gameId}`;
  const wantedSlots = recentAwardSlots(gameId);
  const snap = wantedSlots.length ? await readSnap(gameId) : null;
  const missingSlots = wantedSlots.filter(s => !snap || snap[s] === undefined);
  if(!force){
    try{
      const r = await window.storage.get(cacheKey, false);
      if(r && r.value){
        const parsed = JSON.parse(r.value);
        // A cached miss (hours: null) is only trusted for 5 minutes: RA may just not have the playtime yet.
        const ttl = parsed.hours == null ? 5 * 60 * 1000 : cachedDataTtl(gameId);
        if(Date.now() - parsed.ts < ttl && !awardedCountChanged(parsed, gameId) && missingSlots.length === 0){
          estHoursCache[gameId] = { hours: parsed.hours, beaten, real: !!parsed.real };
          if(!achievementsListCache[gameId]){
            const stored = await readStoredAchList(gameId);
            if(stored) achievementsListCache[gameId] = stored;
          }
          return estHoursCache[gameId];
        }
      }
    }catch(e){}
  }

  let hours = null;
  let real = false;
  try{
    const data = await raFetch('API_GetGameInfoAndUserProgress.php', { g: gameId, a: 1 });

    if(data && data.Achievements){
      achievementsListCache[gameId] = Object.values(data.Achievements)
        .sort((a,b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0));
      await storeAchList(gameId, achievementsListCache[gameId]);
    }

    const realSeconds = Number(data && data.UserTotalPlaytime);
    if(realSeconds > 0){
      hours = realSeconds / 3600;
      real = true;
    }else{
      const achievements = (data && data.Achievements) ? Object.values(data.Achievements) : [];
      const dates = [];
      achievements.forEach(a => {
        const d1 = parseRADate(a.DateEarned);
        const d2 = parseRADate(a.DateEarnedHardcore);
        if(d1) dates.push(d1.getTime());
        if(d2) dates.push(d2.getTime());
      });
      hours = beaten ? beatenSpanHoursFromTimestamps(dates) : estimateHoursFromTimestamps(dates);
    }

    if(missingSlots.length) await saveSnap(gameId, snap, missingSlots, real ? hours : 0);

    // This call sees progress sooner than the bulk progress list, so use it to move a
    // manually added game out of the Backlog straight away.
    const hasRealProgress = real || Number(data && data.NumAwardedToUser) > 0;
    if(hasRealProgress){
      try{ await promoteManualGameToReal(gameId, data); }
      catch(e){ console.error('promoteManualGameToReal failed:', e); }
    }
  }catch(e){ hours = null; }

  estHoursCache[gameId] = { hours, beaten, real };
  try{ await window.storage.set(cacheKey, JSON.stringify({ hours, real, ts: Date.now(), libAwarded: libraryAwardedFor(gameId) }), false); }catch(e){}
  return estHoursCache[gameId];
}

async function loadEstimatedHoursFor(games, onProgress, forceIds){
  const CONCURRENCY = 8;
  const targets = games.filter(g =>
    g && g.GameID != null &&
    (estHoursCache[g.GameID] === undefined || (forceIds && forceIds.has(g.GameID)))
  );
  let idx = 0;
  let doneSinceRender = 0;
  async function worker(){
    while(idx < targets.length){
      const g = targets[idx++];
      const force = !!(forceIds && forceIds.has(g.GameID));
      await getEstimatedHours(g.GameID, force);
      doneSinceRender++;
      if(onProgress && doneSinceRender % 4 === 0) onProgress();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  if(onProgress) onProgress();
}
