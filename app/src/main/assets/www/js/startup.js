// Tabs and the boot sequence. Last of the app scripts; rom-patcher.js and guides.js come after.

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    const panel = $('#tab-' + tabName);
    if(!panel) return; // shouldn't happen, but never leave the UI in a half-switched state

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    panel.classList.add('active');
    activeTab = tabName;
    $('#system-chips').classList.toggle('visible', tabName === 'library' || tabName === 'year' || tabName === 'backlog');

    try{ renderSystemChips(); }
    catch(e){ console.error('renderSystemChips failed:', e); }
  });
});

// Restore RA credentials if previously connected, and show the dashboard right away.
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
