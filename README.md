# Game Night Madness

Can't decide what to play? Game Night Madness pulls the games you own from your BoardGameGeek collection, sorts them into game types, seeds them into a tournament-style bracket, and lets everyone at the table vote from their own phone, round by round, until one game is left.

It's a sibling of [Dinner Madness](https://github.com/The-LJAW/dinner-madness): the same bracket, lobby, live voting and coin-flip tiebreaker, with a BoardGameGeek shelf in place of the restaurant search.

Everything the browser needs is in one file, `index.html`. Players need no accounts. The one server piece is a tiny helper that holds the BoardGameGeek token (see [Connect BoardGameGeek](#connect-boardgamegeek-one-time-setup)).

## How it plays

1. **Whose shelf?** Type a BGG username. The app uses the games marked **Owned** in that collection, minus expansions. There's no password, because BGG collections are public. No BGG account? Use the sample shelf.
2. **How many are playing?** 2 to 8+. Games that can't seat that many are left out.
3. **How much time do you have?** 30, 60, 90, 120 or 180 minutes, or any length. This uses each game's listed play time.
4. **Which games are in?**
   - **Skip games that are weak at this count** (on by default). This uses BGG's player-count votes. A game is skipped only when most voters say it's not recommended at that count, and games with fewer than 5 votes are never skipped.
   - **Skip the heavy ones.** Leaves out games with a complexity weight of 3.5 or more.
   - **Shelf of shame only.** Just the games with no plays logged on BGG.
5. **Seed the field.** There are two modes:
   - **Game type first** (the default). Game types face off first, like Co-op vs. Party and Deck builders vs. Strategy. The winning type then gets its own bracket of your games. Types can be grouped by **How it plays** or by **Theme**.
   - **Games only.** Specific games face off, from the whole shelf or one type.

   Types are seeded by how many of your games fit them. Games are seeded by your BGG rating (BGG's average for games you haven't rated), or shuffled. Brackets hold 2–16 contenders.
6. **Share it.** A QR code and link open the bracket on anyone's phone. Friends type a first name and they're in.
7. **Vote.** Everyone picks a winner in every matchup of the round, then locks in. A round closes on its own once everyone has voted, and the organizer can close a round early. Ties are settled by the coin flip, which plays the same way on every phone. Someone without a phone can be added under **Invite** and vote on the organizer's phone.
8. **Winner.** The winning game shows its box art, player count, play time and weight, with a "How to play" video search and a link to its BGG page.

## Game types

Types come from BGG's own data: its eight ranked game types (Strategy, Family, Party, Thematic, Abstract, Wargames, Customizable, Children's), plus each game's categories, mechanics and complexity weight. A game can count toward several types.

- **How it plays (30):** Party, Co-op, Social deduction, Strategy, Brain burners (weight 3.5+), Family, Thematic, Card games, Dice games, Deck builders, Worker placement, Area control, Tile laying, Drafting, Trick-taking, Push your luck, Bluffing, Word & trivia, Dexterity, Real-time, Economic, Negotiation, Roll & write, Campaign & legacy, Abstract, Wargames, Two-player duels, Quick fillers (30 minutes or less), Kids, Collectible & LCGs.
- **Theme (14):** Fantasy, Sci-fi & space, Horror, Mystery & spies, Animals & nature, History, Adventure, Myth & legend, Pirates & the sea, Trains & travel, Cities & industry, Sports & racing, Pop culture, Humor.

Games that fit no type in the chosen grouping go to **Wildcard**. A type that holds every game on tonight's list is left out of the type bracket, because it wouldn't decide anything. The rules live in `TYPES` in `src/app.js`.

## Connect BoardGameGeek (one-time setup)

BoardGameGeek requires every app that reads its data to be registered and to send a token, and it asks apps to make their calls from a server and cache the results. So the app talks to BGG through a small helper, `bgg-helper/worker.js`, which runs free on Cloudflare Workers. Until the helper is set up, the app offers the sample shelf only.

### 1. Register the app with BGG

1. Sign in to BoardGameGeek and open https://boardgamegeek.com/applications.
2. Register a new application. Suggested details:
   - **Name:** Game Night Madness
   - **Website:** https://the-ljaw.github.io/game-night-madness/
   - **What it does:** A free web app that turns a user's owned BGG collection into a voting bracket, so a group can pick a game to play. It reads one user's collection (owned games) and game details (categories, mechanics, weight, player-count poll). Results are cached (collections for 30 minutes, game details for 7 days), details are requested 20 at a time about a second apart, and the app shows the "Powered by BGG" logo linking to BGG.
   - **Commercial or not:** non-commercial, for now. BGG requires a commercial license for any app that earns money (ads, affiliate links, paid features). It's free until 100 paying users or 1,000 ad-supported users.
3. BGG reviews each application; other developers report about 1–2 business days. Once it's approved, create a token on the same page. Keep it private: it goes straight into Cloudflare (step 2.6) and nowhere else, not in this repository or a chat.
4. Download the **Powered by BGG** logo from https://boardgamegeek.com/using_the_xml_api and add it to this repository as `powered-by-bgg.png`. BGG requires the logo on public apps, linked to BGG. The footer shows it; a text badge stands in until the file is there.

### 2. Put the helper on Cloudflare (free, about 10 minutes)

You can do steps 1–5 while BGG reviews the application.

1. Create a free account at https://dash.cloudflare.com.
2. Go to **Workers & Pages** → **Create application** → **Start with Hello World**. Name it `gnm-bgg` and click **Deploy**.
3. Click **Edit code**, replace everything in the editor with the contents of [`bgg-helper/worker.js`](https://raw.githubusercontent.com/The-LJAW/game-night-madness/main/bgg-helper/worker.js), and click **Deploy**.
4. Create a KV namespace for the cache: **Storage & Databases → KV** (Workers KV) → **Create**, and name it `gnm-bgg-cache`. Then open the Worker → **Bindings** → **Add binding** → **KV namespace**, set the variable name to `CACHE`, pick `gnm-bgg-cache`, and click **Add binding**. Cloudflare's built-in cache only works on your own domain, so KV is what lets the helper reuse answers on a `workers.dev` address.
5. Open the Worker's address (something like `https://gnm-bgg.your-subdomain.workers.dev`). It shows a status page: `running`, `BGG token: not set yet`, `Cache: KV namespace bound as CACHE`.
6. When BGG has approved the app: in the Worker's **Settings → Variables and Secrets**, click **Add**, choose type **Secret**, name it `BGG_TOKEN`, paste the token as the value, and click **Deploy**. Reload the status page; it should say `BGG token: set`.

The helper only answers `https://the-ljaw.github.io`. If the app ever moves to its own domain, add a Text variable `ALLOWED_ORIGINS` with the new address (comma-separate several).

### 3. Point the app at the helper

Near the top of the script in `src/app.js`, set `bggProxy` to the Worker's address, run `python3 build.py`, and upload the new `index.html`. (Or edit the same line directly in `index.html` on GitHub.)

## Put it online (GitHub Pages, about 3 minutes)

This repository is already live at https://the-ljaw.github.io/game-night-madness/. To set up a copy elsewhere:

1. On GitHub, create a new **public** repository, for example `game-night-madness`.
2. Upload the files in this folder to the repository's main branch.
3. Go to **Settings → Pages**. Set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, and save.
4. After a minute, the app is live at `https://<your-username>.github.io/game-night-madness/`, and the one-phone demo at `…/preview.html`.

## What it runs on

| Job | Service | Notes |
|---|---|---|
| Owned games and game details | BoardGameGeek XML API, through `bgg-helper` | Registered token required. The helper caches collections for 30 minutes and game details for 7 days; the organizer's phone keeps game details for 30 days. Details come 20 games per request (BGG's limit), about a second apart. |
| Live voting between phones | ntfy.sh, a public message relay | Free, no account. Each bracket is a channel named `gamenightmadness-<code>`. Messages expire after about 12 hours. |
| Box art | BGG's image server (`cf.geekdo-images.com`) | Thumbnails from the collection. A letter tile stands in when a picture is missing. |
| QR codes | qrcode-generator (MIT license), bundled into the page | Works offline. |

Every phone replays the same ordered list of messages (joins, votes, round closes), so every phone works out the same bracket on its own.

## Usage analytics (PostHog)

The app has the same named, anonymous events as Dinner Madness, plus `shelf_loaded`, `shelf_failed` and `type_decided`. There's no autocapture, no screen recording and no cookies. Names and BGG usernames are never sent.

Analytics are **off** until `posthogKey` is set near the top of `src/app.js`. Use a separate PostHog project, so Dinner Madness's dashboard stays clean.

## Good to know

- **Links expire.** A bracket lasts about 12 hours. After that, the link shows a "back in the box" page.
- **Privacy.** Anyone with the link or code can join and vote. The shared bracket data includes the organizer's BGG username (BGG collections are public), so the organizer can rebuild stage 2 on another device.
- **First load of a big shelf.** The app reads details for every game that fits tonight's players and time, 20 at a time. A 150-game shelf takes several seconds the first time; after that, the phone remembers the details for 30 days.
- **"Queued" collections.** BGG sometimes answers "queued" the first time it's asked for a collection. The app waits and asks again on its own.
- **Same site as Dinner Madness.** Both apps live on `the-ljaw.github.io`, so they share browser storage. This app keeps everything under keys that start with `gn.`.

## For developers

- `python3 build.py` builds `index.html` and `preview.html` from `src/`.
- `node test/worker.test.mjs` tests the BGG helper. `node test/app.test.mjs` runs the app in a real browser against a fake BGG and a fake relay (needs Playwright; add `--shots` for screenshots).
- See `CLAUDE.md` for how the code fits together.
