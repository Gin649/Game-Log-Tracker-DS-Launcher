// Settings modals: Data export / import, About.

function openDataModal(){
  $('#data-backdrop').classList.add('open');
  $('#data-status').innerHTML = '';
  renderDeviceBackups();
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
const REBUILDABLE_CACHE_PREFIXES = ['ra-hours:', 'ra-gameinfo:', 'ra-ach:', 'ra-dash:', 'boxcand:', 'boxcand2:',
  'ra-gamelist:', 'ra-gamelist-h:', 'ra-gamelist-all:', 'ra-consoles-supported', 'ss-info2:', 'ss-info3:', 'rawg-desc:', 'rating-avg:',
  'rating-igdb:', 'igdb-info2:', 'ra-playtime-stats:', 'guide-archive-index:', 'rapatches-tree-cache-v4', 'social-cache:', 'ports-catalog:', 'backlog-points'];
// A base ROM remembered for the ROM patcher is raw bytes, which a JSON file can't hold. It is left out of backups and
// picked again when needed.
const isRememberedRom = (rawKey) => /^(priv|shared):rom:/.test(rawKey);
function isRebuildableCache(rawKey){
  return REBUILDABLE_CACHE_PREFIXES.some(p => rawKey.startsWith('priv:' + p) || rawKey.startsWith('shared:' + p));
}

// Everything a backup holds. Inside the launcher it also carries the launcher's own settings (ROM folders, emulator
// picks, your launch commands, play counts and picked art), never its logins or keys.
async function buildBackupPayload(){
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
  try{
    if(thorBridge && typeof thorBridge.appBackupExport === 'function') payload.appSettings = JSON.parse(thorBridge.appBackupExport());
  }catch(e){}
  return payload;
}

async function exportLocalData(){
  const payload = await buildBackupPayload();
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
  return importPayload(payload);
}

// Puts a backup back. Returns what the launcher said about its own settings, or null outside the launcher.
async function importPayload(payload){
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
  let launcher = null;
  try{
    if(payload.appSettings && thorBridge && typeof thorBridge.appBackupImport === 'function'){
      launcher = JSON.parse(thorBridge.appBackupImport(JSON.stringify(payload.appSettings)));
    }
  }catch(e){}
  return launcher;
}

// What to say once a restore is done, and how long to leave it up before the page reloads.
function restoreDoneNote(launcher){
  const regrant = launcher && Array.isArray(launcher.regrant) ? launcher.regrant : [];
  if(launcher && launcher.ok === false) return { text: 'Your data is back, but ' + launcher.message, wait: 5000, color: '--gold' };
  if(launcher && launcher.otherDevice){
    return { text: 'Restored. The backup came from another device, so your ROM folders here were left as they are. Check them in Launcher settings.',
      wait: 6000, color: '--gold' };
  }
  if(regrant.length){
    return { text: 'Restored. On this install, pick these ROM folders again in Launcher settings so emulators can open their games: '
      + regrant.join(', '), wait: 6000, color: '--gold' };
  }
  return { text: 'Restored. Reloading…', wait: 900, color: '--teal' };
}

// Backup files kept on the device, in the app's data folder (only inside the launcher).
const hasDeviceBackups = () => typeof thorBridge !== 'undefined' && thorBridge && typeof thorBridge.backupBegin === 'function';

async function saveBackupToDevice(kind){
  const text = JSON.stringify(await buildBackupPayload());
  const id = thorBridge.backupBegin(kind);
  if(!id) throw new Error('The backup folder can\'t be written to. Check the app has file access.');
  const piece = 256 * 1024;
  for(let i = 0; i < text.length; i += piece){
    if(!thorBridge.backupPut(id, text.slice(i, i + piece))) throw new Error('Writing the backup failed.');
  }
  const res = JSON.parse(thorBridge.backupEnd(id));
  if(!res.ok) throw new Error(res.message || 'The backup could not be saved.');
  return res;
}

function readDeviceBackup(path){
  const n = thorBridge.backupChunks(path);
  if(n < 0) throw new Error('That backup can\'t be read.');
  let text = '';
  for(let i = 0; i < n; i++) text += thorBridge.backupGet(path, i);
  try{ return JSON.parse(text); }
  catch(e){ throw new Error('That backup file is damaged.'); }
}

function renderDeviceBackups(){
  const field = $('#thor-backup-field');
  if(!field) return;
  if(!hasDeviceBackups()){ field.style.display = 'none'; return; }
  field.style.display = '';
  const box = $('#data-backup-list');
  let list = [];
  try{ list = JSON.parse(thorBridge.backupList()) || []; }catch(e){}
  try{
    const where = thorBridge.backupFolder();
    if(where) $('#data-backup-where').textContent = 'Kept in ' + where + '.';
  }catch(e){}
  if(!list.length){ box.innerHTML = '<div class="hint">No backups on this device yet.</div>'; return; }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kinds = { auto: 'Automatic', manual: 'Made by you', 'before-restore': 'Before a restore' };
  const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  box.innerHTML = list.map((b, i) =>
    '<div class="backup-row" style="display:flex;align-items:center;gap:8px;margin-top:8px;">' +
      '<div style="flex:1;min-width:0;"><div>' + esc(new Date(b.time).toLocaleString()) + '</div>' +
      '<div class="hint" style="margin:0;">' + esc(kinds[b.kind] || '') + ' · ' + size(b.size) + '</div></div>' +
      '<button class="btn-line gold" data-restore="' + i + '" type="button">Restore</button>' +
      (b.kind === 'manual' ? '<button class="btn-line" data-delete="' + i + '" type="button">Delete</button>' : '') +
    '</div>').join('');
  box.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', () => askRestore(list[+btn.dataset.restore])));
  box.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => {
    const b = list[+btn.dataset.delete];
    const del = () => { try{ thorBridge.backupDelete(b.path); }catch(e){} renderDeviceBackups(); };
    if(typeof thorChoice === 'function') thorChoice('Delete this backup?', 'Made ' + new Date(b.time).toLocaleString() + '.', [['Delete', del]]);
    else del();
  }));
}

