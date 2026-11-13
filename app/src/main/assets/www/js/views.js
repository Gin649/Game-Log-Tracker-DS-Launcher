// Dashboard, library, backlog and Beaten by Year rendering.

function renderProfile(p){
  lastProfile = p;

  // Unlock count and "started games beaten" come from the library (RA has no field for either),
  // so they fill in when renderProfile() runs again after the library loads.
  let unlocksLabel = '—';
  let startedBeatenLabel = '—';
  if(libraryData && libraryData.length > 0){
    let casualUnlocks = 0, hardcoreUnlocks = 0;
    let startedCasual = 0, beatenCasual = 0;
    let startedHardcore = 0, beatenHardcore = 0;
    libraryData.forEach(g => {
      if(g.customConsole) return; // non-RA games don't count
      const awarded = Number(g.NumAwarded || 0);
      const hardcore = Number(g.NumAwardedHardcore || 0);
      casualUnlocks += Math.max(0, awarded - hardcore);
      hardcoreUnlocks += hardcore;
      if(awarded > 0){
        startedCasual++;
        if(g.HighestAwardKind === 'completed' || g.HighestAwardKind === 'beaten-softcore') beatenCasual++;
      }
      if(hardcore > 0){
        startedHardcore++;
        if(g.HighestAwardKind === 'beaten-hardcore' || g.HighestAwardKind === 'mastered') beatenHardcore++;
      }
    });
    const unlocks = statsMode === 'hardcore' ? hardcoreUnlocks : casualUnlocks;
    const started = statsMode === 'hardcore' ? startedHardcore : startedCasual;
    const beaten = statsMode === 'hardcore' ? beatenHardcore : beatenCasual;
    unlocksLabel = unlocks.toLocaleString();
    startedBeatenLabel = started > 0 ? ((beaten / started) * 100).toFixed(2) + '%' : '0%';
  }

  // Hardcore and softcore points from API_GetUserPoints.php (two separate totals).
  const points = userPoints
    ? (statsMode === 'hardcore' ? Number(userPoints.Points || 0) : Number(userPoints.SoftcorePoints || 0))
    : (statsMode === 'hardcore' ? null : Number(p.TotalSoftcorePoints || 0)); // until the points call has loaded
  const pointsLabel = points == null ? '—' : points.toLocaleString();
  const modeColor = statsMode === 'hardcore' ? 'var(--gold)' : 'var(--teal)';
  const ptsLabel = statsMode === 'hardcore' ? 'hardcore pts' : 'casual pts';
  const unlocksLbl = statsMode === 'hardcore' ? 'achievements unlocked (hardcore)' : 'achievements unlocked (casual)';

  $('#profile-hero').innerHTML = `
      <img class="avatar" src="${imgUrl(p.UserPic)}" alt="${p.User}">
      <div class="who">
        <h2>${p.User}</h2>
        <p class="motto">${p.Motto ? p.Motto : 'Member since ' + (parseRADate(p.MemberSince) ? parseRADate(p.MemberSince).toLocaleDateString() : '—')}</p>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="num" style="color:${modeColor}">${pointsLabel}</div><div class="lbl">${ptsLabel}</div></div>
        <div class="stat"><div class="num" style="color:${modeColor}">${unlocksLabel}</div><div class="lbl">${unlocksLbl}</div></div>
        <div class="stat"><div class="num" style="color:${modeColor}">${startedBeatenLabel}</div><div class="lbl">started games beaten</div></div>
      </div>
    `;
}

// The two modes are kept apart: hardcore shows only hardcore awards, casual only casual ones.
function awardCountsInMode(kind){
  if(statsMode === 'hardcore') return kind === 'mastered' || kind === 'beaten-hardcore';
  return kind === 'completed' || kind === 'beaten-softcore';
}

// Label and color class for a game's award in the current mode, or null when it has none.
function awardInfo(kind){
  if(!awardCountsInMode(kind)) return null;
  if(statsMode === 'hardcore'){
    return kind === 'mastered'
      ? { label: 'Mastered', cls: 'pill-gold' }
      : { label: 'Beaten', cls: 'pill-gold' };
  }
  return kind === 'completed'
    ? { label: 'Mastered', cls: 'pill-teal' }
    : { label: 'Beaten', cls: 'pill-teal' };
}

function awardPill(kind){
  const info = awardInfo(kind);
  if(!info) return '<span class="pill pill-muted">In progress</span>';
  return `<span class="pill ${info.cls}">${info.label}</span>`;
}

// RetroAchievements' recent games plus the games added by hand (not on RA) that were played from here, newest first.
function recentWithCustom(games){
  const launched = (typeof thorLaunchTimes === 'function') ? thorLaunchTimes() : {};
  const t = g => { const d = parseRADate(g.LastPlayed); return d ? d.getTime() : 0; };
  const list = (games || []).map(g => {
    const mine = launched[String(g.GameID)];
    // started from here more recently than RetroAchievements has heard about: it goes first
    if(mine && Date.parse(mine) > t(g)) return Object.assign({}, g, { LastPlayed: mine });
    return g;
  });
  const have = new Set(list.map(g => String(g.GameID)));
  libraryData.forEach(g => {
    if(have.has(String(g.GameID))) return;
    const when = launched[String(g.GameID)] || (g.manual && g.customConsole ? g.lastPlayed : '');
    if(!when) return;
    const custom = !!(g.manual && g.customConsole);
    list.push({
      GameID: g.GameID, Title: g.Title, ConsoleName: g.ConsoleName,
      ImageIcon: g.ImageIcon || g.ImageBoxArt || '',
      NumPossibleAchievements: custom ? 0 : Number(g.MaxPossible || 0),
      NumAchieved: custom ? 0 : Number(g.NumAwarded || 0),
      NumAchievedHardcore: custom ? 0 : Number(g.NumAwardedHardcore || 0),
      LastPlayed: when, _custom: custom,
    });
  });
  return list.sort((a, b) => t(b) - t(a));
}

// Time played on this device, from the app's own tracking (RetroAchievements has none for these games).
// Seconds counted on this device for a game RetroAchievements doesn't track (0 when none, or outside the launcher).
function customPlaySeconds(g){
  try{
    return (typeof thorBridge !== 'undefined' && thorBridge && thorBridge.playtime) ? Number(thorBridge.playtime(g.Title, g.ConsoleName)) || 0 : 0;
  }catch(e){ return 0; }
}

