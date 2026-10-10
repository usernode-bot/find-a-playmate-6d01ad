'use strict';

/* Pure rules for games, shares and ratings: no database, no request objects,
 * so the server and the tests can both call them. */

const SKILLS = ['beginner', 'intermediate', 'advanced'];
const DURATIONS = [60, 90, 120, 180];
const MAX_FEE = 100000000;
const MAX_AHEAD_DAYS = 90;

/* The court fee splits evenly across everyone in the game, rounded up to a
 * whole amount, so the organizer is never left short. */
function shareOf(fee, n) {
  if (!Number.isInteger(fee) || fee < 0) return 0;
  if (n <= 0) return fee;
  return Math.ceil(fee / n);
}

/* Validates a New game body against `now` (a Date). Returns
 * { error, field } on the first problem, or { value } with the cleaned
 * fields. Times arrive as ISO from the browser's own zone. */
function validateGame(body, now) {
  if (!body || typeof body !== 'object') return { error: 'Missing game details', field: 'venue' };
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  if (venue.length < 1 || venue.length > 80) {
    return { error: 'Add a venue of 1 to 80 characters', field: 'venue' };
  }
  let notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 280) return { error: 'Notes can be at most 280 characters', field: 'notes' };
  const startsAt = new Date(body.startsAt);
  if (!(startsAt.getTime() > 0)) return { error: 'Pick a date and start time', field: 'startsAt' };
  if (startsAt.getTime() <= now.getTime()) {
    return { error: 'The start time must be in the future', field: 'startsAt' };
  }
  const aheadDays = (startsAt.getTime() - now.getTime()) / 86400000;
  if (aheadDays > MAX_AHEAD_DAYS) {
    return { error: 'Post a game at most 90 days ahead', field: 'startsAt' };
  }
  const duration = body.duration;
  if (!DURATIONS.includes(duration)) {
    return { error: 'Pick how long the court is booked', field: 'duration' };
  }
  const skill = body.skill;
  if (!SKILLS.includes(skill)) return { error: 'Pick a skill level', field: 'skill' };
  const playersNeeded = body.playersNeeded;
  if (!Number.isInteger(playersNeeded) || playersNeeded < 2 || playersNeeded > 12) {
    return { error: 'A game needs 2 to 12 players', field: 'playersNeeded' };
  }
  const fee = body.fee;
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE) {
    return { error: 'The court fee must be a whole amount', field: 'fee' };
  }
  return {
    value: {
      venue,
      notes,
      startsAt,
      endsAt: new Date(startsAt.getTime() + duration * 60000),
      skill,
      playersNeeded,
      fee,
    },
  };
}

/* A rating is three integers from 1 to 5. */
function validateRating(body) {
  if (!body || typeof body !== 'object') return { error: 'Missing scores', field: 'punctuality' };
  const out = {};
  for (const key of ['punctuality', 'sportsmanship', 'skillMatch']) {
    const v = body[key];
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      return { error: 'Score each from 1 to 5', field: key };
    }
    out[key] = v;
  }
  return { value: out };
}

/* A player's rating summary. Averages to one decimal, but only once at least
 * 3 DIFFERENT people have rated them, so nobody can work out who gave which
 * score. `rows` are { punctuality, sportsmanship, skill_match } rows. */
function summarize(rows) {
  const raters = new Set((rows || []).map((r) => r.rater_id));
  if (raters.size < 3) return null;
  const avg = (key) => {
    const sum = rows.reduce((a, r) => a + Number(r[key] || 0), 0);
    return Math.round((sum / rows.length) * 10) / 10;
  };
  return {
    punctuality: avg('punctuality'),
    sportsmanship: avg('sportsmanship'),
    skillMatch: avg('skill_match'),
    ratingCount: raters.size,
  };
}

/* Dot coordinates for the small court (viewBox 0 0 72 44). Spots alternate
 * sides of the net, left first; a half holds ceil(needed/2) dots and the
 * right half mirrors it 40 units across. */
const HALF_LAYOUTS = {
  1: [[16, 22]],
  2: [[16, 14], [16, 30]],
  3: [[11, 14], [21, 14], [11, 30]],
  4: [[11, 14], [21, 14], [11, 30], [21, 30]],
  5: [[11, 11], [21, 11], [11, 22], [21, 22], [11, 33]],
  6: [[11, 11], [21, 11], [11, 22], [21, 22], [11, 33], [21, 33]],
};

/* Returns [{x, y, state}] in join order: 'taken' for every player in and
 * 'open' for the free spots. */
function courtSpots(needed) {
  const half = Math.ceil(needed / 2);
  const left = HALF_LAYOUTS[half] || HALF_LAYOUTS[6];
  const spots = [];
  for (let i = 0; i < needed; i++) {
    const [x, y] = left[Math.floor(i / 2)];
    spots.push({ x: i % 2 === 0 ? x : x + 40, y, state: 'taken' });
  }
  return spots;
}

module.exports = {
  SKILLS,
  DURATIONS,
  MAX_FEE,
  shareOf,
  validateGame,
  validateRating,
  summarize,
  courtSpots,
};