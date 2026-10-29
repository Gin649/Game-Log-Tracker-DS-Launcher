// Storage for files imported per game: guides and base ROMs.

// Game guides: one key per game holds an array of guides (older saves held a single object).
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
      else if(parsed && typeof parsed === 'object') list = [parsed];
      if(list){
        // Older guides have no id; give them one (saved with the list next time).
        list.forEach((g, i) => { if(g && !g.id) g.id = 'legacy-' + i; });
        return list.filter(g => g && typeof g === 'object');
      }
    }
  }catch(e){}
  return [];
}
async function saveGuides(gameId, guides){
  try{ await window.storage.set(guideKey(gameId), JSON.stringify(guides), false); }catch(e){}
}
async function addGuide(gameId, guide){
  guide.id = guide.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const guides = await loadGuides(gameId);
  guides.push(guide);
  await saveGuides(gameId, guides);
  return guide;
}
// Saves one guide's fields (scroll position, bookmarks) in place.
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
// Removes anything in an imported HTML guide that could run code: scripts, event handlers, javascript: links.
function sanitizeGuideHtml(rawHtml){
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  doc.querySelectorAll('script,style,link,meta,iframe,frame,frameset,object,embed,applet,form,base').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const n = attr.name.toLowerCase();
      // The author's colours assume a white page and vanish on the dark reader.
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
    kind = 'text'; // .txt, .md and anything else
    content = await readFileAsText(file);
  }
  const guide = { filename: name, kind, content, scrollFrac: 0, savedAt: Date.now() };
  await addGuide(gameId, guide);
  return guide;
}

// Remembered base ROMs for the ROM patcher, stored as { filename, bytes } (IndexedDB keeps typed arrays as they are).
function romKey(gameId){
  return `rom:${creds.username.trim().toLowerCase()}:${gameId}`;
}
async function saveRom(gameId, filename, bytes){
  await window.storage.set(romKey(gameId), { filename, bytes }, false);
}
async function loadRom(gameId){
  try{
    const r = await window.storage.get(romKey(gameId), false);
    if(r && r.value) return r.value;
  }catch(e){}
  return null;
}
async function deleteRom(gameId){
  try{ await window.storage.delete(romKey(gameId), false); }catch(e){}
}
