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

window.storage = {
  get: (key, shared) => idbRun('readonly', (st, res, rej) => idbRead(st.get(nsKey(key, shared)), res, rej, (r) => {
    if(!r) throw new Error('No value found for key: ' + key);
    return { key, value: r.value, shared: !!shared };
  })),
  set: (key, value, shared) => idbRun('readwrite', (st) => {
    st.put({ key: nsKey(key, shared), value });
    return { key, value, shared: !!shared };
  }),
  delete: (key, shared) => idbRun('readwrite', (st) => {
    st.delete(nsKey(key, shared));
    return { key, deleted: true, shared: !!shared };
  }),
  list: (prefix, shared) => idbRun('readonly', (st, res, rej) => {
    const p = nsKey(prefix || '', shared);
    const cut = nsKey('', shared).length;
    idbRead(st.getAllKeys(), res, rej, (keys) => ({
      keys: keys.filter(k => String(k).startsWith(p)).map(k => k.slice(cut)),
      prefix, shared: !!shared,
    }));
  }),
  // Whole-store access for Data export / import.
  _getAllRaw: () => idbRun('readonly', (st, res, rej) => idbRead(st.getAll(), res, rej, (r) => r || [])),
  _putAllRaw: (entries) => idbRun('readwrite', (st) => { entries.forEach(e => st.put(e)); }),
};

// Ask the WebView not to evict the data when space runs low.
if(navigator.storage && navigator.storage.persist){
  navigator.storage.persisted().then(already => { if(!already) navigator.storage.persist(); });
}
