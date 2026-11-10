// Tabs and start-up.

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    const panel = $('#tab-' + tabName);
    if(!panel) return;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    panel.classList.add('active');
    activeTab = tabName;
    $('#system-chips').classList.toggle('visible', tabName === 'library' || tabName === 'year' || tabName === 'backlog');
    if(tabName === 'apps' && typeof renderApps === 'function') renderApps();

    if(tabName === 'library' && libraryDirty){ libraryDirty = false; try{ renderLibrary(); }catch(e){} }

    try{ renderSystemChips(); }catch(e){}
  });
});

// Show the dashboard and load the saved login.
(async () => {
  statsMode = await loadStatsMode();
  applyStatsModeLabel();
  showDashboard();
  await thorSeedCredentials();
  const saved = await loadCreds();
  if(saved && saved.username && saved.apiKey){
    creds = saved;
    $('#in-user').value = saved.username;
    loadAll();
  }
  updateRaConnectionView();
})();


// Measures the pinned heading (tabs, console chips, title and search bar) so the pieces stack under each other and
// anything scrolled into view lands below them.
(function pinHeading(){
  const root = document.documentElement;
  const status = () => (document.body.classList.contains('show-status') ? 28 : 0);
  const h = el => (el && el.offsetParent !== null ? el.getBoundingClientRect().height : 0);
  function measure(){
    const tabs = h(document.querySelector('.tabs'));
    const chips = h(document.querySelector('#system-chips.visible'));
    const head = h(document.querySelector('.tab-panel.active .panel-head'));
    root.style.setProperty('--stk-tabs', tabs + 'px');
    root.style.setProperty('--stk-chips', chips + 'px');
    const th = h(document.querySelector('.tab-panel.active .lib-table th'));
    root.style.setProperty('--stk-sum', (status() + tabs + chips + head) + 'px');
    root.style.setProperty('--stk-all', (status() + tabs + chips + head + th + 8) + 'px');
  }
  let queued = false;
  const soon = () => { if(queued) return; queued = true; requestAnimationFrame(() => { queued = false; measure(); }); };
  if(window.ResizeObserver){
    const ro = new ResizeObserver(soon);
    ['.tabs', '#system-chips', '.panel-head', '#lib-table-wrap', '#backlog-table-wrap'].forEach(sel => document.querySelectorAll(sel).forEach(el => ro.observe(el)));
  }
  window.addEventListener('resize', soon);
  document.addEventListener('click', soon, true);
  new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  soon();
})();

// A console chip that runs off the edge of the row is hidden until you scroll to it, so no name is ever cut in half.
// Where to scroll the console row so the chosen console is fully in view with no gap after the pinned "All":
// it scrolls only when it has to, and then in whole chips, so the first console always sits right beside All.
// How far in from the row's left edge the first console sits when it is right beside the pinned "All".
function chipPin(row, all){
  return (parseFloat(getComputedStyle(row).paddingLeft) || 0) + all.offsetWidth + 8;
}

function chipScrollTarget(row, active){
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  const all = row.classList.contains('editing') ? null : row.querySelector('.chip[data-sys="All"]');
  if(!all || active === all) return 0;
  const pin = chipPin(row, all);
  const sl = row.scrollLeft;
  let t = sl;
  if(active.offsetLeft - pin < sl) t = active.offsetLeft - pin;
  else if(active.offsetLeft + active.offsetWidth > sl + row.clientWidth - 4) t = active.offsetLeft + active.offsetWidth - row.clientWidth + 6;
  else return sl;
  const chips = Array.from(row.querySelectorAll('.chip')).filter(c => c !== all);
  const snap = chips.find(c => c.offsetLeft - pin >= t);
  if(snap) t = snap.offsetLeft - pin;
  return Math.min(max, Math.max(0, t));
}

(function clipChips(){
  const row = document.getElementById('system-chips');
  if(!row) return;
  let queued = false;
  let lastActive = null;
  function apply(){
    queued = false;
    const box = row.getBoundingClientRect();
    if(!box.width) return;
    // The blades never scroll or hide anything. Only reorder mode is still a scrolling row.
    if(row.classList.contains('blades')){ row.classList.remove('can-scroll'); lastActive = null; return; }
    // The console you are on is always kept in view: when it changes, the row scrolls to centre it.
    const active = row.querySelector('.chip.active');
    const key = active ? active.textContent : null;
    if(active && key !== lastActive && row.classList.contains('visible')){
      const max = Math.max(0, row.scrollWidth - row.clientWidth);
      row.scrollLeft = chipScrollTarget(row, active);
    }
    lastActive = key;
    // more consoles off to the right: show the arrow, and keep chips from hiding behind it
    const more = !row.classList.contains('editing') && row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    row.classList.toggle('can-scroll', more);
    const rightEdge = box.right - (more ? 28 : 0);
    const allEl = row.classList.contains('editing') ? null : row.querySelector('.chip[data-sys="All"]');
    const pin = allEl ? chipPin(row, allEl) : 0;
    row.style.scrollPaddingLeft = pin + 'px'; // chips snap to sit right beside All
    const leftEdge = box.left + pin; // the pinned All covers the left of the row
    row.querySelectorAll('.chip').forEach(c => {
      if(c === allEl){ c.style.visibility = ''; return; }
      const r = c.getBoundingClientRect();
      const cut = r.right > rightEdge + 3 || r.left < leftEdge - 3;
      const keep = c.classList.contains('active') || c.classList.contains('pad-focus') // never hide the one you are on
        || (c === row.querySelectorAll('.chip')[row.querySelectorAll('.chip').length - 1] && row.scrollLeft >= row.scrollWidth - row.clientWidth - 2); // the last one, once scrolled all the way
      c.style.visibility = cut && !keep ? 'hidden' : '';
    });
  }
  const soon = () => { if(!queued){ queued = true; requestAnimationFrame(apply); } };
  row.addEventListener('scroll', soon, { passive: true });
  window.addEventListener('resize', soon);
  new MutationObserver(soon).observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  soon();
})();
