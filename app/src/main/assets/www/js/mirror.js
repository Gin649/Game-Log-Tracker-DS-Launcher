// Top screen header. On a two-screen handheld the app shows the header (logo, hamburger menu) and
// the profile card on the top screen, and this page starts at the tabs. The real elements stay in
// this page, hidden, so every button and the controller navigation keep working; this file sends
// a copy of them to the top screen whenever they change, and presses the real button when the
// copy is tapped.
(function(){
  const native = window.PadNative || null;
  let active = false, timer = 0, last = null;

  function snapshot(){
    const wrap = $('#menu-wrap');
    if(!wrap || wrap.style.display === 'none') return null; // dashboard not up yet
    const hero = $('#profile-hero');
    const heroShown = hero.children.length > 0 && $('#ra-content').style.display !== 'none';
    return {
      html: document.querySelector('.brand').outerHTML + (heroShown ? hero.outerHTML : ''),
      body: document.body.classList.contains('pad-mode') ? 'pad-mode' : '',
    };
  }

  function push(){
    timer = 0;
    if(!active || !native) return;
    const s = snapshot();
    const key = s ? s.body + '|' + s.html : '';
    if(key === last) return;
    last = key;
    try{ native.pushPanel(s ? s.html : '', s ? s.body : ''); }catch(e){ /* app side not ready */ }
  }
  const schedule = () => { if(active && !timer) timer = setTimeout(push, 60); };

  const watch = { subtree: true, childList: true, attributes: true, characterData: true };
  new MutationObserver(schedule).observe(document.querySelector('.brand'), watch);
  new MutationObserver(schedule).observe($('#profile-hero'), watch);
  new MutationObserver(schedule).observe($('#ra-content'), { attributes: true, attributeFilter: ['style'] });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  function setActive(on){
    active = !!on;
    document.documentElement.classList.toggle('top-panel', active);
    last = null;
    if(active) push();
  }

  window.GLTMirror = {
    setActive,
    // The top screen's copy was tapped; '' means a tap outside the menu.
    click(id){
      if(id !== '' && !/^[\w-]+$/.test(id)) return;
      const el = id ? document.getElementById(id) : document.body;
      if(el) el.click();
    },
  };

  try{ if(native && native.topPanelActive()) setActive(true); }catch(e){ /* not in the app */ }
})();
