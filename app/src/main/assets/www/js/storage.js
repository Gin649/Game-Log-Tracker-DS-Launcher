// Key/value storage on top of IndexedDB. Keys are namespaced "priv:" or "shared:".
const IDB_STORE = 'kv';
const nsKey = (key, shared) => (shared ? 'shared:' : 'priv:') + key;

let idbOpenPromise = null;
function openIdb(){
  if(!idbOpenPromise){
    idbOpenPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('GLTFrontendDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return idbOpenPromise;
}

// Runs one request (or a batch of writes) in a transaction and resolves with fn's result.
async function idbRun(mode, fn){
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const out = fn(tx.objectStore(IDB_STORE), resolve, reject);
    if(mode === 'readwrite'){
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    }
  });
}
function idbRead(req, resolve, reject, map){
  req.onsuccess = () => { try{ resolve(map(req.result)); }catch(e){ reject(e); } };
  req.onerror = () => reject(req.error);
}

// Inside the app, text values are kept as files in the app's data folder (ThorBridge.data*), so they survive
// an uninstall and live where you chose in the setup wizard. Anything else (a remembered ROM is binary), and
// anything the files can't take, stays in IndexedDB.
const fileStore = (window.ThorBridge && typeof window.ThorBridge.dataChunks === 'function') ? window.ThorBridge : null;
const FILE_PIECE = 512 * 1024;

function fileGet(name){
  const n = fileStore.dataChunks(name);
  if(n < 0) return null;
  let out = '';
  for(let i = 0; i < n; i++){
    const piece = fileStore.dataChunk(name, i);
    if(piece == null) return null;
    out += piece;
  }
  return out;
}
function filePut(name, value){
  let i = 0, at = 0;
  do{
    let end = Math.min(value.length, at + FILE_PIECE);
    // never split a surrogate pair across two pieces
    if(end < value.length){
      const c = value.charCodeAt(end - 1);
      if(c >= 0xD800 && c <= 0xDBFF) end--;
    }
    const last = end >= value.length;
    if(!fileStore.dataPut(name, i++, value.slice(at, end), last)){
      fileStore.dataDelete(name);
      return false;
    }
    at = end;
  }while(at < value.length);
  return true;
}

const idbDelete = (name) => idbRun('readwrite', (st) => { st.delete(name); });

window.storage = {
  get: async (key, shared) => {
    const name = nsKey(key, shared);
    if(fileStore){
      let v = null;
      try{ v = fileGet(name); }catch(e){}
      if(v !== null) return { key, value: v, shared: !!shared };
    }
    return idbRun('readonly', (st, res, rej) => idbRead(st.get(name), res, rej, (r) => {
      if(!r) throw new Error('No value found for key: ' + key);
      return { key, value: r.value, shared: !!shared };
    }));
  },
  set: async (key, value, shared) => {
    const name = nsKey(key, shared);
    if(fileStore && typeof value === 'string'){
      let ok = false;
      try{ ok = filePut(name, value); }catch(e){}
      if(ok) return { key, value, shared: !!shared };
    }
    if(fileStore){ try{ fileStore.dataDelete(name); }catch(e){} } // so an older file can't hide this value
    return idbRun('readwrite', (st) => {
      st.put({ key: name, value });
      return { key, value, shared: !!shared };
    });
  },
  delete: async (key, shared) => {
    const name = nsKey(key, shared);
    if(fileStore){ try{ fileStore.dataDelete(name); }catch(e){} }
    await idbDelete(name);
    return { key, deleted: true, shared: !!shared };
  },
  list: async (prefix, shared) => {
    const p = nsKey(prefix || '', shared);
    const cut = nsKey('', shared).length;
    const keys = new Set();
    if(fileStore){
      try{ JSON.parse(fileStore.dataList(p)).forEach(k => keys.add(k)); }catch(e){}
    }
    const idbKeys = await idbRun('readonly', (st, res, rej) => idbRead(st.getAllKeys(), res, rej, (k) => k));
    idbKeys.forEach(k => { if(String(k).startsWith(p)) keys.add(k); });
    return { keys: [...keys].map(k => k.slice(cut)), prefix, shared: !!shared };
  },
  // Whole-store access for Data export / import.
  _getAllRaw: async () => {
    const rows = await idbRun('readonly', (st, res, rej) => idbRead(st.getAll(), res, rej, (r) => r || []));
    if(!fileStore) return rows;
    const byKey = new Map(rows.map(r => [r.key, r]));
    try{
      JSON.parse(fileStore.dataList('')).forEach(name => {
        const v = fileGet(name);
        if(v !== null) byKey.set(name, { key: name, value: v });
      });
    }catch(e){}
    return [...byKey.values()];
  },
  _putAllRaw: async (entries) => {
    const rest = [];
    entries.forEach(e => {
      let ok = false;
      if(fileStore && typeof e.value === 'string'){ try{ ok = filePut(e.key, e.value); }catch(err){} }
      if(!ok) rest.push(e);
    });
    if(rest.length) await idbRun('readwrite', (st) => { rest.forEach(e => st.put(e)); });
  },
};

// Ask the WebView not to evict the data when space runs low.
if(navigator.storage && navigator.storage.persist){
  navigator.storage.persisted().then(already => { if(!already) navigator.storage.persist(); });
}
