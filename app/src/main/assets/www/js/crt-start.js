// The old-TV start-up animation on the top screen: a wood-grain TV (16:9 overall, 4:3 picture) that turns on
// as static, waves into a dim picture, and the emulator opens over it. ArtActivity calls GLTCrt.start() when Play is pressed
// and GLTCrt.stop() when the emulator takes over the screen.
(function(){
  const W = 440, H = 330, DUR = 2.0;   // the picture is drawn at this size, then scaled to the screen's height
  let root, flash, strips = [], noise, nctx, nimg, bar, built = false;
  let raf = 0, t0 = 0, audio = null, failsafe = 0;
  const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => 1 - Math.pow(1 - x, 3);
  
  function build(){
    root = document.createElement('div');
    root.id = 'crt-root';
    root.innerHTML = '<div id="crt-tv"><div id="crt-case"></div>' +
      '<div id="crt-grain"><svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><filter id="crt-w" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.004 0.22" numOctaves="4" seed="7"/>' +
      '<feColorMatrix type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 -2.2 1.35"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#crt-w)"/></svg></div>' +
      '<div id="crt-bez"><div id="crt-scr"><div id="crt-s"><div id="crt-c"></div><div id="crt-wv"></div>' +
      '<canvas id="crt-n" width="147" height="110"></canvas><div id="crt-b"></div><div id="crt-sl"></div></div>' +
      '<div id="crt-vg"></div><div id="crt-gl"></div></div></div>' +
      '<div id="crt-side"><div class="crt-knob" id="crt-k1"></div><div class="crt-knob" id="crt-k2"></div>' +
      '<i class="crt-gr" style="top:132px"></i><i class="crt-gr" style="top:148px"></i><i class="crt-gr" style="top:164px"></i>' +
      '<i class="crt-gr" style="top:180px"></i><i class="crt-gr" style="top:196px"></i><i class="crt-gr" style="top:212px"></i>' +
      '<i class="crt-btn" style="left:20px"></i><i class="crt-btn" style="left:68px"></i><i class="crt-btn" style="left:116px"></i><div id="crt-led"></div></div></div>';
    document.body.appendChild(root);
    flash = root.querySelector('#crt-c');
    flash.style.display = 'none'; // the turn-on flash is gone: it starts as static
    noise = root.querySelector('#crt-n');
    nctx = noise.getContext('2d');
    nimg = nctx.createImageData(147, 110);
    bar = root.querySelector('#crt-b');
    built = true;
  }

  // What the static clears into: a dim picture with a faint grid, so the wave can be seen. No title:
  // the emulator opens over it.
  function fill(){
    const wv = root.querySelector('#crt-wv');
    wv.innerHTML = '';
    strips = [];
    for(let y = 0; y < H; y += 8){
      const d = document.createElement('div');
      d.className = 'crt-st';
      d.style.top = y + 'px';
      d.innerHTML = '<div style="top:' + (-y) + 'px"></div>';
      wv.appendChild(d);
      strips.push(d);
    }
  }

  // Full-screen static from the first frame; it thins out while the picture waves into place.
  function draw(t){
    const nop = 1 - cl((t - 0.5) / 0.9);
    const vis = cl((t - 0.55) / 0.7);
    const u = cl((t - 0.5) / 1.1), amp = 26 * Math.pow(1 - u, 1.5);
    for(let i = 0; i < strips.length; i++){
      const d = strips[i];
      d.style.transform = 'translateX(' + (amp * Math.sin(i * 0.55 + t * 16)).toFixed(2) + 'px)';
      d.style.opacity = vis;
    }
    noise.style.opacity = nop;
    if(nop > 0.01){
      const u32 = new Uint32Array(nimg.data.buffer);
      for(let i = 0; i < u32.length; i++){ const v = (Math.random() * 255) | 0; u32[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
      nctx.putImageData(nimg, 0, 0);
    }
    bar.style.top = (((t * 1.4) % 1) * 380 - 80) + 'px';
    bar.style.opacity = t < 1.2 ? nop * 0.8 : 0;
  }

  function loop(now){
    const t = Math.min((now - t0) / 1000, DUR);
    draw(t);
    raf = t < DUR ? requestAnimationFrame(loop) : 0;
  }

  window.GLTCrt = {
    start(){
      if(!built) build();
      fill();
      root.style.display = 'block';
      // the whole 16:9 TV fills the screen, with a thin black margin around it
      root.querySelector('#crt-tv').style.transform = 'scale(' + Math.min(window.innerHeight * 0.98 / 410, window.innerWidth * 0.98 / 729) + ')';
      cancelAnimationFrame(raf);
      t0 = performance.now();
      draw(0);
      raf = requestAnimationFrame(loop);
      try{
        if(!audio) audio = new Audio('crt-start.wav');
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }catch(e){ /* no sound is fine */ }
      clearTimeout(failsafe);
      failsafe = setTimeout(() => window.GLTCrt.stop(), 12000); // never leave it covering the screen
    },
    stop(){
      clearTimeout(failsafe);
      cancelAnimationFrame(raf); raf = 0;
      if(root) root.style.display = 'none';
      try{ if(audio) audio.pause(); }catch(e){}
    }
  };
})();
