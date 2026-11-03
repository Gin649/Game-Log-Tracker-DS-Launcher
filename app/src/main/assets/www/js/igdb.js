// IGDB (through the Worker, which holds the Twitch login): review scores, game search and details.

const IGDB_WORKER = 'https://ra-proxy.gin649.workers.dev';

// IGDB's critic and user ratings (out of 100) through the Worker.
// Resolves to { critic, user, name }, null where IGDB has nothing.
async function fetchIgdbScores(title){
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim(); // drop "~Hack~" style tags
  const res = await fetchWithTimeout(`${IGDB_WORKER}/igdb/score?name=${encodeURIComponent(clean)}`, 12000);
  if(!res.ok) throw new Error(`IGDB: HTTP ${res.status}`);
  const j = await res.json();
  const valid = n => (typeof n === 'number' && n > 0 && n <= 100) ? n : null;
  return { critic: valid(j.critic), user: valid(j.user), name: j.name || null };
}

// One score per game: the average of IGDB's critic and user scores, whichever exist.
async function fetchCombinedRating(title){
  const igdb = await fetchIgdbScores(title);
  const scores = [igdb.critic, igdb.user].filter(n => typeof n === 'number' && n > 0);
  if(scores.length === 0) return null;
  return {
    score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    metacritic: false,
    matchedName: igdb.name || title,
  };
}

async function getGameRating(title, forceRefresh){
  const cacheKey = `rating-igdb:${title.toLowerCase()}`;
  if(!forceRefresh){
    try{
      const r = await window.storage.get(cacheKey, false);
      if(r && r.value){
        const parsed = JSON.parse(r.value);
        const ttl = parsed.data ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // a miss is tried again after a day
        if(Date.now() - parsed.ts < ttl) return parsed.data;
      }
    }catch(e){}
  }

  let data = null;
  try{ data = await fetchCombinedRating(title); }
  catch(e){ return null; } // couldn't be reached: not kept, so the next look tries again
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}

// Games matching a title, for "Add a game" (games RetroAchievements doesn't list). Resolves to
// [{ id, name, platforms: [names], genres: [names], released: "YYYY-MM-DD" | null, cover: url | null }].
// Waits up to 15 seconds and tries twice, since someone is waiting on it.
async function searchIgdbGames(query){
  const url = `${IGDB_WORKER}/igdb/search?q=${encodeURIComponent(query)}`;
  let lastErr = null;
  for(let i = 0; i < 2; i++){
    try{
      const res = await fetchWithTimeout(url, 15000);
      if(!res.ok) throw new Error(`IGDB: HTTP ${res.status}`);
      const j = await res.json();
      return Array.isArray(j.results) ? j.results : [];
    }catch(e){ lastErr = e; }
  }
  throw lastErr;
}

// IGDB's other names for a game and its time to beat, through the Worker (for games RetroAchievements has no data on).
// Resolves to { name, id, alts: [names], beat: { hastily, normally, completely, count } | null }, or null when
// IGDB has nothing or can't be reached. Found games are kept a month, misses a day, failures not at all.
async function getIgdbInfo(title){
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim();
  if(!clean) return null;
  const cacheKey = `igdb-info2:${clean.toLowerCase()}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      const ttl = parsed.data ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if(Date.now() - parsed.ts < ttl) return parsed.data;
    }
  }catch(e){}
  let data = null;
  try{
    const res = await fetchWithTimeout(`${IGDB_WORKER}/igdb/info?name=${encodeURIComponent(clean)}`, 12000);
    if(!res.ok) return null;
    const j = await res.json();
    data = (j && j.id) ? { name: j.name, id: j.id, alts: Array.isArray(j.alts) ? j.alts : [], beat: j.beat || null, summary: typeof j.summary === 'string' ? j.summary : '' } : null;
  }catch(e){ return null; }
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}
