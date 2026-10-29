// Games added by hand, moving them into the library, and the RA console/game lists used to add them.

// Keyed by the lowercased username: RA logins ignore case, so a different capitalisation must find the same list.
function manualGamesKey(){
  return `ra-manual-games:${creds.username.trim().toLowerCase()}`;
}

async function loadManualGames(){
  try{
    const r = await window.storage.get(manualGamesKey(), false);
    if(r && r.value) return JSON.parse(r.value);
  }catch(e){}

  // Older saves used the username exactly as typed.
  try{
    const legacyKey = `ra-manual-games:${creds.username}`;
    if(legacyKey !== manualGamesKey()){
      const r = await window.storage.get(legacyKey, false);
      if(r && r.value){
        const migrated = JSON.parse(r.value);
        await saveManualGames(migrated);
        return migrated;
      }
    }
  }catch(e){}

  return [];
}
async function saveManualGames(list){
  try{ await window.storage.set(manualGamesKey(), JSON.stringify(list), false); }catch(e){}
}

// Games the per-game call shows progress on that the bulk progress list hasn't caught up with.
// Keeps them out of the Backlog across restarts; loadAll() drops them once the list agrees.
function pendingRealGamesKey(){
  return `ra-pending-real:${creds.username.trim().toLowerCase()}`;
}
async function loadPendingRealGames(){
  try{
    const r = await window.storage.get(pendingRealGamesKey(), false);
    if(r && r.value) return JSON.parse(r.value);
  }catch(e){}
  return [];
}
async function savePendingRealGames(list){
  try{ await window.storage.set(pendingRealGamesKey(), JSON.stringify(list), false); }catch(e){}
}

// Moves a manually added RA game out of the Backlog as soon as the per-game call shows progress.
// The save and re-render are batched, so a burst of promotions costs one of each.
const pendingPromotions = new Map(); // GameID -> entry
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

    renderLibraryViews();
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
    renderLibraryViews();
  });
}

// RAWG platform (lowercase) -> [RA console id, pattern RA's name for it must match], so a game added
// from RAWG lands under RA's console name ("NES" -> "NES/Famicom"). Platforms RA lacks keep RAWG's name.
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

// Renames custom games saved under a RAWG platform name. Returns true if anything changed.
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

// Leaves out systems RA doesn't support yet, hubs and events. Non-RA systems go through "Other".
function onlySupportedConsoles(list){
  return (list || []).filter(c => (c.Active ?? c.active) !== false && (c.IsGameSystem ?? c.isGameSystem) !== false);
}

async function getConsoleList(){
  const cacheKey = 'ra-consoles-supported';
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < 30 * 24 * 60 * 60 * 1000) return parsed.data;
    }
  }catch(e){}

  // a=1: active systems only, g=1: no hubs or events.
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
  }catch(e){}

  const data = await raFetch('API_GetGameList.php', { i: consoleId, f: 1 });
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}
