/* Find a playmate — the whole front end.
 * Vanilla JS on the design kit's tokens: hash router, the Games screen, a
 * game's own screen, the New game form and the rate and player sheets.
 * All user data is rendered through esc() as text; nothing from the API
 * ever reaches innerHTML unescaped. */
(() => {
'use strict';

const $app = document.getElementById('app');
const search = new URLSearchParams(location.search);
const TOKEN = search.get('token') || '';
const DEMO = search.get('demo') === '1';
const LOCALE = navigator.language || 'en';
const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return 'UTC'; }
})();

const esc = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The request's moment: the bridge's usernode.now() honours a staging
// preview's ?un-now; the plain Date is the fallback outside the frame.
function now() {
  try { if (window.usernode && window.usernode.now) return window.usernode.now(); } catch (_) {}
  return new Date();
}

let currency = null;
function amount(n) {
  return currency
    ? new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
    : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(n);
}
const shareText = (fee, n) => (fee === 0 ? 'Free' : `${amount(fee)} each`);

// ── Time formatting ───────────────────────────────────────────────────────
function timeParts(d) {
  const parts = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(d);
  const period = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
  // The locale's own literal before the day period ("7:00 PM") is a lone
  // space; drop it or timeRange adds a second one ("7:00  to").
  const time = parts.filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal')
    .map((p) => p.value).join('').trim();
  return { time, period: period.toLowerCase() };
}
function timeRange(a, b) {
  const x = timeParts(a), y = timeParts(b);
  return x.period === y.period
    ? `${x.time} to ${y.time} ${y.period}`
    : `${x.time} ${x.period} to ${y.time} ${y.period}`;
}
const daysBetween = (d1, d2) => Math.round(
  (new Date(d2.getFullYear(), d2.getMonth(), d2.getDate())
    - new Date(d1.getFullYear(), d1.getMonth(), d1.getDate())) / 86400000);
