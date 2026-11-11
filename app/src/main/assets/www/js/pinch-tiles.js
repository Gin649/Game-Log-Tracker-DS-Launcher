// Pinch on the game tiles (tile view) or on the Apps tab to change how many fit in a row. Spreading two fingers
// makes the tiles bigger, so fewer fit, and pinching them together makes them smaller. The game tiles stay
// within the 3 to 5 of Display Options, and the choice is kept the same way as the buttons there.
(function(){
  const APPTILE_KEY = 'app-apps-tile';
  const APP_SIZES = [64, 80, 96, 120, 150]; // the narrowest an app tile may be, in px. 96 is the usual size.
  const STEP_OUT = 1.22, STEP_IN = 0.82;    // how far the fingers move apart or together for one step
  let appSize = 96;
  let pinch = null;

  function applyAppSize(){
    const root = document.documentElement.style;
    root.setProperty('--app-tile', appSize + 'px');
    root.setProperty('--app-icon', Math.round(appSize / 2) + 'px');
  }
  (async function(){
    try{
      const v = await window.storage.get(APPTILE_KEY, false);
      const n = v ? parseInt(v.value, 10) : NaN;
      if(APP_SIZES.includes(n)) appSize = n;
    }catch(e){}
    applyAppSize();
  })();

  // The grids on screen are changed where they are. Drawing them again would take the tiles out from under
  // your fingers and end the pinch.
  function setTileCols(n){
    n = Math.min(5, Math.max(3, n));
    if(n === tileCols) return false;
    tileCols = n;
    document.querySelectorAll('.tile-grid').forEach(g => {
      g.classList.remove('cols-3', 'cols-4', 'cols-5');
      g.classList.add('cols-' + n);
      g.style.setProperty('--tile-cols', n);
    });
    try{ applyGameViewButtons(); }catch(e){}
    return true;
  }
  function stepApps(bigger){
    const i = APP_SIZES.indexOf(appSize) + (bigger ? 1 : -1);
    if(i < 0 || i >= APP_SIZES.length) return false;
    appSize = APP_SIZES[i];
    applyAppSize();
    return true;
  }

  const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const gridOf = (el) => el && el.closest ? el.closest('.tile-grid, .apps-grid') : null;

  function onMove(e){
    if(!pinch) return;
    if(e.touches.length !== 2){ end(); return; }
    if(e.cancelable) e.preventDefault(); // the page must not zoom or scroll under a pinch
    const ratio = spread(e.touches) / pinch.dist;
    if(ratio < STEP_OUT && ratio > STEP_IN) return;
    const bigger = ratio >= STEP_OUT;
    const changed = pinch.apps ? stepApps(bigger) : setTileCols(tileCols + (bigger ? -1 : 1));
    pinch.dist = spread(e.touches);
    if(changed) pinch.changed = true;
  }
  function end(){
    if(!pinch) return;
    const p = pinch;
    pinch = null;
    document.removeEventListener('touchmove', onMove);
    if(!p.changed) return;
    try{
      if(p.apps) window.storage.set(APPTILE_KEY, String(appSize), false);
      else window.storage.set(TILECOLS_KEY, String(tileCols), false);
    }catch(e){}
  }

  document.addEventListener('touchstart', (e) => {
    if(e.touches.length !== 2){ end(); return; }
    const grid = gridOf(e.touches[0].target);
    if(!grid || gridOf(e.touches[1].target) !== grid) return;
    pinch = { dist: spread(e.touches) || 1, apps: grid.classList.contains('apps-grid'), changed: false };
    document.addEventListener('touchmove', onMove, { passive: false });
  }, { passive: true });
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
})();
