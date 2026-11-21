// IGDB (through the Worker, which holds the Twitch login): game search and details, and the review score, which also
// takes in ScreenScraper, LaunchBox's community rating and, for PC games, Steam.

const IGDB_WORKER = 'https://ra-proxy.gin649.workers.dev';

// IGDB's critic and user ratings (out of 100) through the Worker. The console is sent so the Worker can pick that
// system's release. Resolves to { critic, user, criticCount, userCount, name }, null where IGDB has nothing (a count
// is null when the Worker doesn't send it).
async function fetchIgdbScores(title, consoleName){
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim(); // drop "~Hack~" style tags
  const sys = consoleName ? `&system=${encodeURIComponent(consoleName)}` : '';
  const res = await fetchWithTimeout(`${IGDB_WORKER}/igdb/score?name=${encodeURIComponent(clean)}${sys}`, 12000);
  if(!res.ok) throw new Error(`IGDB: HTTP ${res.status}`);
  const j = await res.json();
  const valid = n => (typeof n === 'number' && n > 0 && n <= 100) ? n : null;
  const count = n => (typeof n === 'number' && n >= 0) ? n : null;
  return { critic: valid(j.critic), user: valid(j.user), criticCount: count(j.criticCount), userCount: count(j.userCount), name: j.name || null };
}

// Other names IGDB may list a game under, tried in turn when a name finds no score. IGDB names licensed games
// with their owner, as on the box ("Disney's Darkwing Duck"), where RetroAchievements has "Darkwing Duck"; and the
// other way round.
const IGDB_OWNER_PREFIXES = ["Disney's", "Disney", "Capcom's", "Tom Clancy's", "Sid Meier's", "Bram Stoker's"];
function igdbNameVariants(title){
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim();
  const out = [clean];
  const owner = IGDB_OWNER_PREFIXES.find(p => clean.toLowerCase().startsWith(p.toLowerCase() + ' '));
  if(owner) out.push(clean.slice(owner.length).trim());
  else out.push("Disney's " + clean);
  return out;
}

// A score with fewer votes than this is left out, so a handful of people can't swing it.
const RATING_MIN_VOTES = 5;
const isPcConsole = c => /microsoft windows|^\s*(pc|windows)\s*$/i.test(String(c || ''));
const cleanTitle = t => String(t).replace(/^(?:~[^~]*~\s*)+/, '').trim();

// IGDB's critic and user scores, each its own source.
async function igdbRatingSources(title, consoleName){
  let igdb = null;
  for(const name of igdbNameVariants(title)){
    const found = await fetchIgdbScores(name, consoleName);
    if(found.critic || found.user){ igdb = found; break; }
  }
  if(!igdb) return [];
  const out = [];
  if(igdb.critic) out.push({ label: 'IGDB critics', score: igdb.critic, votes: igdb.criticCount });
  if(igdb.user) out.push({ label: 'IGDB players', score: igdb.user, votes: igdb.userCount });
  return out;
}

// ScreenScraper's rating (the Worker turns it into a score out of 100). Inside the launcher the app asks and remembers it with the rest of the game's
// ScreenScraper entry; in the browser the Worker is asked.
async function screenscraperRatingSources(title, consoleName){
  if(!consoleName) return [];
  const clean = cleanTitle(title);
  let note = null;
  if(typeof thorBridge !== 'undefined' && thorBridge && thorBridge.describeAsync){
    note = parseFloat(await nativeDescribe('ss-rate', clean, consoleName));
  }else{
    const res = await fetchWithTimeout(`${IGDB_WORKER}/ss/info?title=${encodeURIComponent(clean)}&system=${encodeURIComponent(consoleName)}`, 15000);
    if(res.status === 503) return [];
    if(!res.ok) throw new Error(`ScreenScraper: HTTP ${res.status}`);
    const j = await res.json();
    note = j && j.found ? Number(j.rating) : null;
  }
  if(!(note > 0 && note <= 100)) return [];
  return [{ label: 'ScreenScraper', score: Math.round(note), votes: null }];
}

// LaunchBox's community stars (out of 5), from the index the app keeps on the device. Only inside the launcher.
async function launchboxRatingSources(title, consoleName){
  if(typeof thorBridge === 'undefined' || !thorBridge || !thorBridge.describeAsync || !consoleName) return [];
  const raw = await nativeDescribe('lb-rate', cleanTitle(title), consoleName);
  const [stars, votes] = String(raw || '').split('|').map(Number);
  if(!(stars > 0 && stars <= 5)) return [];
  return [{ label: 'LaunchBox', score: Math.round(stars * 20), votes: votes >= 0 ? votes : null }];
}

// Steam players' reviews (% positive), for PC games only, through the Worker.
async function steamRatingSources(title, consoleName){
  if(!isPcConsole(consoleName)) return [];
  const res = await fetchWithTimeout(`${IGDB_WORKER}/steam/score?name=${encodeURIComponent(cleanTitle(title))}`, 12000);
  if(res.status === 404) return []; // a Worker without the Steam lookup yet
  if(!res.ok) throw new Error(`Steam: HTTP ${res.status}`);
  const j = await res.json();
  const total = Number(j && j.total), positive = Number(j && j.positive);
  if(!j || !j.found || !(total > 0) || !(positive >= 0)) return [];
  return [{ label: 'Steam', score: Math.round(positive / total * 100), votes: total }];
}

// One score per game: every source counts the same, and the score is their average. Resolves to
// { score, sources: [{ label, score, votes }] } or null when no source has a score. failed is set when a source
// couldn't be reached, so the answer is only kept a day.
async function fetchCombinedRating(title, consoleName){
  const lookups = [igdbRatingSources, screenscraperRatingSources, launchboxRatingSources, steamRatingSources]
    .map(f => f(title, consoleName).then(list => ({ list }), () => ({ list: [], failed: true })));
  const results = await Promise.all(lookups);
  const failed = results.some(r => r.failed);
  if(results.every(r => r.failed)) throw new Error('No review source could be reached');
  const sources = results.flatMap(r => r.list)
    .filter(s => s.score > 0 && s.score <= 100 && (s.votes == null || s.votes >= RATING_MIN_VOTES));
  if(sources.length === 0) return { data: null, failed };
  const score = Math.round(sources.reduce((n, s) => n + s.score, 0) / sources.length);
  return { data: { score, sources }, failed };
}

async function getGameRating(title, consoleName, forceRefresh){
  const sys = consoleName && consoleName !== '—' ? consoleName : '';
  // rating-mix1: the score from every source, kept per console since a game's score can differ between systems
  const cacheKey = `rating-mix1:${sys.toLowerCase()}:${title.toLowerCase()}`;
  if(!forceRefresh){
    try{
      const r = await window.storage.get(cacheKey, false);
      if(r && r.value){
        const parsed = JSON.parse(r.value);
        const ttl = (parsed.data && !parsed.failed ? 30 : 1) * 24 * 60 * 60 * 1000; // a miss is tried again after a day
        if(Date.now() - parsed.ts < ttl) return parsed.data;
      }
    }catch(e){}
  }

  let found;
  try{ found = await fetchCombinedRating(title, sys); }
  catch(e){ return null; } // couldn't be reached: not kept, so the next look tries again
  try{ await window.storage.set(cacheKey, JSON.stringify({ data: found.data, failed: found.failed, ts: Date.now() }), false); }catch(e){}
  return found.data;
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
