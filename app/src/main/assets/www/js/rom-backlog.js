// Add Game: bring in games from your ROM files. Pick files in the app's file picker, or add every game in
// a system folder. Each game is matched to the RetroAchievements list for its system by title; one that
// isn't on RA is added as a plain entry. They all go to the Backlog.

function showToast(text){
  let el = document.getElementById('glt-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'glt-toast';
    el.className = 'glt-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

// A title with the tags, brackets and "The" taken out, for comparing a file name with RA's name.
function romMatchKey(title){
  return String(title == null ? '' : title)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/~[^~]*~/g, ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(w => w && w !== 'the').join(' ');
}

// "Simpsons, The - Hit & Run (USA) [!]" becomes "The Simpsons - Hit & Run".
function romDisplayTitle(name){
  let t = String(name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(.+?),\s*(The|A|An)\b(.*)$/i, (m, a, art, rest) => art + ' ' + a + rest).replace(/\s+/g, ' ').trim();
  return t || String(name || '').trim();
}

function romConsoleFor(raNames, consoles){
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = (raNames || []).map(key).filter(Boolean);
  for(const c of consoles){
    const n = key(c.Name ?? c.name);
    if(names.includes(n)) return { id: Number(c.ID ?? c.id), name: c.Name ?? c.name };
  }
  return null;
}

// items: [{ title, folder, ra: [RA console names] }]. Returns how many games were added to the Backlog.
async function addRomsToBacklog(items){
  if(!items || !items.length) return 0;
  let consoles = [];
  try{ consoles = (await getConsoleList()) || []; }catch(e){}

  // group by RA system so each system's game list is read once
  const groups = new Map();
  items.forEach(it => {
    const c = romConsoleFor(it.ra, consoles);
    const gk = c ? 'ra:' + c.id : 'other:' + (it.ra && it.ra[0] || it.folder || '');
    if(!groups.has(gk)) groups.set(gk, { console: c, label: (it.ra && it.ra[0]) || it.folder || 'Other', items: [] });
    groups.get(gk).items.push(it);
  });

  const additions = [];
  let customSeq = 0;
  for(const grp of groups.values()){
    let byKey = null;
    if(grp.console){
      try{
        const list = await getGameListForConsole(grp.console.id);
        byKey = new Map();
        (list || []).forEach(g => {
          const raw = String(g.Title ?? g.title ?? '');
          const k = romMatchKey(raw);
          if(!k) return;
          const isHack = /~hack~/i.test(raw);
          const cur = byKey.get(k);
          if(!cur || (cur.hack && !isHack)) byKey.set(k, { g, hack: isHack });
        });
      }catch(e){ byKey = null; }
    }
    grp.items.forEach(it => {
      const hit = byKey && byKey.get(romMatchKey(it.title));
      if(hit){
        additions.push({ ra: true, g: hit.g, consoleId: grp.console.id, consoleName: grp.console.name });
      }else{
        additions.push({ ra: false, title: romDisplayTitle(it.title), consoleName: grp.console ? grp.console.name : grp.label, seq: customSeq++, folder: it.folder || '', romPath: it.path || '' });
      }
    });
  }

  return enqueueTask(async () => {
    const manual = await loadManualGames();
    const existingIds = new Set(libraryData.map(x => x.GameID));
    const customKeys = new Set(libraryData.filter(x => x.customConsole).map(x => romMatchKey(x.Title) + '|' + x.ConsoleName));
    const base = Date.now() * 1000;
    const entries = [];
    additions.forEach(a => {
      if(a.ra){
        const id = Number(a.g.ID ?? a.g.id);
        if(existingIds.has(id)) return;
        existingIds.add(id);
        entries.push(buildManualRaEntry(a.g, a.consoleId, a.consoleName));
      }else{
        const ck = romMatchKey(a.title) + '|' + a.consoleName;
        if(customKeys.has(ck)) return;
        customKeys.add(ck);
        entries.push({
          GameID: -(base + a.seq), // negative, so it never clashes with a real RA GameID
          Title: a.title,
          ConsoleID: null,
          ConsoleName: a.consoleName,
          ImageIcon: null, ImageBoxArt: null,
          MaxPossible: 0, NumAwarded: 0, NumAwardedHardcore: 0,
          HighestAwardKind: null, HighestAwardDate: null, MostRecentAwardedDate: null,
          pct: 0, lastPlayed: null,
          manual: true, customConsole: true,
          folder: a.folder, romPath: a.romPath, // where its ROM is, to look for its art
          genre: null, released: null,
          manualStarted: false, manualBeaten: false, manualBeatenDate: null,
        });
      }
    });
    if(entries.length){
      libraryData = [...libraryData, ...entries];
      await saveManualGames([...manual, ...entries]);
      renderLibraryViews();
    }
    closeAddGameModal();
    showToast(`${entries.length} game${entries.length === 1 ? '' : 's'} added to backlog`);
    setTimeout(fillMissingCustomArt, 500);
    return entries.length;
  });
}

// Pictures for games that aren't on RetroAchievements: your frontend's media, SteamGridDB (with a key) and
// LaunchBox through the app, then RAWG from here. One game at a time, and each is only tried once a week.
const customArtWaiting = new Map(); // GameID -> resolve
let customArtRunning = false;

window.thorCustomArt = function(id, url){
  const done = customArtWaiting.get(String(id));
  if(done){ customArtWaiting.delete(String(id)); done(url || ''); }
};

function nativeCustomArt(entry){
  return new Promise(resolve => {
    const id = String(entry.GameID);
    const timer = setTimeout(() => { customArtWaiting.delete(id); resolve(''); }, 30000);
    customArtWaiting.set(id, (url) => { clearTimeout(timer); resolve(url); });
    try{ thorBridge.customArt(id, entry.Title, entry.folder || '', entry.romPath || ''); }
    catch(e){ clearTimeout(timer); customArtWaiting.delete(id); resolve(''); }
  });
}

async function rawgArtFor(title){
  try{
    const results = await searchRawgForAddGame(title);
    return (results[0] && results[0].background_image) || '';
  }catch(e){ return ''; }
}

async function fillMissingCustomArt(){
  if(customArtRunning || typeof creds === 'undefined' || !creds) return;
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const todo = libraryData.filter(g => g.manual && g.customConsole && !g.ImageIcon && !(g.artTried && Date.now() - g.artTried < WEEK));
  if(!todo.length) return;
  customArtRunning = true;
  let found = 0;
  try{
    for(const g of todo){
      let url = '';
      if(thorBridge && typeof thorBridge.customArt === 'function') url = await nativeCustomArt(g);
      if(!url) url = await rawgArtFor(g.Title);
      await enqueueTask(async () => {
        const cur = libraryData.find(x => x.GameID === g.GameID);
        if(!cur) return;
        const manual = await loadManualGames();
        const saved = manual.find(x => x.GameID === g.GameID);
        [cur, saved].forEach(e => {
          if(!e) return;
          e.artTried = Date.now();
          if(url){ e.ImageIcon = url; e.ImageBoxArt = url; }
        });
        await saveManualGames(manual);
      });
      if(url && ++found % 8 === 0) renderLibraryViews();
    }
  }finally{
    customArtRunning = false;
  }
  if(found) renderLibraryViews();
}

// The page's side of the app's file picker.
window.thorRomsPicked = function(json){
  let items = [];
  try{ items = JSON.parse(json); }catch(e){}
  addRomsToBacklog(items);
};

function setupRomBacklogSection(){
  const box = document.getElementById('addgame-roms');
  if(!box || !thorBridge || typeof thorBridge.pickRoms !== 'function') return;
  box.style.display = 'block';

  const pickBtn = box.querySelector('#addgame-pick-roms');
  const allBtn = box.querySelector('#addgame-all-toggle');
  const allRow = box.querySelector('#addgame-all-row');
  const sysSel = box.querySelector('#addgame-all-system');
  const goBtn = box.querySelector('#addgame-all-go');
  let systems = [];

  pickBtn.addEventListener('click', () => { try{ thorBridge.pickRoms(); }catch(e){} });

  const syncGo = () => {
    const s = systems[sysSel.selectedIndex];
    goBtn.textContent = s ? `Add all ${s.count} game${s.count === 1 ? '' : 's'}` : 'Add all';
    goBtn.disabled = !s;
  };
  sysSel.addEventListener('change', syncGo);

  allBtn.addEventListener('click', () => {
    if(allRow.style.display === 'flex'){ allRow.style.display = 'none'; return; }
    try{ systems = JSON.parse(thorBridge.romSystems()); }catch(e){ systems = []; }
    sysSel.innerHTML = systems.length
      ? systems.map(s => `<option>${esc(s.folder)} (${s.count})</option>`).join('')
      : '<option>No ROMs found. Choose your ROMs folder in Launcher settings.</option>';
    allRow.style.display = 'flex';
    syncGo();
  });

  goBtn.addEventListener('click', async () => {
    const s = systems[sysSel.selectedIndex];
    if(!s) return;
    goBtn.disabled = true;
    let items = [];
    try{ items = JSON.parse(thorBridge.romsIn(s.folder)); }catch(e){}
    await addRomsToBacklog(items);
    goBtn.disabled = false;
  });
}
setupRomBacklogSection();
