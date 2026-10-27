// Games added by hand, moving them into the library, and the RA console/game lists used to add them.

// Manually added ("wishlist") games
// Keyed by a normalized (lowercase, trimmed) username so that reconnecting
// with different capitalization, RA logins are case-insensitive, can't
// silently land on a different storage slot and appear empty.
function manualGamesKey(){
  return `ra-manual-games:${creds.username.trim().toLowerCase()}`;
}

async function loadManualGames(){
  try{
    const r = await window.storage.get(manualGamesKey(), false);
    if(r && r.value) return JSON.parse(r.value);
  }catch(e){ /* not found under the normalized key, check the old format below */ }

  // Fallback for games saved before this key was normalized, keyed by the
  // exact username string as originally typed.
  try{
    const legacyKey = `ra-manual-games:${creds.username}`;
    if(legacyKey !== manualGamesKey()){
      const r = await window.storage.get(legacyKey, false);
      if(r && r.value){
        const migrated = JSON.parse(r.value);
        await saveManualGames(migrated); // re-save under the normalized key going forward
        return migrated;
      }
    }
  }catch(e){ /* nothing under the old key either */ }

  return [];
}
async function saveManualGames(list){
  try{ await window.storage.set(manualGamesKey(), JSON.stringify(list), false); }
  catch(e){ /* non-fatal */ }
}

// Games the per-game endpoint has confirmed progress on but the bulk
// API_GetUserCompletionProgress has not caught up to yet. Keeps them out of the
// Backlog across reloads; loadAll() drops an entry once the bulk fetch agrees.
function pendingRealGamesKey(){
  return `ra-pending-real:${creds.username.trim().toLowerCase()}`;
}
async function loadPendingRealGames(){
  try{
    const r = await window.storage.get(pendingRealGamesKey(), false);
    if(r && r.value) return JSON.parse(r.value);
  }catch(e){ /* none saved yet */ }
  return [];
}
async function savePendingRealGames(list){
  try{ await window.storage.set(pendingRealGamesKey(), JSON.stringify(list), false); }
  catch(e){ /* non-fatal */ }
}

// A manual RA game normally leaves the Backlog on the next full load, but the bulk
// completion-progress endpoint can lag a play session by a while. The per-game endpoint
// (already fetched by getEstimatedHours for every game) shows it sooner, so promote
// from there. The storage write and re-render are debounced so a burst of promotions
// costs one write and one render pass instead of one per game.
const pendingPromotions = new Map(); // GameID -> entry, collected until the flush fires
let promotionFlushTimer = null;
function schedulePromotionFlush(){
  if(promotionFlushTimer) return;
  promotionFlushTimer = setTimeout(async () => {
    promotionFlushTimer = null;
    const batch = [...pendingPromotions.values()];
    pendingPromotions.clear();
    if(batch.length === 0) return;

    await enqueueTask(async () => {
      const idsToRemove = new Set(batch.map(e => e.GameID));
      const manual = await loadManualGames();
      await saveManualGames(manual.filter(g => !idsToRemove.has(g.GameID)));
      const pending = await loadPendingRealGames();
      await savePendingRealGames([...pending.filter(g => !idsToRemove.has(g.GameID)), ...batch]);
    });

    renderSystemChips();
    renderBacklog();
    renderLibrary();
    renderByYear();
  }, 250);
}

async function promoteManualGameToReal(gameId, data){
  const idx = libraryData.findIndex(g => g.GameID === gameId);
  if(idx === -1 || !libraryData[idx].manual || libraryData[idx].customConsole) return;

  const old = libraryData[idx];
  const maxPossible = Number(data.NumAchievements ?? old.MaxPossible ?? 0);
  const numAwarded = Number(data.NumAwardedToUser ?? 0);
  const entry = {
    GameID: gameId,
    Title: data.Title || old.Title,
    ConsoleID: data.ConsoleID ?? old.ConsoleID,
    ConsoleName: data.ConsoleName || old.ConsoleName,
    ImageIcon: data.ImageIcon || old.ImageIcon,
    MaxPossible: maxPossible,
    NumAwarded: numAwarded,
    NumAwardedHardcore: Number(data.NumAwardedToUserHardcore ?? 0),
    HighestAwardKind: data.HighestAwardKind ?? null,
    HighestAwardDate: data.HighestAwardDate ?? null,
    // This endpoint doesn't report MostRecentAwardedDate, keep whatever
    // the entry already had (usually nothing yet, this early).
    MostRecentAwardedDate: old.MostRecentAwardedDate ?? null,
    lastPlayed: old.lastPlayed || old.MostRecentAwardedDate || null,
    pct: maxPossible ? Math.round((numAwarded / maxPossible) * 100) : 0,
  };
  libraryData[idx] = entry;
  pendingPromotions.set(gameId, entry);
  schedulePromotionFlush();
}

