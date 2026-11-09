// Box art picker: tap the cover in a game's profile to see it full screen, then swipe left/right (or use the arrows, or
// the controller's left/right) to browse other covers for the game and press "Use this one" to keep it.
// The list of covers is only looked up when you first move away from the current picture, never when a profile opens.
//   boxpick:<gameId>  the cover you chose (a picture address). Part of the backup, so it follows you.
//   boxcand:<gameId>  the covers found for the game, kept 30 days (rebuilt on demand, left out of the backup).
const BOXPICK_PREFIX = 'boxpick:';
const BOXCAND_TTL = 30 * 24 * 60 * 60 * 1000;
const boxPickMem = new Map(); // gameId -> url | null

async function getBoxPick(gameId){
  const id = String(gameId);
  if(boxPickMem.has(id)) return boxPickMem.get(id);
  let url = null;
  try{
    const r = await window.storage.get(BOXPICK_PREFIX + id, false);
    if(r && r.value) url = String(r.value);
  }catch(e){}
  boxPickMem.set(id, url);
  return url;
}
async function setBoxPick(gameId, url){
  const id = String(gameId);
  boxPickMem.set(id, url || null);
  try{
    if(url) await window.storage.set(BOXPICK_PREFIX + id, url, false);
    else await window.storage.delete(BOXPICK_PREFIX + id, false);
  }catch(e){}
}

// Called when a profile is drawn: remembers what the viewer needs and shows the cover you chose, if any.
function applyBoxPick(card, gameId, title, consoleName, original, romPath){
  card.dataset.boxTitle = title || '';
  card.dataset.boxConsole = consoleName || '';
  card.dataset.boxOriginal = original || '';
  card.dataset.boxRom = romPath || '';
  delete card.dataset.boxPicked;
  getBoxPick(gameId).then(url => {
    if(!url || card.dataset.gameId !== String(gameId)) return;
    card.dataset.boxPicked = '1';
    const art = card.querySelector('.modal-art');
    if(art) art.src = url;
  });
}

// Covers found by the app itself (your frontend's media, LaunchBox, ScreenScraper), asked in the background.
function nativeBoxCandidates(title, consoleName, romPath){
  return new Promise(resolve => {
    if(typeof thorBridge === 'undefined' || !thorBridge || typeof thorBridge.boxCandidatesAsync !== 'function'){ resolve([]); return; }
    let folder = '', path = romPath || '';
    try{
      const r = JSON.parse(thorBridge.findRom(JSON.stringify({ title, console: consoleName })));
      if(r && r.found){ folder = r.folder || ''; path = path || r.path || ''; }
    }catch(e){}
    const id = 'bc' + (++descSeq);
    const timer = setTimeout(() => { descWaiting.delete(id); resolve([]); }, 30000);
    descWaiting.set(id, t => { clearTimeout(timer); try{ resolve(JSON.parse(t) || []); }catch(e){ resolve([]); } });
    try{ thorBridge.boxCandidatesAsync(id, title, folder, path, consoleName || ''); }
    catch(e){ clearTimeout(timer); descWaiting.delete(id); resolve([]); }
  });
}

// Every cover we can find for a game: [{ label, url }]. The first entry is the picture the profile shows now.
async function loadBoxCandidates(ctx){
  const id = String(ctx.gameId);
  const ckey = 'boxcand:' + id;
  try{
    const r = await window.storage.get(ckey, false);
    if(r && r.value){
      const c = JSON.parse(r.value);
      if(Date.now() - c.ts < BOXCAND_TTL && Array.isArray(c.list) && c.list.length) return c.list;
    }
  }catch(e){}
  const clean = String(ctx.title || '').replace(/^(?:~[^~]*~\s*)+/, '').trim();
  const hack = /^\s*~hack~/i.test(String(ctx.title || ''));
  const list = [];
  const seen = new Set();
  const add = (label, url) => { if(url && !seen.has(url)){ seen.add(url); list.push({ label, url }); } };
  if(ctx.original) add('Original', ctx.original);
  if(clean && !hack){
    const native = nativeBoxCandidates(clean, ctx.consoleName, ctx.romPath);
    const ig = fetchWithTimeout(`${SS_WORKER}/igdb/info?name=${encodeURIComponent(clean)}`, 12000)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const [nat, g] = await Promise.all([native, ig]);
    nat.forEach(c => add(c.label, c.url));
    if(g && g.cover) add('IGDB', g.cover);
  }
  if(list.length > 1){
    try{ await window.storage.set(ckey, JSON.stringify({ list, ts: Date.now() }), false); }catch(e){}
  }
  return list;
}
