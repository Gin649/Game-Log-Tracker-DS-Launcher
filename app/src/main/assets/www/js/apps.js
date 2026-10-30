// Apps tab: your installed Android apps, with favourites. Opening one starts it (on the top screen when there are two).

const APPS_FAV_KEY = 'apps-favs';
let appsAll = [];       // [{ pkg, label }]
let appsFavs = [];      // package names
let appsShowAll = false;

async function loadAppsFavs(){
  try{
    const r = await window.storage.get(APPS_FAV_KEY, false);
    const v = r && r.value ? JSON.parse(r.value) : [];
    appsFavs = Array.isArray(v) ? v : [];
  }catch(e){ appsFavs = []; }
}
async function saveAppsFavs(){
  try{ await window.storage.set(APPS_FAV_KEY, JSON.stringify(appsFavs), false); }catch(e){}
}

function renderAppsList(){
  const wrap = $('#apps-wrap');
  const q = $('#apps-search').value.trim().toLowerCase();
  const favSet = new Set(appsFavs);
  // with no favourites yet, everything is listed so there is something to pick from
  const all = appsShowAll || !appsFavs.length || !!q;
  const list = appsAll.filter(a => (all || favSet.has(a.pkg)) && (!q || a.label.toLowerCase().includes(q)));
  $('#apps-count').textContent = list.length ? '(' + list.length + ')' : '';
  const btn = $('#btn-apps-mode');
  btn.textContent = appsShowAll ? 'Favourites' : 'All apps';
  btn.setAttribute('aria-pressed', appsShowAll ? 'true' : 'false');
  const note = (!appsShowAll && !appsFavs.length && !q)
    ? '<p class="apps-note">Tap the star on an app to keep it here. Favourites are shown by default.</p>' : '';
  if(!list.length){
    wrap.innerHTML = '<div class="loading">' + (q ? 'No apps match.' : 'No apps found.') + '</div>';
    return;
  }
  wrap.innerHTML = note + '<div class="apps-grid">' + list.map(a => `
    <div class="app-tile">
      <button class="app-launch" data-pkg="${esc(a.pkg)}"><img src="/appicon/${encodeURIComponent(a.pkg)}" alt="" loading="lazy"><span>${esc(a.label)}</span></button>
      <button class="app-star" data-star="${esc(a.pkg)}" aria-label="${favSet.has(a.pkg) ? 'Remove from favourites' : 'Add to favourites'}">${favSet.has(a.pkg) ? '\u2605' : '\u2606'}</button>
    </div>`).join('') + '</div>';
}

async function renderApps(){
  if(!thorBridge || typeof thorBridge.appsList !== 'function') return;
  try{ appsAll = JSON.parse(thorBridge.appsList()); }catch(e){ appsAll = []; }
  await loadAppsFavs();
  renderAppsList();
}

(function(){
  if(!thorBridge || typeof thorBridge.appsList !== 'function') return; // only inside the launcher
  $('#tab-apps-btn').style.display = '';
  $('#apps-search').addEventListener('input', renderAppsList);
  $('#btn-apps-mode').addEventListener('click', () => { appsShowAll = !appsShowAll; renderAppsList(); });
  $('#apps-wrap').addEventListener('click', async (ev) => {
    const star = ev.target.closest('[data-star]');
    if(star){
      const pkg = star.getAttribute('data-star');
      appsFavs = appsFavs.includes(pkg) ? appsFavs.filter(p => p !== pkg) : [...appsFavs, pkg];
      renderAppsList();
      await saveAppsFavs();
      return;
    }
    const launch = ev.target.closest('[data-pkg]');
    if(!launch) return;
    let res;
    try{ res = JSON.parse(thorBridge.launchApp(launch.getAttribute('data-pkg'))); }catch(e){ res = { ok: false, message: 'Could not reach the launcher.' }; }
    if(!res.ok) showToast(res.message || 'Could not open that app.');
  });
})();
