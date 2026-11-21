// Cloud sync: keeps the launcher the same on every device signed in to the same Google account.
// The copy lives in a hidden folder in the person's own Google Drive that only this app can see (CloudSync.java).
// It holds the same data as a backup, minus things that belong to one device: logins and keys (never in backups),
// cached data, the Apps tab, text size and button settings. ROM folders stay as they are when a copy from another
// device is put in, as with a restore.
//
// How it decides:
//   - only the cloud copy changed since the last sync: it is put in here (after a backup of this device), then a reload
//   - only this device changed: it is uploaded
//   - both changed: you choose which to keep, and a backup is made first either way
// "Changed" is worked out by comparing a fingerprint of the data with the one saved at the last sync.

const cloudBridge = () => (typeof thorBridge !== 'undefined' && thorBridge && typeof thorBridge.cloudMeta === 'function') ? thorBridge : null;

// Settings that belong to one device and are not synced.
const CLOUD_DEVICE_ONLY = ['apps-favs', 'apps-screen', 'app-apps-tile', 'app-text-size-pct', 'pad-swap-ab', 'device-status-on', 'patched-discs'];

function cloudSyncable(e){
  const key = String(e.key);
  if(CLOUD_DEVICE_ONLY.some(k => key === 'priv:' + k || key === 'shared:' + k)) return false;
  // saved lookups carry the time they were saved ("ts"); they are fetched again when needed
  if(typeof e.value === 'string' && e.value.charAt(0) === '{' && e.value.indexOf('"ts":') !== -1){
    try{ const o = JSON.parse(e.value); if(o && typeof o.ts === 'number') return false; }catch(err){}
  }
  return true;
}

async function cloudPayload(){
  const p = await buildBackupPayload();
  p.entries = p.entries.filter(cloudSyncable).sort((a, b) => String(a.key) < String(b.key) ? -1 : 1);
  delete p.exportedAt;
  if(p.appSettings) delete p.appSettings.device; // which device sent it is kept with the file instead
  return p;
}

