# Find a playmate

Find badminton buddies and fill your court. A player posts a game session
(venue, date and time, duration, skill level, how many players are needed,
the court fee and any notes); other players browse the open sessions grouped
by day and join until the court is full. The court fee splits evenly among
everyone playing, rounded up so the organizer is never left short, and the
organizer tracks who has paid. After a game, players rate each other on
punctuality, sportsmanship and skill match; ratings stay hidden until at
least three distinct people have rated the player.

## How it works

- **Games screen** — your games (with what you owe or who still owes you),
  a rate-players reminder for games that ended recently, and open games
  grouped by day with a skill-level filter.
- **Game screen** — every game is drawn as a top-down badminton court with
  a dot per player; your spot is the shuttle-yellow one. Joining is one
  tap until the court is full.
- **Ratings** — open for 14 days after the game ends. A player's averages
  show once at least three distinct raters have rated them.
- **Staging demo** — on staging, `?demo=1` seeds a made-up set of games
  and players just for the signed-in viewer, so the whole flow can be seen
  without other people around.

## Development

- `npm start` runs the server; `npm run build` recompiles Tailwind after
  editing `styles/tailwind-input.css`; `npm test` runs the unit tests for
  the game rules (`lib/rules.js`).
- Platform behaviour (auth, theming, staging) is described in `CLAUDE.md`
  and the hosted platform conventions it links to.