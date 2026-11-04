// Game Details: other players' median playtime from RA (in the current mode), your own times,
// a write-up (ES-DE, LaunchBox or IGDB) and the manual (manuals.js).

const PLAYTIME_TTL = 7 * 24 * 60 * 60 * 1000; // medians barely move
const PLAYTIME_MISS_TTL = 10 * 60 * 1000;
const DESCRIPTION_TTL = 30 * 24 * 60 * 60 * 1000;
const DESCRIPTION_MISS_TTL = 24 * 60 * 60 * 1000;

// Median times in seconds for casual and hardcore. The profile calls both 100% times "time to master".
async function getPlaytimeStats(gameId){
  const cacheKey = `ra-playtime-stats:${gameId}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      const has = parsed.stats && [parsed.stats.casual, parsed.stats.hardcore].some(m => m.beat || m.master);
      if(Date.now() - parsed.ts < (has ? PLAYTIME_TTL : PLAYTIME_MISS_TTL)) return parsed.stats;
    }
  }catch(e){}

  const data = await raFetch('API_GetGameProgression.php', { i: gameId });
  const secs = n => (Number(n) > 0 ? Number(n) : null);
  const count = n => (Number(n) > 0 ? Number(n) : 0);
  const stats = {
    casual: {
      beat: secs(data && data.MedianTimeToBeat), beatN: count(data && data.TimesUsedInBeatMedian),
      master: secs(data && data.MedianTimeToComplete), masterN: count(data && data.TimesUsedInCompletionMedian),
    },
    hardcore: {
      beat: secs(data && data.MedianTimeToBeatHardcore), beatN: count(data && data.TimesUsedInHardcoreBeatMedian),
      master: secs(data && data.MedianTimeToMaster), masterN: count(data && data.TimesUsedInMasteryMedian),
    },
  };
  try{ await window.storage.set(cacheKey, JSON.stringify({ stats, ts: Date.now() }), false); }catch(e){}
  return stats;
}

// The write-up your own frontend saved (ES-DE gamelist.xml). Only inside the launcher app; "" or null when none.
function getEsdeDescription(title, consoleName){
  if(typeof thorBridge === 'undefined' || !thorBridge || !thorBridge.esdeDescription || !consoleName) return Promise.resolve(null);
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim();
  return new Promise(resolve => setTimeout(() => {
    try{
      const t = tidyDescription(thorBridge.esdeDescription(clean, consoleName));
      resolve(t.length >= 40 ? t : null);
    }catch(e){ resolve(null); }
  }, 0));
}

// ScreenScraper's write-up, asked through the app's Worker (which holds the ScreenScraper login). Inside the launcher the
// app asks and remembers it; in the browser the answer is kept in storage, a month for a game found and a day for a miss.
const SS_WORKER = 'https://ra-proxy.gin649.workers.dev';
function getScreenScraperDescription(title, consoleName){
  if(!consoleName) return Promise.resolve(null);
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim();
  const done = text => { const t = tidyDescription(text || ''); return t.length >= 40 ? t : null; };
  if(typeof thorBridge !== 'undefined' && thorBridge && thorBridge.screenscraperDescription){
    return new Promise(resolve => setTimeout(() => {
      try{ resolve(done(thorBridge.screenscraperDescription(clean, consoleName))); }catch(e){ resolve(null); }
    }, 0));
  }
  return (async () => {
    const key = `ss-info:${String(consoleName).toLowerCase()}:${clean.toLowerCase()}`;
    try{
      const r = await window.storage.get(key, false);
      if(r && r.value){
        const p = JSON.parse(r.value);
        if(Date.now() - p.ts < (p.found ? 30 : 1) * 24 * 60 * 60 * 1000) return p.found ? done(p.synopsis) : null;
      }
    }catch(e){}
    try{
      const res = await fetchWithTimeout(`${SS_WORKER}/ss/info?title=${encodeURIComponent(clean)}&system=${encodeURIComponent(consoleName)}`, 15000);
      if(!res.ok) return null; // busy or not set up: nothing is kept, so it is tried again next time
      const j = await res.json();
      try{ await window.storage.set(key, JSON.stringify({ found: !!j.found, synopsis: j.synopsis || '', ts: Date.now() }), false); }catch(e){}
      return j.found ? done(j.synopsis) : null;
    }catch(e){ return null; }
  })();
}

// LaunchBox's write-up, used to fill the gaps when ES-DE has none. Only inside the launcher app.
function getLaunchBoxDescription(title, consoleName){
  if(typeof thorBridge === 'undefined' || !thorBridge || !thorBridge.launchboxDescription || !consoleName) return Promise.resolve(null);
  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim();
  return new Promise(resolve => setTimeout(() => {
    try{
      const t = tidyDescription(thorBridge.launchboxDescription(clean, consoleName));
      resolve(t.length >= 40 ? t : null);
    }catch(e){ resolve(null); }
  }, 0));
}

// RA hacks are titled "~Hack~ Name". The original game's description would be wrong for them, so they show "Hack" and a
// link to the hack's page on RomHacking.net (that site is behind a bot check, so it opens in the viewer, not in the app).
const isHackTitle = t => /^\s*~hack~/i.test(String(t || ''));
const hackSearchUrl = t => 'https://www.romhacking.net/hacks/?title=' + encodeURIComponent(String(t || '').replace(/^(?:\s*~[^~]*~)+\s*/, '').trim());

function cleanDescription(raw){
  let text = String(raw || '').replace(/\r/g, '').trim();
  // Text sources often add a Spanish copy after a line that just says "Español".
  const es = text.search(/\n\s*espa[ñn]ol\s*:?\s*(\n|$)/i);
  if(es > 0) text = text.slice(0, es).trim();
  text = tidyDescription(text);
  return text.length >= 40 ? text : null;
}

// The text has line breaks mid-sentence. A break only stays between a sentence end and a new
// sentence; the rest become spaces.
function tidyDescription(text){
  return String(text || '').replace(/\r/g, '').split(/\n{2,}/).map(para => {
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
    let out = '';
    lines.forEach((line, i) => {
      if(i === 0){ out = line; return; }
      const endsSentence = /[.!?:)"'”’…]$/.test(out);
      const startsNew = /^[A-Z0-9"“'‘(\[¡¿]/.test(line);
      out += (endsSentence && startsNew ? '\n\n' : ' ') + line;
    });
    return out;
  }).filter(Boolean).join('\n\n');
}

function achievementType(a){
  return String((a && (a.Type || a.type)) || '').toLowerCase();
}

// RA doesn't report your own time to beat or master, so both come from your unlock dates. Beating
// ends at the unlock that completed the requirements (every progression achievement plus a win
// condition). The master time is RA's tracked playtime when there is one, otherwise an estimate.
async function getMyTimes(gameId){
  const list = await getAchievementsList(gameId);
  if(!list || !list.length) return null;
  try{ attachAchievementTypes(list, await getGameExtended(gameId)); }
  catch(e){}
  const cached = estHoursCache[gameId];
  const real = cached && cached.real ? cached.hours : null;
  const snap = await readSnap(gameId);

  // Unlocks in either mode. The share made by the beat moment, scaled to RA's real playtime,
  // beats the raw unlock gaps as an estimate.
  const anyStamps = list
    .map(a => { const d = parseRADate(a.DateEarned || a.DateEarnedHardcore); return d ? d.getTime() : null; })
    .filter(t => t != null);
  const estTotal = estimateHoursFromTimestamps(anyStamps);

  const timesFor = (hard) => {
    const earned = list.map(a => {
      const d = parseRADate(hard ? a.DateEarnedHardcore : (a.DateEarned || a.DateEarnedHardcore));
      return d ? d.getTime() : null;
    });
    const out = { beat: null, master: null };

    const progression = [];
    const wins = [];
    list.forEach((a, i) => {
      const t = achievementType(a);
      if(t === 'progression') progression.push(earned[i]);
      else if(t === 'win_condition') wins.push(earned[i]);
    });
    const winTimes = wins.filter(t => t != null);
    const beaten = progression.length + wins.length > 0
      && !progression.includes(null)
      && (wins.length === 0 || winTimes.length > 0);
    const saved = snap && snap[hard ? 'beatHardcore' : 'beatCasual'];
    if(saved > 0){
      out.beat = { hours: saved, est: false };
    }else if(beaten){
      const beatAt = Math.max(...progression, wins.length ? Math.min(...winTimes) : -Infinity);
      const hours = estimateHoursFromTimestamps(anyStamps.filter(t => t <= beatAt));
      if(hours != null){
        out.beat = { hours: (real != null && estTotal) ? (hours / estTotal) * real : hours, est: true };
      }
    }

    const savedMaster = snap && snap[hard ? 'masterHardcore' : 'masterCasual'];
    if(savedMaster > 0){
      out.master = { hours: savedMaster, est: false };
    }else if(earned.every(t => t != null)){
      if(real != null){
        out.master = { hours: real, est: false };
      }else{
        const hours = estimateHoursFromTimestamps(earned);
        if(hours != null) out.master = { hours, est: true };
      }
    }
    return out;
  };

  return { casual: timesFor(false), hardcore: timesFor(true) };
}

function playtimeBox(label, seconds, players, mine){
  const value = seconds ? formatDuration({ hours: seconds / 3600 }, true) : '—';
  const n = players ? `${players} player${players === 1 ? '' : 's'}` : '';
  const you = mine
    ? `<div class="gd-you"><div class="gd-k">YOUR TIME</div><div class="gd-v">${mine.est ? '~' : ''}${formatDuration({ hours: mine.hours }, true)}</div></div>`
    : '';
  return `<div class="gd-box"><div class="gd-main"><div class="gd-k">${label}</div><div class="gd-v">${value}</div><div class="gd-n">${n}</div></div>${you}</div>`;
}

// aboutOnly: non-RA games have no playtime data, so only the write-up shows.
function renderGameDetails(wrap, stats, description, aboutOnly, manualCtx, mine, hack, igdb){
  if(description) description = tidyDescription(description); // fixes write-ups cached before tidying existed
  const hard = statsMode === 'hardcore';
  const m = (!aboutOnly && stats) ? (hard ? stats.hardcore : stats.casual) : null;
  const my = (!aboutOnly && mine) ? (hard ? mine.hardcore : mine.casual) : null;
  // Games RetroAchievements has no playtime for borrow IGDB's: a normal playthrough, and everything done.
  const ib = (aboutOnly && igdb && igdb.beat && (igdb.beat.normally || igdb.beat.completely)) ? igdb.beat : null;
  const hasTimes = !!(m && (m.beat || m.master)) || !!(my && (my.beat || my.master));

  if(!hasTimes && !ib && !description && !hack){
    wrap.innerHTML = `<div class="gd-empty">${aboutOnly ? 'No write-up available for this game yet.' : 'No details available for this game yet.'}</div>`;
    addManualSection(wrap, manualCtx);
    return;
  }

  let html = '';
  if(ib){
    html += `<div class="gd-head"><span class="gd-label">AVERAGE PLAYTIME</span><span class="gd-mode">IGDB</span></div>`;
    html += `<div class="gd-boxes">${playtimeBox('TIME TO BEAT', ib.normally, ib.count, null)}${playtimeBox('TIME TO 100%', ib.completely, ib.count, null)}</div>`;
  }
  if(!aboutOnly){
    html += `<div class="gd-head"><span class="gd-label">AVERAGE PLAYTIME</span><span class="gd-mode">${hard ? 'Hardcore' : 'Casual'}</span></div>`;
    html += hasTimes
      ? `<div class="gd-boxes">${playtimeBox('TIME TO BEAT', m && m.beat, m && m.beatN, my && my.beat)}${playtimeBox('TIME TO MASTER', m && m.master, m && m.masterN, my && my.master)}</div>`
      : '<div class="gd-empty">No playtime data yet.</div>';
  }

  if(hack){
    html += `<div class="gd-label${aboutOnly && !ib ? '' : ' gd-about-label'}">ABOUT</div><div class="gd-hack">Hack<br><br><a href="${esc(hack.url)}" target="_blank" rel="noopener">Click here for details</a></div>`;
  }
  if(description){
    html += `<div class="gd-label${aboutOnly && !ib ? '' : ' gd-about-label'}">ABOUT</div><div class="gd-about"></div>`;
    if(description.length > 280) html += '<button class="gd-more">Read more</button>';
  }
  wrap.innerHTML = html;

  const aboutEl = wrap.querySelector('.gd-about');
  if(aboutEl){
    aboutEl.textContent = description;
    const more = wrap.querySelector('.gd-more');
    if(more){
      aboutEl.classList.add('clamp');
      more.addEventListener('click', () => {
        const collapsed = aboutEl.classList.toggle('clamp');
        more.textContent = collapsed ? 'Read more' : 'Show less';
      });
    }
  }
  addManualSection(wrap, manualCtx);
}

function setupGameDetailsUI(gameId, title, card, opts){
  const aboutOnly = !!(opts && opts.aboutOnly);
  const manualCtx = { gameId, title, consoleName: opts && opts.consoleName };
  const btn = card.querySelector('#modal-details-btn');
  const wrap = card.querySelector('#modal-details');
  if(!btn || !wrap) return;

  // Loads in the background just after the profile opens, so it's usually ready when tapped.
  let pending = null;
  const igdbText = () => getIgdbInfo(title).then(i => {
    const t = i && i.summary ? tidyDescription(i.summary) : '';
    return t.length >= 40 ? t : null;
  }).catch(() => null);
  // Your frontend's own text first, then ScreenScraper, then LaunchBox, then IGDB.
  const descP = () => {
    if(isHackTitle(title)) return Promise.resolve(null);
    const consoleName = opts && opts.consoleName;
    return getEsdeDescription(title, consoleName)
      .then(d => d || getScreenScraperDescription(title, consoleName))
      .then(d => d || getLaunchBoxDescription(title, consoleName))
      .then(d => d || igdbText())
      .catch(() => null);
  };
  let descPromise = null;
  const load = () => pending || (pending = (descPromise = descP(), Promise.allSettled([
    aboutOnly ? Promise.resolve(null) : getPlaytimeStats(gameId),
    Promise.resolve(null),
    Promise.resolve(isHackTitle(title) ? { url: hackSearchUrl(title) } : null),
    aboutOnly ? Promise.resolve(null) : getMyTimes(gameId),
    aboutOnly && !isHackTitle(title) ? getIgdbInfo(title) : Promise.resolve(null),
  ])));
  setTimeout(load, 400);

  let loaded = false;
  btn.addEventListener('click', async () => {
    const nowOpen = wrap.style.display === 'none';
    wrap.style.display = nowOpen ? 'block' : 'none';
    btn.classList.toggle('open', nowOpen);
    if(!nowOpen || loaded) return;

    loaded = true;
    wrap.innerHTML = '<div class="achievements-list-loading">Loading details…</div>';
    const [statsRes, , hackRes, mineRes, igdbRes] = await load();
    // The write-up can come late (IGDB is the slow one): wait a moment for it, then show the rest and fill it in after.
    const early = await Promise.race([descPromise, new Promise(r => setTimeout(() => r(undefined), 2500))]);
    if(card.dataset.gameId !== String(gameId)) return; // another game was opened meanwhile

    const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
    const hack = hackRes.status === 'fulfilled' ? hackRes.value : null;
    const mine = mineRes.status === 'fulfilled' ? mineRes.value : null;
    const igdb = igdbRes && igdbRes.status === 'fulfilled' ? igdbRes.value : null;
    const draw = (description) => renderGameDetails(wrap, stats, description, aboutOnly, manualCtx, mine, hack, igdb);
    draw(isHackTitle(title) ? null : (early || null));
    if(early === undefined){
      descPromise.then(text => {
        if(text && card.dataset.gameId === String(gameId)) draw(text);
        else if(!stats && !hack){ loaded = false; pending = null; }
      });
    }else if(!stats && !early && !hack){ loaded = false; pending = null; } // all failed: retry next time
  });
}
