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

  let shown = null; // { wrap, head }

  function exit(){
    if(!shown) return false;
    const { wrap, head } = shown;
    shown = null;
    wrap.classList.remove('fs-panel');
    head.remove();
    document.documentElement.classList.remove('fs-on');
    if(wrap.classList.contains('achievements-list') && typeof achRerenderOpen === 'function') achRerenderOpen();
    return true;
  }
  window.glFsExit = exit;

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
    document.documentElement.classList.add('fs-on');
    shown = { wrap, head };
    wrap.scrollTop = 0;
    if(wrap.classList.contains('achievements-list') && typeof achRerenderOpen === 'function') achRerenderOpen();
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