// "Today", "Tomorrow" or '' — nothing, when the day heading already says it.
function relDay(d) {
  const n = daysBetween(now(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : '';
}
const dateLabel = (d) => d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
// "Today, 7:00 to 9:00 pm" or "8:00 to 10:00 am" (a day heading says the day).
function whenLine(d1, d2, withDay) {
  const rel = withDay ? relDay(d1) : '';
  return rel ? `${rel}, ${timeRange(d1, d2)}` : timeRange(d1, d2);
}
// "Today, Sat 10 Oct, 7:00 to 9:00 pm" — a game's own screen.
function fullWhen(d1, d2) {
  const rel = relDay(d1);
  const bits = [rel, dateLabel(d1)].filter(Boolean);
  return `${bits.join(', ')}, ${timeRange(d1, d2)}`;
}
const dayHeading = (d) => {
  const n = daysBetween(now(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : dateLabel(d);
};

// ── The drawn court ───────────────────────────────────────────────────────
// Spots alternate sides of the net, left first; a half's layout is fixed
// per capacity (the same idea as lib/rules.js courtSpots).
const HALF = {
  1: [[16, 22]], 2: [[16, 14], [16, 30]], 3: [[11, 14], [21, 14], [11, 30]],
  4: [[11, 14], [21, 14], [11, 30], [21, 30]],
  5: [[11, 11], [21, 11], [11, 22], [21, 22], [11, 33]],
  6: [[11, 11], [21, 11], [11, 22], [21, 22], [11, 33], [21, 33]],
};
function courtSmall(needed, taken, viewerSpot) {
  const base = HALF[Math.min(Math.ceil(needed / 2), 6)];
  let dots = '';
  for (let i = 0; i < needed; i++) {
    const [x, y] = base[Math.floor(i / 2)];
    const cx = i % 2 === 0 ? x : x + 40;
    const cls = i === viewerSpot ? 'd-me' : i < taken ? 'd-on' : 'd-open';
    dots += `<circle class="${cls}" cx="${cx}" cy="${y}" r="3.5"/>`;
  }
  return `<svg class="court-svg mt-0.5" viewBox="0 0 72 44" width="72" height="44" aria-hidden="true"><rect class="c-fill" width="72" height="44" rx="4"/><rect class="c-ln" x="5" y="5" width="62" height="34"/><line class="c-ln" x1="28" y1="5" x2="28" y2="39"/><line class="c-ln" x1="44" y1="5" x2="44" y2="39"/><line class="c-ln" x1="5" y1="22" x2="28" y2="22"/><line class="c-ln" x1="44" y1="22" x2="67" y2="22"/><line class="c-ln c-net" x1="36" y1="2" x2="36" y2="42"/>${dots}</svg>`;
}
function bigRows(k) {
  if (k <= 1) return [100];
  if (k === 2) return [56, 138];
  if (k === 3) return [45, 100, 155];
  if (k === 4) return [40, 80, 120, 160];
  const rows = [];
  for (let i = 0; i < k; i++) rows.push(Math.round(40 + (i * 120) / (k - 1)));
  return rows;
}
function courtBig(game, players) {
  const k = Math.min(Math.ceil(game.playersNeeded / 2), 6);
  const rows = bigRows(k);
  let dots = '';
  for (let i = 0; i < game.playersNeeded; i++) {
    const y = rows[Math.floor(i / 2)];
    const x = i % 2 === 0 ? 86 : 272;
    const p = i < players.length ? players[i] : null;
    if (!p) {
      dots += `<circle class="d-open" cx="${x}" cy="${y}" r="20"/><text class="t-lbl" x="${x}" y="${y + 36}" text-anchor="middle">Open</text>`;
    } else if (p.isViewer) {
      dots += `<circle class="d-me" cx="${x}" cy="${y}" r="20"/><text class="t-me" x="${x}" y="${y + 5}" text-anchor="middle">You</text>`;
    } else {
      const initial = (p.username[0] || '?').toUpperCase();
      dots += `<circle class="d-on" cx="${x}" cy="${y}" r="20"/><text class="t-in" x="${x}" y="${y + 5}" text-anchor="middle">${esc(initial)}</text>`
        + `<text class="t-lbl" x="${x}" y="${y + 36}" text-anchor="middle">${esc(p.username)}</text>`;
    }
  }
  return `<svg class="court-svg court-lg" viewBox="0 0 358 200" role="img" aria-label="Court with ${players.length} of ${game.playersNeeded} spots taken"><rect class="c-fill" width="358" height="200" rx="10"/><rect class="c-ln" x="14" y="14" width="330" height="172"/><line class="c-ln" x1="14" y1="27" x2="344" y2="27"/><line class="c-ln" x1="14" y1="173" x2="344" y2="173"/><line class="c-ln" x1="33" y1="14" x2="33" y2="186"/><line class="c-ln" x1="325" y1="14" x2="325" y2="186"/><line class="c-ln" x1="139" y1="14" x2="139" y2="186"/><line class="c-ln" x1="219" y1="14" x2="219" y2="186"/><line class="c-ln" x1="14" y1="100" x2="139" y2="100"/><line class="c-ln" x1="219" y1="100" x2="344" y2="100"/><line class="c-ln c-net" x1="179" y1="6" x2="179" y2="194"/><circle class="post" cx="179" cy="6" r="4"/><circle class="post" cx="179" cy="194" r="4"/>${dots}</svg>`;
}

const SKILL_BARS = { beginner: 1, intermediate: 2, advanced: 3 };
const SKILL_WORD = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
function skillMeter(skill) {
  const n = SKILL_BARS[skill] || 0;
  const rects = [[4, 14, 6], [10, 10, 10], [16, 5, 15]]
    .map(([x, y, h], i) => `<rect class="${i < n ? 'bar-on' : 'bar-off'}" x="${x}" y="${y}" width="4" height="${h}" rx="1"/>`)
    .join('');
  return `<svg class="skill-meter inline-block align-[-2px]" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">${rects}</svg>`;
}
const ICONS = {
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  more: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  mark: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><path d="M9.5 16.5 6 4h12l-3.5 12.5"/><path d="M10 4l1 12"/><path d="M14 4l-1 12"/><path d="M7.2 8.5h9.6"/></svg>',
};

// ── API ───────────────────────────────────────────────────────────────────
function accountPrompt() {
  try {
    if (window.usernode && window.usernode.askForAccount) window.usernode.askForAccount({});
  } catch (_) { /* the frame decides; nothing to do here */ }
}
async function api(path, opts = {}) {
  const qs = new URLSearchParams();
  if (DEMO) qs.set('demo', '1');
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) headers['x-usernode-token'] = TOKEN;
  try {
    if (window.usernode && window.usernode.previewNow) headers['x-usernode-now'] = window.usernode.previewNow;
  } catch (_) {}
  const full = path === '/api/games' ? path + `?${new URLSearchParams({ ...(DEMO ? { demo: '1' } : {}), tz: TZ })}` : path + (qs.toString() ? `?${qs}` : '');
  const res = await fetch(full, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error === 'account_required') accountPrompt();
    const err = new Error(data.error || 'request_failed');
    err.status = res.status;
    err.code = data.error;
    err.field = data.field;
    err.message = data.error || 'request_failed';
    throw err;
  }
  return data;
}

// ── State ─────────────────────────────────────────────────────────────────
const FILTERS = ['all', 'beginner', 'intermediate', 'advanced'];
const state = {
  me: null,
  demo: false,
  home: { status: 'loading', data: null }, // loading | error | ready
  filter: FILTERS.includes(localStorage.getItem('fap.filter')) ? localStorage.getItem('fap.filter') : 'all',
  games: new Map(), // id -> {status, data} for game screens
};

// ── Toasts, navigation ────────────────────────────────────────────────────
function toast(msg) {
  try { if (window.unNative && unNative.toast) unNative.toast(msg); } catch (_) {}
}
function go(hash, type) {
  if (window.unNative && unNative.transition) {
    unNative.transition(() => { location.hash = hash; }, { type: type || 'push' });
  } else {
    location.hash = hash;
  }
}

// ── The Games screen ──────────────────────────────────────────────────────
function metaLine(g, opts) {
  const bits = [];
  if (g.cancelled) bits.push('<span class="font-medium">Cancelled</span>');
  else if (opts.playing) bits.push('<span class="font-medium">Playing now</span>');
  else if (g.playerCount >= g.playersNeeded) bits.push('<span class="font-medium">Full</span>');
  else if (opts.openFee) bits.push(`<span>${g.fee === 0 ? 'Free' : `${esc(amount(g.shareFull))} each when full`}</span>`);
  return `<p class="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-small tabular-nums"><span class="inline-flex items-center gap-1">${skillMeter(g.skill)}${SKILL_WORD[g.skill]}</span><span>${g.playerCount} of ${g.playersNeeded} players</span>${bits.join('')}</p>`;
}
function moneyStrip(g) {
  if (g.fee === 0) return '';
  let left = g.role === 'organizer' ? "You're organizing" : "You're in";
  if (g.cancelled) left = 'Cancelled';
  let right = '';
  if (g.role === 'organizer') {
    right = g.paidCount >= g.payableCount ? 'All paid' : `${g.paidCount} of ${g.payableCount} paid`;
  } else {
    right = g.viewerPaid ? "You've paid" : `Pay ${esc(g.organizer.username)} ${esc(amount(g.shareNow))}`;
  }
  const cls = right === "You've paid" || right === 'All paid' ? 'text-accent font-medium' : 'text-due font-medium';
  return `<div class="col-span-2 flex justify-between gap-2 border-t border-line pt-2 text-small"><span>${left}</span><span class="${cls}">${right}</span></div>`;
}
function gameCard(g, kind) {
  const playing = kind === 'mine' && !g.cancelled
    && new Date(g.startsAt).getTime() <= now().getTime();
  const strip = kind === 'mine' ? moneyStrip(g) : '';
  return `<button class="game-card" data-game="${g.id}">
    ${courtSmall(g.playersNeeded, g.playerCount, g.viewerSpot)}
    <div class="min-w-0">
      <p class="truncate text-body font-semibold leading-[22px]">${esc(g.venue)}</p>
      <p class="text-small text-muted tabular-nums">${esc(whenLine(new Date(g.startsAt), new Date(g.endsAt), kind === 'mine'))}</p>
      ${metaLine(g, { playing, openFee: kind === 'open' })}
    </div>
    ${strip}
  </button>`;
}
function skeletons(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<div class="grid grid-cols-[72px_1fr] gap-3 rounded-xl bg-raised p-3" aria-hidden="true">
      <div class="skeleton h-[44px] w-[72px]"></div>
      <div class="flex flex-col gap-2 pt-0.5"><div class="skeleton h-4 w-3/4"></div><div class="skeleton h-4 w-1/2"></div></div>
    </div>`;
  }
  return out;
}

function renderHome() {
  const s = state.home;
  let html = `<header class="flex h-16 items-center justify-between">
    <div class="flex items-center gap-2 font-display text-heading text-fg"><span class="text-accent">${ICONS.mark}</span>Find a playmate</div>
    <button class="btn-primary" data-go="#/new">${ICONS.plus}New game</button>
  </header>`;
  if (state.demo) {
    html += '<p class="mb-5 rounded-lg bg-raised px-3 py-2 text-small text-muted">Staging demo: the games and players below are made up.</p>';
  }
  if (s.status === 'error') {
    html += `<div class="state-error mt-6"><p class="text-body font-medium">Couldn't load games.</p>
      <p class="text-small text-muted">Check your connection. Nothing you posted is lost.</p>
      <button class="btn-secondary mt-2" data-retry>Retry</button></div>`;
    $app.innerHTML = html;
    return;
  }
  const d = s.data;
  if (s.status === 'loading' || !d) {
    html += `<div class="flex flex-col gap-2">${skeletons(4)}</div>`;
    $app.innerHTML = html;
    return;
  }
  if (d.yours.length) {
    html += '<h2 class="section-label">Your games</h2><div class="mb-6 flex flex-col gap-2">'
      + d.yours.map((g) => gameCard(g, 'mine')).join('') + '</div>';
  }
  if (d.toRate.length) {
    html += '<h2 class="section-label">Rate players</h2><ul class="list mb-6">'
      + d.toRate.map((g) => `<li><button class="list-row w-full text-left" data-game="${g.id}">
          <span class="text-accent">${ICONS.star}</span>
          <span class="min-w-0 flex-1"><span class="block truncate text-body font-semibold leading-[22px]">${esc(g.venue)}</span>
          <span class="block text-small text-muted tabular-nums">${esc(dateLabel(new Date(g.startsAt)))}, ${g.unratedCount} player${g.unratedCount === 1 ? '' : 's'} to rate</span></span>
          <span class="text-muted">${ICONS.chev}</span></button></li>`).join('')
      + '</ul>';
  }
  html += '<h2 class="section-label">Open games</h2>';
  html += `<div class="seg mb-4" role="group" aria-label="Skill level">`
    + FILTERS.map((f) => `<button aria-pressed="${state.filter === f}" data-filter="${f}">${f === 'all' ? 'All' : SKILL_WORD[f]}</button>`).join('')
    + '</div>';
  const open = d.open.filter((g) => state.filter === 'all' || g.skill === state.filter);
  if (d.open.length === 0) {
    html += `<div class="state-empty" data-list="open"><p class="text-body font-medium">No open games yet</p>
      <p class="text-small text-muted">Post one and fill your court.</p>
      <button class="btn-secondary mt-2" data-go="#/new">New game</button></div>`;
  } else if (open.length === 0) {
    html += `<div class="state-empty" data-list="open"><p class="text-body font-medium">No ${esc(SKILL_WORD[state.filter].toLowerCase())} games open</p>
      <p class="text-small text-muted">Try another skill level.</p></div>`;
  } else {
    // Group by the viewer's own calendar day; soonest first.
    const groups = new Map();
    for (const g of open) {
      const d1 = new Date(g.startsAt);
      const key = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    html += '<div data-list="open">' + [...groups.entries()].map(([key, list]) => `
      <div class="mb-4"><h3 class="mb-2 px-1 text-small font-semibold">${esc(dayHeading(new Date(key)))}</h3>
      <div class="flex flex-col gap-2">${list.map((g) => gameCard(g, 'open')).join('')}</div></div>`).join('') + '</div>';
  }
  $app.innerHTML = html;
}

async function loadHome() {
  state.home.status = state.home.data ? 'ready' : 'loading';
  renderHome();
  try {
    const data = await api('/api/games');
    state.home = { status: 'ready', data };
    renderHome();
  } catch (err) {
    if (!state.home.data) {
      state.home = { status: 'error', data: null };
      renderHome();
    }
  }
}

// ── A game's own screen ───────────────────────────────────────────────────
function summaryLine(p) {
  if (p.isOrganizer) return 'Organizer, booked the court';
  const s = p.summary;
  if (!s) return 'New player';
  const overall = Math.round(((s.punctuality + s.sportsmanship + s.skillMatch) / 3) * 10) / 10;
  return `Rated ${overall} by ${s.ratingCount} player${s.ratingCount === 1 ? '' : 's'}`;
}
function paidMark(p, g, detail) {
  if (g.fee === 0) return '';
  if (p.isOrganizer || p.paid) return '<span class="text-small font-medium text-accent">Paid</span>';
  if (state.me && state.me.id === g.organizer.id && !p.isViewer) {
    return `<label class="flex items-center gap-2.5"><span class="text-small font-medium text-due">Not paid</span><input type="checkbox" class="un-switch" data-paid="${esc(p.id)}" aria-label="${esc(p.username)} has paid"></label>`;
  }
  return '<span class="text-small font-medium text-due">Not paid</span>';
}
function renderGameScreen(detail) {
  const g = detail.game;
  const players = detail.players;
  const me = state.me;
  const isOrganizer = !!me && me.id === g.organizer.id;
  const inGame = g.role != null;
  const startsAt = new Date(g.startsAt);
  const endsAt = new Date(g.endsAt);
  const upcoming = detail.state === 'upcoming';
  const spotsOpen = g.playersNeeded - g.playerCount;
  const joinable = upcoming && !g.cancelled && !inGame && spotsOpen > 0 && detail.state !== 'playing';

  let html = `<div class="flex h-14 items-center justify-between py-2">
    <button class="inline-flex min-h-11 items-center gap-0.5 px-2 text-accent" data-go="#/">${ICONS.back}Games</button>
    <button class="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-fg" data-more aria-label="More">${ICONS.more}</button>
  </div>`;
  if (detail.state === 'cancelled') {
    html += '<p class="mb-2 rounded-lg bg-raised px-3 py-2 text-small text-muted">Cancelled by the organizer</p>';
  }
  html += `<h1 class="mt-1 font-display text-title font-bold leading-9">${esc(g.venue)}</h1>
    <p class="mt-1 text-body tabular-nums">${esc(fullWhen(startsAt, endsAt))}</p>
    <p class="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-small"><span class="inline-flex items-center gap-1">${skillMeter(g.skill)}${SKILL_WORD[g.skill]}</span><span>Organized by ${isOrganizer ? 'you' : esc(g.organizer.username)}</span></p>
    <figure class="mb-2 mt-4">${courtBig(g, players)}</figure>
    <p class="mb-6 text-small text-muted tabular-nums">${
      detail.state === 'cancelled' ? `${g.playerCount} of ${g.playersNeeded} players`
        : detail.state === 'playing' ? 'Playing now'
          : detail.state === 'ended' ? `${g.playerCount} of ${g.playersNeeded} players`
            : spotsOpen > 0 ? `${g.playerCount} of ${g.playersNeeded} players, 1 spot open`.replace('1 spot open', `${spotsOpen} spot${spotsOpen === 1 ? '' : 's'} open`)
              : `${g.playerCount} of ${g.playersNeeded} players, game full`}</p>`;

  html += '<h2 class="section-label">Court fee</h2><ul class="list mb-6">';
  if (g.fee === 0) {
    html += '<li class="list-row"><span class="flex-1">Court fee</span><span class="tabular-nums">Free</span></li>';
  } else {
    html += `<li class="list-row"><span class="flex-1">Court fee</span><span class="tabular-nums">${esc(amount(g.fee))}</span></li>
      <li class="list-row"><span class="flex-1 font-semibold">Split ${g.playerCount} wa${g.playerCount === 1 ? 'y' : 'ys'} now</span><span class="font-semibold tabular-nums">${esc(shareText(g.shareNow, g.playerCount))}</span></li>
      <li class="list-row"><span class="flex-1 text-muted">With all ${g.playersNeeded} players</span><span class="text-muted tabular-nums">${esc(shareText(g.shareFull, g.playersNeeded))}</span></li>`;
  }
  html += '</ul>';

  const rateOpen = detail.state === 'ended';
  html += `<div class="flex items-baseline justify-between"><h2 class="section-label">Players</h2>${
    g.fee > 0 && g.payableCount > 0 ? `<span class="section-label tabular-nums">${isOrganizer ? `${g.paidCount} of ${g.payableCount} paid` : ''}</span>` : ''}</div>`;
  html += '<ul class="list mb-4">' + players.map((p) => {
    let right = paidMark(p, g, detail);
    if (rateOpen && me && !p.isViewer && !g.cancelled) {
      const mine = detail.viewerRatings[p.id];
      right = `<button class="btn-secondary min-h-9 px-3 text-small ${mine ? '' : 'text-accent'}" data-rate="${esc(p.id)}">${mine ? 'Rated' : 'Rate'}</button>`;
    }
    const initial = p.isViewer ? 'Y' : (p.username[0] || '?').toUpperCase();
    return `<li class="list-row"><button class="avatar ${p.isViewer ? 'me' : ''}" data-player="${esc(p.id)}" aria-label="${esc(p.username)}'s ratings">${esc(initial)}</button>
      <button class="min-w-0 flex-1 text-left" data-player="${esc(p.id)}"><span class="block truncate text-body font-semibold leading-[22px]">${p.isViewer ? 'You' : esc(p.username)}</span>
      <span class="block text-small text-muted">${esc(summaryLine(p))}</span></button>${right}</li>`;
  }).join('') + '</ul>';

  if (inGame && !isOrganizer && upcoming && !g.cancelled) {
    html += '<button class="btn-secondary mb-6 w-full" data-leave>Leave game</button>';
  }
  if (g.notes) {
    html += `<h2 class="section-label">Notes</h2><p class="rounded-xl border border-line bg-surface px-4 py-3 text-body">${esc(g.notes)}</p>`;
  }
  if (joinable) {
    html += `<div class="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur">
      <div class="mx-auto flex max-w-md items-center justify-between gap-4 px-4 py-3" style="padding-bottom:calc(0.75rem + var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px)))">
        <span class="text-small text-muted tabular-nums">${g.fee === 0 ? 'This game is free' : `Your share would be ${esc(amount(g.shareNow))} now`}</span>
        <button class="btn-primary" data-join>Join game</button>
      </div></div><div class="h-20"></div>`;
  }
  $app.innerHTML = html;

  $app.querySelector('[data-more]').addEventListener('click', (e) => openMore(e.currentTarget, detail));
  const join = $app.querySelector('[data-join]');
  if (join) join.addEventListener('click', () => doJoin(g.id));
  const leave = $app.querySelector('[data-leave]');
  if (leave) leave.addEventListener('click', () => doLeave(g.id));
  $app.querySelectorAll('[data-paid]').forEach((sw) => sw.addEventListener('change', () => doPaid(g.id, sw)));
  $app.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => openRateSheet(detail, b.dataset.rate)));
  $app.querySelectorAll('[data-player]').forEach((b) => b.addEventListener('click', () => openPlayerSheet(b.dataset.player)));
}

async function loadGame(id) {
  const cached = state.games.get(id);
  renderGameFromCache(id, cached);
  try {
    const data = await api(`/api/games/${id}`);
    state.games.set(id, { status: 'ready', data });
    if ((location.hash || '') === `#/game/${id}`) renderGameFromCache(id, state.games.get(id));
  } catch (err) {
    if (err.status === 404) {
      state.games.set(id, { status: 'missing' });
      if ((location.hash || '') === `#/game/${id}`) renderGameFromCache(id, state.games.get(id));
    } else if (!cached) {
      state.games.set(id, { status: 'error' });
      renderGameFromCache(id, state.games.get(id));
    }
  }
}
function renderGameFromCache(id, cached) {
  if ((location.hash || '') !== `#/game/${id}`) return;
  if (!cached || cached.status === 'loading') {
    $app.innerHTML = `<div class="flex h-14 items-center py-2"><button class="inline-flex min-h-11 items-center gap-0.5 px-2 text-accent" data-go="#/">${ICONS.back}Games</button></div>
      <div class="skeleton h-9 w-2/3"></div><div class="mt-3 skeleton h-4 w-1/2"></div>
      <div class="skeleton mt-4 h-[200px] w-full rounded-xl"></div>
      <div class="mt-6 skeleton h-24 w-full rounded-xl"></div>`;
  } else if (cached.status === 'error') {
    $app.innerHTML = `<div class="flex h-14 items-center py-2"><button class="inline-flex min-h-11 items-center gap-0.5 px-2 text-accent" data-go="#/">${ICONS.back}Games</button></div>
      <div class="state-error"><p class="text-body font-medium">Couldn't load this game.</p>
      <p class="text-small text-muted">Check your connection and try again.</p>
      <button class="btn-secondary mt-2" data-retry-game="${id}">Retry</button></div>`;
  } else if (cached.status === 'missing') {
    $app.innerHTML = `<div class="flex h-14 items-center py-2"><button class="inline-flex min-h-11 items-center gap-0.5 px-2 text-accent" data-go="#/">${ICONS.back}Games</button></div>
      <div class="state-error"><p class="text-body font-medium">This game isn't available</p>
      <button class="btn-secondary mt-2" data-go="#/">Back to games</button></div>`;
  } else {
    renderGameScreen(cached.data);
  }
}

// ── Actions ───────────────────────────────────────────────────────────────
async function doJoin(id) {
  try {
    await api(`/api/games/${id}/join`, { method: 'POST' });
    toast("You're in");
    state.games.delete(id);
    state.home.data = null;
    loadGame(id);
  } catch (err) {
    if (err.code === 'game_full') toast('This game just filled up');
    else if (err.code === 'game_started') toast('This game has already started');
    else if (err.status !== 401) toast("Couldn't join. Try again.");
    loadGame(id);
  }
}
async function doLeave(id) {
  try {
    await api(`/api/games/${id}/leave`, { method: 'POST' });
    toast('You left the game');
    state.games.delete(id);
    state.home.data = null;
    loadGame(id);
  } catch (err) {
    if (err.code === 'organizer_cannot_leave') toast('Organizers cancel instead');
    else if (err.code === 'game_started') toast('This game has already started');
    else toast("Couldn't leave. Try again.");
    loadGame(id);
  }
}
async function doPaid(id, sw) {
  const userId = sw.dataset.paid;
  const before = !sw.checked;
  try {
    await api(`/api/games/${id}/players/${encodeURIComponent(userId)}/paid`, { method: 'PUT', body: { paid: sw.checked } });
    toast('Marked paid');
    const cached = state.games.get(id);
    if (cached && cached.status === 'ready') {
      const p = cached.data.players.find((x) => x.id === userId);
      if (p) p.paid = sw.checked;
      const g = cached.data.game;
      g.paidCount += sw.checked ? 1 : -1;
      if (g.paidCount < 0) g.paidCount = 0;
      renderGameFromCache(id, cached);
    }
    state.home.data = null;
  } catch (err) {
    sw.checked = before;
    toast("Couldn't save. Try again.");
  }
}
function openMore(anchor, detail) {
  const g = detail.game;
  const me = state.me;
  const isOrganizer = !!me && me.id === g.organizer.id;
  const upcoming = detail.state === 'upcoming';
  const items = [];
  if (isOrganizer && upcoming && !g.cancelled) items.push({ id: 'cancel', label: 'Cancel game', destructive: true });
  if (!isOrganizer) items.push({ id: 'report', label: 'Report game' });
  if (!items.length) return;
  const done = async (item) => {
    if (!item) return;
    if (item.id === 'cancel') {
      const r = await unNativeAlert('Cancel this game?',
        'The players keep seeing it as cancelled until its start time.',
        'Cancel game');
      if (r) {
        try {
          await api(`/api/games/${g.id}/cancel`, { method: 'POST' });
          toast('Game cancelled');
          state.games.delete(g.id);
          state.home.data = null;
          go('#/', 'pop');
        } catch (_) { toast("Couldn't cancel. Try again."); }
      }
    } else if (item.id === 'report') {
      const r = await unNativeAlert('Report this game?', 'It disappears from your list.', 'Report');
      if (r) {
        try {
          await api(`/api/games/${g.id}/report`, { method: 'POST' });
          toast('Reported');
          state.games.delete(g.id);
          state.home.data = null;
          go('#/', 'pop');
        } catch (_) { toast("Couldn't report. Try again."); }
      }
    }
  };
  try {
    if (unNative.menu) {
      unNative.menu({ anchorEl: anchor, items, cancelLabel: 'Done' }).then(done);
    } else {
      done(items[0]);
    }
  } catch (_) { /* menu unavailable on this platform */ }
}
function unNativeAlert(title, message, confirmLabel) {
  return new Promise((resolve) => {
    try {
      if (!(window.unNative && unNative.alert)) return resolve(true);
      unNative.alert({
        title,
        message,
        buttons: [
          { label: confirmLabel, style: 'destructive' },
          { label: 'Keep', style: 'cancel' },
        ],
      }).then((out) => resolve(!!(out && out.button && out.button.style === 'destructive')), () => resolve(false));
    } catch (_) { resolve(true); }
  });
}

// ── Sheets ────────────────────────────────────────────────────────────────
function sheetEl(inner) {
  const el = document.createElement('div');
  el.className = 'bg-surface px-4 pb-8 pt-3 text-fg';
  el.innerHTML = `<div class="mx-auto mb-4 h-1 w-9 rounded-full bg-line"></div>${inner}`;
  return el;
}
function openRateSheet(detail, userId) {
  const g = detail.game;
  const p = detail.players.find((x) => x.id === userId);
  if (!p) return;
  const prior = detail.viewerRatings[userId] || { punctuality: 0, sportsmanship: 0, skillMatch: 0 };
  const scores = { punctuality: prior.punctuality, sportsmanship: prior.sportsmanship, skillMatch: prior.skillMatch };
  const row = (key, label, hint) => `
    <div class="mb-4">
      <p class="text-body font-semibold">${label}</p>
      <p class="mb-1 text-small text-muted">${hint}</p>
      <div class="flex gap-1.5" role="group" aria-label="${label}">
        ${[1, 2, 3, 4, 5].map((v) => `<button class="min-h-11 flex-1 rounded-lg border text-small tabular-nums ${scores[key] >= v ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-fg'}" data-score="${key}" data-value="${v}" aria-pressed="${scores[key] === v}">${v}</button>`).join('')}
      </div>
    </div>`;
  const content = sheetEl(`
    <h2 class="mb-4 font-display text-heading font-semibold">Rate ${p.isViewer ? 'yourself' : esc(p.username)}</h2>
    ${row('punctuality', 'Punctuality', 'On time and ready to play')}
    ${row('sportsmanship', 'Sportsmanship', 'Fair calls, good company')}
    ${row('skillMatch', 'Skill match', "Played at the game's level")}
    <button class="btn-primary w-full" data-save-rating>Save rating</button>`);
  content.querySelectorAll('[data-score]').forEach((b) => b.addEventListener('click', () => {
    scores[b.dataset.score] = Number(b.dataset.value);
    content.querySelectorAll(`[data-score="${b.dataset.score}"]`).forEach((o) => {
      const on = Number(o.dataset.value) <= scores[b.dataset.score];
      o.className = `min-h-11 flex-1 rounded-lg border text-small tabular-nums ${on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-fg'}`;
      o.setAttribute('aria-pressed', String(Number(o.dataset.value) === scores[b.dataset.score]));
    });
  }));
  content.querySelector('[data-save-rating]').addEventListener('click', async () => {
    const missing = Object.values(scores).some((v) => !v);
    if (missing) { toast('Score all three from 1 to 5'); return; }
    try {
      await api(`/api/games/${g.id}/ratings/${encodeURIComponent(userId)}`, { method: 'PUT', body: scores });
      toast('Rating saved');
      state.games.delete(g.id);
      state.home.data = null;
      if (sheetHandle) sheetHandle.dismiss();
      loadGame(g.id);
    } catch (err) {
      if (err.code === 'rating_not_open') toast('Rating opens when the game ends');
      else toast("Couldn't save. Try again.");
    }
  });
  present(content);
}
let sheetHandle = null;
function present(content) {
  try {
    if (!(window.unNative && unNative.presentSheet)) {
      $app.appendChild(content);
      return;
    }
    sheetHandle = unNative.presentSheet({ contentEl: content, onDismiss: () => { sheetHandle = null; } });
  } catch (_) { $app.appendChild(content); }
}
async function openPlayerSheet(userId) {
  const content = sheetEl('<h2 class="mb-4 font-display text-heading font-semibold">Player</h2>');
  const inner = document.createElement('div');
  inner.className = 'py-6 text-center text-small text-muted';
  inner.textContent = 'Loading…';
  content.appendChild(inner);
  present(content);
  try {
    const data = await api(`/api/players/${encodeURIComponent(userId)}`);
    const s = data.summary;
    inner.outerHTML = `
      <p class="text-body font-semibold">${esc(data.username)}</p>
      <p class="mb-3 text-small text-muted">${data.gamesPlayed} game${data.gamesPlayed === 1 ? '' : 's'} played</p>
      ${s ? `<ul class="list text-left">
        <li class="list-row justify-between"><span>Punctuality</span><span class="font-semibold tabular-nums">${s.punctuality}</span></li>
        <li class="list-row justify-between"><span>Sportsmanship</span><span class="font-semibold tabular-nums">${s.sportsmanship}</span></li>
        <li class="list-row justify-between"><span>Skill match</span><span class="font-semibold tabular-nums">${s.skillMatch}</span></li>
      </ul>` : '<p class="rounded-xl border border-line bg-surface px-4 py-3 text-left text-small text-muted">New player</p>'}`;
  } catch (_) {
    inner.textContent = "Couldn't load this player.";
  }
}

// ── New game form ─────────────────────────────────────────────────────────
function renderNew() {
  const form = {
    venue: '', notes: '', date: '', time: '19:00', duration: 120, skill: '', players: 4, fee: '',
  };
  const today = now();
  const pad = (n) => String(n).padStart(2, '0');
  form.date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  $app.innerHTML = `
    <div class="flex h-14 items-center py-2"><button class="inline-flex min-h-11 items-center gap-0.5 px-2 text-accent" data-go="#/">${ICONS.back}Games</button></div>
    <h1 class="mb-4 mt-1 font-display text-title font-bold leading-9">New game</h1>
    <form id="new-game" class="pb-4">
      <label class="section-label" for="f-venue">Venue</label>
      <input id="f-venue" class="field mb-4" maxlength="80" placeholder="e.g. Riverside Sports Hall, court 3" autocomplete="off">
      <label class="section-label" for="f-date">Date</label>
      <input id="f-date" class="field mb-4" type="date" value="${form.date}">
      <label class="section-label" for="f-time">Start time</label>
      <input id="f-time" class="field mb-4" type="time" value="19:00">
      <span class="section-label">Court booked for</span>
      <div class="seg" role="group" aria-label="Court booked for">
        ${[[60, '1 h'], [90, '1.5 h'], [120, '2 h'], [180, '3 h']].map(([v, l]) => `<button type="button" aria-pressed="${form.duration === v}" data-duration="${v}">${l}</button>`).join('')}
      </div>
      <span class="section-label">Skill level</span>
      <div class="seg" role="group" aria-label="Skill level">
        ${['beginner', 'intermediate', 'advanced'].map((s) => `<button type="button" aria-pressed="false" data-skill="${s}">${SKILL_WORD[s]}</button>`).join('')}
      </div>
      <span class="section-label">Players</span>
      <div class="stepper mb-1">
        <button type="button" data-step="-1" aria-label="Fewer players">−</button>
        <output id="f-players">4</output>
        <button type="button" data-step="1" aria-label="More players">+</button>
      </div>
      <p class="mb-4 px-1 text-small text-muted">Including you</p>
      <label class="section-label" for="f-fee">Court fee</label>
      <input id="f-fee" class="field mb-1" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 120000">
      <p id="f-split" class="mb-4 px-1 text-small text-muted tabular-nums"></p>
      <label class="section-label" for="f-notes">Notes</label>
      <textarea id="f-notes" class="field mb-4" rows="2" maxlength="280" placeholder="e.g. Bring your own shuttles"></textarea>
      <p id="f-hint" class="mb-2 px-1 text-small text-muted"></p>
      <button id="f-post" class="btn-primary w-full" type="submit" disabled>Post game</button>
    </form>`;
  const $ = (sel) => $app.querySelector(sel);
  const venue = $('#f-venue'), date = $('#f-date'), time = $('#f-time'), fee = $('#f-fee'), notes = $('#f-notes');
  const playersOut = $('#f-players'), split = $('#f-split'), hint = $('#f-hint'), post = $('#f-post');

  const segBind = (attr, key) => {
    $app.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
      form[key] = attr === 'duration' ? Number(b.dataset.duration) : b.dataset.skill;
      $app.querySelectorAll(`[data-${attr}]`).forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      refresh();
    }));
  };
  segBind('duration', 'duration');
  segBind('skill', 'skill');
  $app.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    form.players = Math.min(12, Math.max(2, form.players + Number(b.dataset.step)));
    playersOut.textContent = form.players;
    refresh();
  }));
  const refresh = () => {
    const f = fee.value === '' ? null : Math.max(0, Math.floor(Number(fee.value)));
    if (f == null || Number.isNaN(f)) split.textContent = '';
    else if (f === 0) split.textContent = 'This game is free.';
    else split.textContent = `That's ${amount(Math.ceil(f / form.players))} each when all ${form.players} play.`;
    const d = date.value ? new Date(`${date.value}T${time.value || '00:00'}`) : null;
    const validTime = d && !Number.isNaN(d.getTime()) && d.getTime() > now().getTime();
    const missing = [];
    if (!venue.value.trim()) missing.push('a venue');
    if (!form.skill) missing.push('a skill level');
    if (date.value && !validTime) missing.push('a start time in the future');
    hint.textContent = missing.length ? `Add ${missing.join(' and ')} to post.` : '';
    post.disabled = missing.length > 0;
  };
  [venue, date, time, fee].forEach((i) => i.addEventListener('input', refresh));
  refresh();

  post.addEventListener('click', async (e) => {
    e.preventDefault();
    const startsAt = new Date(`${date.value}T${time.value}`);
    const feeNum = fee.value === '' ? 0 : Math.max(0, Math.floor(Number(fee.value)));
    try {
      const detail = await api('/api/games', {
        method: 'POST',
        body: {
          venue: venue.value, notes: notes.value, startsAt: startsAt.toISOString(),
          duration: form.duration, skill: form.skill, playersNeeded: form.players, fee: feeNum,
        },
      });
      toast('Game posted');
      state.games.set(detail.game.id, { status: 'ready', data: detail });
      state.home.data = null;
      go(`#/game/${detail.game.id}`);
    } catch (err) {
      toast(err.message === 'account_required' ? 'Make an account to post' : (err.status === 400 ? err.message || err.code : "Couldn't post. Try again."));
    }
  });
}

