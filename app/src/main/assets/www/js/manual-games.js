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

// What a game you tracked by hand had before it became a RetroAchievements entry: the time played, and whether it was
// beaten. Kept on its own, by RetroAchievements GameID, because the entry itself is replaced by RetroAchievements' own
// once it shows progress there. Shown in the game's profile, and as an asterisk beside a game beaten beforehand.
let preRaInfo = {}; // GameID -> { minutes, beaten, beatenDate }
function preRaKey(){
  return `pre-ra:${creds.username.trim().toLowerCase()}`;
}
async function loadPreRaInfo(){
  try{
    const r = await window.storage.get(preRaKey(), false);
    const parsed = r && r.value ? JSON.parse(r.value) : null;
    preRaInfo = parsed && typeof parsed === 'object' ? parsed : {};
  }catch(e){ preRaInfo = {}; }
  return preRaInfo;
}
function preRaFor(gameId){
  return preRaInfo[String(gameId)] || null;
}
// Minutes played so far on a game tracked by hand: its play log, or the time counted on this device.
function customMinutesPlayed(g){
  if(typeof usesPlayLog === 'function' && usesPlayLog(g.ConsoleName)) return playLogMinutes(g);
  try{
    const sec = (typeof thorBridge !== 'undefined' && thorBridge && thorBridge.playtime) ? Number(thorBridge.playtime(g.Title, g.ConsoleName)) : 0;
    return Math.round((sec || 0) / 60);
  }catch(e){ return 0; }
}
// Call before the hand-tracked entry g is replaced by the RetroAchievements game raGameId.
async function rememberPreRa(raGameId, g){
  if(!g) return;
  const minutes = customMinutesPlayed(g);
  const beaten = !!g.manualBeaten;
  if(!minutes && !beaten) return;
  await loadPreRaInfo();
  const old = preRaInfo[String(raGameId)] || {};
  preRaInfo[String(raGameId)] = {
    minutes: Math.max(minutes, Number(old.minutes) || 0),
    beaten: beaten || !!old.beaten,
    beatenDate: g.manualBeatenDate || old.beatenDate || null,
  };
  try{ await window.storage.set(preRaKey(), JSON.stringify(preRaInfo), false); }catch(e){}
}
// The asterisk shown beside a game that was beaten before it was tracked on RetroAchievements.
function preRaStar(gameId){
  const p = preRaFor(gameId);
  return p && p.beaten ? '<span class="pre-ra-star" title="Beaten before it was tracked on RetroAchievements">*</span>' : '';
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
    romPath: old.romPath || undefined,
    pct: maxPossible ? Math.round((numAwarded / maxPossible) * 100) : 0,
  };
  libraryData[idx] = entry;
  pendingPromotions.set(gameId, entry);
  schedulePromotionFlush();
}

