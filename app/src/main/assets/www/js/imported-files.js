// Storage for files imported per game: guides and base ROMs.

// Game guides, imported manually (see the Game Guide panel for why). One key per game
// holds an array of guides. A key saved before that held a single object, which is
// read back as a one-item list.
function guideKey(gameId){
  return `guide:${creds.username.trim().toLowerCase()}:${gameId}`;
}
async function loadGuides(gameId){
  try{
    const r = await window.storage.get(guideKey(gameId), false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      let list = null;
      if(Array.isArray(parsed)) list = parsed;
      else if(parsed && typeof parsed === 'object') list = [parsed]; // pre-multi-guide format
      if(list){
        // Guides saved before the multi-guide change have no id, which made
        // Read/Remove silently do nothing. Give each one a stable id on load
        // (it gets written back the next time the list is saved).
        list.forEach((g, i) => { if(g && !g.id) g.id = 'legacy-' + i; });
        return list.filter(g => g && typeof g === 'object');
      }
    }
  }catch(e){ /* none imported yet */ }
  return [];
}
async function saveGuides(gameId, guides){
  try{ await window.storage.set(guideKey(gameId), JSON.stringify(guides), false); }
  catch(e){ /* non-fatal */ }
}
// Adds a newly downloaded/pasted/imported guide, giving it a stable id so
// a specific guide, not just "whichever one is saved", can later be
// read, updated (scroll position, bookmarks), or removed on its own.
async function addGuide(gameId, guide){
  guide.id = guide.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const guides = await loadGuides(gameId);
  guides.push(guide);
  await saveGuides(gameId, guides);
  return guide;
}
// Re-saves one guide's own fields (scroll position, bookmarks) in place, without touching the others.
async function updateGuide(gameId, guide){
  const guides = await loadGuides(gameId);
  const idx = guides.findIndex(g => g.id === guide.id);
  if(idx === -1) guides.push(guide); else guides[idx] = guide;
  await saveGuides(gameId, guides);
}
async function renameGuide(gameId, guideId, newName){
  const guides = await loadGuides(gameId);
  const g = guides.find(x => x.id === guideId);
  if(g){ g.filename = newName; await saveGuides(gameId, guides); }
  return guides;
}
async function deleteGuide(gameId, guideId){
  const guides = (await loadGuides(gameId)).filter(g => g.id !== guideId);
  await saveGuides(gameId, guides);
  return guides;
}
function readFileAsText(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    r.readAsText(file);
  });
}
function readFileAsDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}
// Strips anything that could execute when an imported HTML guide is later
// rendered, <script> tags, inline event handlers, javascript: URLs. This
// runs on every HTML import regardless of source, since a guide file is
// just an arbitrary file the person picked off their device.
function sanitizeGuideHtml(rawHtml){
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  doc.querySelectorAll('script,style,link,meta,iframe,frame,frameset,object,embed,applet,form,base').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const n = attr.name.toLowerCase();
      // Author colours/backgrounds assume a white page; on the reader's
      // black background they render text invisible.
      if(n === 'style' || n === 'color' || n === 'bgcolor' || n === 'text' || n === 'background') el.removeAttribute(attr.name);
      if(n.startsWith('on')) el.removeAttribute(attr.name);
      if(n === 'srcdoc' || n === 'formaction') el.removeAttribute(attr.name);
      if((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*(javascript|vbscript):/i.test(attr.value)) el.removeAttribute(attr.name);
      if(n === 'href' && /^\s*data:/i.test(attr.value)) el.removeAttribute(attr.name);
    });
  });
  return doc.body ? doc.body.innerHTML : rawHtml;
}
async function importGuideFile(gameId, file){
  const name = file.name || 'guide';
  const ext = (name.split('.').pop() || '').toLowerCase();
  let kind, content;
  if(ext === 'pdf'){
    kind = 'pdf';
    content = await readFileAsDataURL(file);
  }else if(ext === 'html' || ext === 'htm'){
    kind = 'html';
    content = sanitizeGuideHtml(await readFileAsText(file));
  }else{
    // .txt, .md, or anything unrecognized, plain text is the safest
    // default, and matches how GameFAQs guides are almost always shared
    kind = 'text';
    content = await readFileAsText(file);
  }
  const guide = { filename: name, kind, content, scrollFrac: 0, savedAt: Date.now() };
  await addGuide(gameId, guide);
  return guide;
}

// Saved base ROMs (used by the ROM patcher)
// Stored as a raw { filename, bytes: Uint8Array } via structured clone,
// deliberately not JSON-stringified like everything else here, since
// base64-encoding a multi-megabyte ROM would bloat it by another third
// for no reason. IndexedDB stores typed arrays natively.
function romKey(gameId){
  return `rom:${creds.username.trim().toLowerCase()}:${gameId}`;
}
async function saveRom(gameId, filename, bytes){
  await window.storage.set(romKey(gameId), { filename, bytes }, false);
}
async function loadRom(gameId){
  try{
    const r = await window.storage.get(romKey(gameId), false);
    if(r && r.value) return r.value; // { filename, bytes }
  }catch(e){ /* none saved */ }
  return null;
}
async function deleteRom(gameId){
  try{ await window.storage.delete(romKey(gameId), false); }catch(e){}
}
