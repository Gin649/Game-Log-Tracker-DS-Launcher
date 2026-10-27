// On-device storage: a small key/value layer over IndexedDB, plus the request to make it persistent.

// Storage (IndexedDB)
// Everything lives on-device in IndexedDB. Requesting persistent storage asks the
// browser not to evict it when space runs low.
if(!window.storage){
  const IDB_NAME = 'GLTFrontendDB';
  const IDB_VERSION = 1;
  const IDB_STORE = 'kv';
  const nsKey = (key, shared) => (shared ? 'shared:' : 'priv:') + key;
  const stripNs = (key, shared) => key.slice((shared ? 'shared:' : 'priv:').length);

  let idbOpenPromise = null;
  function openIdb(){
    if(idbOpenPromise) return idbOpenPromise;
    idbOpenPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(IDB_STORE)){
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbOpenPromise;
  }

  window.storage = {
    get: async (key, shared) => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(nsKey(key, shared));
        req.onsuccess = () => {
          if(!req.result) reject(new Error('No value found for key: ' + key));
          else resolve({ key, value: req.result.value, shared: !!shared });
        };
        req.onerror = () => reject(req.error);
      });
    },
    set: async (key, value, shared) => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ key: nsKey(key, shared), value });
        tx.oncomplete = () => resolve({ key, value, shared: !!shared });
        tx.onerror = () => reject(tx.error);
      });
    },
    delete: async (key, shared) => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(nsKey(key, shared));
        tx.oncomplete = () => resolve({ key, deleted: true, shared: !!shared });
        tx.onerror = () => reject(tx.error);
      });
    },
    list: async (prefix, shared) => {
      const db = await openIdb();
      const p = nsKey(prefix || '', shared);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = () => {
          const keys = req.result.filter(k => String(k).startsWith(p)).map(k => stripNs(k, shared));
          resolve({ keys, prefix, shared: !!shared });
        };
        req.onerror = () => reject(req.error);
      });
    },
    // Not part of the standard interface, used only by the Data export/
    // import feature to work with the whole store at once.
    _getAllRaw: async () => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    _putAllRaw: async (rawEntries) => {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        rawEntries.forEach(entry => tx.objectStore(IDB_STORE).put(entry));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

if(navigator.storage && navigator.storage.persist){
  navigator.storage.persisted().then(already => {
    if(!already) navigator.storage.persist().then(granted => {
      console.log('Persistent storage request:', granted ? 'granted' : 'declined by browser');
    });
  });
}
