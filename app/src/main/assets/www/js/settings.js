// Settings modals: RAWG key, Data export/import, About.

// Settings modals & data export/import
// RAWG settings modal
async function openRawgModal(){
  $('#rawg-backdrop').classList.add('open');
  $('#rawg-status').innerHTML = '';
  const existing = await loadRawgCreds();
  $('#rawg-api-key').value = existing ? existing.apiKey : '';
}

function closeRawgModal(){
  $('#rawg-backdrop').classList.remove('open');
}

// Data export/import
function openDataModal(){
  $('#data-backdrop').classList.add('open');
  $('#data-status').innerHTML = '';
}
function closeDataModal(){
  $('#data-backdrop').classList.remove('open');
}

// About
// Bump this every release, together with CACHE_NAME in sw.js.
const APP_VERSION = '2.1.2.2';
function openAboutModal(){
  $('#about-version').textContent = APP_VERSION;
  $('#about-backdrop').classList.add('open');
}
function closeAboutModal(){
  $('#about-backdrop').classList.remove('open');
}

async function exportLocalData(){
  const entries = await window.storage._getAllRaw(); // [{key, value}, ...], includes RA creds, RAWG key, manual games, caches
  const payload = {
    app: 'Game Log Tracker',
    exportedAt: new Date().toISOString(),
    version: 1,
    entries,
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
  const text = await file.text();
  let payload;
  try{ payload = JSON.parse(text); }
  catch(e){ throw new Error('That file isn\'t valid JSON.'); }
  if(!payload || !Array.isArray(payload.entries)){
    throw new Error('This doesn\'t look like a Game Log Tracker backup file.');
  }
  await window.storage._putAllRaw(payload.entries);
}

$('#btn-rawg-settings').addEventListener('click', openRawgModal);
$('#rawg-close-btn').addEventListener('click', closeRawgModal);
$('#rawg-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'rawg-backdrop') closeRawgModal();
});

$('#btn-social-open').addEventListener('click', openSocialModal);
$('#social-close-btn').addEventListener('click', closeSocialModal);
$('#social-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'social-backdrop') closeSocialModal();
});
$('#btn-about-open').addEventListener('click', openAboutModal);
$('#about-close-btn').addEventListener('click', closeAboutModal);
$('#about-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'about-backdrop') closeAboutModal();
});

$('#btn-data-settings-open').addEventListener('click', openDataModal);
$('#data-close-btn').addEventListener('click', closeDataModal);
$('#data-backdrop').addEventListener('click', (e) => {
  if(e.target.id === 'data-backdrop') closeDataModal();
});
$('#data-export-btn').addEventListener('click', async () => {
  const btn = $('#data-export-btn');
  const statusEl = $('#data-status');
  statusEl.innerHTML = '';
  btn.disabled = true; btn.textContent = 'Preparing download…';
  try{
    await exportLocalData();
    statusEl.innerHTML = '<p style="color:var(--teal);font-size:0.7812rem;margin-top:10px;">Backup downloaded.</p>';
  }catch(e){
    statusEl.innerHTML = `<div class="error-box">Export failed: ${e.message}</div>`;
  }finally{
    btn.disabled = false; btn.textContent = 'Download backup (.json)';
  }
});
$('#data-import-btn').addEventListener('click', () => {
  $('#data-import-file').click();
});
$('#data-import-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const statusEl = $('#data-status');
  statusEl.innerHTML = '<p style="color:var(--muted);font-size:0.7812rem;margin-top:10px;">Importing…</p>';
  try{
    await importLocalData(file);
    statusEl.innerHTML = '<p style="color:var(--teal);font-size:0.7812rem;margin-top:10px;">Import complete — reloading…</p>';
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
    // No token exchange to verify against, run a real lookup instead.
    const result = await fetchRawgRatingLive('Super Mario Bros');
    if(!result) throw new Error('Key saved, but a test lookup came back empty — double-check the key is correct');
    statusEl.innerHTML = '<p style="color:var(--teal);font-size:0.7812rem;margin-top:10px;">Connected — ratings will show on game details from now on.</p>';
  }catch(e){
    statusEl.innerHTML = `<div class="error-box">Couldn't verify: ${e.message}</div>`;
  }finally{
    btn.disabled = false; btn.textContent = 'Save';
  }
});

$('#rawg-remove-btn').addEventListener('click', async () => {
  await removeRawgCreds();
  $('#rawg-api-key').value = '';
  $('#rawg-status').innerHTML = '<p style="color:var(--muted);font-size:0.7812rem;margin-top:10px;">RAWG key removed — ratings will stop showing until a new key is saved.</p>';
});
