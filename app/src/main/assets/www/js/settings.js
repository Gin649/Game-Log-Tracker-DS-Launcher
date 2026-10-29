// Settings modals: RAWG key, Data export / import, About.

async function openRawgModal(){
  $('#rawg-backdrop').classList.add('open');
  $('#rawg-status').innerHTML = '';
  const existing = await loadRawgCreds();
  $('#rawg-api-key').value = existing ? existing.apiKey : '';
}
function closeRawgModal(){
  $('#rawg-backdrop').classList.remove('open');
}

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
const REBUILDABLE_CACHE_PREFIXES = ['ra-hours:', 'ra-gameinfo:', 'ra-ach:', 'ra-dash:'];
function isRebuildableCache(rawKey){
  return REBUILDABLE_CACHE_PREFIXES.some(p => rawKey.startsWith('priv:' + p) || rawKey.startsWith('shared:' + p));
}

async function exportLocalData(){
  const all = await window.storage._getAllRaw();
  const payload = {
    app: 'Game Log Tracker',
    exportedAt: new Date().toISOString(),
    version: 1,
    entries: all.filter(e => !isRebuildableCache(String(e.key))),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-log-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
  await window.storage._putAllRaw(payload.entries);
}

// Opener button, close button, and a tap on the backdrop.
function wireModal(openSel, closeSel, backdropId, open, close){
  $(openSel).addEventListener('click', open);
  $(closeSel).addEventListener('click', close);
  $('#' + backdropId).addEventListener('click', (e) => { if(e.target.id === backdropId) close(); });
}
// The RAWG window is still opened from a game's rating link; its key is set in Launcher settings.
$('#rawg-close-btn').addEventListener('click', closeRawgModal);
$('#rawg-backdrop').addEventListener('click', (e) => { if(e.target.id === 'rawg-backdrop') closeRawgModal(); });
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

$('#rawg-save-btn').addEventListener('click', async () => {
  const apiKey = $('#rawg-api-key').value.trim();
  const statusEl = $('#rawg-status');
  if(!apiKey){
    statusEl.innerHTML = '<div class="error-box">Enter an API key.</div>';
    return;
  }
  const btn = $('#rawg-save-btn');
  btn.disabled = true; btn.textContent = 'Verifying…';
  statusEl.innerHTML = '';

  rawgCreds = { apiKey };
  await saveRawgCreds(apiKey);
  try{
    // RAWG has no key check, so try a real lookup.
    const result = await fetchRawgRatingLive('Super Mario Bros');
    if(!result) throw new Error('Key saved, but a test lookup came back empty. Check the key is right.');
    statusEl.innerHTML = statusLine('Connected. Ratings will show on game details from now on.', '--teal');
  }catch(e){
    statusEl.innerHTML = `<div class="error-box">Couldn't verify: ${e.message}</div>`;
  }finally{
    btn.disabled = false; btn.textContent = 'Save';
  }
});

$('#rawg-remove-btn').addEventListener('click', async () => {
  await removeRawgCreds();
  $('#rawg-api-key').value = '';
  $('#rawg-status').innerHTML = statusLine('RAWG key removed. Ratings stop showing until a new key is saved.', '--muted');
});
