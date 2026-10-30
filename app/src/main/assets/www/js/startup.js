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
