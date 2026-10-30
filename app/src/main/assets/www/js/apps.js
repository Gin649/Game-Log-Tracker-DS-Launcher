// Apps tab: your installed Android apps, with favourites. Opening one starts it (on the top screen when there are two).

const APPS_FAV_KEY = 'apps-favs';
let appsAll = [];       // [{ pkg, label }]
let appsFavs = [];      // package names
let appsShowAll = false;
let appsScreen = {};   // package name -> 'top' or 'bottom'; apps not listed open on the top screen
let appsLongPressed = false;

async function loadAppsFavs(){
  try{
    const r = await window.storage.get(APPS_FAV_KEY, false);
    const v = r && r.value ? JSON.parse(r.value) : [];
    appsFavs = Array.isArray(v) ? v : [];
  }catch(e){ appsFavs = []; }
}
async function loadAppsScreens(){
  try{
    const r = await window.storage.get('apps-screen', false);
    appsScreen = r && r.value ? JSON.parse(r.value) : {};
  }catch(e){ appsScreen = {}; }
}
async function saveAppsScreens(){
  try{ await window.storage.set('apps-screen', JSON.stringify(appsScreen), false); }catch(e){}
}
function launchAppNow(pkg){
  let res;
  const screen = appsScreen[pkg] === 'bottom' ? 'bottom' : 'top';
  try{
    res = JSON.parse(typeof thorBridge.launchAppOn === 'function' ? thorBridge.launchAppOn(pkg, screen) : thorBridge.launchApp(pkg));
  }catch(e){ res = { ok: false, message: 'Could not reach the launcher.' }; }
  if(!res.ok) showToast(res.message || 'Could not open that app.');
}
// Holding an app asks which screen it opens on; the choice is remembered for that app.
function showAppScreenChoice(pkg, label){
  const old = $('#app-pop'); if(old) old.remove();
  const cur = appsScreen[pkg] === 'bottom' ? 'bottom' : 'top';
  const pop = document.createElement('div');
  pop.id = 'app-pop';
  pop.className = 'app-pop';
  pop.innerHTML = `<div class="app-pop-card">
    <div class="app-pop-title">${esc(label)}</div>
    <div class="app-pop-sub">Open on which screen?</div>
    <button class="btn-primary" id="app-pop-top">${cur === 'top' ? '\u25cf ' : ''}Top screen</button>
    <button class="btn-primary" id="app-pop-bottom">${cur === 'bottom' ? '\u25cf ' : ''}Bottom screen</button>
    <button class="btn-ghost" id="app-pop-cancel">Cancel</button>
  </div>`;
  document.body.appendChild(pop);
  const choose = async (screen) => {
    pop.remove();
    if(screen === 'top') delete appsScreen[pkg]; else appsScreen[pkg] = screen;
    await saveAppsScreens();
    launchAppNow(pkg);
  };
  pop.querySelector('#app-pop-top').addEventListener('click', () => choose('top'));
  pop.querySelector('#app-pop-bottom').addEventListener('click', () => choose('bottom'));
  pop.querySelector('#app-pop-cancel').addEventListener('click', () => pop.remove());
  pop.addEventListener('click', (e) => { if(e.target === pop) pop.remove(); });
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
  await loadAppsScreens();
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
    if(appsLongPressed){ appsLongPressed = false; return; } // the hold already opened the screen choice
    launchAppNow(launch.getAttribute('data-pkg'));
  });
  // Hold an app for half a second to pick its screen.
  let holdTimer = 0;
  const wrap = $('#apps-wrap');
  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = 0; };
  wrap.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('.app-launch');
    if(!b) return;
    cancelHold();
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      appsLongPressed = true;
      showAppScreenChoice(b.getAttribute('data-pkg'), b.textContent.trim());
    }, 500);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach(t => wrap.addEventListener(t, cancelHold, true));
  wrap.addEventListener('contextmenu', (ev) => { if(ev.target.closest('.app-launch')) ev.preventDefault(); });
})();
