// RAWG key and review score lookups.

let rawgCreds = null; // { apiKey }, loaded on first use

async function loadRawgCreds(){
  try{
    const r = await window.storage.get('rawg-credentials', false);
    if(r && r.value) return JSON.parse(r.value);
  }catch(e){}
  return null;
}
async function saveRawgCreds(apiKey){
  try{ await window.storage.set('rawg-credentials', JSON.stringify({ apiKey }), false); }catch(e){}
}
async function removeRawgCreds(){
  rawgCreds = null;
  try{ await window.storage.delete('rawg-credentials', false); }catch(e){}
}

// RAWG allows cross-origin calls, so it is asked directly.
async function rawgGet(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`RAWG: HTTP ${res.status}`);
  try{ return await res.json(); }
  catch(e){ throw new Error("RAWG: response wasn't valid JSON"); }
}

// The score and the Game Details text start with the same RAWG search, so the second reuses
// the first's request for a minute.
const rawgSharedRequests = new Map();
function rawgGetShared(url){
  if(!rawgSharedRequests.has(url)){
    const p = rawgGet(url);
    rawgSharedRequests.set(url, p);
    p.then(() => setTimeout(() => rawgSharedRequests.delete(url), 60000), () => rawgSharedRequests.delete(url));
  }
  return rawgSharedRequests.get(url);
}

async function fetchRawgRatingLive(title){
  if(!rawgCreds) rawgCreds = await loadRawgCreds();
  if(!rawgCreds || !rawgCreds.apiKey) return null;

  const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(rawgCreds.apiKey)}&search=${encodeURIComponent(title)}&page_size=5`;
  const json = await rawgGetShared(url);
  const results = (json && json.results) || [];
  if(results.length === 0) return null;

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // The Metacritic score when RAWG has one, otherwise RAWG's own rating (0-5, scaled to 100).
  // RAWG sends 0 rather than null when it has no data, so 0 means "nothing".
  function extractScore(g){
    if(g.metacritic != null && g.metacritic > 0) return { score: g.metacritic, metacritic: true };
    if(g.rating != null && g.rating > 0 && Number(g.ratings_count) > 0) return { score: g.rating * 20, metacritic: false };
    return null;
  }

  // The exact title first, then the other results: the exact entry is sometimes nearly empty
  // while a related listing has the reviews.
  const exact = results.find(r => norm(r.name) === norm(title));
  const ordered = exact ? [exact, ...results.filter(r => r !== exact)] : results;
  for(const g of ordered){
    const extracted = extractScore(g);
    if(extracted) return { score: Math.round(extracted.score), metacritic: extracted.metacritic, matchedName: g.name };
  }
  return null;
}

// IGDB's critic and user ratings (out of 100) through the Worker, which holds the Twitch login.
// Resolves to { critic, user, name }, null where IGDB has nothing.
async function fetchIgdbScores(title){
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim(); // drop "~Hack~" style tags
  const res = await fetchWithTimeout(`https://ra-proxy.gin649.workers.dev/igdb/score?name=${encodeURIComponent(clean)}`, 12000);
  if(!res.ok) throw new Error(`IGDB: HTTP ${res.status}`);
  const j = await res.json();
  const valid = n => (typeof n === 'number' && n > 0 && n <= 100) ? n : null;
  return { critic: valid(j.critic), user: valid(j.user), name: j.name || null };
}

// One score per game: the average of RAWG's score and IGDB's critic and user scores, whichever
// exist. partial = one source couldn't be reached, so the number shouldn't be kept long.
async function fetchCombinedRating(title){
  const [rawgRes, igdbRes] = await Promise.allSettled([fetchRawgRatingLive(title), fetchIgdbScores(title)]);
  if(rawgRes.status === 'rejected' && igdbRes.status === 'rejected') throw rawgRes.reason;

  const rawg = rawgRes.status === 'fulfilled' ? rawgRes.value : null;
  const igdb = igdbRes.status === 'fulfilled' ? igdbRes.value : null;
  const scores = [rawg && rawg.score, igdb && igdb.critic, igdb && igdb.user].filter(n => typeof n === 'number' && n > 0);
  if(scores.length === 0) return null;

  return {
    score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    metacritic: false,
    matchedName: (rawg && rawg.matchedName) || (igdb && igdb.name) || title,
    partial: igdbRes.status === 'rejected' || rawgRes.status === 'rejected',
  };
}

async function getRawgRating(title, forceRefresh){
  const cacheKey = `rating-avg:${title.toLowerCase()}`;
  if(!forceRefresh){
    try{
      const r = await window.storage.get(cacheKey, false);
      if(r && r.value){
        const parsed = JSON.parse(r.value);
        const ttl = (parsed.data && !parsed.data.partial) ? 30 * 24 * 60 * 60 * 1000 : 10 * 60 * 1000;
        if(!(parsed.data && parsed.data.score === 0) && Date.now() - parsed.ts < ttl) return parsed.data;
      }
    }catch(e){}
  }

  let data = null;
  try{ data = await fetchCombinedRating(title); }catch(e){ data = null; }
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}
