// Picking games from the ROMs folder, from Add your game(s). Two ways in:
//  - "Pick individual ROM files": the consoles down the left, their games on the right. Tick as many as you like, on
//    as many consoles as you like (L1/R1 change console), then add them all at once.
//  - "Add a whole console folder": the console folders, each with how many games it holds. One tap adds them all.
// The lists come from the app's own index of the ROMs folder (thorBridge.romSystems / romsIn), so there's no system
// file picker, which only takes several files after a long press.
(function(){
  const $id = (id) => document.getElementById(id);
  const backdrop = $id('rompick-backdrop');
  if(!backdrop) return;
  const body = $id('rompick-body');
  const bar = $id('rompick-bar');
  const addBtn = $id('rompick-add');
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let mode = null;        // 'pick' | 'folder'
  let systems = [];       // [{ folder, ra:[names], count }]
  let cur = 0;            // the console shown in pick mode
  const roms = new Map(); // folder -> [{ title, path, folder, ra }]
  const picked = new Map(); // path -> rom
  let busy = false;

  const bridge = () => (typeof thorBridge !== 'undefined' && thorBridge) ? thorBridge : null;
  const shortName = (s) => String(s.folder || '').toUpperCase();
  const longName = (s) => (s.ra && s.ra[0]) || shortName(s);
  const ext = (path) => { const m = /\.([a-z0-9]+)$/i.exec(path || ''); return m ? '.' + m[1].toLowerCase() : ''; };

  function romsOf(folder){
    if(!roms.has(folder)){
      let list = [];
      try{ list = JSON.parse(bridge().romsIn(folder)) || []; }catch(e){}
      list.sort((a, b) => romDisplayTitle(a.title).localeCompare(romDisplayTitle(b.title)));
      roms.set(folder, list);
    }
    return roms.get(folder);
  }

  // Games already in the library: by the ROM they point at, or by title on the same console.
  let owned = null;
  function buildOwned(){
    const paths = new Set(), keys = new Set();
    (typeof libraryData !== 'undefined' ? libraryData : []).forEach(g => {
      if(g.romPath) paths.add(g.romPath);
      keys.add(romMatchKey(g.Title) + '|' + String(g.ConsoleName || '').toLowerCase());
    });
    owned = { paths, keys };
  }
  function isOwned(r){
    if(owned.paths.has(r.path)) return true;
    const k = romMatchKey(r.title);
    return [...(r.ra || []), r.folder].some(n => owned.keys.has(k + '|' + String(n || '').toLowerCase()));
  }

  function open(which){
    const br = bridge();
    if(!br || typeof br.romSystems !== 'function') return;
    mode = which;
    try{ systems = JSON.parse(br.romSystems()) || []; }catch(e){ systems = []; }
    roms.clear();
    picked.clear();
    busy = false;
    cur = 0;
    buildOwned();
    $id('rompick-title').textContent = which === 'pick' ? 'Pick ROM files' : 'Add a whole console folder';
    $id('rompick-sub').textContent = which === 'pick'
      ? 'Tick as many as you like, from any console'
      : 'Tap a folder and every game in it goes to your Backlog';
    backdrop.classList.toggle('rp-folder-mode', which === 'folder');
    backdrop.classList.add('open');
    render();
  }

  function close(){
    backdrop.classList.remove('open');
    mode = null;
  }

  function empty(){
    return '<div class="rp-empty">No ROMs found. Choose your ROMs folder in Launcher settings.</div>';
  }

  function render(){
    if(mode === 'folder') renderFolders();
    else renderPick();
  }

  function renderFolders(){
    bar.style.display = 'none';
    body.innerHTML = systems.length ? systems.map((s, i) => `
      <button class="rp-folder" type="button" data-i="${i}" data-key="f:${escHtml(s.folder)}">
        <span class="rp-fname">${escHtml(longName(s))}</span>
        <span class="rp-fpath">roms/${escHtml(s.folder)}</span>
        <span class="rp-fcount">${s.count} game${s.count === 1 ? '' : 's'}</span>
        <span class="rp-fgo">Add all</span>
      </button>`).join('') : empty();
    body.querySelectorAll('.rp-folder').forEach(btn => btn.addEventListener('click', () => addFolder(btn)));
  }

  function renderPick(){
    if(!systems.length){ body.innerHTML = empty(); bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const s = systems[cur];
    const list = romsOf(s.folder);
    const left = systems.map((x, i) => {
      const n = [...picked.values()].filter(r => r.folder === x.folder).length;
      return `<button class="rp-sys${i === cur ? ' on' : ''}" type="button" data-i="${i}" data-key="s:${escHtml(x.folder)}">
        <span>${escHtml(shortName(x))}</span><b>${n ? `<i>${n}</i>` : ''}${x.count}</b></button>`;
    }).join('');
    const right = list.length ? list.map((r, i) => {
      const have = isOwned(r);
      const on = picked.has(r.path);
      return `<button class="rp-rom${on ? ' sel' : ''}${have ? ' have' : ''}" type="button" data-i="${i}" data-key="r:${escHtml(r.path)}"${have ? ' aria-disabled="true"' : ''}>
        <span class="rp-box">${on || have ? '✓' : ''}</span>
        <span class="rp-name">${escHtml(romDisplayTitle(r.title))}</span>
        <span class="rp-ext">${have ? 'in Backlog' : escHtml(ext(r.path))}</span>
      </button>`;
    }).join('') : '<div class="rp-empty">No games in this folder.</div>';
    const keepScroll = body.querySelector('.rp-list');
    const top = keepScroll && keepScroll.getAttribute('data-folder') === s.folder ? keepScroll.scrollTop : 0;
    body.innerHTML = `<div class="rp-cols"><div class="rp-syslist">${left}</div><div class="rp-list" data-folder="${escHtml(s.folder)}">${right}</div></div>`;
    body.querySelector('.rp-list').scrollTop = top;
    body.querySelectorAll('.rp-sys').forEach(btn => btn.addEventListener('click', () => {
      cur = Number(btn.getAttribute('data-i'));
      render();
    }));
    body.querySelectorAll('.rp-rom:not(.have)').forEach(btn => btn.addEventListener('click', () => {
      const r = list[Number(btn.getAttribute('data-i'))];
      if(picked.has(r.path)) picked.delete(r.path); else picked.set(r.path, r);
      render();
    }));
    syncBar();
  }

  function syncBar(){
    const n = picked.size;
    $id('rompick-count').textContent = n ? `${n} selected` : 'Nothing ticked yet';
    addBtn.textContent = busy ? 'Adding…' : (n ? `Add ${n} to Backlog` : 'Add to Backlog');
    addBtn.disabled = busy || !n;
  }

  // Each picked cartridge ROM is identified by its hash too, like a file from the file picker.
  function withHashes(items){
    const br = bridge();
    if(!br || typeof br.romHash !== 'function') return items;
    return items.map(r => {
      let md5 = '';
      try{ md5 = br.romHash(r.path) || ''; }catch(e){}
      return md5 ? Object.assign({}, r, { md5 }) : r;
    });
  }

  addBtn.addEventListener('click', async () => {
    if(busy || !picked.size) return;
    busy = true;
    syncBar();
    const items = withHashes([...picked.values()]);
    try{ await addRomsToBacklog(items); }catch(e){}
    busy = false;
    close();
  });

  async function addFolder(btn){
    if(busy) return;
    const s = systems[Number(btn.getAttribute('data-i'))];
    if(!s) return;
    busy = true;
    btn.classList.add('busy');
    btn.querySelector('.rp-fgo').textContent = 'Adding…';
    let n = 0;
    try{ n = await addRomsToBacklog(romsOf(s.folder)); }catch(e){}
    busy = false;
    close();
    showToast(n ? `Added ${n} ${shortName(s)} game${n === 1 ? '' : 's'} to your Backlog`
      : `Every ${shortName(s)} game is already in your Backlog`);
  }

  $id('rompick-back').addEventListener('click', () => { if(!busy) close(); });

  // Controller keys while the picker is open (gamepad.js asks first). L1/R1 change console.
  function key(name){
    if(!backdrop.classList.contains('open') || mode !== 'pick' || !systems.length) return false;
    if(name !== 'l1' && name !== 'r1') return false;
    cur = (cur + (name === 'r1' ? 1 : -1) + systems.length) % systems.length;
    render();
    return true;
  }

  window.RomPick = { open, close, key, isOpen: () => backdrop.classList.contains('open') };
})();
