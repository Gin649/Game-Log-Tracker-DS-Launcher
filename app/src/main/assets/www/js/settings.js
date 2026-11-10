// Settings modals: Data export / import, About.

function openDataModal(){
  $('#data-backdrop').classList.add('open');
  $('#data-status').innerHTML = '';
}
function closeDataModal(){
  $('#data-backdrop').classList.remove('open');
}

const APP_VERSION = '2.1.2.3'; // the web app's version; the About box shows the APK's
function openAboutModal(){
  let shown = APP_VERSION;
  try{ if(thorBridge && thorBridge.appVersion) shown = thorBridge.appVersion() || shown; }catch(e){}
  $('#about-version').textContent = shown;
  $('#about-backdrop').classList.add('open');
}
function closeAboutModal(){
  $('#about-backdrop').classList.remove('open');
}

// Cached RA data is fetched again when needed, so backups leave it out.
// (ra-snap: is not one of them: the playtime at the moment a game was beaten can't be fetched again.)
const REBUILDABLE_CACHE_PREFIXES = ['ra-hours:', 'ra-gameinfo:', 'ra-ach:', 'ra-dash:', 'boxcand:',
  'ra-gamelist:', 'ra-gamelist-h:', 'ra-gamelist-all:', 'ra-consoles-supported', 'ss-info2:', 'rawg-desc:', 'rating-avg:',
  'rating-igdb:', 'guide-archive-index:', 'rapatches-tree-cache-v4', 'social-cache:', 'ports-catalog:'];
// A base ROM remembered for the ROM patcher is raw bytes, which a JSON file can't hold. It is left out of backups and
// picked again when needed.
const isRememberedRom = (rawKey) => /^(priv|shared):rom:/.test(rawKey);
function isRebuildableCache(rawKey){
  return REBUILDABLE_CACHE_PREFIXES.some(p => rawKey.startsWith('priv:' + p) || rawKey.startsWith('shared:' + p));
}

async function exportLocalData(){
  const all = await window.storage._getAllRaw();
  const payload = {
    app: 'Game Log Tracker',
    exportedAt: new Date().toISOString(),
    version: 1,
    // the saved login (RetroAchievements) is never written into a backup file
    entries: all.filter(e => !isRebuildableCache(String(e.key)) && !isRememberedRom(String(e.key))
      && !/^(priv|shared):(ra|rawg)-credentials$/.test(String(e.key))),
  };
  // the time counted on this device for games RetroAchievements doesn't track lives in the app, not in storage
  try{
    if(thorBridge && typeof thorBridge.playtimeExport === 'function') payload.devicePlaytime = JSON.parse(thorBridge.playtimeExport());
  }catch(e){}
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-log-tracker-backup-${playLogToday()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importLocalData(file){
  let payload;
  try{ payload = JSON.parse(await file.text()); }
  catch(e){ throw new Error('That file isn\'t valid JSON.'); }
  if(!payload || !Array.isArray(payload.entries)) throw new Error('This doesn\'t look like a Game Log Tracker backup file.');
  // older backups wrote remembered ROMs out in a form that can't be read back; never put those over a working one
  let entries = payload.entries.filter(e => e && !isRememberedRom(String(e.key)));
  if(keyBridge()){
    // inside the app the keys go to its private settings, not back into storage
    const kept = entries;
    entries = [];
    for(const e of kept){
      try{
        if(e.key === 'priv:ra-credentials'){ const o = JSON.parse(e.value); if(o.username && o.apiKey) await saveCreds(o.username, o.apiKey); continue; }
        if(e.key === 'priv:rawg-credentials') continue; // RAWG isn't used any more
      }catch(err){ continue; }
      entries.push(e);
    }
  }
  await window.storage._putAllRaw(entries);
  try{
    if(payload.devicePlaytime && thorBridge && typeof thorBridge.playtimeImport === 'function') thorBridge.playtimeImport(JSON.stringify(payload.devicePlaytime));
  }catch(e){}
}

// Opener button, close button, and a tap on the backdrop.
function wireModal(openSel, closeSel, backdropId, open, close){
  $(openSel).addEventListener('click', open);
  $(closeSel).addEventListener('click', close);
  $('#' + backdropId).addEventListener('click', (e) => { if(e.target.id === backdropId) close(); });
}
wireModal('#btn-social-open', '#social-close-btn', 'social-backdrop', openSocialModal, closeSocialModal);
wireModal('#btn-about-open', '#about-close-btn', 'about-backdrop', openAboutModal, closeAboutModal);
wireModal('#btn-data-settings-open', '#data-close-btn', 'data-backdrop', openDataModal, closeDataModal);

const statusLine = (text, color) => `<p style="color:var(${color});font-size:0.7812rem;margin-top:10px;">${text}</p>`;

$('#data-export-btn').addEventListener('click', async () => {
  const btn = $('#data-export-btn');
  const statusEl = $('#data-status');
  statusEl.innerHTML = '';
  btn.disabled = true; btn.textContent = 'Preparing download…';
  try{
    await exportLocalData();
    statusEl.innerHTML = statusLine('Backup downloaded.', '--teal');
  }catch(e){
    statusEl.innerHTML = `<div class="error-box">Export failed: ${e.message}</div>`;
  }finally{
    btn.disabled = false; btn.textContent = 'Download backup (.json)';
  }
});
$('#data-import-btn').addEventListener('click', () => $('#data-import-file').click());
$('#data-import-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const statusEl = $('#data-status');
  statusEl.innerHTML = statusLine('Importing…', '--muted');
  try{
    await importLocalData(file);
    statusEl.innerHTML = statusLine('Import complete. Reloading…', '--teal');
    setTimeout(() => window.location.reload(), 900);
  }catch(err){
    statusEl.innerHTML = `<div class="error-box">Import failed: ${err.message}</div>`;
  }finally{
    e.target.value = '';
  }
});
