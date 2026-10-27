// RetroAchievements requests, the saved login, and playtime lookups.

// Networking: our Worker first, then public CORS proxies, direct call as a last resort
// (RetroAchievements normally blocks direct browser requests, so trying it first only wasted a
// round trip on every call.)
const WORKER_TIMEOUT_MS = 12000; // a hung Worker must fall through to the proxies, not stall the load
function fetchWithTimeout(url, ms){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}
async function raFetch(endpoint, params){
  const qs = new URLSearchParams({ u: creds.username, ...params, y: creds.apiKey }); // params.u lets Social look up another user
  const targetUrl = `https://retroachievements.org/API/${endpoint}?${qs.toString()}`;

  async function validate(label, res){
    if(res.status === 401 || res.status === 403){
      if(label === 'direct' || label === 'worker'){
        // Direct and our own Worker both reach RetroAchievements server-to-server
        // with nothing in between to misattribute a 401/403 to, a public proxy
        // returning 401/403 is often the proxy's own auth wall, not RA's, so only
        // these two are trusted as a real signal from RetroAchievements itself.
        const err = new Error('RetroAchievements rejected the username or API key (HTTP ' + res.status + ').');
        err.authFailure = true;
        throw err;
      }
      throw new Error(`${label}: HTTP ${res.status} (likely the proxy, not RetroAchievements)`);
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

  async function attempt(label, run){
    let res;
    try{ res = await run(); }
    catch(networkErr){ throw new Error(`${label}: blocked (${networkErr.message})`); }
    return validate(label, res);
  }

  // Races a set of promises, resolving with whichever succeeds first.
  // Only rejects once every single one has failed, collecting all reasons.
  // (Written by hand instead of using Promise.any for wider compatibility.)
  function raceFirstSuccess(promises){
    return new Promise((resolve, reject) => {
      let remaining = promises.length;
      const errors = [];
      promises.forEach(p => {
        p.then(resolve, (err) => {
          errors.push(err && err.message ? err.message : String(err));
          remaining--;
          if(remaining === 0) reject(new Error(errors.join('; ')));
        });
      });
    });
  }

  // Our own Cloudflare Worker, one reliable hop we control, instead of going
  // straight to racing five shared public proxies. Falls through to those only
  // if the Worker itself is unreachable or erroring (e.g. its free daily
  // request quota is exhausted), so the public proxies stay as a genuine
  // safety net rather than being replaced outright.
  try{
    return await attempt('worker', () => fetchWithTimeout(`https://ra-proxy.gin649.workers.dev/${endpoint}?${qs.toString()}`, WORKER_TIMEOUT_MS));
  }catch(workerErr){
    if(workerErr.authFailure) throw workerErr;
    // Otherwise fall through and race the public proxies below.
  }

  const proxyAttempts = [
    attempt('allorigins', () => fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl))),
    attempt('codetabs',   () => fetch('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(targetUrl))),
    attempt('corsproxy',  () => fetch('https://corsproxy.io/?url=' + encodeURIComponent(targetUrl))),
    attempt('thingproxy', () => fetch('https://thingproxy.freeboard.io/fetch/' + targetUrl)),
    attempt('corseu',     () => fetch('https://cors.eu.org/' + targetUrl)),
  ];

  let proxyErrMsg = '';
  try{
    return await raceFirstSuccess(proxyAttempts);
  }catch(aggregateErr){
    proxyErrMsg = aggregateErr.message;
  }

  // Last resort: ask RetroAchievements directly. Usually blocked in browsers, but costs nothing
  // to try once everything else has failed, and its status is a trustworthy signal from RA itself.
  try{
    return await attempt('direct', () => fetch(targetUrl));
  }catch(directErr){
    if(directErr.authFailure) throw directErr;
    throw new Error('Every connection route failed — ' + proxyErrMsg + '; ' + directErr.message);
  }
}

function imgUrl(path){
  if(!path) return '';
  return path.startsWith('http') ? path : MEDIA + path;
}

// Persistence via window.storage (local only, no cloud copy)
async function saveCreds(username, apiKey){
  try{ await window.storage.set('ra-credentials', JSON.stringify({ username, apiKey }), false); }
  catch(e){ /* non-fatal */ }
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

// Casual/Hardcore mode survives reloads (including "Update app") so it doesn't reset to Casual.
async function saveStatsMode(mode){
  try{ await window.storage.set('stats-mode', mode, false); }catch(e){ /* non-fatal */ }
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

// Playtime: RA reports UserTotalPlaytime (seconds) in the GetGameInfoAndUserProgress
// call we already make. Some clients never send it, so when it is 0 or missing we
// estimate: for beaten/completed/mastered games, the span from first unlock to the
// award; otherwise unlock timestamps grouped into sessions (gaps under 30 minutes
// count as continuous play) and summed. Rough, and only used when RA has nothing.
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

async function getEstimatedHours(gameId, force){
  if(!force && estHoursCache[gameId] !== undefined) return estHoursCache[gameId];

  const localGame = libraryIndex[gameId];
  const officialAward = !!(localGame && localGame.HighestAwardKind);
  // RA only assigns an official "beaten" award when the achievement set's
  // author tagged specific win-condition achievements, many sets never
  // do. A 100%-complete game is functionally beaten either way, so treat
  // it the same regardless of whether that formal tag exists. (Only
  // matters for the estimate fallback below, not for real RA data.)
  const fullyCompleted = !!(localGame && Number(localGame.MaxPossible) > 0 &&
    Number(localGame.NumAwarded) >= Number(localGame.MaxPossible));
  const beaten = officialAward || fullyCompleted;
  const cacheKey = `ra-hours:${creds.username}:${gameId}`;
  if(!force){
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      // Only trust a cached *miss* (hours: null) for a much shorter window,
      // RA may simply not have finished computing playtime for this game
      // yet, and we don't want that temporary gap sticking around for the
      // full 12h once RA does have it.
      const ttl = parsed.hours == null ? 5 * 60 * 1000 : 12 * 60 * 60 * 1000;
      if(Date.now() - parsed.ts < ttl){
        estHoursCache[gameId] = { hours: parsed.hours, beaten, real: !!parsed.real };
        return estHoursCache[gameId];
      }
    }
  }catch(e){ /* not cached yet */ }
  }

  let hours = null;
  let real = false;
  try{
    const data = await raFetch('API_GetGameInfoAndUserProgress.php', { g: gameId, a: 1 });

    if(data && data.Achievements){
      achievementsListCache[gameId] = Object.values(data.Achievements)
        .sort((a,b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0));
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

    // This per-game call sees real progress sooner than RA's bulk
    // completion-progress fetch does, use it to move a manually-added
    // game out of the Backlog right away instead of waiting on that.
    const hasRealProgress = real || Number(data && data.NumAwardedToUser) > 0;
    if(hasRealProgress){
      try{ await promoteManualGameToReal(gameId, data); }
      catch(e){ console.error('promoteManualGameToReal failed:', e); }
    }
  }catch(e){ hours = null; }

  estHoursCache[gameId] = { hours, beaten, real };
  try{ await window.storage.set(cacheKey, JSON.stringify({ hours, real, ts: Date.now() }), false); }catch(e){ /* non-fatal */ }
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
  if(onProgress) onProgress(); // final render to catch any remainder
}
