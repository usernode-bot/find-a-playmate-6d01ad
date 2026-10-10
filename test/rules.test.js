'use strict';

const test = require('node:test');
const assert = require('node:assert');
const rules = require('../lib/rules');

const NOW = new Date('2026-10-10T12:00:00Z');
const valid = (over = {}) => ({
  venue: 'Riverside Sports Hall, court 3',
  notes: '',
  startsAt: '2026-10-11T19:00:00Z',
  duration: 120,
  skill: 'beginner',
  playersNeeded: 4,
  fee: 120000,
  ...over,
});

test('shareOf rounds up so the organizer is never left short', () => {
  assert.strictEqual(rules.shareOf(100000, 3), 33334);
  assert.strictEqual(rules.shareOf(120000, 4), 30000);
  assert.strictEqual(rules.shareOf(100000, 2), 50000);
});

test('shareOf handles no players and a free court', () => {
  assert.strictEqual(rules.shareOf(100000, 0), 100000);
  assert.strictEqual(rules.shareOf(0, 4), 0);
});

test('validateGame accepts a good body and sets the end time', () => {
  const out = rules.validateGame(valid(), NOW);
  assert.ok(!out.error, out.error);
  assert.strictEqual(out.value.endsAt.getTime(), new Date('2026-10-11T21:00:00Z').getTime());
  assert.strictEqual(out.value.venue, 'Riverside Sports Hall, court 3');
});

test('validateGame rejects a start in the past', () => {
  const out = rules.validateGame(valid({ startsAt: '2026-10-10T11:00:00Z' }), NOW);
  assert.strictEqual(out.field, 'startsAt');
});

test('validateGame rejects a bad skill level', () => {
  assert.strictEqual(rules.validateGame(valid({ skill: 'pro' }), NOW).field, 'skill');
});

test('validateGame rejects 1 and 13 players', () => {
  assert.strictEqual(rules.validateGame(valid({ playersNeeded: 1 }), NOW).field, 'playersNeeded');
  assert.strictEqual(rules.validateGame(valid({ playersNeeded: 13 }), NOW).field, 'playersNeeded');
});

test('validateGame rejects a fractional or negative fee and an over-long venue', () => {
  assert.strictEqual(rules.validateGame(valid({ fee: 1.5 }), NOW).field, 'fee');
  assert.strictEqual(rules.validateGame(valid({ fee: -5 }), NOW).field, 'fee');
  assert.strictEqual(rules.validateGame(valid({ venue: 'x'.repeat(81) }), NOW).field, 'venue');
});

test('validateGame rejects a bad duration', () => {
  assert.strictEqual(rules.validateGame(valid({ duration: 45 }), NOW).field, 'duration');
});

test('validateRating accepts 1 to 5 and rejects 0, 6 and non-integers', () => {
  const good = rules.validateRating({ punctuality: 3, sportsmanship: 5, skillMatch: 1 });
  assert.deepStrictEqual(good.value, { punctuality: 3, sportsmanship: 5, skillMatch: 1 });
  assert.ok(rules.validateRating({ punctuality: 0, sportsmanship: 5, skillMatch: 1 }).error);
  assert.ok(rules.validateRating({ punctuality: 6, sportsmanship: 5, skillMatch: 1 }).error);
  assert.ok(rules.validateRating({ punctuality: 4.5, sportsmanship: 5, skillMatch: 1 }).error);
});

test('summarize stays hidden under 3 distinct raters', () => {
  assert.strictEqual(rules.summarize([]), null);
  assert.strictEqual(rules.summarize([
    { rater_id: 'a', punctuality: 5, sportsmanship: 5, skill_match: 5 },
    { rater_id: 'a', punctuality: 4, sportsmanship: 4, skill_match: 4 },
  ]), null);
});

test('summarize averages to one decimal once 3 people have rated', () => {
  const s = rules.summarize([
    { rater_id: 'a', punctuality: 5, sportsmanship: 5, skill_match: 5 },
    { rater_id: 'b', punctuality: 5, sportsmanship: 4, skill_match: 4 },
    { rater_id: 'c', punctuality: 4, sportsmanship: 4, skill_match: 5 },
    { rater_id: 'a', punctuality: 1, sportsmanship: 1, skill_match: 1 }, // same rater again
  ]);
  assert.deepStrictEqual(s, {
    punctuality: 3.8, sportsmanship: 3.5, skillMatch: 3.8, ratingCount: 3,
  });
});

test('courtSpots places dots on alternating sides at the mock coordinates', () => {
  assert.deepStrictEqual(rules.courtSpots(2), [
    { x: 16, y: 22, state: 'taken' }, { x: 56, y: 22, state: 'taken' },
  ]);
  assert.deepStrictEqual(rules.courtSpots(4), [
    { x: 16, y: 14, state: 'taken' }, { x: 56, y: 14, state: 'taken' },
    { x: 16, y: 30, state: 'taken' }, { x: 56, y: 30, state: 'taken' },
  ]);
  assert.deepStrictEqual(rules.courtSpots(6), [
    { x: 11, y: 14, state: 'taken' }, { x: 51, y: 14, state: 'taken' },
    { x: 21, y: 14, state: 'taken' }, { x: 61, y: 14, state: 'taken' },
    { x: 11, y: 30, state: 'taken' }, { x: 51, y: 30, state: 'taken' },
  ]);
  assert.deepStrictEqual(rules.courtSpots(8).slice(6), [
    { x: 21, y: 30, state: 'taken' }, { x: 61, y: 30, state: 'taken' },
  ]);
});