function askRestore(b){
  const go = async () => {
    const statusEl = $('#data-status');
    try{
      statusEl.innerHTML = statusLine('Backing up what is here now…', '--muted');
      await saveBackupToDevice('before-restore'); // so a restore can be undone with the backup it leaves
      statusEl.innerHTML = statusLine('Restoring…', '--muted');
      const launcher = await importPayload(readDeviceBackup(b.path));
      const note = restoreDoneNote(launcher);
      statusEl.innerHTML = statusLine(note.text, note.color);
      setTimeout(() => window.location.reload(), note.wait);
    }catch(err){
      statusEl.innerHTML = `<div class="error-box">Restore failed: ${err.message}</div>`;
    }
  };
  const when = new Date(b.time).toLocaleString();
  if(typeof thorChoice === 'function'){
    thorChoice('Restore this backup?', 'From ' + when + '. What is on this device now is backed up first, so you can go back to it.', [['Restore', go]]);
  }else{
    go();
  }
}

// One automatic backup a day, made a little after the app opens so it never slows the start.
setTimeout(() => {
  try{
    if(hasDeviceBackups() && thorBridge.backupDue()) saveBackupToDevice('auto').catch(() => {});
  }catch(e){}
}, 45000);

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
$('#data-backup-now-btn').addEventListener('click', async () => {
  const btn = $('#data-backup-now-btn');
  const statusEl = $('#data-status');
  statusEl.innerHTML = '';
  btn.disabled = true; btn.textContent = 'Backing up…';
  try{
    await saveBackupToDevice('manual');
    statusEl.innerHTML = statusLine('Backup saved on this device.', '--teal');
    renderDeviceBackups();
  }catch(e){
    statusEl.innerHTML = `<div class="error-box">Backup failed: ${e.message}</div>`;
  }finally{
    btn.disabled = false; btn.textContent = 'Back up now';
  }
});
$('#data-import-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const statusEl = $('#data-status');
  statusEl.innerHTML = statusLine('Importing…', '--muted');
  try{
    const launcher = await importLocalData(file);
    const note = restoreDoneNote(launcher);
    statusEl.innerHTML = statusLine(note.text === 'Restored. Reloading…' ? 'Import complete. Reloading…' : note.text, note.color);
    setTimeout(() => window.location.reload(), note.wait);
  }catch(err){
    statusEl.innerHTML = `<div class="error-box">Import failed: ${err.message}</div>`;
  }finally{
    e.target.value = '';
  }
});