function customPlaytimeHtml(g){
  if(typeof usesPlayLog === 'function' && usesPlayLog(g.ConsoleName)){ // PS5, Xbox Series X|S, Switch 2: the hand-kept play log
    const mins = playLogMinutes(libraryData.find(x => x.GameID === g.GameID));
    return mins ? `<span class="val" style="color:var(--gold)">${playLogTime(mins)}</span>` : '';
  }
  try{
    const sec = (typeof thorBridge !== 'undefined' && thorBridge && thorBridge.playtime) ? Number(thorBridge.playtime(g.Title, g.ConsoleName)) : 0;
    if(sec >= 30) return `<span class="val" style="color:var(--gold)">${formatDuration({ hours: sec / 3600 })}</span>`;
  }catch(e){}
  return '';
}

function renderRecentGames(games){
  const el = $('#recent-games');
  const shown = recentWithCustom(games).filter(g => !isSubsetGame(g)); // subsets live in their base game's profile
  if(shown.length === 0){ el.innerHTML = '<div class="empty">No recently played games found.</div>'; return; }
  const libById = new Map(libraryData.map(x => [x.GameID, x]));
  wireCartArt(el);
  const html = shown.slice(0, 12).map(g => {
    const total = Number(g.NumPossibleAchievements || g.AchievementsTotal || 0);
    const earned = statsMode === 'hardcore' ? Number(g.NumAchievedHardcore || 0) : Number(g.NumAchieved || 0);
    const pct = total ? Math.round((earned/total)*100) : 0;
    const est = estHoursCache[g.GameID];
    const hoursHtml = g._custom ? customPlaytimeHtml(g) : est
      ? `<span class="val" style="color:var(--gold)">${est.real ? '' : '≈ '}${formatDuration(est)}</span>`
      : '<span class="pt-pending" title="Loading playtime…"></span>';
    const artSrc = g._custom && typeof cachedBoxArt === 'function' && cachedBoxArt(g.GameID) || imgUrl(g.ImageIcon);
    const lib = libById.get(g.GameID);
    const award = lib && isGameAwarded(lib) ? awardInfo(lib.HighestAwardKind) : null;
    const badge = award ? `<span class="pill pill-corner ${award.cls}">${award.label}</span>` : '';
    return `
        <div class="cart" data-game-id="${g.GameID}">
          <div class="art-wrap"><img class="art" src="${artSrc}" alt="${esc(g.Title)}">${cartArtHtml(g)}${badge}</div>
          <div class="body">
            <p class="title">${esc(g.Title)}</p>
            <p class="console">${esc(g.ConsoleName)}</p>
            <div class="cart-progress-group">
              <div class="progress-track"><div class="progress-fill ${pct>=100?'complete':''} ${statsMode==='hardcore'?'hardcore':''}" style="width:${pct}%"></div></div>
              <div class="prog-lbl"><span>${earned}/${total}</span><span>${pct}%</span></div>
              <div class="hours">${hoursHtml}</div>
            </div>
          </div>
        </div>
      `;
  }).join('');
  // Drawn again only when something changed, so cartridge pictures that have loaded are not fetched and faded in again.
  if(el.recentHtml === html && el.querySelector('.cart')) return;
  el.recentHtml = html;
  el.innerHTML = html;
  el.querySelectorAll('.cart').forEach(card => {
    card.addEventListener('click', () => openGameModal(Number(card.getAttribute('data-game-id'))));
  });
}

function renderUnlocks(list){
  const el = $('#recent-unlocks');
  if(!list || list.length === 0){ el.innerHTML = '<div class="empty">No unlocks in the last few days. Go play something!</div>'; return; }
  el.innerHTML = list.slice(0, 10).map(a => {
    const isHardcore = Number(a.HardcoreMode) === 1;
    return `
      <div class="unlock">
        <div class="unlock-row">
          <img src="${imgUrl('/Badge/' + a.BadgeName + '.png')}" alt="">
          <div class="info">
            <p class="t">${esc(a.Title)}</p>
            <p class="g">${esc(a.GameTitle)}</p>
          </div>
          ${isHardcore ? '<span class="pill pill-muted">HC</span>' : ''}
          <div class="pts" style="color:${isHardcore ? 'var(--muted)' : 'var(--teal)'}">${a.Points}</div>
          <div class="when">${timeAgo(a.Date)}</div>
        </div>
        <p class="unlock-desc">${esc(a.Description || 'No description available.')}</p>
      </div>
    `;
  }).join('');
  el.querySelectorAll('.unlock').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

// Console tabs can be put in your own order and renamed. Both are saved and shared by Library, Beaten by Year and Backlog.
let consoleOrder = [];       // ConsoleNames in the order you chose
let consoleNames = {};       // ConsoleName -> the name shown on its tab
let consolePrefsState = 0;   // 0 not loaded, 1 loading, 2 loaded
let chipEdit = false;        // reorder/rename mode
let chipEditTab = '';

async function loadConsolePrefs(){
  if(consolePrefsState) return;
  consolePrefsState = 1;
  try{
    const o = await window.storage.get('console-order', false);
    if(o && o.value) consoleOrder = JSON.parse(o.value) || [];
    const n = await window.storage.get('console-names', false);
    if(n && n.value) consoleNames = JSON.parse(n.value) || {};
  }catch(e){}
  consolePrefsState = 2;
  try{ renderSystemChips(); }catch(e){}
}
function saveConsolePrefs(){
  try{ window.storage.set('console-order', JSON.stringify(consoleOrder), false); }catch(e){}
  try{ window.storage.set('console-names', JSON.stringify(consoleNames), false); }catch(e){}
}
const consoleLabel = sys => (consoleNames[sys] || sys);

// Your order first, then any console you haven't placed yet by number of games.
function orderedSystems(counts){
  const names = Object.keys(counts);
  const rank = n => { const i = consoleOrder.indexOf(n); return i === -1 ? Infinity : i; };
  return names.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if(ra !== rb) return ra === Infinity ? 1 : rb === Infinity ? -1 : ra - rb;
    return counts[b] - counts[a];
  });
}

// Puts the visible consoles in the order given. They take the places those consoles already had in the saved
// order, so consoles that aren't on this tab keep theirs and Library and Backlog stay in step.
function applyConsoleOrder(arrangement){
  const full = consoleOrder.slice();
  arrangement.forEach(n => { if(!full.includes(n)) full.push(n); });
  const slots = [];
  full.forEach((n, i) => { if(arrangement.includes(n)) slots.push(i); });
  slots.forEach((slot, k) => { full[slot] = arrangement[k]; });
  consoleOrder = full;
  saveConsolePrefs();
}

