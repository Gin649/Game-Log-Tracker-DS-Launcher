// The top screen's copy of the tracker's header and profile card.
// The tracker page (mirror.js) sends the markup whenever it changes; this page only draws it,
// scaled to fill the screen, and passes taps back so the real menu does the work.
(function(){
  const stage = document.getElementById('stage');
  const DESIGN_WIDTH = 720; // the width the tracker lays this out at

  const MENU_ZOOM = 0.7;  // keep in step with the zoom on .dropdown-menu in top.html
  let stageZoom = 1;

  const openMenu = () => stage.querySelector('#dropdown-menu.open');

  function fit(){
    stage.style.zoom = 1;
    const natural = stage.offsetHeight || 1;
    // Where the open menu starts, measured at zoom 1 so it doesn't depend on how zoom is reported.
    const menu = openMenu();
    let menuTop = 0;
    if(menu){
      menu.style.maxHeight = 'none';
      menuTop = menu.getBoundingClientRect().top;
    }
    const scale = Math.min(window.innerWidth * 0.97 / DESIGN_WIDTH, window.innerHeight * 0.97 / natural);
    stageZoom = Math.max(0.5, scale);
    stage.style.zoom = stageZoom;
    if(menu){
      // Room left under the button, in the menu's own units. The list scrolls inside this.
      const room = window.innerHeight / stageZoom - menuTop - 8 / stageZoom;
      menu.style.maxHeight = Math.max(60, room / MENU_ZOOM) + 'px';
    }
  }

  // Keeps the controller highlight visible inside the menu by scrolling the menu itself (never the page).
  // Only follows the highlight when it has moved. A tap that opens a section redraws the menu with the
  // highlight where it was, and chasing it would send the list back to the top.
  let lastFocusKey = '';
  function keepFocusInMenu(){
    const menu = openMenu();
    const el = menu && menu.querySelector('.pad-focus');
    if(!el){ lastFocusKey = ''; return; }
    const key = Array.prototype.indexOf.call(menu.querySelectorAll('*'), el) + ':' + (el.id || el.textContent.slice(0, 20));
    if(key === lastFocusKey) return;
    lastFocusKey = key;
    const k = stageZoom * MENU_ZOOM;
    for(let i = 0; i < 3; i++){
      const m = menu.getBoundingClientRect(), r = el.getBoundingClientRect();
      if(r.top < m.top) menu.scrollTop -= (m.top - r.top) / k + 2;
      else if(r.bottom > m.bottom) menu.scrollTop += (r.bottom - m.bottom) / k + 2;
      else break;
    }
  }

  // Which menu sections are open, so a section that has just opened can be brought to the top of the list.
  let openSections = '';
  const sectionsOpen = (menu) => Array.prototype.filter.call(menu.querySelectorAll('.dropdown-heading'), h => h.textContent.indexOf('\u25be') >= 0)
    .map(h => h.id);

  // Scrolls the menu until this heading is at its top. How far the list moves for a given scrollTop depends on how
  // the screen reports zoom, so this measures what each step really did and corrects (a few steps at most).
  function headToTop(menu, head){
    let k = stageZoom * MENU_ZOOM; // screen pixels per scrollTop unit, to start with
    for(let i = 0; i < 5; i++){
      const diff = head.getBoundingClientRect().top - menu.getBoundingClientRect().top - 2;
      if(Math.abs(diff) < 3) break;
      const before = menu.scrollTop, y0 = head.getBoundingClientRect().top;
      menu.scrollTop = before + diff / k;
      const moved = y0 - head.getBoundingClientRect().top;
      const used = menu.scrollTop - before;
      if(Math.abs(used) < 0.5) break; // at the end of the list
      if(Math.abs(moved) > 0.5) k = Math.abs(moved / used);
    }
  }

  window.GLTTop = {
    set(html, bodyClass){
      const before = openMenu();
      if(!before){ lastFocusKey = ''; openSections = ''; }
      const kept = before ? before.scrollTop : 0;
      stage.innerHTML = html;
      document.body.className = bodyClass || '';
      fit();
      const menu = openMenu();
      if(menu && before) menu.scrollTop = kept; // a redraw shouldn't send the list back to the top
      if(menu){
        const now = sectionsOpen(menu);
        const was = openSections ? openSections.split(',') : [];
        const fresh = now.filter(id => was.indexOf(id) < 0)[0];
        openSections = now.join(',');
        const head = fresh && menu.querySelector('#' + fresh);
        if(head){ // a section just opened: put its heading at the top so all of it shows
          headToTop(menu, head);
          lastFocusKey = ''; // and make sure the highlight (still on that heading) is in view
        }
      }
      keepFocusInMenu();
    },
    // The controller's right stick (or D-pad past the end) scrolls the menu here, not the tracker page.
    scrollMenu(dy){
      const menu = openMenu();
      if(menu) menu.scrollTop += dy * 0.6;
    },
  };
  window.addEventListener('resize', fit);

  // A tap on anything with an id is passed to the real element; a tap elsewhere (outside the
  // menu) is passed as an empty id, which closes the menu just like tapping away would.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if(link){ // a link on the copy is opened by the real one
      e.preventDefault();
      if(link.id) try{ window.TopBridge.tap(link.id); }catch(err){ /* not inside the app */ }
      return;
    }
    const withId = e.target.closest('[id]');
    let id = '';
    if(withId && !/^(stage|dropdown-menu|menu-wrap|profile-hero)$/.test(withId.id)) id = withId.id;
    if(!id && e.target.closest('#dropdown-menu')) return; // dead space inside the menu
    try{ window.TopBridge.tap(id); }catch(err){ /* not inside the app */ }
  });
})();
