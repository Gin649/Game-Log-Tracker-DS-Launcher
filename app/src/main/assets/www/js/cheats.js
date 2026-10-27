// "Need Cheats?" button. Finds the game's GameFAQs page through Wikidata.

// "Need Cheats?" opens the game's GameFAQs cheats page in a new tab (GameFAQs blocks
// in-app fetching). The page needs GameFAQs' numeric ID, looked up on Wikidata the
// first time and cached per game; any platform's ID works since the cheats are shared.
// No match falls back to a GameFAQs title search.
const CHEATS_URL = id => `https://gamefaqs.gamespot.com/-/${id}-/cheats`; // if this pattern doesn't reach the cheats page, fix it here only
const CHEATS_CACHE_V = 3; // bump to make every game re-run its lookup once
const WD_API = 'https://www.wikidata.org/w/api.php';
const WD_SPARQL = 'https://query.wikidata.org/sparql';
// RA console name (lowercase) -> Wikidata platform labels (lowercase) that count as a match.
// Consoles not listed here are matched on title only.
const WD_PLATFORMS = {
  'game boy': ['game boy'],
  'game boy color': ['game boy color'],
  'game boy advance': ['game boy advance'],
  'snes/super famicom': ['super nintendo entertainment system', 'super famicom', 'snes'],
  'nes/famicom': ['nintendo entertainment system', 'family computer', 'famicom', 'nes'],
  'genesis/mega drive': ['sega genesis', 'mega drive', 'sega mega drive', 'genesis'],
  'nintendo 64': ['nintendo 64'],
  'playstation': ['playstation'],
  'playstation 2': ['playstation 2'],
  'playstation portable': ['playstation portable'],
  'nintendo ds': ['nintendo ds'],
  'master system': ['sega master system', 'master system'],
  'game gear': ['game gear', 'sega game gear'],
  'sega cd': ['sega cd', 'mega-cd', 'sega mega-cd'],
  'saturn': ['sega saturn', 'saturn'],
  'dreamcast': ['dreamcast', 'sega dreamcast'],
  'pc engine/turbografx-16': ['turbografx-16', 'pc engine', 'turbografx-16/pc engine'],
  'atari 2600': ['atari 2600'],
  'atari 7800': ['atari 7800'],
  'atari lynx': ['atari lynx'],
  'virtual boy': ['virtual boy'],
  'neo geo pocket': ['neo geo pocket', 'neo geo pocket color'],
  'wonderswan': ['wonderswan', 'wonderswan color']
};

