'use strict';

/* The staging demo set: one viewer's own copy of made-up games and players,
 * written only on staging, only with ?demo=1, only for a signed-in viewer,
 * and only by this module. Idempotent: a viewer's set is written once and
 * then re-anchored to today by shifting whole days, so joins, paid flags
 * and ratings the viewer changed stay as they are. */

const V = 'VIEWER'; // replaced with the real viewer's id and name

// Each game: a fixed demo_key, its venue and facts, its wall-clock time as a
// day offset from today plus hour and minute, its players in join order, and
// the ratings the fake players have already given.
const GAMES = [
  {
    key: 'organizing', day: 0, hour: 19, min: 0, duration: 120,
    organizer: V, venue: 'Eastside Sports Hall, court 2',
    notes: 'Shuttles provided. Meet at the front desk at 6:50 pm.',
    skill: 'intermediate', needed: 4, fee: 120000,
    players: [[V, true], ['shuttle_sam', true], ['net_nina', false]],
    ratings: [],
  },
  {
    key: 'joined', day: 1, hour: 8, min: 0, duration: 120,
    organizer: 'lob_maya', venue: 'Riverside Badminton Club, court 5',
    notes: '', skill: 'beginner', needed: 6, fee: 150000,
    players: [['lob_maya', true], ['smash_kofi', false], ['clear_lena', false],
      ['baseline_ben', false], [V, false]],
    ratings: [],
  },
  {
    key: 'torate', day: -3, hour: 19, min: 0, duration: 120,
    organizer: 'clear_lena', venue: 'Maple Street Community Centre',
    notes: '', skill: 'advanced', needed: 4, fee: 100000,
    players: [['clear_lena', true], ['smash_kofi', false], ['rally_ravi', false], [V, false]],
    ratings: [
      [V, 'rally_ravi', 4, 5, 4],
      ['clear_lena', 'smash_kofi', 4, 4, 4], ['clear_lena', 'rally_ravi', 5, 4, 4], ['clear_lena', V, 5, 4, 5],
      ['smash_kofi', 'clear_lena', 4, 5, 4], ['smash_kofi', 'rally_ravi', 4, 4, 5], ['smash_kofi', V, 4, 5, 4],
      ['rally_ravi', 'clear_lena', 5, 4, 4], ['rally_ravi', 'smash_kofi', 4, 4, 4], ['rally_ravi', V, 5, 5, 4],
    ],
  },
  {
    key: 'history', day: -6, hour: 19, min: 0, duration: 120,
    organizer: 'shuttle_sam', venue: 'North Park Gym',
    notes: '', skill: 'intermediate', needed: 6, fee: 90000,
    players: [['shuttle_sam', true], ['net_nina', true], ['lob_maya', true],
      ['smash_kofi', true], ['rally_ravi', true], ['dropshot_dee', true]],
    ratings: buildHistory(),
  },
  {
    key: 'open1', day: 0, hour: 20, min: 0, duration: 120,
    organizer: 'dropshot_dee', venue: 'North Park Gym, court 1',
    notes: '', skill: 'advanced', needed: 4, fee: 100000,
    players: [['dropshot_dee', true], ['baseline_ben', false]],
    ratings: [],
  },
  {
    key: 'open2', day: 1, hour: 18, min: 30, duration: 120,
    organizer: 'baseline_ben', venue: 'Old Mill Leisure Centre',
    notes: '', skill: 'beginner', needed: 4, fee: 80000,
    players: [['baseline_ben', true]],
    ratings: [],
  },
  {
    key: 'open3', day: 1, hour: 20, min: 0, duration: 120,
    organizer: 'net_nina', venue: 'Eastside Sports Hall, court 4',
    notes: '', skill: 'intermediate', needed: 6, fee: 180000,
    players: [['net_nina', true], ['shuttle_sam', false], ['lob_maya', false], ['smash_kofi', false]],
    ratings: [],
  },
  {
    key: 'open4', day: 3, hour: 7, min: 0, duration: 120,
    organizer: 'rally_ravi', venue: 'Riverside Badminton Club, court 2',
    notes: '', skill: 'intermediate', needed: 2, fee: 60000,
    players: [['rally_ravi', true]],
    ratings: [],
  },
  {
    key: 'open5', day: 4, hour: 19, min: 0, duration: 120,
    organizer: 'smash_kofi', venue: 'Maple Street Community Centre',
    notes: '', skill: 'advanced', needed: 8, fee: 200000,
    players: [['smash_kofi', true], ['dropshot_dee', false], ['baseline_ben', false],
      ['rally_ravi', false], ['lob_maya', false], ['clear_lena', false]],
    ratings: [],
  },
];

