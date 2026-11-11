// Pinch on the game tiles (tile view), the covers on the Beaten tab or the Apps tab to change how many fit in a
// row. The pinch can be anywhere on that tab, not only on the tiles. Spreading two fingers makes them bigger, so fewer fit, and pinching them together makes them smaller.
// The game tiles go from 2 to 6 in a row and the Beaten tab from 2 to 10. The choice is kept.
(function(){
  const APPTILE_KEY = 'app-apps-tile', YEARCOLS_KEY = 'app-year-cols';
  const APP_SIZES = [64, 80, 96, 120, 150]; // the narrowest an app tile may be, in px. 96 is the usual size.
  const STEP_OUT = 1.22, STEP_IN = 0.82;    // how far the fingers move apart or together for one step
  let appSize = 96;
  let yearCols = 0; // 0 until you pinch: the covers keep their usual size and wrap
  let pinch = null;

  function applyAppSize(){
    const root = document.documentElement.style;
    root.setProperty('--app-tile', appSize + 'px');
    root.setProperty('--app-icon', Math.round(appSize / 2) + 'px');
  }
  function applyYearCols(){
    const root = document.documentElement;
    root.classList.toggle('year-cols', yearCols > 0);
    root.classList.toggle('year-small', yearCols >= 7); // too small for the Mastered label, which becomes an outline
    if(yearCols) root.style.setProperty('--year-cols', yearCols);
  }
  (async function(){
    try{
      const y = await window.storage.get(YEARCOLS_KEY, false);
      const yn = y ? parseInt(y.value, 10) : NaN;
      if(yn >= 2 && yn <= 10){ yearCols = yn; applyYearCols(); }
    }catch(e){}
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
    n = Math.min(6, Math.max(2, n));
    if(n === tileCols) return false;
    tileCols = n;
    document.querySelectorAll('.tile-grid').forEach(g => {
      g.classList.remove('cols-2', 'cols-3', 'cols-4', 'cols-5', 'cols-6');
      g.classList.add('cols-' + n);
      g.style.setProperty('--tile-cols', n);
    });
    return true;
  }
  function stepApps(bigger){
    const i = APP_SIZES.indexOf(appSize) + (bigger ? 1 : -1);
    if(i < 0 || i >= APP_SIZES.length) return false;
    appSize = APP_SIZES[i];
    applyAppSize();
    return true;
  }

  // The first pinch starts from however many covers fit in a row at their usual size.
  function stepYear(bigger, grid){
    let from = yearCols;
    if(!from){
      const item = grid.querySelector('.year-item');
      const w = item ? item.getBoundingClientRect().width + 2 : 82;
      from = Math.min(10, Math.max(2, Math.floor((grid.clientWidth + 2) / w)));
    }
    const n = Math.min(10, Math.max(2, from + (bigger ? -1 : 1)));
    if(n === yearCols) return false;
    yearCols = n;
    applyYearCols();
    return true;
  }

  const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const GRIDS = '.tile-grid, .apps-grid, .year-icons';
  // The tiles a pinch is for: the ones under the finger, or else the ones on the tab you are on. So a pinch that
  // lands above the tiles (on the tabs, the console bar or the search box) still counts. The menu is left alone.
  function gridFor(el){
    if(!el || !el.closest || !el.closest('.wrap') || el.closest('#dropdown-menu, .modal-backdrop')) return null;
    return el.closest(GRIDS) || document.querySelector('.tab-panel.active ' + GRIDS.split(', ').join(', .tab-panel.active '));
  }

  function onMove(e){
    if(!pinch) return;
    if(e.touches.length !== 2){ end(); return; }
    if(e.cancelable) e.preventDefault(); // the page must not zoom or scroll under a pinch
    const ratio = spread(e.touches) / pinch.dist;
    if(ratio < STEP_OUT && ratio > STEP_IN) return;
    const bigger = ratio >= STEP_OUT;
    const changed = pinch.kind === 'apps' ? stepApps(bigger) : pinch.kind === 'year' ? stepYear(bigger, pinch.grid) : setTileCols(tileCols + (bigger ? -1 : 1));
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
      if(p.kind === 'apps') window.storage.set(APPTILE_KEY, String(appSize), false);
      else if(p.kind === 'year') window.storage.set(YEARCOLS_KEY, String(yearCols), false);
      else window.storage.set(TILECOLS_KEY, String(tileCols), false);
    }catch(e){}
  }

  document.addEventListener('touchstart', (e) => {
    if(e.touches.length !== 2){ end(); return; }
    const grid = gridFor(e.touches[0].target);
    if(!grid || !gridFor(e.touches[1].target)) return;
    pinch = { dist: spread(e.touches) || 1, grid, kind: grid.classList.contains('apps-grid') ? 'apps' : grid.classList.contains('year-icons') ? 'year' : 'tiles', changed: false };
    document.addEventListener('touchmove', onMove, { passive: false });
  }, { passive: true });
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
})();
