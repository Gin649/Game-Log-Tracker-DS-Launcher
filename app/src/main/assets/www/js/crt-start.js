// The start-up animation on the top screen: full-screen TV static, held until the emulator opens over it.
// ArtActivity calls GLTCrt.start() when Play is pressed and GLTCrt.stop() when the emulator takes over.
(function(){
  const W = 960, H = 540;   // drawn at this size, then scaled to cover the screen
  let root, noise, nctx, nimg, bar, word, built = false;
  let raf = 0, t0 = 0, audio = null, failsafe = 0;

  function build(){
    root = document.createElement('div');
    root.id = 'crt-root';
    root.innerHTML = '<div id="crt-full"><canvas id="crt-n" width="240" height="135"></canvas>' +
      '<div id="crt-b"></div><div id="crt-t">GAME<br>STARTING</div><div id="crt-sl"></div></div>';
    document.body.appendChild(root);
    noise = root.querySelector('#crt-n');
    nctx = noise.getContext('2d');
    nimg = nctx.createImageData(240, 135);
    bar = root.querySelector('#crt-b');
    word = root.querySelector('#crt-t');
    built = true;
  }

  // Full-screen static, held until the emulator opens over it.
  function draw(t){
    const u32 = new Uint32Array(nimg.data.buffer);
    for(let i = 0; i < u32.length; i++){ const v = (Math.random() * 255) | 0; u32[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
    nctx.putImageData(nimg, 0, 0);
    bar.style.top = (((t * 1.4) % 1) * 680 - 140) + 'px';
    bar.style.opacity = 0.7;
    word.style.opacity = (0.3 + Math.random() * 0.15).toFixed(2); // faint, and it flickers a little like the static
  }

  function loop(now){
    draw((now - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }

  window.GLTCrt = {
    // quiet: the app plays the sound itself (the top screen does)
    start(title, quiet){
      if(!built) build();
      root.style.display = 'block';
      // fills the screen: the 16:9 picture is scaled to cover it
      root.querySelector('#crt-full').style.transform = 'scale(' + Math.max(window.innerWidth / W, window.innerHeight / H) + ')';
      cancelAnimationFrame(raf);
      t0 = performance.now();
      draw(0);
      raf = requestAnimationFrame(loop);
      if(!quiet) try{
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
