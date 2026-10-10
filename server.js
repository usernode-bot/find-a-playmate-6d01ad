const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const rules = require('./lib/rules');
const { ensureDemo } = require('./lib/demo');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
// /api/local-login is only public for local test runs (see its handler).
const PUBLIC_API_PATHS = new Set([
  '/health',
  ...(process.env.USERNODE_ALLOW_LOCAL_LOGIN === '1' ? ['/api/local-login'] : []),
]);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  // Cookies are only used by the loopback test runner's sign-in
  // (inLoopCheckAuth in dapp.json); the platform always sends the header.
  let cookieToken = null;
  if (req.headers.cookie) {
    const found = /(?:^|;\s*)usernode_token=([^;]*)/.exec(req.headers.cookie);
    if (found) cookieToken = decodeURIComponent(found[1]);
  }
  const token = req.query.token || req.headers['x-usernode-token'] || cookieToken;
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Games: schema, visibility scope and API ───────────────────────────────
// One screen of app: post a badminton game, browse the open ones, join a
// spot, split the court fee, mark who paid, and rate the other players
// after the game ends.

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// All tables exist before the first request. CREATE TABLE IF NOT EXISTS, so
// booting against an existing database changes nothing.
async function bootSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id serial PRIMARY KEY,
      organizer_id text NOT NULL,
      organizer_name text NOT NULL,
      venue text NOT NULL CHECK (length(venue) BETWEEN 1 AND 80),
      notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 280),
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      skill text NOT NULL CHECK (skill = ANY (ARRAY['beginner','intermediate','advanced']::text[])),
      players_needed int NOT NULL CHECK (players_needed BETWEEN 2 AND 12),
      fee int NOT NULL CHECK (fee BETWEEN 0 AND 100000000),
      cancelled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      demo_owner text,
      demo_key text,
      UNIQUE (demo_owner, demo_key)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS games_starts_at_idx ON games (starts_at)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_players (
      game_id int NOT NULL REFERENCES games (id) ON DELETE CASCADE,
      user_id text NOT NULL,
      username text NOT NULL,
      paid bool NOT NULL DEFAULT false,
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, user_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ratings (
      game_id int NOT NULL REFERENCES games (id) ON DELETE CASCADE,
      rater_id text NOT NULL,
      ratee_id text NOT NULL,
      punctuality smallint NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
      sportsmanship smallint NOT NULL CHECK (sportsmanship BETWEEN 1 AND 5),
      skill_match smallint NOT NULL CHECK (skill_match BETWEEN 1 AND 5),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, rater_id, ratee_id),
      CHECK (rater_id <> ratee_id)
    )`);
  await pool.query('COMMENT ON TABLE ratings IS \'staging:private\'');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_reports (
      game_id int NOT NULL REFERENCES games (id) ON DELETE CASCADE,
      reporter_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, reporter_id)
    )`);
  await pool.query('COMMENT ON TABLE game_reports IS \'staging:private\'');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_sets (
      owner_id text PRIMARY KEY,
      anchored_on date NOT NULL,
      tz text NOT NULL
    )`);
  await pool.query('COMMENT ON TABLE demo_sets IS \'staging:private\'');
}

// Who is looking, and through which window. `demo` opens the viewer's own
// staging demo set: only rows whose demo_owner is them, never anyone
// else's, and only on staging with ?demo=1 while signed in. Every games
// query adds the demo filter, so the plain route never sees demo rows and
// answers exactly as production would.
function scope(req) {
  const viewer = req.user ? req.user.id : null;
  const demo = IS_STAGING && req.query.demo === '1' && !!req.user;
  return { viewer, demo };
}

// The demo filter every games query carries. When demo is false the clause
// references no placeholder, so callers must not bind one for it.

const GP_LATERAL = `
  JOIN LATERAL (
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE p.paid)::int AS paid_count,
           array_agg(p.user_id ORDER BY p.joined_at, p.user_id) AS members,
           array_position(array_agg(p.user_id ORDER BY p.joined_at, p.user_id), $1) AS viewer_index,
           (SELECT p2.paid FROM game_players p2 WHERE p2.game_id = g.id AND p2.user_id = $1) AS viewer_paid
    FROM game_players p WHERE p.game_id = g.id
  ) gp ON TRUE`;

// The organizer's row is inserted paid, so paid_count includes them; the
// paid fraction on a card counts only the joiners ("1 of 2 paid").
function gameOut(row) {
  const inGame = row.viewer_index != null;
  return {
    id: row.id,
    venue: row.venue,
    notes: row.notes,
    startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : row.starts_at,
    endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : row.ends_at,
    skill: row.skill,
    playersNeeded: row.players_needed,
    playerCount: row.n,
    viewerSpot: inGame ? row.viewer_index - 1 : null,
    fee: row.fee,
    shareNow: rules.shareOf(row.fee, row.n),
    shareFull: rules.shareOf(row.fee, row.players_needed),
    organizer: { id: row.organizer_id, username: row.organizer_name },
    role: !inGame ? null
      : (row.organizer_id === row.members[row.viewer_index - 1] ? 'organizer' : 'player'),
    paidCount: Math.max(0, row.paid_count - 1),
    payableCount: Math.max(0, row.n - 1),
    viewerPaid: inGame ? !!row.viewer_paid : false,
    cancelled: row.cancelled,
    unratedCount: row.unrated_count,
  };
}

app.get('/api/me', (req, res) => {
  res.json({
    user: req.user ? { id: req.user.id, username: req.user.username } : null,
    currency: process.env.CURRENCY || null,
    demo: IS_STAGING && req.query.demo === '1' && !!req.user,
  });
});

// Sign-in for the loopback check runner only (inLoopCheckAuth in
// dapp.json): stores a token it hands us in a cookie the auth middleware
// above reads. Gated on an env flag that is only ever set for local test
// runs, never on staging or production.
app.post('/api/local-login', (req, res) => {
  if (process.env.USERNODE_ALLOW_LOCAL_LOGIN !== '1') {
    return res.status(404).json({ error: 'not_found' });
  }
  const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
  if (!token || token.length > 512) return res.status(400).json({ error: 'bad_request' });
  res.setHeader('Set-Cookie',
    `usernode_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.get('/api/games', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    const tz = typeof req.query.tz === 'string' ? req.query.tz.slice(0, 64) : null;
    if (demo) await ensureDemo(pool, viewer, req.user.username, tz, req.now);
    // $1 viewer, $2 now, $3 the demo filter's viewer (bound only when demo).
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $4))`;
    const tail = [demo, viewer];
    const SEL = (unrated) => `
      SELECT g.id, g.venue, g.notes, g.starts_at, g.ends_at, g.skill, g.players_needed, g.fee,
             (g.cancelled_at IS NOT NULL) AS cancelled, g.organizer_id, g.organizer_name,
             gp.n, gp.paid_count, gp.members, gp.viewer_index, gp.viewer_paid, ${unrated} AS unrated_count
      FROM games g ${GP_LATERAL}`;
    const [yours, toRate, open] = await Promise.all([
      pool.query(
        `${SEL('0::int')}
         WHERE ${demoClause}
           AND EXISTS (SELECT 1 FROM game_players pm WHERE pm.game_id = g.id AND pm.user_id = $1)
           AND ((g.cancelled_at IS NULL AND g.ends_at > $2)
             OR (g.cancelled_at IS NOT NULL AND g.starts_at > $2))
         ORDER BY g.starts_at`,
        [viewer, req.now, ...tail]),
      pool.query(
        `${SEL(`(gp.n - 1 - (SELECT count(*) FROM ratings rt
                               WHERE rt.game_id = g.id AND rt.rater_id = $1))::int`)}
         WHERE ${demoClause}
           AND g.cancelled_at IS NULL AND g.ends_at <= $2
           AND g.ends_at > $2 - interval '14 days'
           AND EXISTS (SELECT 1 FROM game_players pm WHERE pm.game_id = g.id AND pm.user_id = $1)
           AND (SELECT count(*) FROM ratings rt
                WHERE rt.game_id = g.id AND rt.rater_id = $1) < gp.n - 1
         ORDER BY g.ends_at DESC`,
        [viewer, req.now, ...tail]),
      pool.query(
        `${SEL('0::int')}
         WHERE ${demoClause}
           AND g.cancelled_at IS NULL AND g.starts_at > $2
           AND gp.n < g.players_needed
           AND NOT EXISTS (SELECT 1 FROM game_players pm WHERE pm.game_id = g.id AND pm.user_id = $1)
           AND NOT EXISTS (SELECT 1 FROM game_reports r WHERE r.game_id = g.id AND r.reporter_id = $1)
           AND (SELECT count(*) FROM game_reports r2 WHERE r2.game_id = g.id) < 3
         ORDER BY g.starts_at`,
        [viewer, req.now, ...tail]),
    ]);
    res.json({
      yours: yours.rows.map(gameOut),
      toRate: toRate.rows.map(gameOut),
      open: open.rows.map(gameOut),
    });
  } catch (err) {
    console.error('GET /api/games failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// Load one game with its players, each player's rating summary, the
// viewer's own ratings here, and the game's state. Everything outside
// scope answers 404.
async function loadGame(id, viewer, demo, now) {
  return tx(async (c) => {
    const g = await c.query(
      `SELECT g.*, gp.n, gp.paid_count, gp.members, gp.viewer_index, gp.viewer_paid
       FROM games g
       JOIN LATERAL (
         SELECT count(*)::int AS n,
                count(*) FILTER (WHERE p.paid)::int AS paid_count,
                array_agg(p.user_id ORDER BY p.joined_at, p.user_id) AS members,
                array_position(array_agg(p.user_id ORDER BY p.joined_at, p.user_id), $2) AS viewer_index,
                (SELECT p2.paid FROM game_players p2 WHERE p2.game_id = g.id AND p2.user_id = $2) AS viewer_paid
         FROM game_players p WHERE p.game_id = g.id
       ) gp ON TRUE
       WHERE g.id = $1
         AND (g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))
         AND NOT EXISTS (SELECT 1 FROM game_reports r WHERE r.game_id = g.id AND r.reporter_id = $2)
         AND ((SELECT count(*) FROM game_reports r2 WHERE r2.game_id = g.id) < 3
              OR EXISTS (SELECT 1 FROM game_players pm
                         WHERE pm.game_id = g.id AND pm.user_id = $2))`,
      [id, viewer, demo]);
    if (!g.rows.length) return null;
    const row = g.rows[0];
    const players = await c.query(
      `SELECT user_id, username, paid, joined_at FROM game_players
       WHERE game_id = $1 ORDER BY joined_at, user_id`, [id]);
    const ids = players.rows.map((p) => p.user_id);
    const sums = ids.length
      ? await c.query(
        `SELECT r.ratee_id, r.rater_id, r.punctuality, r.sportsmanship, r.skill_match
         FROM ratings r JOIN games g2 ON g2.id = r.game_id
         WHERE r.ratee_id = ANY($1::text[])
           AND (g2.demo_owner IS NULL OR ($3::boolean AND g2.demo_owner = $2))`,
        [ids, viewer, demo])
      : { rows: [] };
    const byRatee = new Map();
    for (const r of sums.rows) {
      if (!byRatee.has(r.ratee_id)) byRatee.set(r.ratee_id, []);
      byRatee.get(r.ratee_id).push(r);
    }
    let viewerRatings = { rows: [] };
    if (viewer) {
      viewerRatings = await c.query(
        `SELECT ratee_id, punctuality, sportsmanship, skill_match
         FROM ratings WHERE game_id = $1 AND rater_id = $2`, [id, viewer]);
    }
    const cancelled = row.cancelled_at != null;
    const t = now.getTime();
    const state = cancelled ? 'cancelled'
      : t >= row.ends_at.getTime() ? 'ended'
        : t >= row.starts_at.getTime() ? 'playing' : 'upcoming';
    return {
      game: gameOut({ ...row, cancelled }),
      state,
      players: players.rows.map((p) => ({
        id: p.user_id,
        username: p.username,
        paid: p.paid,
        isOrganizer: p.user_id === row.organizer_id,
        isViewer: viewer != null && p.user_id === viewer,
        summary: rules.summarize(byRatee.get(p.user_id) || []),
      })),
      viewerRatings: Object.fromEntries(viewerRatings.rows.map((r) => [r.ratee_id, {
        punctuality: r.punctuality, sportsmanship: r.sportsmanship, skillMatch: r.skill_match,
      }])),
    };
  });
}

app.get('/api/games/:id', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const detail = await loadGame(id, viewer, demo, req.now);
    if (!detail) return res.status(404).json({ error: 'not_found' });
    res.json(detail);
  } catch (err) {
    console.error('GET /api/games/:id failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/games', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const v = rules.validateGame(req.body, req.now);
    if (v.error) return res.status(400).json({ error: v.error, field: v.field });
    const created = await tx(async (c) => {
      const g = await c.query(
        `INSERT INTO games (organizer_id, organizer_name, venue, notes, starts_at, ends_at,
                            skill, players_needed, fee${demo ? ', demo_owner' : ''})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9${demo ? ', $10' : ''}) RETURNING id`,
        [viewer, req.user.username, v.value.venue, v.value.notes, v.value.startsAt, v.value.endsAt,
          v.value.skill, v.value.playersNeeded, v.value.fee, ...(demo ? [viewer] : [])]);
      const id = g.rows[0].id;
      await c.query(
        `INSERT INTO game_players (game_id, user_id, username, paid) VALUES ($1, $2, $3, true)`,
        [id, viewer, req.user.username]);
      return id;
    });
    const detail = await loadGame(created, viewer, demo, req.now);
    res.status(201).json(detail);
  } catch (err) {
    console.error('POST /api/games failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/games/:id/join', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))`;
    const outcome = await tx(async (c) => {
      const g = await c.query(
        `SELECT g.starts_at, g.cancelled_at, g.players_needed,
                (SELECT count(*)::int FROM game_players p WHERE p.game_id = g.id) AS n
         FROM games g
         WHERE g.id = $1 AND ${demoClause}
           AND NOT EXISTS (SELECT 1 FROM game_reports r WHERE r.game_id = g.id AND r.reporter_id = $2)
           AND (SELECT count(*) FROM game_reports r2 WHERE r2.game_id = g.id) < 3
         FOR UPDATE OF g`,
        [id, viewer, demo]);
      if (!g.rows.length) return { status: 404 };
      const game = g.rows[0];
      if (game.cancelled_at != null || game.starts_at.getTime() <= req.now.getTime()) {
        return { status: 409, code: 'game_started' };
      }
      const existing = await c.query(
        `SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2`, [id, viewer]);
      if (existing.rows.length) return { status: 200, joined: false };
      if (game.n >= game.players_needed) return { status: 409, code: 'game_full' };
      await c.query(
        `INSERT INTO game_players (game_id, user_id, username, paid)
         VALUES ($1, $2, $3, false)`,
        [id, viewer, req.user.username]);
      return { status: 200, joined: true };
    });
    if (outcome.status === 404) return res.status(404).json({ error: 'not_found' });
    if (outcome.status === 409) return res.status(409).json({ error: outcome.code });
    res.json({ joined: outcome.joined });
  } catch (err) {
    console.error('POST join failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/games/:id/leave', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))`;
    const outcome = await tx(async (c) => {
      const g = await c.query(
        `SELECT g.starts_at, g.organizer_id FROM games g
         WHERE g.id = $1 AND ${demoClause}`, [id, viewer, demo]);
      if (!g.rows.length) return { status: 404 };
      if (g.rows[0].organizer_id === viewer) return { status: 409, code: 'organizer_cannot_leave' };
      if (g.rows[0].starts_at.getTime() <= req.now.getTime()) {
        return { status: 409, code: 'game_started' };
      }
      const del = await c.query(
        `DELETE FROM game_players WHERE game_id = $1 AND user_id = $2`, [id, viewer]);
      if (!del.rowCount) return { status: 404 };
      return { status: 200 };
    });
    if (outcome.status === 404) return res.status(404).json({ error: 'not_found' });
    if (outcome.status === 409) return res.status(409).json({ error: outcome.code });
    res.json({ left: true });
  } catch (err) {
    console.error('POST leave failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/games/:id/cancel', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))`;
    const outcome = await tx(async (c) => {
      const g = await c.query(
        `SELECT g.organizer_id, g.starts_at, g.cancelled_at FROM games g
         WHERE g.id = $1 AND ${demoClause} FOR UPDATE OF g`, [id, viewer, demo]);
      if (!g.rows.length) return { status: 404 };
      if (g.rows[0].organizer_id !== viewer) return { status: 403 };
      if (g.rows[0].cancelled_at != null || g.rows[0].starts_at.getTime() <= req.now.getTime()) {
        return { status: 409, code: 'game_started' };
      }
      await c.query(`UPDATE games SET cancelled_at = $2 WHERE id = $1`, [id, req.now]);
      return { status: 200 };
    });
    if (outcome.status === 404) return res.status(404).json({ error: 'not_found' });
    if (outcome.status === 403) return res.status(403).json({ error: 'forbidden' });
    if (outcome.status === 409) return res.status(409).json({ error: outcome.code });
    res.json({ cancelled: true });
  } catch (err) {
    console.error('POST cancel failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.put('/api/games/:id/players/:userId/paid', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const paid = req.body && req.body.paid;
    if (typeof paid !== 'boolean') return res.status(400).json({ error: 'bad_request' });
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))`;
    const tail = [demo];
    const outcome = await tx(async (c) => {
      const g = await c.query(
        `SELECT g.organizer_id FROM games g WHERE g.id = $1 AND ${demoClause}`,
        [id, viewer, ...tail]);
      if (!g.rows.length) return { status: 404 };
      if (g.rows[0].organizer_id !== viewer) return { status: 403 };
      if (req.params.userId === viewer) return { status: 400 };
      const upd = await c.query(
        `UPDATE game_players SET paid = $3 WHERE game_id = $1 AND user_id = $2`,
        [id, req.params.userId, paid]);
      if (!upd.rowCount) return { status: 404 };
      return { status: 200 };
    });
    if (outcome.status === 404) return res.status(404).json({ error: 'not_found' });
    if (outcome.status === 403) return res.status(403).json({ error: 'forbidden' });
    if (outcome.status === 400) return res.status(400).json({ error: 'bad_request' });
    res.json({ paid });
  } catch (err) {
    console.error('PUT paid failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.put('/api/games/:id/ratings/:userId', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const v = rules.validateRating(req.body);
    if (v.error) return res.status(400).json({ error: v.error, field: v.field });
    if (req.params.userId === viewer) return res.status(400).json({ error: 'bad_request' });
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))`;
    const tail = [demo];
    const outcome = await tx(async (c) => {
      const g = await c.query(
        `SELECT g.ends_at, g.cancelled_at FROM games g
         WHERE g.id = $1 AND ${demoClause}`, [id, viewer, ...tail]);
      if (!g.rows.length) return { status: 404 };
      if (g.rows[0].cancelled_at != null || req.now.getTime() < g.rows[0].ends_at.getTime()) {
        return { status: 409, code: 'rating_not_open' };
      }
      const both = await c.query(
        `SELECT count(*)::int AS n FROM game_players
         WHERE game_id = $1 AND user_id = ANY($2::text[])`, [id, [viewer, req.params.userId]]);
      if (both.rows[0].n < 2) return { status: 404 };
      await c.query(
        `INSERT INTO ratings (game_id, rater_id, ratee_id, punctuality, sportsmanship, skill_match, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (game_id, rater_id, ratee_id)
         DO UPDATE SET punctuality = EXCLUDED.punctuality, sportsmanship = EXCLUDED.sportsmanship,
                       skill_match = EXCLUDED.skill_match, updated_at = EXCLUDED.updated_at`,
        [id, viewer, req.params.userId, v.value.punctuality, v.value.sportsmanship,
          v.value.skillMatch, req.now]);
      return { status: 200 };
    });
    if (outcome.status === 404) return res.status(404).json({ error: 'not_found' });
    if (outcome.status === 409) return res.status(409).json({ error: outcome.code });
    res.json({ saved: true });
  } catch (err) {
    console.error('PUT ratings failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/games/:id/report', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    if (!viewer) return res.status(401).json({ error: 'account_required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
    const demoClause = `(g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $2))`;
    const outcome = await tx(async (c) => {
      const g = await c.query(
        `SELECT g.organizer_id FROM games g WHERE g.id = $1 AND ${demoClause}`, [id, viewer, demo]);
      if (!g.rows.length) return { status: 404 };
      if (g.rows[0].organizer_id === viewer) return { status: 403 };
      await c.query(
        `INSERT INTO game_reports (game_id, reporter_id) VALUES ($1, $2)
         ON CONFLICT (game_id, reporter_id) DO NOTHING`, [id, viewer]);
      return { status: 200 };
    });
    if (outcome.status === 404) return res.status(404).json({ error: 'not_found' });
    if (outcome.status === 403) return res.status(403).json({ error: 'forbidden' });
    res.json({ reported: true });
  } catch (err) {
    console.error('POST report failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/players/:userId', async (req, res) => {
  try {
    const { viewer, demo } = scope(req);
    const userId = req.params.userId;
    const name = await pool.query(
      `SELECT username FROM game_players WHERE user_id = $1 ORDER BY joined_at DESC LIMIT 1`, [userId]);
    if (!name.rows.length) return res.status(404).json({ error: 'not_found' });
    const played = await pool.query(
      `SELECT count(*)::int AS n FROM games g
       JOIN game_players p ON p.game_id = g.id AND p.user_id = $1
       WHERE g.cancelled_at IS NULL AND g.ends_at <= $2
         AND (g.demo_owner IS NULL OR ($3::boolean AND g.demo_owner = $4))`,
      [userId, req.now, demo, viewer]);
    const sums = await pool.query(
      `SELECT r.rater_id, r.punctuality, r.sportsmanship, r.skill_match
       FROM ratings r JOIN games g2 ON g2.id = r.game_id
       WHERE r.ratee_id = $1
         AND (g2.demo_owner IS NULL OR ($2::boolean AND g2.demo_owner = $3))`,
      [userId, demo, viewer]);
    res.json({
      username: name.rows[0].username,
      gamesPlayed: played.rows[0].n,
      summary: rules.summarize(sums.rows),
    });
  } catch (err) {
    console.error('GET /api/players failed: ' + err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/find-a-playmate-6d01ad/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/find-a-playmate-6d01ad/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await bootSchema();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
  // Stop accepting, let in-flight requests drain (about 3 s), then close the
  // pool so the platform's rolling restart never cuts a write mid-transaction.
  const shutdown = (signal) => {
    console.log(`${signal}: draining`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => pool.end().then(() => process.exit(0)), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });
