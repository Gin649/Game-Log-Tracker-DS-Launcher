// Controller support for retro handhelds.
//
//   D-pad / left stick  move the highlight      A  confirm        B  back
//   Right stick         scroll quickly          Select  hamburger menu
//   X                   refresh                 L1 / R1  previous / next console
//                                                       L2 / R2  previous / next tab
//
// The Android app turns controller input into calls on window.GLTPad (see PadRouter.java).
// This file decides what each button does on the page. A and B can be swapped from the
// hamburger menu (Controller). Touch works exactly as before; touching the screen hides the
// highlight again.
(function(){
  const SWAP_KEY = 'pad-swap-ab';
  const REPEAT_FIRST = 380;   // ms before a held direction starts repeating
  const REPEAT_EVERY = 105;   // ms between repeats
  const SCROLL_MAX = 2400;    // px per second with the right stick fully pushed
  const STEP_SCROLL = 140;    // px per D-pad press when there is nothing to move to
  const DIRS = ['up', 'down', 'left', 'right'];

  // Everything on the page that can be activated. The first group is natively interactive; the
  // second group is the app's own clickable rows and cards (they are plain divs / table rows).
  const CLICKABLE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[tabindex]', '[role="button"]', '[role="switch"]',
    '.cart', '.unlock', '.year-item', '.subset-head', '.ag-result', '.soc-row',
    '.lib-table th', '.lib-table tbody tr', '.modal-art',
  ].join(',');

  let swapAB = false;
  let padMode = false;        // true while the highlight is showing
  let focusEl = null;
  let focusSig = null;        // lets the highlight find its element again after a redraw
  const memory = new WeakMap(); // last highlighted element per screen (dashboard, profile, ...)
  const held = {};
  const timers = {};
  let rs = 0;                 // right stick, -1 (up) .. 1 (down)

  const nativePad = window.PadNative || null;
  const showKeyboard = (on) => {
    try{ if(nativePad) on ? nativePad.showKeyboard() : nativePad.hideKeyboard(); }catch(e){ /* not in the app */ }
  };

  // ---- what is on screen ---------------------------------------------------------------------

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0; // display:none gives an empty box
  };
  const isTextField = (el) => !!el && (el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|range|color)$/.test(el.type)));

  function menuOpen(){ return $('#dropdown-menu').classList.contains('open'); }

  // The topmost full-screen layer, if any. Later modals sit above earlier ones.
  function topOverlay(){
    const zoom = $('#img-zoom-overlay');
    if(zoom.classList.contains('open')) return { type: 'zoom', el: zoom };
    const guide = $('#guide-reader-overlay');
    if(guide.classList.contains('open')) return { type: 'guide', el: guide };
    const modals = document.querySelectorAll('.modal-backdrop.open');
    if(modals.length) return { type: 'modal', el: modals[modals.length - 1] };
    return null;
  }

  // Where the highlight is allowed to move right now.
  function getRoot(){
    if(menuOpen()) return $('#dropdown-menu');
    const top = topOverlay();
    return top ? top.el : document.body;
  }

  // With the header on the top screen the open menu is drawn and scrolled there, so the stick and the
  // D-pad scroll that menu and leave the tracker page on the bottom screen where it is.
  const TOP_MENU = { topMenu: true };
  const topPanelOn = () => document.documentElement.classList.contains('top-panel');

  // What the right stick scrolls.
  function getScroller(){
    if(menuOpen() && topPanelOn()) return TOP_MENU;
    if(!menuOpen()){
      const top = topOverlay();
      if(top){
        if(top.type === 'guide') return $('#guide-reader-body');
        if(top.type === 'modal') return top.el; // modals and the game profile scroll themselves
        return null;
      }
    }
    return window;
  }
  function scrollBy(sc, dy){
    if(!sc) return;
    if(sc === TOP_MENU){
      try{ if(nativePad) nativePad.scrollTopMenu(dy); }catch(e){ /* not in the app */ }
      return;
    }
    if(sc === window) window.scrollBy(0, dy); else sc.scrollTop += dy;
  }

  function candidates(root){
    const out = [];
    // With the header on the top screen, its hidden copy here is only reachable through the menu.
    const skipHeader = root === document.body && document.documentElement.classList.contains('top-panel');
    root.querySelectorAll(CLICKABLE).forEach(el => {
      if(skipHeader && el.closest('.brand')) return;
      if(el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if(el.getAttribute('tabindex') === '-1') return;
      if(el.tagName === 'INPUT' && /^(hidden|file)$/.test(el.type)) return;
      const r = el.getBoundingClientRect();
      if(r.width <= 0 || r.height <= 0) return;
      out.push({ el, r });
    });
    return out;
  }

  // ---- the highlight -------------------------------------------------------------------------

  const cls = (el) => el.className.replace(/\bpad-focus\b/, '').trim();
  const signature = (el) => ({ id: el.id, gid: el.getAttribute('data-game-id'), tag: el.tagName, cls: cls(el) });

  function refind(list, sig){
    if(sig.id){
      const hit = list.find(i => i.el.id === sig.id);
      if(hit) return hit.el;
    }
    if(sig.gid){
      const hit = list.find(i => i.el.tagName === sig.tag && i.el.getAttribute('data-game-id') === sig.gid && cls(i.el) === sig.cls);
      if(hit) return hit.el;
    }
    return null;
  }

  function setFocus(el){
    if(focusEl && focusEl !== el) focusEl.classList.remove('pad-focus');
    focusEl = el;
    if(!el){ focusSig = null; return; }
    focusSig = signature(el);
    el.classList.add('pad-focus');
    memory.set(getRoot(), el);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function initialFocus(list){
    const tab = list.find(i => i.el.classList.contains('tab-btn') && i.el.classList.contains('active'));
    if(tab) return tab.el;
    const h = window.innerHeight;
    const onScreen = list.filter(i => i.r.bottom > 0 && i.r.top < h);
    const pool = onScreen.length ? onScreen : list;
    pool.sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
    return pool[0].el;
  }

  // Makes sure the highlight sits on something usable on the current screen and returns it.
  function ensureFocus(){
    const root = getRoot();
    if(focusEl && focusEl.isConnected && root.contains(focusEl) && isVisible(focusEl)) return focusEl;
    const list = candidates(root);
    if(!list.length){ setFocus(null); return null; }
    let el = focusSig ? refind(list, focusSig) : null;
    if(!el){
      const saved = memory.get(root);
      if(saved && list.some(i => i.el === saved)) el = saved;
    }
    if(!el) el = initialFocus(list);
    setFocus(el);
    return el;
  }

  const gap = (a1, a2, b1, b2) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));

  // The nearest candidate in a direction: close along that direction, and lined up across it.
  function pick(cur, dir, list){
    const c = cur.getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = null, bestScore = Infinity;
    for(const it of list){
      if(it.el === cur) continue;
      const r = it.r;
      const rx = r.left + r.width / 2, ry = r.top + r.height / 2;
      let ahead, primary, cross;
      if(dir === 'left' || dir === 'right'){
        ahead = dir === 'right' ? rx - cx : cx - rx;
        primary = dir === 'right' ? r.left - c.right : c.left - r.right;
        cross = gap(r.top, r.bottom, c.top, c.bottom);
      }else{
        ahead = dir === 'down' ? ry - cy : cy - ry;
        primary = dir === 'down' ? r.top - c.bottom : c.top - r.bottom;
        cross = gap(r.left, r.right, c.left, c.right);
      }
      if(ahead <= 1) continue; // not actually that way
      const score = Math.max(0, primary) + cross * 3 + Math.hypot(rx - cx, ry - cy) * 0.05;
      if(score < bestScore){ bestScore = score; best = it.el; }
    }
    return best;
  }

  function move(dir){
    const ae = document.activeElement;
    if(isTextField(ae)){
      if(dir === 'left' || dir === 'right'){ // inside a text box, left/right move the cursor
        try{
          const p = ae.selectionStart;
          const n = dir === 'left' ? Math.max(0, p - 1) : Math.min(ae.value.length, p + 1);
          ae.setSelectionRange(n, n);
        }catch(e){ /* field type without a cursor */ }
        return;
      }
      if(ae !== focusEl && ae.isConnected) setFocus(ae);
      ae.blur();
      showKeyboard(false);
    }
    const cur = ensureFocus();
    if(!cur) return;
    const next = pick(cur, dir, candidates(getRoot()));
    if(next) setFocus(next);
    else if(dir === 'up' || dir === 'down') scrollBy(getScroller(), dir === 'down' ? STEP_SCROLL : -STEP_SCROLL);
  }

  // Puts the highlight on the first game of the tab that is showing: the first recently played
  // card, library or backlog row, or Beaten by Year tile. Does nothing if there is no game yet.
  function focusFirstGame(){
    if(menuOpen() || topOverlay()) return;
    const panel = document.querySelector('.tab-panel.active');
    if(!panel) return;
    const first = candidates(panel).find(i => i.el.matches('.cart, .lib-table tbody tr, .year-item'));
    if(first) setFocus(first.el);
  }

  // ---- buttons -------------------------------------------------------------------------------

  function confirm(){
    const el = ensureFocus();
    if(!el) return;
    if(el.classList.contains('chip') && el.closest('#system-chips')){
      el.click();          // picking a console starts you on its first game
      focusFirstGame();
      return;
    }
    if(isTextField(el)){ el.focus(); showKeyboard(true); return; }
    if(el.tagName === 'SELECT'){ // the native picker can't be opened from here, so step through the options
      if(!el.options.length) return;
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    el.click();
  }

  // Closes or steps back out of whatever is open. Returns true if it did something.
  function goBack(){
    const ae = document.activeElement;
    if(isTextField(ae)){ ae.blur(); showKeyboard(false); return true; }
    const top = topOverlay();
    if(top){
      if(top.type === 'zoom'){ $('#img-zoom-close').click(); return true; }
      if(top.type === 'guide'){
        if($('#guide-find-bar').classList.contains('open')){ $('#guide-find-close').click(); return true; }
        if($('#guide-marks-panel').classList.contains('open')){ $('#guide-marks-btn').click(); return true; }
        if($('#guide-text-panel').classList.contains('open')){ $('#guide-text-btn').click(); return true; }
        $('#guide-reader-close').click();
        return true;
      }
      const back = top.el.querySelector('.soc-back, #patch-back-btn');
      if(back && isVisible(back)){ back.click(); return true; }
      const close = top.el.querySelector('.modal-close');
      if(close){ close.click(); return true; }
      if(top.el.id === 'modal-backdrop'){ closeGameModal(); return true; }
      return false;
    }
    if(menuOpen()){ closeDropdownMenu(); return true; }
    return false;
  }

  function toggleMenu(){
    const wrap = $('#menu-wrap');
    if(!wrap || !wrap.getClientRects().length) return; // not connected yet, no menu to open
    if(menuOpen()){ closeDropdownMenu(); return; }
    for(let i = 0; i < 8 && topOverlay(); i++) goBack(); // the menu lives on the main screen
    if(!topPanelOn()) window.scrollTo(0, 0); // with the menu on the top screen, the bottom page stays put
    $('#dropdown-menu').classList.add('open');
    ensureFocus();
  }

  function switchTab(delta){
    if(menuOpen() || topOverlay()) return;
    const tabs = Array.from(document.querySelectorAll('.tab-btn')).filter(isVisible);
    if(!tabs.length) return;
    const cur = Math.max(0, tabs.findIndex(t => t.classList.contains('active')));
    const next = Math.min(tabs.length - 1, Math.max(0, cur + delta));
    if(next !== cur){
      tabs[next].click();
      focusFirstGame();
    }
  }

  // Library, Beaten by Year and Backlog share a row of console filters; step through it.
  function switchSystem(delta){
    if(menuOpen() || topOverlay()) return;
    const row = $('#system-chips');
    if(!row || !row.classList.contains('visible')) return;
    const chips = Array.from(row.querySelectorAll('.chip'));
    if(!chips.length) return;
    const cur = Math.max(0, chips.findIndex(c => c.classList.contains('active')));
    const next = Math.min(chips.length - 1, Math.max(0, cur + delta));
    if(next === cur) return;
    chips[next].click(); // redraws the row, so look the active chip up again afterwards
    const active = row.querySelector('.chip.active');
    if(active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    focusFirstGame();
  }

  function press(name){
    const wasShowing = padMode;
    if(!padMode){ padMode = true; document.body.classList.add('pad-mode'); }
    const confirmKey = swapAB ? 'b' : 'a';
    if(DIRS.includes(name)){
      if(!wasShowing) ensureFocus(); // first press just shows where the highlight is
      else move(name);
    }else if(name === confirmKey){
      if(!wasShowing) ensureFocus(); else confirm();
    }else if(name === 'a' || name === 'b'){
      goBack();
    }else if(name === 'select'){
      toggleMenu();
    }else if(name === 'x'){
      if(window.padRefresh) window.padRefresh();
    }else if(name === 'l1'){
      switchSystem(-1);
    }else if(name === 'r1'){
      switchSystem(1);
    }else if(name === 'l2'){
      switchTab(-1);
    }else if(name === 'r2'){
      switchTab(1);
    }
  }

  // Called by the app for every button change. Directions repeat while held.
  function b(name, down){
    if(down){
      if(held[name]) return;
      held[name] = true;
      press(name);
      if(DIRS.includes(name)){
        const again = () => {
          if(!held[name]) return;
          press(name);
          timers[name] = setTimeout(again, REPEAT_EVERY);
        };
        timers[name] = setTimeout(again, REPEAT_FIRST);
      }
    }else{
      held[name] = false;
      clearTimeout(timers[name]);
    }
  }

  // Right stick: smooth scrolling that speeds up the further it is pushed.
  let raf = 0, lastT = 0;
  function tick(t){
    raf = 0;
    if(!rs) return;
    const dt = Math.min(50, t - lastT);
    lastT = t;
    scrollBy(getScroller(), Math.sign(rs) * rs * rs * SCROLL_MAX * dt / 1000);
    raf = requestAnimationFrame(tick);
  }
  function setRightStick(v){
    rs = v;
    if(rs && !raf){ lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function reset(){
    Object.keys(held).forEach(k => { held[k] = false; clearTimeout(timers[k]); });
    setRightStick(0);
  }

  window.GLTPad = { b, rs: setRightStick, reset, back: goBack };

  // Touching the screen hides the highlight; the controller brings it back.
  ['touchstart', 'mousedown'].forEach(type => document.addEventListener(type, () => {
    padMode = false;
    document.body.classList.remove('pad-mode');
  }, { passive: true, capture: true }));

  // The page redraws often (refreshes, tab changes, pop-ups). Whenever that leaves the highlight
  // without an element, put it back on the nearest equivalent so it never just disappears.
  let restoreTimer = 0;
  new MutationObserver(() => {
    if(!padMode || restoreTimer) return;
    restoreTimer = setTimeout(() => {
      restoreTimer = 0;
      const ok = focusEl && focusEl.isConnected && getRoot().contains(focusEl) && isVisible(focusEl);
      if(padMode && !ok) ensureFocus();
    }, 120);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

  // ---- Controller settings in the hamburger menu ---------------------------------------------

  function syncSwapUi(){
    const sw = $('#pad-swap-switch');
    sw.classList.toggle('on', swapAB);
    sw.setAttribute('aria-checked', swapAB ? 'true' : 'false');
    $('#pad-swap-note').textContent = swapAB ? 'B confirms, A goes back' : 'A confirms, B goes back';
  }
  $('#btn-pad-heading').addEventListener('click', (e) => {
    e.stopPropagation();
    const sub = $('#pad-submenu');
    const isOpen = sub.style.display === 'block';
    sub.style.display = isOpen ? 'none' : 'block';
    $('#pad-heading-arrow').textContent = isOpen ? '▸' : '▾';
  });
  $('#pad-swap-switch').addEventListener('click', async (e) => {
    e.stopPropagation();
    swapAB = !swapAB;
    syncSwapUi();
    try{ await window.storage.set(SWAP_KEY, swapAB ? '1' : '0', false); }catch(err){ /* non-fatal */ }
  });
  (async () => {
    try{
      const saved = await window.storage.get(SWAP_KEY, false);
      swapAB = !!saved && saved.value === '1';
    }catch(e){ /* nothing saved yet */ }
    syncSwapUi();
  })();
})();