async function removeManualGame(gameId){
  return enqueueTask(async () => {
    libraryData = libraryData.filter(g => g.GameID !== gameId);
    const manual = await loadManualGames();
    await saveManualGames(manual.filter(g => g.GameID !== gameId));
    renderSystemChips();
    renderBacklog();
    renderLibrary();
    renderByYear();
  });
}

// Console + game list lookups, for manually adding a game
// RAWG names its platforms differently from RetroAchievements ("NES" vs "NES/Famicom"), which
// would leave a manually added NES game under its own System chip. This maps a RAWG platform
// (lowercase) to [RA console id, pattern that RA's name for that id must match]. The pattern
// is a safety check: if RA's list doesn't look like what's expected, the RAWG name is kept.
// Platforms RA doesn't cover at all (PS4, Switch, PC, ...) aren't listed and stay as they are.
const RAWG_TO_RA_CONSOLE = {
  'genesis': [1, /genesis|mega drive/i],
  'nintendo 64': [2, /64/],
  'snes': [3, /snes|super famicom/i],
  'game boy': [4, /^game boy$/i],
  'game boy advance': [5, /advance/i],
  'game boy color': [6, /color/i],
  'nes': [7, /nes|famicom/i],
  'sega cd': [9, /sega cd|mega cd/i],
  'sega 32x': [10, /32x/i],
  'sega master system': [11, /master system/i],
  'playstation': [12, /^playstation$/i],
  'atari lynx': [13, /lynx/i],
  'game gear': [15, /game gear/i],
  'gamecube': [16, /gamecube/i],
  'jaguar': [17, /^atari jaguar$/i],
  'nintendo ds': [18, /^nintendo ds$/i],
  'wii': [19, /^wii$/i],
  'wii u': [20, /wii u/i],
  'playstation 2': [21, /playstation 2/i],
  'xbox': [22, /^xbox$/i],
  'atari 2600': [25, /2600/],
  'atari st': [36, /atari st/i],
  'apple ii': [38, /apple ii/i],
  'sega saturn': [39, /saturn/i],
  'dreamcast': [40, /dreamcast/i],
  'psp': [41, /portable/i],
  '3do': [43, /3do/i],
  'atari 5200': [50, /5200/],
  'atari 7800': [51, /7800/],
  'nintendo 3ds': [62, /3ds/i],
  'nintendo dsi': [78, /dsi/i],
};

// RA's own name for a RAWG platform, or the RAWG name itself when there's no safe match.
async function raConsoleNameFor(rawgName, consoleList){
  const hit = RAWG_TO_RA_CONSOLE[String(rawgName || '').toLowerCase()];
  if(!hit) return rawgName;
  try{
    const list = consoleList || await getConsoleList();
    const c = (list || []).find(x => Number(x.ID ?? x.id) === hit[0]);
    const name = c && (c.Name ?? c.name);
    return name && hit[1].test(name) ? name : rawgName;
  }catch(e){ return rawgName; }
}

// Renames custom games already saved under a RAWG name. Safe to run every load: a name that's
// already RA's isn't in the table, so it comes back unchanged. Returns true if anything changed.
async function normalizeCustomConsoleNames(games){
  const needs = games.some(g => g.customConsole && RAWG_TO_RA_CONSOLE[String(g.ConsoleName || '').toLowerCase()]);
  if(!needs) return false;
  let list;
  try{ list = await getConsoleList(); }catch(e){ return false; }
  let changed = false;
  for(const g of games){
    if(!g.customConsole) continue;
    const name = await raConsoleNameFor(g.ConsoleName, list);
    if(name !== g.ConsoleName){ g.ConsoleName = name; changed = true; }
  }
  return changed;
}

// RA's full system list also has consoles it doesn't officially support (and hubs/events), which
// only clutter the pickers. Systems for non-RA games like PS3 go through "Other" instead.
function onlySupportedConsoles(list){
  return (list || []).filter(c => (c.Active ?? c.active) !== false && (c.IsGameSystem ?? c.isGameSystem) !== false);
}

async function getConsoleList(){
  const cacheKey = 'ra-consoles-supported'; // separate from the old full-list cache
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < 30 * 24 * 60 * 60 * 1000) return parsed.data;
    }
  }catch(e){ /* not cached yet */ }

  // a=1 asks RA for active systems only and g=1 drops hubs and events; the filter below covers
  // the case where those parameters don't make it through a proxy.
  const data = onlySupportedConsoles(await raFetch('API_GetConsoleIDs.php', { a: 1, g: 1 }));
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}

async function getGameListForConsole(consoleId){
  const cacheKey = `ra-gamelist:${consoleId}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000) return parsed.data;
    }
  }catch(e){ /* not cached yet */ }

  const data = await raFetch('API_GetGameList.php', { i: consoleId, f: 1 });
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}
