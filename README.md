# Kotoba

A spaced-repetition deck (FSRS) over the Japanese you have actually met. Kotoba holds no content of its own: cards come in through its API from sources such as [Midori](https://github.com/thijsdaniels/midori), the Pokémon Green companion, or a one-off import, and each source gets its own deck. `SPEC.md` has the design and the card contract.

## Layout

```
api/              Vercel functions
  _contract.ts      the card, deck and state types, and the card validator: the contract in code
  _store.ts         the two snapshot series in Vercel Blob, library and progress
  _http.ts          CORS, method check and the shared key, for every handler
  state.ts          GET everything the app needs
  review.ts         POST one side's new schedule
  settings.ts       POST newPerDay
  decks/[deck]/     PUT and DELETE a deck; reset; GET, POST and DELETE its cards
src/              the app: main.ts (interface), srs.ts (scheduler), api.ts (client)
public/starters/  starter decks the app can add through the API (Kana)
tools/            kana.py writes the Kana starter; prebuild.mjs stamps the service worker
```

## Adding cards from a source

```
PUT  /api/decks/<deck>         { "title": "Midori" }              makes sure the deck exists
POST /api/decks/<deck>/cards   { "cards": [ { "source": "…", "kind": "word", "kana": "…", "meanings": ["…"] } ] }
GET  /api/decks/<deck>/cards   what exists, to mark words already in the deck
```

Every call sends the key in `x-kotoba-key`. A card is identified by its `source`, the source's own stable ID, so sending the same card twice changes nothing and sending a corrected one updates it in place and keeps its progress. Cards that don't fit the contract come back in `rejected` with the reason.

## The app

Vite, plain TypeScript, no framework. Review mixes every enabled deck; Practice filters by deck and kind; Cards is grouped by deck; Settings has the new-card budget, each deck's switches and operations, the starter decks and the key. The page stores the key after opening `/?key=…` once, or from Settings.

Deployed on Vercel from `main`. Environment: `KOTOBA_KEY` (the shared key) and `BLOB_READ_WRITE_TOKEN` (set by the connected store).