// Drag a tab to a new place: hold it for a moment to pick it up (moving sooner scrolls the row), slide it, let go.
// A quick tap renames it instead.
let chipClickBlockedUntil = 0;
function dropChipDragTouch(chipRow){
  if(chipRow._dragTouchMove) chipRow.removeEventListener('touchmove', chipRow._dragTouchMove);
  chipRow._dragTouchMove = null;
}
function wireChipDrag(chipRow, systems){
  const chips = Array.from(chipRow.querySelectorAll('.chip.edit'));
  let drag = null;
  // This listener makes the browser check with the page before it scrolls the row, so there is only ever one
  // and it is taken off again when reorder mode ends (see dropChipDragTouch).
  dropChipDragTouch(chipRow);
  chipRow._dragTouchMove = (e) => { if(drag && drag.lifted) e.preventDefault(); };
  chipRow.addEventListener('touchmove', chipRow._dragTouchMove, { passive: false });
  chips.forEach((chip, idx) => {
    chip.addEventListener('pointerdown', (e) => {
      if(drag) return;
      drag = { chip, idx, x0: e.clientX, y0: e.clientY, s0: chipRow.scrollLeft, lifted: false, id: e.pointerId, x: e.clientX, timer: null, scroller: null };
      drag.timer = setTimeout(() => {
        if(!drag) return;
        drag.lifted = true;
        chip.classList.add('lifted');
        try{ chip.setPointerCapture(drag.id); }catch(err){}
        drag.scroller = setInterval(() => { // slide the row when the finger is near either edge
          const r = chipRow.getBoundingClientRect();
          if(drag.x < r.left + 48) chipRow.scrollLeft -= 8;
          else if(drag.x > r.right - 48) chipRow.scrollLeft += 8;
          place();
        }, 16);
      }, 250);
    });
    const place = () => {
      if(!drag || !drag.lifted) return;
      drag.chip.style.transform = `translateX(${(drag.x - drag.x0) + (chipRow.scrollLeft - drag.s0)}px)`;
    };
    chip.addEventListener('pointermove', (e) => {
      if(!drag || drag.chip !== chip) return;
      drag.x = e.clientX;
      if(!drag.lifted){
        if(Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10){ clearTimeout(drag.timer); drag = null; }
        return;
      }
      place();
    });
    const end = (e) => {
      if(!drag || drag.chip !== chip) return;
      clearTimeout(drag.timer); clearInterval(drag.scroller);
      const d = drag; drag = null;
      if(!d.lifted) return; // a tap: the click that follows renames it
      chipClickBlockedUntil = Date.now() + 500; // letting go after a drag isn't a tap
      // where the picked-up tab ended up, compared with the middle of each of the others
      const shift = (d.x - d.x0) + (chipRow.scrollLeft - d.s0);
      const mid = c => c.offsetLeft + c.offsetWidth / 2;
      const target = mid(d.chip) + shift;
      const rest = chips.filter(c => c !== d.chip);
      let at = rest.filter(c => mid(c) < target).length;
      const next = systems.slice();
      const moved = next.splice(d.idx, 1)[0];
      next.splice(at, 0, moved);
      if(e.type === 'pointerup') applyConsoleOrder(next);
      renderSystemChips();
    };
    chip.addEventListener('pointerup', end);
    chip.addEventListener('pointercancel', end);
    chip.addEventListener('contextmenu', (e) => e.preventDefault());
    chip.addEventListener('click', () => { if(Date.now() >= chipClickBlockedUntil) renameConsoleTab(systems[idx]); }); // a tap, or the controller's confirm button
  });
}

function renameConsoleTab(sys){
  const old = document.getElementById('chip-rename'); if(old) old.remove();
  const esc2 = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pop = document.createElement('div');
  pop.id = 'chip-rename';
  pop.className = 'app-pop';
  pop.innerHTML = `<div class="app-pop-card">
    <div class="app-pop-title">Rename tab</div>
    <div class="app-pop-sub">${esc2(sys)}</div>
    <input type="text" id="chip-rename-input" value="${esc2(consoleLabel(sys))}" maxlength="40" style="width:100%;">
    <button class="btn-primary" id="chip-rename-save">Save</button>
    <button class="btn-ghost" id="chip-rename-reset">Use original name</button>
    <button class="btn-ghost" id="chip-rename-cancel">Cancel</button>
  </div>`;
  document.body.appendChild(pop);
  const done = () => { pop.remove(); renderSystemChips(); };
  pop.querySelector('#chip-rename-save').addEventListener('click', () => {
    const v = pop.querySelector('#chip-rename-input').value.trim();
    if(v && v !== sys) consoleNames[sys] = v; else delete consoleNames[sys];
    saveConsolePrefs(); done();
  });
  pop.querySelector('#chip-rename-reset').addEventListener('click', () => { delete consoleNames[sys]; saveConsolePrefs(); done(); });
  pop.querySelector('#chip-rename-cancel').addEventListener('click', () => pop.remove());
  pop.addEventListener('click', (e) => { if(e.target === pop) pop.remove(); });
}

function renderSystemChips(){
  const chipRow = $('#system-chips');
  if(!consolePrefsState) loadConsolePrefs();
  if(chipEdit && chipEditTab !== activeTab) chipEdit = false;
  const counts = {};
  const source = activeTab === 'year'
    ? libraryData.filter(g => {
        if(g.customConsole) return g.manualBeaten && g.manualBeatenDate;
        if(!g.HighestAwardKind || !g.HighestAwardDate) return false;
        return awardCountsInMode(g.HighestAwardKind);
      })
    : activeTab === 'backlog'
    ? libraryData.filter(isBacklogGame)
    : libraryData.filter(g => !isBacklogGame(g) && !(activeTab === 'library' && libraryHideDone && isGameAwarded(g)));
  source.forEach(g => { counts[g.ConsoleName] = (counts[g.ConsoleName] || 0) + 1; });
  const yearTab = activeTab === 'year'; // Beaten stays in order of games beaten, with your tab names
  const systems = yearTab ? Object.keys(counts).sort((a, b) => counts[b] - counts[a]) : orderedSystems(counts);
  const label = consoleLabel; // your tab names are used here too

  if(systems.length === 0){ chipRow.innerHTML = ''; chipRow.classList.remove('editing', 'blades', 'logos'); dropChipDragTouch(chipRow); return; }
  const attr = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  if(chipEdit){
    // Reorder / rename mode: drag a tab to move it, tap its name to rename it, OK finishes.
    chipRow.classList.add('editing');
    chipRow.classList.remove('blades', 'logos');
    chipRow.innerHTML = `<button class="chip chip-ok" id="chip-ok">OK</button>
      <span class="chip chip-all-off">All</span>` + systems.map(sys => `
      <button class="chip edit" data-sys="${attr(sys)}">${consoleLabel(sys)}</button>`).join('');
    chipRow.querySelector('#chip-ok').addEventListener('click', () => { chipEdit = false; renderSystemChips(); });
    wireChipDrag(chipRow, systems.slice());
    return;
  }
  chipRow.classList.remove('editing');
  dropChipDragTouch(chipRow);

  // The consoles are a ring of blades. The one you are on sits in the middle with its whole name, the two on
  // each side show a short name, and the rest are thin slivers.
  const chips = ['All', ...systems];
  const at = chips.indexOf(systemFilter);
  chipRow.classList.add('blades');
  chipRow.classList.toggle('logos', consoleBar === 'logos');
  chipRow._blades = {
    chips, attr, yearTab,
    at: Math.max(0, at),
    known: at !== -1,
    full: sys => sys === 'All' ? 'All' : attr(label(sys)) + (yearTab ? ` (${counts[sys]})` : ''),
    count: sys => yearTab && sys !== 'All' ? counts[sys] : 0
  };
  wireBlades(chipRow);
  drawBlades(chipRow, chipRow._blades.at);
}