// Six fakes played a week ago and all rated each other. The scores TO
// shuttle_sam are fixed so their averages come out at 4.8 from 5 raters;
// the rest follow a fixed pattern, mostly 4s and 5s.
function buildHistory() {
  const six = ['shuttle_sam', 'net_nina', 'lob_maya', 'smash_kofi', 'rally_ravi', 'dropshot_dee'];
  const toSam = {
    net_nina: [5, 5, 5], lob_maya: [5, 5, 4], smash_kofi: [5, 4, 5],
    rally_ravi: [4, 5, 5], dropshot_dee: [5, 5, 5],
  };
  const rows = [];
  for (const rater of six) {
    for (const ratee of six) {
      if (rater === ratee) continue;
      if (ratee === 'shuttle_sam') {
        const [p, s, k] = toSam[rater];
        rows.push([rater, ratee, p, s, k]);
      } else {
        const i = six.indexOf(rater), j = six.indexOf(ratee);
        rows.push([rater, ratee, 4 + ((i + j) % 2), 4 + ((i + 2 * j) % 2), 4 + ((2 * i + j) % 2)]);
      }
    }
  }
  return rows;
}

/* A timezone the browser reports must be one Postgres knows; anything else
 * falls back to UTC. Postgres is the authority here: a Node without full
 * ICU (some builds) rejects every zone but its own. */
async function resolveTz(pool, tzRaw) {
  const tz = typeof tzRaw === 'string' && tzRaw ? tzRaw.slice(0, 64) : 'UTC';
  try {
    await pool.query('SELECT (now() AT TIME ZONE $1) IS NOT NULL', [tz]);
    return tz;
  } catch (_) {
    return 'UTC';
  }
}

const uid = (handle) => 'demo:' + handle;

/* Writes (or re-anchors) the viewer's demo set. `now` is the request's
 * time (a Date); `tz` the browser's zone, so "today 19:00" lands on the
 * viewer's own today. */
async function ensureDemo(pool, viewer, viewerName, tzRaw, now) {
  const tz = await resolveTz(pool, tzRaw);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One writer per viewer at a time, for the whole transaction.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('demo:' || $1))`, [viewer]);
    const todayQ = await client.query(
      `SELECT ($1::timestamptz AT TIME ZONE $2)::date AS today`, [now, tz]);
    const today = todayQ.rows[0].today; // a JS Date at that zone's midnight
    const setQ = await client.query(
      `SELECT anchored_on FROM demo_sets WHERE owner_id = $1 FOR UPDATE`, [viewer]);
    if (setQ.rows.length && Number(setQ.rows[0].anchored_on) !== Number(today)) {
      const shift = Math.round((today - setQ.rows[0].anchored_on) / 86400000);
      await client.query(
        `UPDATE games
         SET starts_at = starts_at + make_interval(days => $2),
             ends_at = ends_at + make_interval(days => $2)
         WHERE demo_owner = $1 AND demo_key IS NOT NULL`,
        [viewer, shift]);
      await client.query(
        `UPDATE demo_sets SET anchored_on = $2 WHERE owner_id = $1`, [viewer, today]);
      await client.query('COMMIT');
      return;
    }
    if (setQ.rows.length) { // already anchored to today: nothing to write
      await client.query('COMMIT');
      return;
    }
    await client.query(
      `INSERT INTO demo_sets (owner_id, anchored_on, tz) VALUES ($1, $2, $3)
       ON CONFLICT (owner_id) DO NOTHING`, [viewer, today, tz]);
    for (const g of GAMES) {
      const startsQ = await client.query(
        `SELECT (((($1::timestamptz AT TIME ZONE $2)::date + $3::int)
                 + make_interval(hours => $4::int, mins => $5::int)) AT TIME ZONE $2) AS starts_at`,
        [now, tz, g.day, g.hour, g.min]);
      const startsAt = startsQ.rows[0].starts_at;
      const endsAt = new Date(startsAt.getTime() + g.duration * 60000);
      // Rows joined one after another: a minute apart, in join order.
      const baseJoin = new Date(startsAt.getTime() - 24 * 3600000);
      const organizer = g.organizer === V ? viewer : uid(g.organizer);
      const gIns = await client.query(
        `INSERT INTO games (organizer_id, organizer_name, venue, notes, starts_at, ends_at,
                            skill, players_needed, fee, demo_owner, demo_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (demo_owner, demo_key) DO NOTHING RETURNING id`,
        [organizer, g.organizer === V ? viewerName : g.organizer, g.venue, g.notes,
          startsAt, endsAt, g.skill, g.needed, g.fee, viewer, g.key]);
      if (!gIns.rows.length) continue;
      const gameId = gIns.rows[0].id;
      for (let i = 0; i < g.players.length; i++) {
        const [who, paid] = g.players[i];
        const pId = who === V ? viewer : uid(who);
        const pName = who === V ? viewerName : who;
        const joinedAt = new Date(baseJoin.getTime() + i * 60000);
        await client.query(
          `INSERT INTO game_players (game_id, user_id, username, paid, joined_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (game_id, user_id) DO NOTHING`,
          [gameId, pId, pName, paid, joinedAt]);
      }
      for (const [rater, ratee, p, s, k] of g.ratings) {
        await client.query(
          `INSERT INTO ratings (game_id, rater_id, ratee_id, punctuality, sportsmanship,
                                skill_match, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (game_id, rater_id, ratee_id) DO NOTHING`,
          [gameId, rater === V ? viewer : uid(rater), ratee === V ? viewer : uid(ratee),
            p, s, k, endsAt]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ensureDemo };