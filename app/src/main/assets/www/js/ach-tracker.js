// Achievement Tracker on the Last Played tab: the points earned and achievements unlocked in the last 24 hours,
// 3 days, week and month, and in the current year. It follows the mode you are in. Casual counts the unlocks
// made outside hardcore and hardcore counts the hardcore ones, the same split as the totals at the top.
//
// RetroAchievements is asked for the year once, a month at a time and in the background. What comes back is
// kept on the device, so later syncs only ask for what is new since the last one.
const achTracker = (function(){
  const DAY = 86400000;
  const CHUNK = 30 * DAY;  // how much time one request covers
  const FULL = 500;        // a reply this long may have been cut short, so its span is asked for again in halves
  const key = () => `ra-ach-tracker:${creds.username}`;
  let data = null;         // { from, upTo, done, items: { achievementId: [time, points, hardcore 0/1] } }
  let loadedFor = '';
  let busy = false;

  // The oldest unlock that is needed: 1 January, or a month back when that is earlier (in January).
  function windowStart(now){
    return Math.min(new Date(new Date(now).getFullYear(), 0, 1).getTime(), now - 31 * DAY);
  }

  async function load(){
    if(loadedFor === creds.username) return;
    loadedFor = creds.username;
    data = null;
    try{
      const r = await window.storage.get(key(), false);
      const d = r ? JSON.parse(r.value) : null;
      if(d && d.items && typeof d.upTo === 'number' && typeof d.from === 'number') data = d;
    }catch(e){}
  }
  function save(){
    try{ window.storage.set(key(), JSON.stringify(data), false); }catch(e){}
  }

  function add(list){
    (list || []).forEach(a => {
      const d = parseRADate(a.Date);
      const id = a.AchievementID;
      if(!d || id == null) return;
      const hc = Number(a.HardcoreMode) === 1 ? 1 : 0;
      const had = data.items[id];
      // An achievement can come back twice, once for each mode. Hardcore is the one that is kept.
      if(had && had[2] && !hc) return;
      data.items[id] = [d.getTime(), Number(a.Points) || 0, hc];
    });
  }

  async function fetchSpan(from, to){
    const list = await raFetch('API_GetAchievementsEarnedBetween.php', { f: Math.floor(from / 1000), t: Math.ceil(to / 1000) }, { background: true });
    if(Array.isArray(list) && list.length >= FULL && to - from > 3600000){
      const mid = from + Math.floor((to - from) / 2);
      await fetchSpan(from, mid);
      await fetchSpan(mid, to);
      return;
    }
    add(list);
  }

  // Brings the saved unlocks up to date and redraws. Safe to call on every sync.
  async function refresh(){
    if(busy || !creds || !creds.username) return;
    busy = true;
    try{
      await load();
      const now = Date.now(), start = windowStart(now);
      if(!data || data.from > start) data = { from: start, upTo: start, done: false, items: {} };
      render();
      let at = Math.max(start, data.upTo - 3600000); // an hour of overlap, in case a late unlock was missed
      while(at < now){
        const end = Math.min(now, at + CHUNK);
        await fetchSpan(at, end);
        data.upTo = end;
        at = end;
        save(); // kept as it goes, so a first run that is cut short carries on from here
        render();
      }
      // Last year's unlocks are dropped once they are out of every period.
      Object.keys(data.items).forEach(id => { if(data.items[id][0] < start) delete data.items[id]; });
      data.from = start;
      data.done = true;
      save();
    }catch(e){
      console.error('Achievement Tracker refresh failed:', e);
    }finally{
      busy = false;
      render();
    }
  }

  // Shows what is saved, before anything is fetched.
  async function show(){
    try{ await load(); }catch(e){}
    render();
  }

  function render(){
    const el = document.getElementById('ach-tracker');
    if(!el) return;
    const now = Date.now();
    const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    const periods = [
      ['Last 24 hours', now - DAY],
      ['Last 3 days', now - 3 * DAY],
      ['Last week', now - 7 * DAY],
      ['Last month', now - 30 * DAY],
      ['Current Year', yearStart],
    ];
    const hardcore = statsMode === 'hardcore' ? 1 : 0;
    // Numbers are shown once the first full fetch has finished. Until then it is a dash, not a low number.
    const ok = !!(data && data.done);
    const items = data ? Object.values(data.items).filter(i => i[2] === hardcore) : [];
    el.innerHTML = periods.map(([label, since]) => {
      let pts = 0, n = 0;
      items.forEach(i => { if(i[0] >= since){ pts += i[1]; n++; } });
      return `<div class="at-tile">
        <div class="at-num">${ok ? pts.toLocaleString() : '—'}<span> pts</span></div>
        <div class="at-lbl">${label}</div>
        <div class="at-count">${ok ? n.toLocaleString() : '—'} unlocked</div>
      </div>`;
    }).join('');
  }

  return { refresh, show, render };
})();
