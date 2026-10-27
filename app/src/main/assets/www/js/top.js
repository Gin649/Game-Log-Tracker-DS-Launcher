// The top screen's copy of the tracker's header and profile card.
// The tracker page (mirror.js) sends the markup whenever it changes; this page only draws it,
// scaled to fill the screen, and passes taps back so the real menu does the work.
(function(){
  const stage = document.getElementById('stage');
  const DESIGN_WIDTH = 720; // the width the tracker lays this out at

  function fit(){
    stage.style.zoom = 1;
    const natural = stage.offsetHeight || 1;
    const scale = Math.min(window.innerWidth * 0.97 / DESIGN_WIDTH, window.innerHeight * 0.97 / natural);
    stage.style.zoom = Math.max(0.5, scale);
  }

  window.GLTTop = {
    set(html, bodyClass){
      stage.innerHTML = html;
      document.body.className = bodyClass || '';
      fit();
      const focused = stage.querySelector('.pad-focus'); // keep the controller highlight in view
      if(focused) focused.scrollIntoView({ block: 'nearest' });
    },
  };
  window.addEventListener('resize', fit);

  // A tap on anything with an id is passed to the real element; a tap elsewhere (outside the
  // menu) is passed as an empty id, which closes the menu just like tapping away would.
  document.addEventListener('click', (e) => {
    const withId = e.target.closest('[id]');
    let id = '';
    if(withId && !/^(stage|dropdown-menu|menu-wrap|profile-hero)$/.test(withId.id)) id = withId.id;
    if(!id && e.target.closest('#dropdown-menu')) return; // dead space inside the menu
    try{ window.TopBridge.tap(id); }catch(err){ /* not inside the app */ }
  });
})();
