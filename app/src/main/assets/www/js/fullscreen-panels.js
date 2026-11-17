// A section of the game profile shown full screen: View Achievements, View Beaten Achievements and Game Details.
// While a section is open, an expand icon sits at the right end of its bar; tapping it fills the screen with that
// section, under a slim header whose icon (or Back) puts it back. The section itself stays where it is in the
// profile and is only drawn over the whole screen, so everything that updates it keeps working.
// Full-screen achievements are small tiles framed teal (casual) or gold (hardcore): see achFsOn in achievements.js.
(function(){
  const ICON_EXPAND = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
  const ICON_SHRINK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>';

  // The icons are drawn here so the buttons in game-modal.js only carry an empty marker.
  function fillIcons(root){
    (root || document).querySelectorAll('.fs-expand:empty').forEach(el => { el.innerHTML = ICON_EXPAND; });
  }
  const card = document.getElementById('modal-card');
  if(card){
    fillIcons(card);
    new MutationObserver(() => fillIcons(card)).observe(card, { childList: true, subtree: true });
  }

  let shown = null; // { wrap, head, watch }

  // Tiles that fit: with as many to a row as you pinched to, the tiles are made a little smaller when their rows
  // would just run past the bottom of the screen, so the whole set shows at once. When it would take more than a
  // small squeeze (you pinched to big tiles), they keep their size and the screen scrolls instead.
  const MIN_FIT_TILE = 28;
  const MAX_SQUEEZE = 0.8; // tiles are made at most 20% smaller to fit
  function fit(){
    if(!shown) return;
    const wrap = shown.wrap;
    wrap.querySelectorAll('.ach-tiles').forEach(grid => {
      if(grid.querySelector('.ach-bubble')) return; // a details bubble pads the grid: keep the sizes as they are
      grid.classList.remove('fs-fit');
      grid.style.gridTemplateColumns = '';
      const n = parseInt(getComputedStyle(grid).getPropertyValue('--ach-cols'), 10) || 8;
      const count = grid.querySelectorAll('.ach-tile').length;
      if(!count) return;
      const rows = Math.ceil(count / n);
      const cs = getComputedStyle(grid);
      const gap = parseFloat(cs.columnGap) || 4;
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const tileW = (grid.clientWidth - padX - gap * (n - 1)) / n;
      const top = grid.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
      const room = wrap.clientHeight - top - padY - (parseFloat(getComputedStyle(wrap).paddingBottom) || 0);
      const tileH = (room - gap * (rows - 1)) / rows;
      const size = Math.floor(Math.min(tileW, tileH));
      // Only a small squeeze: when the rows overflow by more than that, a pinch to bigger tiles must give
      // bigger tiles, so they keep their size and the screen scrolls.
      if(size >= MIN_FIT_TILE && size < tileW && size >= tileW * MAX_SQUEEZE){
        grid.classList.add('fs-fit');
        grid.style.gridTemplateColumns = `repeat(${n}, ${size}px)`;
      }
    });
  }
  window.glFsFit = () => requestAnimationFrame(fit);

  function exit(){
    if(!shown) return false;
    const { wrap, head, watch } = shown;
    shown = null;
    watch.disconnect();
    wrap.querySelectorAll('.ach-tiles').forEach(g => { g.classList.remove('fs-fit'); g.style.gridTemplateColumns = ''; });
    wrap.classList.remove('fs-panel');
    wrap.style.top = '';
    head.remove();
    document.documentElement.classList.remove('fs-on');
    if(wrap.classList.contains('achievements-list') && typeof achRerenderOpen === 'function') achRerenderOpen();
    return true;
  }
  window.glFsExit = exit;
  window.addEventListener('resize', () => window.glFsFit());

  function enter(btn){
    const wrap = btn.nextElementSibling;
    if(!wrap || !btn.classList.contains('open')) return;
    exit();
    const title = (btn.textContent || '').replace('▸', '').trim();
    const head = document.createElement('div');
    head.className = 'fs-head';
    const name = card && card.querySelector('.modal-body h2');
    head.innerHTML = `<span class="fs-title"></span><button class="fs-shrink" type="button" aria-label="Leave full screen" title="Leave full screen">${ICON_SHRINK}</button>`;
    head.querySelector('.fs-title').textContent = (name ? name.textContent + ' · ' : '') + title;
    head.querySelector('.fs-shrink').addEventListener('click', (e) => { e.stopPropagation(); exit(); });
    wrap.parentElement.insertBefore(head, wrap);
    wrap.classList.add('fs-panel');
    wrap.style.top = Math.round(head.getBoundingClientRect().height) + 'px'; // right under the header
    document.documentElement.classList.add('fs-on');
    // The section is drawn again when achievements unlock or the view changes: fit the new tiles each time.
    const watch = new MutationObserver(() => window.glFsFit());
    watch.observe(wrap, { childList: true, subtree: true });
    shown = { wrap, head, watch };
    wrap.scrollTop = 0;
    if(wrap.classList.contains('achievements-list') && typeof achRerenderOpen === 'function') achRerenderOpen();
    window.glFsFit();
  }

  // Captured before the bar's own click, so the expand icon doesn't also close the section.
  document.addEventListener('click', (e) => {
    const icon = e.target && e.target.closest && e.target.closest('.fs-expand');
    if(!icon) return;
    e.stopPropagation();
    e.preventDefault();
    const btn = icon.closest('.btn-view-achievements');
    if(btn) enter(btn);
  }, true);

  // The profile closing takes the full-screen section with it.
  const backdrop = document.getElementById('modal-backdrop');
  if(backdrop){
    new MutationObserver(() => { if(!backdrop.classList.contains('open')) exit(); })
      .observe(backdrop, { attributes: true, attributeFilter: ['class'] });
  }
})();
