# Find a playmate — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

Replaced: the app's real screens (games list, game detail, new game form)
now ship instead of the template hero, and `README.md` describes the real
app. The `usernode-dev-console@1` forwarder `<script>`, the bridge
`<script>` and the theme `<script>` in `public/index.html` are platform
infrastructure — never remove them. The light and dark looks follow the
viewer's Homeroom theme; no theme picker.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Find a playmate

Find badminton buddies and fill your court. One person posts a game session
for a single city (venue, when, how long, skill level, players needed, court
fee); others join until the court is full. The fee splits evenly among
everyone playing, rounded up, organizer included, and the organizer marks
players paid. After a game, players rate each other on punctuality,
sportsmanship and skill match; averages stay hidden until 3 or more distinct
people have rated.

## Design

This app's look. The first real version filled these in; every later change
follows it, and updates it when a request changes the look on purpose.

- **Palette:** accent: court green (`accent`, and a slightly deeper `court`
  for the drawn courts); second: shuttle yellow (`shuttle` — your own spot
  on a court, and the "money" accent for what someone owes); neutrals: cool
  greens/greys (`ground`, `surface`, `raised`, `fg`, `muted`, `line`).
  Danger red for destructive actions, amber (`due`) for the money lines.
- **Signature element:** every game is drawn as a top-down badminton court
  (SVG: green floor, white lines, net across the middle) with one dot per
  player — your dot is shuttle yellow, open spots are dashed. Big on the
  game screen, small on every card.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`,
  rounded display stack (`ui-rounded`, falling back to SF Pro Rounded /
  system-ui) so headings feel like a sports scoreboard without a custom font.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- Fees are whole amounts in the venue's minor units (integer, no decimals),
  stored as-is in `games.fee`; a player's share is `ceil(fee / n)` with n =
  everyone playing including the organizer (`lib/rules.js: shareOf`).
- Game times are stored as `timestamptz` from what the poster entered in
  their device's timezone; the browser reports its zone and every time is
  rendered in the viewer's own zone. Durations come from a fixed set
  (1, 1.5, 2, 3 hours), never free-form.
- `ratings` and `game_reports` are marked staging:private — they hold
  per-person behaviour data about real users.
- The staging demo (`lib/demo.js`, `?demo=1`) is written per signed-in
  viewer once and re-anchored to today by shifting whole days, so changes
  the viewer made (joins, paid flags, ratings) survive. Demo rows carry
  `demo_owner` and a `demo_key`; every query filters on
  `demo_owner IS NULL OR (demo-flag AND demo_owner = viewer)`.
- A rating summary (averages by punctuality, sportsmanship, skill match)
  is only shown once 3 or more distinct raters have rated that player
  within the app's games; under 3, show "New player" instead of numbers.
- Avoid adding new dependencies; the app uses the platform's native UI kit
  (`unNative.menu/alert/toast/presentSheet/transition`) for menus, sheets
  and toasts.