// Short names for the narrow blades beside the console you are on.
const BLADE_CODES = {
  nesfamicom:'NES', nes:'NES', famicomdisksystem:'FDS', snessuperfamicom:'SNES', snes:'SNES', supernintendo:'SNES',
  nintendo64:'N64', gamecube:'GCN', wii:'WII', wiiu:'WIIU', gameboy:'GB', gameboycolor:'GBC', gameboyadvance:'GBA',
  nintendods:'NDS', nintendodsi:'DSI', nintendo3ds:'3DS', virtualboy:'VB', pokemonmini:'PKMN', nintendoswitch:'NSW',
  genesismegadrive:'GEN', genesis:'GEN', megadrive:'MD', mastersystem:'SMS', gamegear:'GG', segacd:'SCD', '32x':'32X',
  saturn:'SAT', dreamcast:'DC', sg1000:'SG1K', playstation:'PS1', playstation2:'PS2', playstation3:'PS3',
  playstationportable:'PSP', playstationvita:'VITA', pcengineturbografx16:'PCE', pcengine:'PCE', turbografx16:'TG16',
  pcenginecdturbografxcd:'PCCD', pcfx:'PCFX', neogeopocket:'NGP', neogeocd:'NGCD', neogeo:'NEO', atari2600:'2600',
  atari5200:'5200', atari7800:'7800', atarilynx:'LYNX', atarijaguar:'JAG', atarijaguarcd:'JCD', arcade:'ARC',
  '3dointeractivemultiplayer':'3DO', colecovision:'CV', intellivision:'INTV', msx:'MSX', wonderswan:'WS',
  magnavoxodyssey2:'ODY2', vectrex:'VEC', appleii:'APL2', pc80008800:'PC88', amstradcpc:'CPC', fairchildchannelf:'CHF',
  arduboy:'ARDU', wasm4:'WASM', watarasupervision:'SV', megaduck:'DUCK', uzebox:'UZE', arcadia2001:'2001',
  intertonvc4000:'VC4K', elektortvgamescomputer:'TVGC', standalone:'SOLO', xbox:'XBOX', xbox360:'X360', pc:'PC',
  windows:'WIN', dos:'DOS', commodore64:'C64', amiga:'AMI', zxspectrum:'ZX', ports:'PORT', android:'AND'
};
const bladeNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function bladeCode(sys){
  if(sys === 'All') return 'ALL';
  const yours = consoleNames[sys];
  if(yours && yours.length <= 5) return yours.toUpperCase(); // a short name of your own is used as it is
  const known = BLADE_CODES[bladeNorm(sys)] || (yours && BLADE_CODES[bladeNorm(yours)]);
  if(known) return known;
  const name = String(yours || sys);
  if(name.length <= 5) return name.toUpperCase();
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if(words.length > 1) return words.map(w => /^\d+$/.test(w) ? w : w[0]).join('').slice(0, 5).toUpperCase();
  return name.slice(0, 4).toUpperCase();
}

// The console's logo for the console bar (Display Options, Console bar, Logos), or '' when there is none and the
// name is shown as before. A name of your own is tried first, so a tab renamed Mega Drive gets the Mega Drive logo.
function consoleLogo(sys){
  if(typeof CONSOLE_LOGOS === 'undefined' || sys === 'All') return '';
  const yours = consoleNames[sys];
  const file = (yours && CONSOLE_LOGOS[bladeNorm(yours)]) || CONSOLE_LOGOS[bladeNorm(sys)];
  return file ? `logos/consoles/${file}.webp` : '';
}

// Draws the ring with the console at place `at` in the middle. The blades run in the consoles' own order from
// left to right, wrapping past the last one back to All.
function drawBlades(chipRow, at){
  const b = chipRow._blades;
  const n = b.chips.length;
  const right = Math.ceil((n - 1) / 2), left = n - 1 - right;
  const logos = chipRow.classList.contains('logos');
  const blade = (off) => {
    const sys = b.chips[((at + off) % n + n) % n];
    const d = Math.abs(off);
    const cls = d === 0 ? 'centre' + (b.known ? ' active' : '') : d === 1 ? 'near' : d === 2 ? 'near far' : 'sliver';
    const name = b.full(sys);
    // All keeps an outline wherever it is, so you can see where the list starts
    const logo = logos && d <= 2 ? consoleLogo(sys) : '';
    const count = logo && d === 0 && b.count(sys) ? `<span class="blade-count">(${b.count(sys)})</span>` : '';
    const inside = logo ? `<img src="${logo}" alt="" draggable="false">${count}` : d === 0 ? name : d <= 2 ? b.attr(bladeCode(sys)) : '';
    return `<button class="chip ${cls}${sys === 'All' && d ? ' first' : ''}" data-sys="${b.attr(sys)}" aria-label="${name}">${inside}</button>`;
  };
  let l = '', r = '';
  for(let off = -left; off < 0; off++) l += blade(off);
  for(let off = 1; off <= right; off++) r += blade(off);
  chipRow.innerHTML = `<div class="blade-side left">${l}</div>${blade(0)}<div class="blade-side">${r}</div>`;
}

function pickSystem(sys){
  systemFilter = sys;
  renderLibraryViews();
}