// ── Router and events ─────────────────────────────────────────────────────
let pullAttached = false;
function render() {
  const h = location.hash || '#/';
  $app.replaceChildren();
  if (h.startsWith('#/game/')) {
    const id = Number.parseInt(h.slice(7), 10);
    if (Number.isInteger(id)) loadGame(id);
    else renderHome();
  } else if (h === '#/new') {
    renderNew();
  } else {
    loadHome(); // renders the cached state first, then refetches
  }
  if (!pullAttached) {
    pullAttached = true;
    try {
      if (window.unNative && unNative.attachPullToRefresh) {
        unNative.attachPullToRefresh(window, () => {
          state.home.data = null;
          return loadHome();
        });
      }
    } catch (_) {}
  }
}
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (location.hash || '#/') === '#/') {
    state.home.data = null;
    loadHome();
  }
});
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-go]');
  if (nav) { go(nav.dataset.go, nav.dataset.go === '#/' ? 'pop' : 'push'); return; }
  const retry = e.target.closest('[data-retry]');
  if (retry) { state.home.data = null; loadHome(); return; }
  const retryGame = e.target.closest('[data-retry-game]');
  if (retryGame) { state.games.delete(Number(retryGame.dataset.retryGame)); loadGame(Number(retryGame.dataset.retryGame)); return; }
  const card = e.target.closest('[data-game]');
  if (card) { go(`#/game/${card.dataset.game}`); return; }
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    state.filter = filter.dataset.filter;
    localStorage.setItem('fap.filter', state.filter);
    renderHome(); // the filter switches instantly
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────
(async function boot() {
  // Paint before the first fetch: the header and the skeleton cards render
  // right away, so a slow or blocked /api/me never leaves a blank page.
  render();
  try {
    const me = await api('/api/me');
    state.me = me.user;
    currency = me.currency || null;
    state.demo = !!me.demo;
  } catch (_) {
    state.me = null;
  }
  // Repaint whatever landed while /api/me was in flight: the home list
  // (amounts need the currency, the demo line the demo flag) or a game
  // screen (it shows organizer controls only to the viewer in state.me).
  const h = location.hash || '#/';
  if (h.startsWith('#/game/')) {
    const id = Number.parseInt(h.slice(7), 10);
    const cached = state.games.get(id);
    if (cached && cached.status === 'ready') renderGameFromCache(id, cached);
  } else if (h !== '#/new') {
    renderHome();
  }
})();
})();