// RA titles carry tags and "X, The" ordering that Wikidata doesn't use.
function cheatsCleanTitle(t){
  let s = String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/~[^~]*~/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(.*?),\s*(the|a|an)\b(.*)$/i, '$2 $1$3');
  return s.replace(/\s+/g, ' ').trim();
}
// Publisher/brand possessives that some databases include and others drop.
function cheatsStripBrand(t){
  return String(t || '').replace(/^(?:walt\s+disney|disney|tom\s+clancy|sid\s+meier|marvel|clive\s+barker|nickelodeon)['’]?s\s+(?=\S)/i, '').trim();
}
function cheatsNormTitle(t){
  return foldText(cheatsStripBrand(cheatsCleanTitle(t))).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
// 2 = same title, 1 = one contains the other (without a sequel number/numeral tacked on), 0 = no match
function cheatsTitleScore(a, b){
  if(!a || !b) return 0;
  if(a === b) return 2;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if(short.length / long.length < 0.6 || !(' ' + long + ' ').includes(' ' + short + ' ')) return 0;
  const extra = (' ' + long + ' ').replace(' ' + short + ' ', ' ').trim().split(' ');
  if(extra.some(w => /^\d+$/.test(w) || /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(w))) return 0;
  return 1;
}
// cands: [{ qid, title, names[], itemPlats[], statements:[{ id, preferred, qplats[] }] }]
function pickWikidataMatch(title, consoleName, cands){
  const target = cheatsNormTitle(title);
  const accepted = WD_PLATFORMS[String(consoleName || '').trim().toLowerCase()] || null;
  let best = null;
  (cands || []).forEach(c => {
    let ts = 0;
    (c.names || []).forEach(n => { ts = Math.max(ts, cheatsTitleScore(target, cheatsNormTitle(n))); });
    if(!ts || !c.statements || !c.statements.length) return;
    const itemHasConsole = accepted && c.itemPlats.length ? c.itemPlats.some(p => accepted.includes(p)) : null;
    c.statements.forEach(s => {
      // true = ID is confirmed to be this console's version; false = wrong console;
      // null = can't tell (e.g. the game is on several platforms and Wikidata doesn't say which one this ID is for)
      let ok = null;
      if(accepted){
        if(s.qplats.length) ok = s.qplats.some(p => accepted.includes(p));
        else if(itemHasConsole === false) ok = false;
        else if(itemHasConsole === true && c.itemPlats.length === 1 && c.statements.length === 1) ok = true;
      }
      if(ok === false) return;
      const score = ts * 10 + (ok === true ? 5 : 0) + (s.preferred ? 1 : 0);
      if(!best || score > best.score) best = { score, id:s.id, qid:c.qid, title:c.title, platformOk:ok, ids:c.statements.map(x => x.id) };
    });
  });
  return best;
}
async function wdJson(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try{
    const r = await fetch(url, { signal: ctrl.signal });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }finally{ clearTimeout(timer); }
}
// Resolves to { found, id?, qid?, title?, platformOk?, at }. Throws on network/API errors
// (those are shown to the user and not cached).
async function lookupCheats(title, consoleName){
  if(/^\s*~/.test(title || '')) return { v:CHEATS_CACHE_V, found:false, reason:'hack', at:Date.now() };
  const search = cheatsCleanTitle(title);
  if(!search) return { v:CHEATS_CACHE_V, found:false, at:Date.now() };
  // Wikidata's search is prefix-based, so try the title as given, without a leading brand
  // ("Disney's Goof Troop" -> "Goof Troop"), and with "Disney's" added ("Goof Troop" -> "Disney's Goof Troop").
  const variants = [];
  const stripped = cheatsStripBrand(search);
  [search, stripped, /^disney/i.test(search) ? '' : `Disney's ${stripped}`, /pokemon/i.test(search) ? search.replace(/pokemon/gi, 'Pokémon') : ''].forEach(v => { if(v && !variants.includes(v)) variants.push(v); });
  const settled = await Promise.allSettled(variants.map(v =>
    wdJson(`${WD_API}?${new URLSearchParams({ action:'wbsearchentities', search:v, language:'en', uselang:'en', type:'item', limit:'20', format:'json', origin:'*' })}`)));
  if(settled.every(r => r.status === 'rejected')) throw settled[0].reason;
  const seen = {}, hits = [];
  settled.forEach(r => { if(r.status === 'fulfilled') (r.value.search || []).forEach(h => {
    if(/^Q\d+$/.test(h.id) && !seen[h.id]){ seen[h.id] = 1; hits.push(h); }
  }); });
  hits.length = Math.min(hits.length, 40);
  if(!hits.length) return { v:CHEATS_CACHE_V, found:false, at:Date.now() };
  const sparql = `SELECT ?item ?id ?rank ?qplatLabel ?platLabel WHERE {
      VALUES ?item { ${hits.map(h => 'wd:' + h.id).join(' ')} }
      ?item p:P4769 ?st . ?st ps:P4769 ?id . ?st wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank)
      OPTIONAL { ?st pq:P400 ?qplat . ?qplat rdfs:label ?qplatLabel . FILTER(LANG(?qplatLabel) = "en") }
      OPTIONAL { ?item wdt:P400 ?plat . ?plat rdfs:label ?platLabel . FILTER(LANG(?platLabel) = "en") }
    }`;
  const rows = await wdJson(`${WD_SPARQL}?${new URLSearchParams({ query:sparql, format:'json' })}`);
  const byQ = {};
  hits.forEach(h => {
    byQ[h.id] = { qid:h.id, title:h.label || h.id, names:[h.label, h.match && h.match.text].filter(Boolean), statements:{}, itemPlats:[] };
  });
  ((rows.results && rows.results.bindings) || []).forEach(b => {
    const c = byQ[b.item.value.split('/').pop()];
    if(!c) return;
    const st = c.statements[b.id.value] || (c.statements[b.id.value] = { id:b.id.value, preferred:false, qplats:[] });
    if(/PreferredRank$/.test(b.rank.value)) st.preferred = true;
    if(b.qplatLabel && !st.qplats.includes(b.qplatLabel.value.toLowerCase())) st.qplats.push(b.qplatLabel.value.toLowerCase());
    if(b.platLabel && !c.itemPlats.includes(b.platLabel.value.toLowerCase())) c.itemPlats.push(b.platLabel.value.toLowerCase());
  });
  const cands = Object.values(byQ).map(c => ({ ...c, statements: Object.values(c.statements) }));
  const m = pickWikidataMatch(title, consoleName, cands);
  return m && /^\d+$/.test(String(m.id))
    ? { v:CHEATS_CACHE_V, found:true, id:String(m.id), ids:(m.ids || []).map(String).filter(x => /^\d+$/.test(x)), qid:m.qid, title:m.title, platformOk:m.platformOk, at:Date.now() }
    : { v:CHEATS_CACHE_V, found:false, at:Date.now() };
}

function cheatsAutoKey(gameId){ return `cheatsauto:${creds.username.trim().toLowerCase()}:${gameId}`; }
async function loadCheatsAuto(gameId){
  try{
    const r = await window.storage.get(cheatsAutoKey(gameId), false);
    if(r && r.value){
      const o = JSON.parse(r.value);
      if(o && typeof o === 'object' && o.v === CHEATS_CACHE_V && (!o.found || /^\d+$/.test(String(o.id)))) return o;
    }
  }catch(e){ /* not looked up yet */ }
  return null;
}
async function saveCheatsAuto(gameId, o){
  try{ await window.storage.set(cheatsAutoKey(gameId), JSON.stringify(o), false); }catch(e){ /* non-fatal */ }
}
// Cached match if we have one, otherwise a Wikidata lookup. Falls back to GameFAQs' own search.
// Resolves to { url, final }: final=false means a network problem, so it isn't remembered and
// the next tap should try again.
async function resolveCheatsUrl(gameId, title, consoleName){
  const searchUrl = `https://gamefaqs.gamespot.com/search?game=${encodeURIComponent(title)}`;
  let auto = await loadCheatsAuto(gameId);
  const retryMissAfter = 7 * 24 * 3600 * 1000; // re-check "not found" results weekly
  if(!auto || (!auto.found && Date.now() - (auto.at || 0) > retryMissAfter)){
    try{
      auto = await lookupCheats(title, consoleName);
      await saveCheatsAuto(gameId, auto);
    }catch(e){ return { url:searchUrl, final:false }; }
  }
  return { url: auto.found ? CHEATS_URL(auto.id) : searchUrl, final:true };
}

function setupCheatsUI(gameId, title, card, consoleName){
  const btn = card.querySelector('#modal-cheats-btn');
  if(!btn) return;
  // The lookup starts as soon as the game profile opens, so by the time the button is tapped the
  // link is usually already known and the page opens instantly, inside the tap itself (which
  // browsers require to allow a new tab). The saved result means it's only ever done once per game.
  let readyUrl = null, blockedUrl = null, failed = false, pending = null, busy = false;
  const idleHtml = btn.innerHTML;
  function start(){
    failed = false;
    pending = resolveCheatsUrl(gameId, title, consoleName).then(r => {
      if(r.final) readyUrl = r.url; else failed = true;
      return r;
    });
    return pending;
  }
  start();

  btn.addEventListener('click', () => {
    // A page the browser refused to open earlier (see below) opens on this tap.
    if(blockedUrl){ const u = blockedUrl; blockedUrl = null; btn.innerHTML = idleHtml; window.open(u, '_blank', 'noopener'); return; }
    if(readyUrl){ window.open(readyUrl, '_blank', 'noopener'); return; }
    if(busy) return;
    busy = true;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="cheats-spinner" aria-hidden="true"></span>Finding cheats…';
    (failed ? start() : pending).then(r => {
      // This tap ended a moment ago, so some browsers (phones especially) may block a new tab opened now.
      const tab = window.open(r.url, '_blank');
      if(tab){
        try{ tab.opener = null; }catch(e){}
        btn.innerHTML = idleHtml;
      }else{
        blockedUrl = r.url;
        btn.innerHTML = '<span class="arrow">↗</span> Open cheats page';
      }
    }).finally(() => {
      busy = false;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    });
  });
}