// An RA game played from here that was not in the library at all (RetroAchievements lists no achievements for it).
function addLaunchedRealGame(gameId, data){
  if(libraryData.some(g => g.GameID === gameId)) return;
  const maxPossible = Number(data.NumAchievements ?? 0);
  const numAwarded = Number(data.NumAwardedToUser ?? 0);
  const entry = {
    GameID: gameId,
    Title: data.Title,
    ConsoleID: data.ConsoleID ?? null,
    ConsoleName: data.ConsoleName,
    ImageIcon: data.ImageIcon,
    MaxPossible: maxPossible,
    NumAwarded: numAwarded,
    NumAwardedHardcore: Number(data.NumAwardedToUserHardcore ?? 0),
    HighestAwardKind: data.HighestAwardKind ?? null,
    HighestAwardDate: data.HighestAwardDate ?? null,
    MostRecentAwardedDate: null,
    lastPlayed: new Date().toISOString(),
    pct: maxPossible ? Math.round((numAwarded / maxPossible) * 100) : 0,
  };
  libraryData = [...libraryData, entry];
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

// Platform name (lowercase; IGDB's, plus the older RAWG ones that games added earlier were saved under) ->
// [RA console id, pattern RA's name for it must match], so a game lands under RA's console name
// ("Nintendo Entertainment System" -> "NES/Famicom"). Platforms RA lacks keep their own name.
const PLATFORM_TO_RA_CONSOLE = {
  'sega mega drive/genesis': [1, /genesis|mega drive/i],
  'nintendo entertainment system': [7, /nes|famicom/i],
  'family computer': [7, /nes|famicom/i],
  'super nintendo entertainment system': [3, /snes|super famicom/i],
  'super famicom': [3, /snes|super famicom/i],
  'nintendo gamecube': [16, /gamecube/i],
  'sega game gear': [15, /game gear/i],
  'sega master system/mark iii': [11, /master system/i],
  'atari jaguar': [17, /^atari jaguar$/i],
  'playstation portable': [41, /portable/i],
  'atari st/ste': [36, /atari st/i],
  '3do interactive multiplayer': [43, /3do/i],
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

// Consoles RA doesn't have that have been saved under more than one spelling. Each gets one name, so its games
// share a tab ("Xbox Series S/X" and "Xbox Series X|S" are the same console).
const SAME_CONSOLE = [
  [/^xbox\s*series\b/i, 'Xbox Series X|S'],
];
function oneConsoleName(name){
  const hit = SAME_CONSOLE.find(([re]) => re.test(String(name || '').trim()));
  return hit ? hit[1] : name;
}

// RA's own name for a platform, or the name itself when there's no safe match.
async function raConsoleNameFor(rawgName, consoleList){
  rawgName = oneConsoleName(rawgName);
  const hit = PLATFORM_TO_RA_CONSOLE[String(rawgName || '').toLowerCase()];
  if(!hit) return rawgName;
  try{
    const list = consoleList || await getConsoleList();
    const c = (list || []).find(x => Number(x.ID ?? x.id) === hit[0]);
    const name = c && (c.Name ?? c.name);
    return name && hit[1].test(name) ? name : rawgName;
  }catch(e){ return rawgName; }
}

// Renames custom games saved under a platform name RA spells differently. Returns true if anything changed.
async function normalizeCustomConsoleNames(games){
  // The spellings of our own are fixed first. They need no list from RA, so they are fixed offline too.
  let changed = false;
  for(const g of games){
    if(!g.customConsole) continue;
    const one = oneConsoleName(g.ConsoleName);
    if(one !== g.ConsoleName){ g.ConsoleName = one; changed = true; }
  }
  const needs = games.some(g => g.customConsole && PLATFORM_TO_RA_CONSOLE[String(g.ConsoleName || '').toLowerCase()]);
  if(!needs) return changed;
  let list;
  try{ list = await getConsoleList(); }catch(e){ return changed; }
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

// Every game with achievements on a system, with the file hashes RetroAchievements accepts for each.
async function getGameHashListForConsole(consoleId){
  const cacheKey = `ra-gamelist-h:${consoleId}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000) return parsed.data;
    }
  }catch(e){}
  const data = await raFetch('API_GetGameList.php', { i: consoleId, f: 1, h: 1 });
  const slim = (data || []).map(g => ({ ID: g.ID ?? g.id, Title: g.Title ?? g.title, ImageIcon: g.ImageIcon, NumAchievements: g.NumAchievements, Hashes: g.Hashes || [] }));
  try{ await window.storage.set(cacheKey, JSON.stringify({ data: slim, ts: Date.now() }), false); }catch(e){}
  return slim;
}

// all: true also lists games RetroAchievements has no achievements for (they still have a page and can be played).
async function getGameListForConsole(consoleId, all){
  const cacheKey = all ? `ra-gamelist-all:${consoleId}` : `ra-gamelist:${consoleId}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000) return parsed.data;
    }
  }catch(e){}

  const data = await raFetch('API_GetGameList.php', all ? { i: consoleId } : { i: consoleId, f: 1 });
  try{ await window.storage.set(cacheKey, JSON.stringify({ data, ts: Date.now() }), false); }catch(e){}
  return data;
}
