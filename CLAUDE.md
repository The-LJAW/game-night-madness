# CLAUDE.md: Game Night Madness

A group game picker: the organizer's owned BoardGameGeek games go into a two-stage voting bracket (game type, then game). It's built on the Dinner Madness code (github.com/The-LJAW/dinner-madness), which has the same bracket engine, voting relay and coin flip.

## Layout

- `index.html`, `preview.html`: **built files; never edit them by hand.** GitHub Pages serves them from the repo root.
- `src/app.js`: the whole app. The `CFG` block at the top holds the only settings: `bggProxy` (the BGG helper's address), `posthogKey`, `ntfy`.
- `src/sample.js`: the sample shelf (64 well-known games), inserted into `app.js` at `/*@SAMPLE@*/`.
- `src/body.html`, `src/palette.css`, `src/extra.css`: markup, colours (light and dark), app-specific styles.
- `src/shared/`: taken from Dinner Madness: `layout.css` (its colour names mapped to `--accent`, `--gold`, `--ok`), Levi's coin art, the coin CSS, and the bundled QR library.
- `bgg-helper/worker.js`: a Cloudflare Worker that holds the BGG token (`BGG_TOKEN` secret), only answers `ALLOWED_ORIGINS`, only allows `/collection?username=` and `/thing?id=` (1–20 ids), and caches (KV if bound as `CACHE`, otherwise the edge cache, which works only on a custom domain).
- `test/`: `worker.test.mjs` (Node), `app.test.mjs` (Playwright, with a fake helper and a fake ntfy shared by two "phones"), `fixtures.mjs` (BGG-format XML built from the sample shelf).

## How the app works

1. **Setup:** the username, players (2–8+) and time (30–180 minutes, or any) are set, then `loadShelf(q)` runs. It fetches the collection (retrying on 202 "queued", 429 and 5xx), filters by players, time and shelf of shame, then fetches details only for those games (20 per call, 1.1 s apart, cached in `gn.gd` for 30 days). Finally it filters by "weak at this count" (`verdict()` on the poll) and "skip heavy".
2. **Types:** `typesOf(g)` applies the `TYPES` rules (two lenses, `play` and `theme`) to BGG subdomains, categories, mechanics, families, weight, max players and time. `byType()` groups games, with Wildcard for games that fit no type. `typeItems()` drops a type that holds every game.
3. **Bracket:** `defFrom()` builds the `bracket` message. It must stay at or under 3,900 bytes, because ntfy turns bigger messages into attachments, so it strips `x`, then `im`, then `b`/`w`, then shortens names. Game entries are `{n, i, p0, p1, t, w, im, b}`; `im` is the thumbnail path without `https://cf.geekdo-images.com/`. Type entries are `{n, k, c, x}`.
4. **Room:** `derive(log)` replays the ordered message log (bracket, join, start, vote, close) on every phone. Stage 2 is built only on the organizer's phone, from `gn.host.<code>` (or re-fetched from `def.q`).

## Build and test

```bash
python3 build.py
node test/worker.test.mjs
node test/app.test.mjs          # add --shots for screenshots in test/shots/
```
`app.test.mjs` finds Playwright via `require('playwright')`, `PLAYWRIGHT_MODULE`, or the global install. The fonts are optional (`GNM_FONTS` points at an `@fontsource` folder).

## Conventions

- The storage prefix is `gn.`. Dinner Madness uses `dm.` on the same origin (`the-ljaw.github.io`).
- The ntfy channel prefix is `gamenightmadness-`.
- Keep the Dinner Madness engine (`derive`, `closeRound`, `coinSide`, the channels) in step with that repo when fixing bugs there.
- BGG rules: send the token only from the helper; show the "Powered by BGG" logo (`powered-by-bgg.png`, linked to BGG); cache; keep requests minimal. A monetized version needs a BGG commercial license.
