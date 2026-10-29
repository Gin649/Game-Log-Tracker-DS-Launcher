// Shared state and small helpers used by every other script.

const MEDIA = 'https://media.retroachievements.org';
let creds = null; // { username, apiKey }
let libraryData = [];
let recentGamesData = [];
let lastProfile = null; // kept to recompute profile stats once the library loads
let userPoints = null; // { Points (hardcore), SoftcorePoints }: separate totals, not one inside the other
let statsMode = 'casual'; // 'casual' | 'hardcore'
let libraryIndex = {}; // GameID -> library entry
let librarySort = { key: 'Title', dir: 'asc' };
const estHoursCache = {}; // GameID -> { hours, beaten }, this session only
const achievementsListCache = {}; // GameID -> achievement list with earn dates, filled by getEstimatedHours()
let systemFilter = 'All';
let libraryHideDone = false; // Game Library: hide beaten and mastered games

// Games ticked in the Add Game search but not added yet, keyed by GameID, so the ticks survive a
// new search. Cleared when the modal opens or closes.
let addGameSelections = new Map();

// Runs loadAll() and manual add/remove one at a time, so a game added during the first load
// isn't overwritten by that load's older data.
let taskQueue = Promise.resolve();
function enqueueTask(fn){
  const run = taskQueue.then(fn, fn);
  taskQueue = run.catch(() => {});
  return run;
}
let activeTab = 'overview';
const gameExtendedCache = {}; // GameID -> API_GetGameExtended result

const $ = (sel) => document.querySelector(sel);

function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseRADate(dateStr){
  if(!dateStr) return null;
  let s = String(dateStr).trim();
  if(s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if(!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z'; // RA times are UTC without an offset
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// "Sep 02, 2026", whatever the locale.
const BEATEN_DATE_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatBeatenDate(d){
  if(!d || isNaN(d.getTime())) return '';
  return `${BEATEN_DATE_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}
// Manual games store "YYYY-MM-DD". Read it field by field so the time zone can't move it a day.
function formatManualBeatenDate(str){
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return '';
  return formatBeatenDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function beatenDateHtml(text){
  return text ? `<span class="beaten-date">${text}</span>` : '';
}
function manualStatusHtml(local){
  if(local.manualBeaten){
    return '<span class="pill pill-teal">Beaten</span>' + beatenDateHtml(formatManualBeatenDate(local.manualBeatenDate));
  }
  return local.manualStarted ? '<span class="pill pill-muted">In progress</span>' : '<span class="pill pill-muted">Not started</span>';
}

function timeAgo(dateStr){
  const d = parseRADate(dateStr);
  if(!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if(diff < 60) return 'just now';
  if(diff < 3600) return Math.floor(diff/60) + 'm ago';
  if(diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
