// Game Details section in a game's profile: other players' typical playtime from
// RetroAchievements (for the mode you're in), a write-up from RAWG and the game's manual (manuals.js).

const PLAYTIME_TTL = 7 * 24 * 60 * 60 * 1000; // medians barely move
const PLAYTIME_MISS_TTL = 10 * 60 * 1000;
const DESCRIPTION_TTL = 30 * 24 * 60 * 60 * 1000;
const DESCRIPTION_MISS_TTL = 24 * 60 * 60 * 1000;

// Median times in seconds, for casual and hardcore players. RA calls the casual 100% a
// completion and the hardcore one a mastery; the profile labels both "time to master".
async function getPlaytimeStats(gameId){
  const cacheKey = `ra-playtime-stats:${gameId}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      const has = parsed.stats && [parsed.stats.casual, parsed.stats.hardcore].some(m => m.beat || m.master);
      if(Date.now() - parsed.ts < (has ? PLAYTIME_TTL : PLAYTIME_MISS_TTL)) return parsed.stats;
    }
  }catch(e){ /* not cached yet */ }

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
  try{ await window.storage.set(cacheKey, JSON.stringify({ stats, ts: Date.now() }), false); }catch(e){ /* non-fatal */ }
  return stats;
}

// RAWG's description as plain text, or null when it has none for this game.
async function getRawgDescription(title){
  if(!rawgCreds) rawgCreds = await loadRawgCreds();
  if(!rawgCreds || !rawgCreds.apiKey) return null;

  const clean = String(title).replace(/^(?:~[^~]*~\s*)+/, '').trim(); // drop "~Hack~" style tags
  const cacheKey = `rawg-desc:${clean.toLowerCase()}`;
  try{
    const r = await window.storage.get(cacheKey, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      if(Date.now() - parsed.ts < (parsed.text ? DESCRIPTION_TTL : DESCRIPTION_MISS_TTL)) return parsed.text;
    }
  }catch(e){ /* not cached yet */ }

  const key = encodeURIComponent(rawgCreds.apiKey);
  const search = await rawgGetShared(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(clean)}&page_size=5`);
  const results = (search && search.results) || [];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(clean);
  // An exact title, or one that contains the other, so a similar sequel doesn't lend its text.
  const match = results.find(g => norm(g.name) === want) ||
    results.find(g => { const n = norm(g.name); return n.length >= 4 && want.length >= 4 && (n.includes(want) || want.includes(n)); });

  let text = null;
  if(match){
    const detail = await rawgGet(`https://api.rawg.io/api/games/${match.id}?key=${key}`);
    text = cleanDescription(detail && detail.description_raw);
  }
  try{ await window.storage.set(cacheKey, JSON.stringify({ text, ts: Date.now() }), false); }catch(e){ /* non-fatal */ }
  return text;
}

function cleanDescription(raw){
  let text = String(raw || '').replace(/\r/g, '').trim();
  // RAWG often adds a Spanish copy after the English text, started by a line that just says "Español".
  const es = text.search(/\n\s*espa[ñn]ol\s*:?\s*(\n|$)/i);
  if(es > 0) text = text.slice(0, es).trim();
  text = tidyDescription(text);
  return text.length >= 40 ? text : null;
}

// RAWG text often has hard line breaks in the middle of sentences ("It's panic or" / "perish..."),
// which show up as stray short lines. A line break only stays when the line before it ends a
// sentence and the next one starts a new one; every other break becomes a space.
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

function playtimeBox(label, seconds, players){
  const value = seconds ? formatDuration({ hours: seconds / 3600 }, true) : '—';
  const n = players ? `${players} player${players === 1 ? '' : 's'}` : '';
  return `<div class="gd-box"><div class="gd-k">${label}</div><div class="gd-v">${value}</div><div class="gd-n">${n}</div></div>`;
}

// aboutOnly: games tracked by hand (not on RA) have no playtime data, so only the write-up shows.
function renderGameDetails(wrap, stats, description, aboutOnly, manualCtx){
  if(description) description = tidyDescription(description); // also fixes write-ups saved before this was added
  const hard = statsMode === 'hardcore';
  const m = (!aboutOnly && stats) ? (hard ? stats.hardcore : stats.casual) : null;
  const hasTimes = !!(m && (m.beat || m.master));

  if(!hasTimes && !description){
    wrap.innerHTML = `<div class="gd-empty">${aboutOnly ? 'No write-up available for this game yet.' : 'No details available for this game yet.'}</div>`;
    addManualSection(wrap, manualCtx);
    return;
  }

  let html = '';
  if(!aboutOnly){
    html += `<div class="gd-head"><span class="gd-label">AVERAGE PLAYTIME</span><span class="gd-mode">${hard ? 'Hardcore' : 'Casual'}</span></div>`;
    html += hasTimes
      ? `<div class="gd-boxes">${playtimeBox('TIME TO BEAT', m.beat, m.beatN)}${playtimeBox('TIME TO MASTER', m.master, m.masterN)}</div>`
      : '<div class="gd-empty">No playtime data yet.</div>';
  }

  if(description){
    html += `<div class="gd-label${aboutOnly ? '' : ' gd-about-label'}">ABOUT</div><div class="gd-about"></div>`;
    if(description.length > 280) html += '<button class="gd-more">Read more</button>';
  }
  wrap.innerHTML = html;

  const aboutEl = wrap.querySelector('.gd-about');
  if(aboutEl){
    aboutEl.textContent = description; // plain text, never parsed as HTML
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
  const aboutOnly = !!(opts && opts.aboutOnly); // manual games: no RA playtime to fetch
  const manualCtx = { gameId, title, consoleName: opts && opts.consoleName };
  const btn = card.querySelector('#modal-details-btn');
  const wrap = card.querySelector('#modal-details');
  if(!btn || !wrap) return;

  // Start loading in the background shortly after the profile opens, so the data is usually
  // there by the time the section is tapped. Everything is cached, so this only costs
  // requests the first time a game is opened.
  let pending = null;
  const load = () => pending || (pending = Promise.allSettled([
    aboutOnly ? Promise.resolve(null) : getPlaytimeStats(gameId),
    getRawgDescription(title),
  ]));
  setTimeout(load, 400);

  let loaded = false;
  btn.addEventListener('click', async () => {
    const nowOpen = wrap.style.display === 'none';
    wrap.style.display = nowOpen ? 'block' : 'none';
    btn.classList.toggle('open', nowOpen);
    if(!nowOpen || loaded) return;

    loaded = true;
    wrap.innerHTML = '<div class="achievements-list-loading">Loading details…</div>';
    const [statsRes, descRes] = await load();
    if(card.dataset.gameId !== String(gameId)) return; // user moved on to another game
    if(statsRes.status === 'rejected') console.error('Playtime stats failed:', statsRes.reason && statsRes.reason.message);
    if(descRes.status === 'rejected') console.error('RAWG description failed:', descRes.reason && descRes.reason.message);

    const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
    const description = descRes.status === 'fulfilled' ? descRes.value : null;
    renderGameDetails(wrap, stats, description, aboutOnly, manualCtx);
    if(!stats && !description){ loaded = false; pending = null; } // both failed: try again next time it's opened
  });
}
