// The start-up animation on the top screen: full-screen TV static that waves into a dark picture, and the
// emulator opens over it. ArtActivity calls GLTCrt.start() when Play is pressed
// and GLTCrt.stop() when the emulator takes over the screen.
(function(){
  const W = 960, H = 540, DUR = 2.0;   // the picture is drawn at this size, then scaled to the screen's height
  let root, strips = [], noise, nctx, nimg, bar, built = false;
  let raf = 0, t0 = 0, audio = null, failsafe = 0;
  const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => 1 - Math.pow(1 - x, 3);
  
  function build(){
    root = document.createElement('div');
    root.id = 'crt-root';
    root.innerHTML = '<div id="crt-full"><div id="crt-wv"></div><canvas id="crt-n" width="240" height="135"></canvas>' +
      '<div id="crt-b"></div><div id="crt-sl"></div></div>';
    document.body.appendChild(root);
    noise = root.querySelector('#crt-n');
    nctx = noise.getContext('2d');
    nimg = nctx.createImageData(240, 135);
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
    const u = cl((t - 0.5) / 1.1), amp = 46 * Math.pow(1 - u, 1.5);
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
    bar.style.top = (((t * 1.4) % 1) * 680 - 140) + 'px';
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
      // fills the screen: the 16:9 picture is scaled to cover it
      root.querySelector('#crt-full').style.transform = 'scale(' + Math.max(window.innerWidth / W, window.innerHeight / H) + ')';
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
