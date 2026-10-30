// On two screens the header (logo, menu) and profile card show on the top screen. The real elements
// stay here, hidden, so buttons and controller navigation keep working: a copy is sent to the top
// screen whenever they change, and a tap on the copy presses the real button.
(function(){
  const native = window.PadNative || null;
  let active = false, timer = 0, last = null;

  function snapshot(){
    const wrap = $('#menu-wrap');
    if(!wrap || wrap.style.display === 'none') return null;
    // About is shown on the top screen in place of the header while it is open.
    if($('#about-backdrop').classList.contains('open')){
      return { html: '<div class="about-top">' + $('#about-card').outerHTML + '</div>', body: document.body.classList.contains('pad-mode') ? 'pad-mode' : '' };
    }
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
    try{ native.pushPanel(s ? s.html : '', s ? s.body : ''); }catch(e){}
  }
  const schedule = () => { if(active && !timer) timer = setTimeout(push, 60); };

  const watch = { subtree: true, childList: true, attributes: true, characterData: true };
  new MutationObserver(schedule).observe(document.querySelector('.brand'), watch);
  new MutationObserver(schedule).observe($('#profile-hero'), watch);
  new MutationObserver(schedule).observe($('#ra-content'), { attributes: true, attributeFilter: ['style'] });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(schedule).observe($('#about-backdrop'), { attributes: true, attributeFilter: ['class'] });

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

  try{ if(native && native.topPanelActive()) setActive(true); }catch(e){}
})();