// Touch on the blades: a tap picks that console, a sideways drag turns the ring a console at a time, and holding
// one opens reorder mode. The row is redrawn while you drag, so the row itself follows your finger, not the blades.
let bladeTouchAt = 0;
function wireBlades(chipRow){
  if(chipRow._bladesWired) return;
  chipRow._bladesWired = true;
  const STEP = 34; // how far a finger moves to turn the ring by one console
  let drag = null;
  const finish = (e, cancelled) => {
    if(!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    clearTimeout(d.timer);
    try{ chipRow.releasePointerCapture(d.id); }catch(_){}
    if(!chipRow.classList.contains('blades')) return;
    bladeTouchAt = Date.now();
    if(d.moved){
      const sys = chipRow._blades.chips[d.at];
      if(sys !== systemFilter) pickSystem(sys); else renderSystemChips();
      return;
    }
    if(cancelled || d.held) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const chip = hit && hit.closest ? hit.closest('#system-chips .chip') : null;
    if(chip && chip.getAttribute('data-sys') !== systemFilter) pickSystem(chip.getAttribute('data-sys'));
  };
  chipRow.addEventListener('pointerdown', (e) => {
    if(!chipRow.classList.contains('blades') || drag) return;
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    const b = chipRow._blades;
    const chip = e.target.closest ? e.target.closest('.chip') : null;
    drag = { id: e.pointerId, x: e.clientX, x0: e.clientX, y0: e.clientY, at: b.at, moved: false, held: false, timer: null };
    try{ chipRow.setPointerCapture(e.pointerId); }catch(_){}
    if(chip && chip.getAttribute('data-sys') !== 'All' && !b.yearTab){
      const d = drag;
      d.timer = setTimeout(() => {
        if(drag !== d || d.moved) return;
        d.held = true; chipEdit = true; chipEditTab = activeTab; renderSystemChips();
      }, 600);
    }
  });
  chipRow.addEventListener('pointermove', (e) => {
    if(!drag || e.pointerId !== drag.id || drag.held) return;
    if(Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10) clearTimeout(drag.timer);
    const steps = Math.trunc((e.clientX - drag.x) / STEP);
    if(!steps) return;
    const n = chipRow._blades.chips.length;
    drag.x += steps * STEP;
    drag.moved = true;
    drag.at = ((drag.at - steps) % n + n) % n; // dragging left brings the next console in
    drawBlades(chipRow, drag.at);
  });
  chipRow.addEventListener('pointerup', (e) => finish(e, false));
  chipRow.addEventListener('pointercancel', (e) => finish(e, true));
  chipRow.addEventListener('contextmenu', (e) => { if(chipRow.classList.contains('blades')) e.preventDefault(); });
  // The controller (and a mouse) picks a blade with a plain click. A touch was already dealt with above.
  chipRow.addEventListener('click', (e) => {
    if(!chipRow.classList.contains('blades') || Date.now() - bladeTouchAt < 500) return;
    const chip = e.target.closest ? e.target.closest('.chip') : null;
    if(chip) pickSystem(chip.getAttribute('data-sys'));
  });
}

// Title comparison everywhere ignores case and accents ("Pokémon" = "Pokemon").
function foldText(s){
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Sorting ignores leading tags like "~Hack~", so those games sort under their real title.
function sortableTitle(title){
  return foldText(String(title || '').replace(/^(?:~[^~]*~\s*)+/, ''));
}

// Where a game falls in the Award column: 0 mastered, 1 beaten, 2 in progress.
function awardRank(g){
  if(g.customConsole) return g.manualBeaten ? 1 : 2;
  const info = awardInfo(g.HighestAwardKind);
  return !info ? 2 : (info.label === 'Mastered' ? 0 : 1);
}

// The first press on a Library heading sorts this way, the next press the other way. Game has a third press
// that goes back to the usual order.
const LIBRARY_SORT_FIRST = { Title: 'asc', HighestAwardKind: 'asc', pct: 'desc', estHours: 'asc', lastPlayed: 'desc' };
function pressLibrarySort(k){
  if(k === 'Title'){
    if(librarySort.key !== 'Title'){ librarySort.key = 'Title'; librarySort.dir = 'asc'; }
    else if(librarySort.dir === 'asc') librarySort.dir = 'desc';
    else{ librarySort.key = ''; librarySort.dir = 'asc'; }
  }else if(librarySort.key === k){
    librarySort.dir = librarySort.dir === 'asc' ? 'desc' : 'asc';
  }else{
    librarySort.key = k;
    librarySort.dir = LIBRARY_SORT_FIRST[k] || 'desc';
  }
}
// The Backlog starts A to Z, so the first press on Game turns it round. Achievements is most points first.
function pressBacklogSort(k){
  if(backlogSort.key === k) backlogSort.dir = backlogSort.dir === 'asc' ? 'desc' : 'asc';
  else{ backlogSort.key = k; backlogSort.dir = k === 'Title' ? 'asc' : 'desc'; }
}

// Whether a game shows as done in the current mode (the same rule awardPill() uses).
function isGameAwarded(g){
  if(g.customConsole) return !!g.manualBeaten;
  return awardCountsInMode(g.HighestAwardKind);
}

// A manually added RA game stays in the Backlog until RA reports progress; a non-RA game until
// "Now Playing" is ticked. Beaten without started counts as started (older saves).
function isBacklogGame(g){
  if(g.manual !== true) return false;
  if(!g.customConsole) return true;
  const started = g.manualStarted === true || g.manualBeaten === true;
  return !started;
}

function renderLibrary(){
  const wrap = $('#lib-table-wrap');
  libraryData.forEach(g => { g.estHours = (estHoursCache[g.GameID] && estHoursCache[g.GameID].hours) ?? -1; });
  const searchVal = foldText($('#lib-search').value || '');
  let rows = libraryData.filter(g =>
    !isBacklogGame(g) &&
    !isSubsetGame(g) &&
    !(libraryHideDone && isGameAwarded(g)) &&
    foldText(g.Title).includes(searchVal) &&
    (systemFilter === 'All' || g.ConsoleName === systemFilter)
  );

  const { key, dir } = librarySort;
  const byTitle = (a, b) => sortableTitle(a.Title).localeCompare(sortableTitle(b.Title));
  if(!key || key === 'Title'){
    rows = rows.slice().sort((a, b) => (key && dir === 'desc' ? -1 : 1) * byTitle(a, b));
  }else{
    // What a game is sorted by in this column, or null when it has nothing (never played, no playtime yet).
    // Those stay at the bottom whichever way the column is sorted.
    const value = (g) => {
      if(key === 'HighestAwardKind') return awardRank(g);
      if(key === 'lastPlayed'){ const d = parseRADate(g.lastPlayed); return d ? d.getTime() : null; }
      if(key === 'estHours'){
        if(g.customConsole){ const sec = customPlaySeconds(g); return sec >= 30 ? sec / 3600 : null; }
        return g.estHours >= 0 ? g.estHours : null;
      }
      return Number(g[key]) || 0;
    };
    const sign = dir === 'asc' ? 1 : -1;
    rows = rows.map(g => ({ g, v: value(g) })).sort((a, b) => {
      if((a.v === null) !== (b.v === null)) return a.v === null ? 1 : -1;
      if(a.v !== b.v) return (a.v < b.v ? -1 : 1) * sign;
      return byTitle(a.g, b.g);
    }).map(x => x.g);
  }

  // Default order: the three most recently played (on the picked console, if any), then by name.
  let recentSet = null; // the games shown first, with a label over them
  if(!key && !searchVal){
    const recent = rows
      .filter(g => parseRADate(g.lastPlayed))
      .sort((a, b) => parseRADate(b.lastPlayed) - parseRADate(a.lastPlayed))
      .slice(0, 3);
    if(recent.length){
      const picked = new Set(recent);
      rows = [...recent, ...rows.filter(g => !picked.has(g))];
      recentSet = picked;
    }
  }

  $('#lib-count').textContent = rows.length ? `(${rows.length} ${rows.length === 1 ? 'game' : 'games'})` : '';

  if(rows.length === 0){
    wrap.innerHTML = `<div class="empty">${libraryHideDone && !searchVal && systemFilter === 'All' ? 'No games in progress.' : 'No games match.'}</div>`;
    return;
  }

  if(gameView === 'tile'){ renderTiles(wrap, rows, recentSet, false); return; }

  const showAward = !libraryHideDone; // with beaten games hidden, every game left is in progress
  const cols = showAward ? 5 : 4;
  setGamesHtml(wrap, `
      <table class="lib-table">
        <thead><tr>
          <th data-key="Title">Game</th>
          ${showAward ? '<th data-key="HighestAwardKind">Award</th>' : ''}
          <th data-key="pct">Progress</th>
          <th data-key="estHours" title="In-progress games: estimated active playtime. Beaten/completed games: time from first unlock to the award.">Playtime</th>
          <th data-key="lastPlayed">Last played</th>
        </tr></thead>
        <tbody>
          ${rows.map((g, i) => {
          const label = recentSet
            ? (i === 0 ? `<tr class="lib-sec"><td colspan="${cols}">RECENTLY PLAYED</td></tr>`
              : (i === recentSet.size ? `<tr class="lib-sec alt"><td colspan="${cols}">ALL GAMES A\u2013Z</td></tr>` : ''))
            : '';
          const isCustom = g.customConsole === true;
          const est = estHoursCache[g.GameID];
          const hoursLabel = isCustom ? (customPlaytimeHtml(g) || '—') : (est ? formatDuration(est, true) : '<span class="pt-pending" title="Loading playtime…"></span>');
          const awardCell = isCustom
            ? (g.manualBeaten ? '<span class="pill pill-teal">Beaten</span>' : '<span class="pill pill-muted">In progress</span>')
            : awardPill(g.HighestAwardKind);
          const isHardcoreMode = statsMode === 'hardcore';
          const awardedForMode = isHardcoreMode ? Number(g.NumAwardedHardcore || 0) : Number(g.NumAwarded || 0);
          const pctForMode = Number(g.MaxPossible) ? Math.round((awardedForMode / Number(g.MaxPossible)) * 100) : 0;
          const progressCell = isCustom
            ? '<span style="color:var(--muted);font-size:0.75rem;">—</span>'
            : `
                <div class="bar">
                  <div class="progress-track"><div class="progress-fill ${pctForMode>=100?'complete':''} ${isHardcoreMode?'hardcore':''}" style="width:${pctForMode}%"></div></div>
                </div>
                <span style="font-family:'Space Mono',monospace;font-size:0.6875rem;color:var(--muted)">${awardedForMode}/${g.MaxPossible} · ${pctForMode}%</span>
              `;
          const lastPlayedLabel = isCustom
            ? (g.lastPlayed ? timeAgoShort(g.lastPlayed) : (parseLocalDay(g.manualBeatenDate) ? shortDay(parseLocalDay(g.manualBeatenDate)) : 'Never'))
            : (g.lastPlayed ? timeAgoShort(g.lastPlayed) : 'Never');
          return label + `
            <tr data-game-id="${g.GameID}">
              <td><div class="g-title"><img src="${imgUrl(g.ImageIcon)}" alt="" loading="lazy" decoding="async"><span>${esc(g.Title)}${preRaStar(g.GameID)}</span>${g.manual ? `<button class="manual-remove" data-remove-id="${g.GameID}" title="Remove">✕</button>` : ''}</div></td>
              ${showAward ? `<td>${awardCell}</td>` : ''}
              <td>${progressCell}</td>
              <td style="font-family:'Space Mono',monospace;font-size:0.75rem;color:var(--gold)">${hoursLabel}</td>
              <td style="color:var(--muted);font-size:0.75rem;">${lastPlayedLabel}</td>
            </tr>
          `;
        }).join('')}
        </tbody>
      </table>
    `);
}

// Cart view (Display Options, Game art), for the Last Played cards and the Library and Backlog tiles: the app looks for a picture of the game's cartridge or disc and answers
// at this address. The address is the same every time for a game, so a list that is drawn again stays identical.
// Hacks are left out: they would get the original game's cartridge.
const CART_ART_BASE = 'https://appassets.androidplatform.net/cart/art';
function cartArtAvailable(){
  return !!window.ThorBridge;
}
function cartArtHtml(g){
  if(gameArt !== 'cart' || !cartArtAvailable()) return '';
  const title = String(g.Title || '');
  if(!title || !g.ConsoleName || /^\s*~/.test(title)) return '';
  const src = `${CART_ART_BASE}?t=${encodeURIComponent(title)}&c=${encodeURIComponent(g.ConsoleName)}`;
  return `<img class="media" src="${src}" alt="" loading="lazy" decoding="async" draggable="false">`;
}

// Cart view: a cartridge or disc picture that loads takes the icon's place in its tile. One that isn't there is
// taken away and the tile stays as it was. These events don't bubble, so they are caught on the way down.
function wireCartArt(wrap){
  if(wrap.cartArtWired) return;
  wrap.cartArtWired = true;
  wrap.addEventListener('load', (e) => {
    const img = e.target;
    if(img && img.classList && img.classList.contains('media') && img.parentNode) img.parentNode.classList.add('has-media');
  }, true);
  wrap.addEventListener('error', (e) => {
    const img = e.target;
    if(img && img.classList && img.classList.contains('media')) img.remove();
  }, true);
}

// Tile view (Display Options): the Last Played cards, in a grid with 3 to 5 tiles per row.
function tileHtml(g, backlog){
  const isCustom = g.customConsole === true;
  const remove = g.manual ? `<button class="manual-remove tile-remove" data-remove-id="${g.GameID}" title="Remove">✕</button>` : '';
  let badge = '', foot = '';
  if(backlog){
    const n = isCustom ? 'Not on RA' : (Number(g.MaxPossible) || 0) + ' achievements';
    foot = `<div class="cart-progress-group"><div class="prog-lbl"><span>${n}</span></div></div>`;
  }else if(isCustom){
    // a game RetroAchievements doesn't track: the time counted on this device (or its play log), when there is any
    const played = customPlaytimeHtml(g);
    foot = `<div class="cart-progress-group"><div class="prog-lbl"><span>${g.manualBeaten ? 'Beaten' : 'In progress'}</span></div>${played ? `<div class="hours">${played}</div>` : ''}</div>`;
  }else{
    const hard = statsMode === 'hardcore';
    const total = Number(g.MaxPossible) || 0;
    const earned = hard ? Number(g.NumAwardedHardcore || 0) : Number(g.NumAwarded || 0);
    const pct = total ? Math.round((earned / total) * 100) : 0;
    const est = estHoursCache[g.GameID];
    const hoursHtml = est
      ? `<span class="val" style="color:var(--gold)">${est.real ? '' : '≈ '}${formatDuration(est)}</span>`
      : '<span class="pt-pending" title="Loading playtime…"></span>';
    const award = isGameAwarded(g) ? awardInfo(g.HighestAwardKind) : null;
    if(award) badge = `<span class="pill pill-corner ${award.cls}">${award.label}</span>`;
    foot = `<div class="cart-progress-group">
              <div class="progress-track"><div class="progress-fill ${pct >= 100 ? 'complete' : ''} ${hard ? 'hardcore' : ''}" style="width:${pct}%"></div></div>
              <div class="prog-lbl"><span>${earned}/${total}</span><span>${pct}%</span></div>
              <div class="hours">${hoursHtml}</div>
            </div>`;
  }
  return `<div class="cart" data-game-id="${g.GameID}">
      <div class="art-wrap"><img class="art" src="${imgUrl(g.ImageIcon)}" alt="${esc(g.Title)}" loading="lazy" decoding="async">${cartArtHtml(g)}${badge}${remove}</div>
      <div class="body"><p class="title">${esc(g.Title)}${preRaStar(g.GameID)}</p><p class="console">${esc(g.ConsoleName || '')}</p>${foot}</div>
    </div>`;
}

// rows: games in order. recentSet: the games to show first under a "Recently played" label, or null.
function renderTiles(wrap, rows, recentSet, backlog){
  const cols = Math.min(6, Math.max(2, tileCols));
  const first = recentSet ? rows.filter(g => recentSet.has(g)) : [];
  const rest = recentSet ? rows.filter(g => !recentSet.has(g)) : rows;
  let html = '';
  if(first.length){
    html += `<div class="tile-sec">RECENTLY PLAYED</div><div class="tile-grid cols-${cols}" style="--tile-cols:${cols}">${first.map(g => tileHtml(g, backlog)).join('')}</div>`;
    html += '<div class="tile-sec alt">ALL GAMES A\u2013Z</div>';
  }
  html += `<div class="tile-grid cols-${cols}" style="--tile-cols:${cols}">${rest.map(g => tileHtml(g, backlog)).join('')}</div>`;
  setGamesHtml(wrap, html);
}

// Puts a game list (tiles or table) on the page. A sync or a tab switch often asks for the list that is already
// showing, and building hundreds of tiles again for nothing is the slow part, so that case is skipped.
function setGamesHtml(wrap, html){
  wireGames(wrap);
  if(wrap.gamesHtml === html && wrap.querySelector('.tile-grid, .lib-table')) return;
  wrap.gamesHtml = html;
  wrap.innerHTML = html;
}

// One click handler for the whole list, set up once: a tile or table row opens the game, ✕ removes a manually
// added game, and a column heading in the Library table sorts by it.
function wireGames(wrap){
  if(wrap.gamesWired) return;
  wrap.gamesWired = true;
  wireCartArt(wrap);
  wrap.addEventListener('click', (e) => {
    const hit = (sel) => { const el = e.target.closest(sel); return el && wrap.contains(el) ? el : null; };
    const remove = hit('.manual-remove');
    if(remove){
      e.stopPropagation();
      removeManualGame(Number(remove.getAttribute('data-remove-id')));
      return;
    }
    const th = hit('th[data-key]');
    if(th){
      const k = th.getAttribute('data-key');
      if(wrap.id === 'backlog-table-wrap'){ pressBacklogSort(k); renderBacklog(); }
      else{ pressLibrarySort(k); renderLibrary(); }
      return;
    }
    const game = hit('.cart, .lib-table tbody tr:not(.lib-sec)');
    if(game) openGameModal(Number(game.getAttribute('data-game-id')));
  });
}

// A backlog game's total points come from RetroAchievements' list for its console (kept for a week, so this is
// one request per console at most). They are kept in their own saved list, by game. Keeping them on the games
// themselves lost them: a sync reads the backlog from storage again and puts fresh copies in the library.
const BACKLOG_POINTS_KEY = 'backlog-points';
let backlogPoints = null; // game id -> points, null until the saved list has been read
let backlogPointsReading = false;
const backlogPointsAsked = new Set();
function backlogPointsOf(g){
  if(g.customConsole) return null;
  if(g.Points != null) return Number(g.Points);
  const p = backlogPoints ? backlogPoints[g.GameID] : null;
  return p != null ? Number(p) : null;
}
function fillBacklogPoints(rows){
  if(backlogPoints === null){
    if(backlogPointsReading) return;
    backlogPointsReading = true;
    (async () => {
      let saved = {};
      try{
        const r = await window.storage.get(BACKLOG_POINTS_KEY, false);
        const v = r && r.value ? JSON.parse(r.value) : null;
        if(v && typeof v === 'object') saved = v;
      }catch(e){}
      backlogPoints = saved;
      renderBacklog(); // draws what was saved, and asks for the rest
    })();
    return;
  }
  const need = rows.filter(g => !g.customConsole && g.ConsoleID && backlogPointsOf(g) === null && !backlogPointsAsked.has(g.GameID));
  if(!need.length || typeof getGameListForConsole !== 'function') return;
  need.forEach(g => backlogPointsAsked.add(g.GameID));
  const consoles = [...new Set(need.map(g => Number(g.ConsoleID)))];
  (async () => {
    let found = 0;
    for(const cid of consoles){
      try{
        const list = await getGameListForConsole(cid);
        const byId = new Map((list || []).map(x => [Number(x.ID ?? x.id), x]));
        need.forEach(g => {
          const hit = Number(g.ConsoleID) === cid ? byId.get(Number(g.GameID)) : null;
          const pts = hit ? (hit.Points ?? hit.points) : null;
          if(pts != null){ backlogPoints[g.GameID] = Number(pts); found++; }
        });
      }catch(e){
        need.forEach(g => { if(Number(g.ConsoleID) === cid) backlogPointsAsked.delete(g.GameID); }); // offline: ask again later
      }
    }
    if(!found) return;
    try{ await window.storage.set(BACKLOG_POINTS_KEY, JSON.stringify(backlogPoints), false); }catch(e){}
    renderBacklog();
  })();
}

// Games added but not played yet.
function renderBacklog(){
  const wrap = $('#backlog-table-wrap');
  if(!wrap) return;
  const searchInput = $('#backlog-search');
  const searchVal = foldText(searchInput ? searchInput.value : '');
  let rows = libraryData.filter(g =>
    isBacklogGame(g) &&
    foldText(g.Title).includes(searchVal) &&
    (systemFilter === 'All' || g.ConsoleName === systemFilter)
  );
  fillBacklogPoints(rows);
  const byTitle = (a, b) => sortableTitle(a.Title).localeCompare(sortableTitle(b.Title));
  const sign = backlogSort.dir === 'asc' ? 1 : -1;
  if(backlogSort.key === 'points'){
    // games with no points to show (not on RetroAchievements, or not looked up yet) stay at the bottom either way
    const pts = backlogPointsOf;
    rows = rows.slice().sort((a, b) => {
      const av = pts(a), bv = pts(b);
      if((av === null) !== (bv === null)) return av === null ? 1 : -1;
      if(av !== bv) return (av < bv ? -1 : 1) * sign;
      return byTitle(a, b);
    });
  }else{
    rows = rows.slice().sort((a, b) => sign * byTitle(a, b));
  }

  const countEl = $('#backlog-count');
  if(countEl) countEl.textContent = rows.length ? `(${rows.length} ${rows.length === 1 ? 'game' : 'games'})` : '';

  if(rows.length === 0){
    wrap.innerHTML = '<div class="empty">Nothing in your backlog. Add a game to start tracking it.</div>';
    return;
  }

  if(gameView === 'tile'){ renderTiles(wrap, rows, null, true); return; }

  const showSystem = systemFilter === 'All'; // on one console's list every row would say the same thing
  setGamesHtml(wrap, `
      <table class="lib-table">
        <thead><tr>
          <th data-key="Title">Game</th>
          ${showSystem ? '<th>System</th>' : ''}
          <th data-key="points">Achievements</th>
        </tr></thead>
        <tbody>
          ${rows.map(g => `
            <tr data-game-id="${g.GameID}">
              <td><div class="g-title"><img src="${imgUrl(g.ImageIcon)}" alt="" loading="lazy" decoding="async"><span>${esc(g.Title)}${preRaStar(g.GameID)}</span>${g.manual ? `<button class="manual-remove" data-remove-id="${g.GameID}" title="Remove">✕</button>` : ''}</div></td>
              ${showSystem ? `<td style="color:var(--muted);font-size:0.75rem;">${esc(g.ConsoleName || '—')}</td>` : ''}
              <td style="font-family:'Space Mono',monospace;font-size:0.75rem;color:var(--muted)">${g.customConsole ? 'Not on RA' : (Number(g.MaxPossible) || 0) + (backlogPointsOf(g) != null ? ' / ' + backlogPointsOf(g) + ' pts' : '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
}

// Small floating label with a game's title, used when a Beaten by Year tile is held.
let yearTipEl = null, yearTipTimer = null;
function showYearTip(item){
  if(!yearTipEl){
    yearTipEl = document.createElement('div');
    yearTipEl.className = 'year-tip';
    document.body.appendChild(yearTipEl);
  }
  yearTipEl.textContent = item.getAttribute('title') || '';
  yearTipEl.classList.add('show');
  const r = item.getBoundingClientRect();
  const w = yearTipEl.offsetWidth, h = yearTipEl.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
  yearTipEl.style.left = left + 'px';
  yearTipEl.style.top = top + 'px';
  clearTimeout(yearTipTimer);
  yearTipTimer = setTimeout(hideYearTip, 2500);
}
function hideYearTip(){
  if(yearTipEl) yearTipEl.classList.remove('show');
}
window.addEventListener('scroll', hideYearTip, { passive: true });

function renderByYear(){
  const el = $('#year-wrap');
  const raBeaten = libraryData.filter(g => {
    if(g.customConsole || !g.HighestAwardKind || !g.HighestAwardDate) return false;
    if(systemFilter !== 'All' && g.ConsoleName !== systemFilter) return false;
    return awardCountsInMode(g.HighestAwardKind);
  });
  const manualBeaten = libraryData.filter(g =>
    g.customConsole && g.manualBeaten && g.manualBeatenDate &&
    (systemFilter === 'All' || g.ConsoleName === systemFilter)
  );
  const done = [...raBeaten, ...manualBeaten];
  if(done.length === 0){
    el.innerHTML = '<div class="empty">No completions yet. Beat or master a game and it\'ll show up here.</div>';
    return;
  }

  const casualFirst = { 'beaten-softcore': 0, 'completed': 1, 'beaten-hardcore': 2, 'mastered': 3 };
  const byYear = {};
  done.forEach(g => {
    let year;
    if(g.customConsole){
      const d = parseLocalDay(g.manualBeatenDate);
      if(!d) return;
      year = d.getFullYear();
    }else{
      const parsed = parseRADate(g.HighestAwardDate);
      if(!parsed) return;
      year = parsed.getFullYear();
    }
    if(!byYear[year]) byYear[year] = [];
    byYear[year].push(g);
  });

  const years = Object.keys(byYear).sort((a,b) => b - a);
  el.innerHTML = years.map(year => {
    const games = byYear[year].slice().sort((a,b) =>
      (casualFirst[a.HighestAwardKind] ?? (a.customConsole ? -1 : 9)) - (casualFirst[b.HighestAwardKind] ?? (b.customConsole ? -1 : 9))
    );
    return `
        <div class="year-group">
          <div class="year-heading">${year} <span class="n">${games.length} completion${games.length===1?'':'s'}</span></div>
          <div class="year-icons">
            ${games.map(g => {
              // Only Mastered gets a pill; a plain beat is what this tab shows anyway.
              const award = g.customConsole ? null : awardInfo(g.HighestAwardKind);
              const pill = award && award.label === 'Mastered'
                ? `<span class="pill pill-year ${award.cls}">Mastered</span>` : '';
              return `
              <div class="year-item" data-game-id="${g.GameID}" title="${esc(g.Title)}">
                <img src="${imgUrl(g.ImageIcon)}" alt="${esc(g.Title)}">
                ${pill}
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
  }).join('');
  let lastLongPress = 0;
  el.querySelectorAll('.year-item').forEach(item => {
    item.addEventListener('click', () => {
      if(Date.now() - lastLongPress < 600) return; // letting go of a long press isn't a tap
      openGameModal(Number(item.getAttribute('data-game-id')));
    });
    // Holding a tile shows the game's title (no hover on touch screens).
    let holdTimer = null, startX = 0, startY = 0, held = false;
    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
    item.addEventListener('touchstart', (e) => {
      held = false;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      cancelHold();
      holdTimer = setTimeout(() => { held = true; showYearTip(item); }, 450);
    }, { passive: true });
    item.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if(Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) cancelHold();
    }, { passive: true });
    item.addEventListener('touchend', (e) => {
      cancelHold();
      if(held){ lastLongPress = Date.now(); if(e.cancelable) e.preventDefault(); }
    });
    item.addEventListener('touchcancel', cancelHold);
    item.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}
