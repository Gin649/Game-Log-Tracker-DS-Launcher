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
(function clipChips(){
  const row = document.getElementById('system-chips');
  if(!row) return;
  let queued = false;
  let lastActive = null;
  function apply(){
    queued = false;
    const box = row.getBoundingClientRect();
    if(!box.width) return;
    // The console you are on is always kept in view: when it changes, the row scrolls to centre it.
    const active = row.querySelector('.chip.active');
    const key = active ? active.textContent : null;
    if(active && key !== lastActive && row.classList.contains('visible')){
      const max = Math.max(0, row.scrollWidth - row.clientWidth);
      row.scrollLeft = Math.min(max, Math.max(0, active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2));
    }
    lastActive = key;
    row.querySelectorAll('.chip').forEach(c => {
      const r = c.getBoundingClientRect();
      const cut = r.right > box.right + 1 || r.left < box.left - 1;
      const keep = c.classList.contains('active') || c.classList.contains('pad-focus'); // never hide the one you are on
      c.style.visibility = cut && !keep ? 'hidden' : '';
    });
  }
  const soon = () => { if(!queued){ queued = true; requestAnimationFrame(apply); } };
  row.addEventListener('scroll', soon, { passive: true });
  window.addEventListener('resize', soon);
  new MutationObserver(soon).observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  soon();
})();