async function cloudFingerprint(p){
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// The slow bridge calls answer through window.thorCloudDone.
const cloudWaiting = {};
let cloudNextId = 1;
window.thorCloudDone = (id, json) => {
  const done = cloudWaiting[id];
  delete cloudWaiting[id];
  let res;
  try{ res = JSON.parse(json); }catch(e){ res = { ok: false, message: 'Bad answer from the app.' }; }
  if(done) done(res);
};
function cloudCall(method, ...args){
  return new Promise(resolve => {
    const id = 'c' + (cloudNextId++);
    cloudWaiting[id] = resolve;
    try{ cloudBridge()[method](id, ...args); }
    catch(e){ delete cloudWaiting[id]; resolve({ ok: false, message: e.message }); }
  });
}

function cloudStatus(){
  try{ return JSON.parse(cloudBridge().cloudStatus()); }catch(e){ return { available: false, on: false }; }
}
function cloudState(){
  try{ return JSON.parse(cloudBridge().cloudState()) || {}; }catch(e){ return {}; }
}
function cloudSetState(s){
  try{ cloudBridge().cloudSetState(JSON.stringify(s)); }catch(e){}
}

let cloudBusy = false;
let cloudAsked = false;     // a "both changed" question was already put this session (no asking every few seconds)
let cloudLastNote = '';     // shown in Data Options

async function cloudUpload(payload, hash, fileId){
  const text = JSON.stringify(payload);
  const b = cloudBridge();
  b.cloudPutBegin();
  const piece = 256 * 1024;
  for(let i = 0; i < text.length; i += piece) b.cloudPut(text.slice(i, i + piece));
  const rev = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const res = await cloudCall('cloudPutEnd', fileId || '', rev);
  if(!res.ok) throw new Error(res.message || 'Upload failed.');
  cloudSetState({ rev, hash, at: Date.now() });
}

async function cloudDownload(fileId){
  const res = await cloudCall('cloudDownload', fileId);
  if(!res.ok) throw new Error(res.message || 'Download failed.');
  let text = '';
  for(let i = 0; i < res.chunks; i++) text += cloudBridge().cloudChunk(i);
  try{ return JSON.parse(text); }
  catch(e){ throw new Error('The cloud copy is damaged.'); }
}

// Puts the cloud copy in: a backup of this device first, then anything synced here that the copy no longer has is
// removed (so something deleted on the other device goes here too), then the copy goes in and the page reloads.
async function cloudApply(meta){
  // the safety backup is made while the cloud copy downloads, rather than one after the other
  const backup = typeof saveBackupToDevice === 'function' ? saveBackupToDevice('before-restore') : Promise.resolve();
  const remote = await cloudDownload(meta.fileId);
  await backup;
  if(!remote || !Array.isArray(remote.entries)) throw new Error('The cloud copy isn\'t a Game Log Tracker backup.');
  const keep = new Set(remote.entries.map(e => String(e.key)));
  const here = (await window.storage._getAllRaw()).filter(cloudSyncable);
  for(const e of here){
    const key = String(e.key);
    if(keep.has(key)) continue;
    const m = /^(priv|shared):(.*)$/.exec(key);
    if(!m || /^(ra|rawg)-credentials$/.test(m[2]) || /^rom:/.test(m[2])) continue;
    try{ await window.storage.delete(m[2], m[1] === 'shared'); }catch(err){}
  }
  await importPayload(remote);
  // the next start works out this device's fingerprint again (its own ROM folders etc. make it differ a little)
  cloudSetState({ rev: meta.rev, hash: '', rebase: true, at: Date.now() });
  // reload straight away; the note says where the copy came from once the page is back
  try{ sessionStorage.setItem('cloud-updated-from', meta.device || 'your other device'); }catch(e){}
  window.location.reload();
}

// The main step. "ask" says a "both changed" question may be put even if one was put already this session.
async function cloudSync(ask){
  const b = cloudBridge();
  if(!b || cloudBusy) return;
  const st = cloudStatus();
  if(!st.on) return;
  cloudBusy = true;
  try{
    let state = cloudState();
    const local = await cloudPayload();
    const hash = await cloudFingerprint(local);
    if(state.rebase){
      // just put in a cloud copy: what is here now counts as that copy
      state = { rev: state.rev, hash, at: state.at };
      cloudSetState(state);
    }
    const meta = await cloudCall('cloudMeta');
    if(!meta.ok){ cloudLastNote = meta.message || 'Sync failed.'; return; }

    const changedHere = hash !== state.hash;
    const changedThere = meta.exists && meta.rev !== state.rev;

    if(!meta.exists){
      await cloudUpload(local, hash, '');
      cloudLastNote = '';
    }else if(changedThere && !changedHere){
      await cloudApply(meta);
    }else if(changedThere && changedHere){
      if(cloudAsked && !ask) return;
      cloudAsked = true;
      cloudAskWhichToKeep(meta, local, hash, !state.rev);
    }else if(changedHere){
      await cloudUpload(local, hash, meta.fileId);
      cloudLastNote = '';
    }
  }catch(e){
    cloudLastNote = e.message || 'Sync failed.';
  }finally{
    cloudBusy = false;
    cloudRender();
  }
}

function cloudAskWhichToKeep(meta, local, hash, firstTime){
  const from = meta.device || 'another device';
  const when = meta.modified ? new Date(meta.modified).toLocaleString() : '';
  const title = firstTime ? 'There is already a cloud copy' : 'Your games changed on two devices';
  const sub = (firstTime
      ? 'Your Google account already has a copy, from ' + from + (when ? ' (' + when + ')' : '') + '.'
      : 'This device and ' + from + ' both changed since the last sync.')
    + ' Whichever you pick, what is on this device now is backed up first, so you can go back to it in Data Options.';
  const keepHere = async () => {
    try{
      if(typeof saveBackupToDevice === 'function') await saveBackupToDevice('before-restore');
      await cloudUpload(local, hash, meta.fileId);
      cloudLastNote = '';
      cloudToast('This device\'s copy is now in the cloud.');
    }catch(e){ cloudLastNote = e.message; }
    cloudRender();
  };
  const useCloud = async () => {
    try{ await cloudApply(meta); }
    catch(e){ cloudLastNote = e.message; cloudRender(); }
  };
  if(typeof thorChoice === 'function') thorChoice(title, sub, [['Use the cloud copy', useCloud], ['Keep this device\'s', keepHere]]);
}

function cloudToast(text){
  const old = document.getElementById('cloud-toast'); if(old) old.remove();
  const t = document.createElement('div');
  t.id = 'cloud-toast';
  t.className = 'cloud-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// When it runs: a second after the app opens, when it comes back on screen or goes off it, every 5 minutes while on
// screen, 3 seconds after anything is saved, and when a game closes (thor.js calls cloudSyncSoon).
let cloudSoonTimer = 0;
function cloudSyncSoon(delay){
  clearTimeout(cloudSoonTimer);
  cloudSoonTimer = setTimeout(() => cloudSync(false), delay == null ? 3000 : delay);
}
window.cloudSyncSoon = cloudSyncSoon;

if(cloudBridge()){
  try{
    const from = sessionStorage.getItem('cloud-updated-from');
    if(from){ sessionStorage.removeItem('cloud-updated-from'); setTimeout(() => cloudToast('Updated from ' + from + '.'), 300); }
  }catch(e){}
  setTimeout(() => cloudSync(false), 1000);
  document.addEventListener('visibilitychange', () => cloudSyncSoon(document.hidden ? 0 : 1500));
  setInterval(() => { if(!document.hidden) cloudSync(false); }, 5 * 60 * 1000);
  // anything saved schedules a sync, except saved lookups, which aren't synced
  const origSet = window.storage.set, origDelete = window.storage.delete;
  const worth = (key, value, shared) => {
    const raw = nsKey(key, shared);
    if(typeof isRebuildableCache === 'function' && isRebuildableCache(raw)) return false;
    return cloudSyncable({ key: raw, value });
  };
  window.storage.set = async function(key, value, shared){
    const r = await origSet.call(this, key, value, shared);
    if(cloudStatusOn() && worth(key, value, shared)) cloudSyncSoon();
    return r;
  };
  window.storage.delete = async function(key, shared){
    const r = await origDelete.call(this, key, shared);
    if(cloudStatusOn() && worth(key, '', shared)) cloudSyncSoon();
    return r;
  };
}
let cloudOnCache = null;
function cloudStatusOn(){
  if(cloudOnCache === null) cloudOnCache = !!cloudStatus().on;
  return cloudOnCache;
}

// Data Options section.
function cloudRender(){
  const field = document.getElementById('cloud-field');
  if(!field) return;
  const b = cloudBridge();
  const st = b ? cloudStatus() : { available: false };
  if(!st.available){ field.style.display = 'none'; return; }
  field.style.display = '';
  const box = document.getElementById('cloud-box');
  const e = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if(!st.on){
    box.innerHTML = '<button class="btn-primary" id="cloud-signin" type="button" style="width:100%;">Sign in with Google</button>'
      + (cloudLastNote ? '<p class="cloud-note bad">' + e(cloudLastNote) + '</p>' : '');
    document.getElementById('cloud-signin').addEventListener('click', cloudSignIn);
    return;
  }
  const s = cloudState();
  const last = s.at ? 'Last synced ' + new Date(s.at).toLocaleString() + '.' : 'Not synced yet.';
  box.innerHTML = '<div class="cloud-account">Signed in' + (st.email ? ' as <b>' + e(st.email) + '</b>' : '') + '</div>'
    + '<p class="cloud-note">' + e(last) + '</p>'
    + (cloudLastNote ? '<p class="cloud-note bad">' + e(cloudLastNote) + '</p>' : '')
    + '<div class="cloud-buttons">'
    + (cloudLastNote && /sign in/i.test(cloudLastNote) ? '<button class="btn-line gold" id="cloud-signin" type="button">Sign in again</button>' : '')
    + '<button class="btn-line gold" id="cloud-now" type="button">Sync now</button>'
    + '<button class="btn-line" id="cloud-off" type="button">Turn off</button></div>';
  const again = document.getElementById('cloud-signin');
  if(again) again.addEventListener('click', cloudSignIn);
  document.getElementById('cloud-now').addEventListener('click', async () => {
    cloudLastNote = '';
    const btn = document.getElementById('cloud-now');
    if(btn){ btn.disabled = true; btn.textContent = 'Syncing…'; }
    await cloudSync(true);
  });
  document.getElementById('cloud-off').addEventListener('click', () => {
    const off = async (deleteCopy) => {
      await cloudCall('cloudSignOut', !!deleteCopy);
      cloudOnCache = false;
      cloudLastNote = '';
      cloudRender();
    };
    if(typeof thorChoice === 'function'){
      thorChoice('Turn off cloud sync?', 'This device stops syncing. Your games here stay as they are.',
        [['Turn off, keep the cloud copy', () => off(false)], ['Turn off and delete the cloud copy', () => off(true)]]);
    }else off(false);
  });
}

async function cloudSignIn(){
  cloudLastNote = '';
  const res = await cloudCall('cloudSignIn');
  if(!res.ok){ cloudLastNote = res.message || 'Sign-in failed.'; cloudRender(); return; }
  cloudOnCache = true;
  cloudAsked = false;
  cloudRender();
  await cloudSync(true); // first sync: uploads, or asks if the account already has a copy
}

// Data Options opens: show the section as it is now.
(function(){
  const btn = document.getElementById('btn-data-settings-open');
  if(btn) btn.addEventListener('click', () => setTimeout(cloudRender, 0));
  cloudRender();
})();
