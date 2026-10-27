// Clock and battery readout at the top of the screen, on by default (Display in the menu).
// The Android app has no system status bar on this screen, so this is the clock and battery.
// The battery comes from navigator.getBattery(), which thor.js provides inside the app.

const STATUS_KEY = 'device-status-on';
const STATUS_SUPPORTED = typeof navigator.getBattery === 'function';
let deviceStatusOn = false;
let batteryManager = null;
let clockTimer = null;

// 13x11 pixel heart. X marks the heart, and its outer ring of pixels becomes the outline.
const HEART_SHAPE = [
  '..XXX...XXX..',
  '.XXXXX.XXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '...XXXXXXX...',
  '....XXXXX....',
  '.....XXX.....',
  '......X......',
];

function buildHeart(filled){
  const at = (x, y) => y >= 0 && y < HEART_SHAPE.length && HEART_SHAPE[y][x] === 'X';
  let cells = '';
  for(let y = 0; y < HEART_SHAPE.length; y++){
    for(let x = 0; x < HEART_SHAPE[y].length; x++){
      if(!at(x, y)) continue;
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      let fill;
      if(edge) fill = 'fill="' + ((x + y) % 2 ? '#b8a58e' : '#e4d4c0') + '"';
      else if(filled) fill = 'fill="#862200"';
      else fill = 'fill="#000" fill-opacity="0.45"';
      cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1" ' + fill + '/>';
    }
  }
  return '<svg width="19.5" height="16.5" viewBox="0 0 13 11" shape-rendering="crispEdges" style="display:block" aria-hidden="true">' + cells + '</svg>';
}
const HEART_FULL = buildHeart(true);
const HEART_EMPTY = buildHeart(false);

// A heart empties as the battery drops to 75, 50, 25 and 5 percent.
function heartsFor(percent){
  if(percent > 75) return 4;
  if(percent > 50) return 3;
  if(percent > 25) return 2;
  if(percent > 5) return 1;
  return 0;
}

function clockText(){
  const now = new Date();
  const hour = now.getHours() % 12 || 12;
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return hour + ':' + minutes + (now.getHours() >= 12 ? 'PM' : 'AM');
}

function drawDeviceStatus(){
  let hearts = '';
  if(batteryManager){
    const full = heartsFor(Math.round(batteryManager.level * 100));
    for(let i = 0; i < 4; i++) hearts += i < full ? HEART_FULL : HEART_EMPTY;
  }
  $('#status-hearts').innerHTML = hearts;
  $('#status-time').textContent = clockText();
}

// Redraw on the minute so the clock never lags more than a second or two.
function scheduleClock(){
  clearTimeout(clockTimer);
  clockTimer = setTimeout(() => { drawDeviceStatus(); scheduleClock(); }, 60000 - (Date.now() % 60000) + 50);
}

async function applyDeviceStatus(on){
  deviceStatusOn = on && STATUS_SUPPORTED;
  document.body.classList.toggle('show-status', deviceStatusOn);
  const toggle = $('#display-status-switch');
  toggle.classList.toggle('on', deviceStatusOn);
  toggle.setAttribute('aria-checked', String(deviceStatusOn));
  if(!deviceStatusOn){
    clearTimeout(clockTimer);
    return;
  }
  if(!batteryManager){
    try{
      batteryManager = await navigator.getBattery();
      batteryManager.addEventListener('levelchange', drawDeviceStatus);
    }catch(e){ /* no battery info, the clock still shows */ }
  }
  if(!deviceStatusOn) return; // switched off while waiting for the battery
  drawDeviceStatus();
  scheduleClock();
}

async function initDeviceStatus(){
  if(!STATUS_SUPPORTED){
    $('#display-status-switch').disabled = true;
    $('#display-status-note').textContent = 'Not available on this device or browser';
    return;
  }
  let on = true; // visible unless it was switched off in the Display menu
  try{
    const saved = await window.storage.get(STATUS_KEY, false);
    if(saved && saved.value === '0') on = false;
  }catch(e){ /* nothing saved yet */ }
  await applyDeviceStatus(on);
}
initDeviceStatus();

// Timers are paused while the app is in the background, so catch up when it comes back.
document.addEventListener('visibilitychange', () => {
  if(deviceStatusOn && document.visibilityState === 'visible'){ drawDeviceStatus(); scheduleClock(); }
});

$('#btn-display-heading').addEventListener('click', (e) => {
  e.stopPropagation();
  const submenu = $('#display-submenu');
  const isOpen = submenu.style.display === 'block';
  submenu.style.display = isOpen ? 'none' : 'block';
  $('#display-heading-arrow').textContent = isOpen ? '▸' : '▾';
});
$('#display-status-switch').addEventListener('click', async (e) => {
  e.stopPropagation();
  const next = !deviceStatusOn;
  applyDeviceStatus(next);
  try{ await window.storage.set(STATUS_KEY, next ? '1' : '0', false); }catch(err){ /* non-fatal */ }
});
