# Kotoba and Midori: the split

Decided on Oct 27, 2026. This is the plan the rebuild follows. Where the code and this file disagree, one of them is wrong.

## Three repos

- **japan-2026**: the trip journal. Untouched by any of this.
- **kotoba**: the review app. It owns the decks, the cards in them, and the learner's progress, and exposes a small API for adding cards. It holds no card content of its own and knows nothing about Pokémon, kana or the trip.
- **midori**: the Pokémon Green companion. The disassembly as a pinned dependency, the extracted script with our layer of sentence splits, breakdowns and literal translations on top, the pixel font, the map and the emulator. It talks to Kotoba only through the API.

A monorepo was considered and rejected: once the API is the only link, the one thing the projects share is the card type, which is small enough to copy.

## Kotoba

### Model

- **One learner per deployment**, identified by the shared key. "Users" in the plan means this; real accounts are not needed while there is one learner.
- **Settings**: `newPerDay`, the daily budget of new cards across all decks (default 20).
- **Deck**: one per source (Kana, Midori, the trip). `id` (slug), `title`, `description?`, and its settings: `enabled`, `production` (whether its cards also get a meaning→Japanese side), `introduce` (`"random"` or `"in order"`, by the cards' `order`).
- **Card**: belongs to one deck. Its id is `<deck>/<source>`, so a card's identity is the source's own stable ID and a re-import can never duplicate it.
- **Progress**: per card, an FSRS schedule per side, `recognition` and `production`.

Kotoba's own UI, not the API, does the deck operations: enable or disable, production on or off, reset progress, delete, and removing a single card.

### The card contract

What a source sends. Everything else Kotoba stores (id, deck, when it was added) it adds itself.

```ts
interface CardInput {
  source: string;        // required. Stable within the deck: a disassembly label plus the word, "hira-a", "2026-10-13/sumimasen"
  kind: "word" | "expression" | "form" | "ending" | "name" | "kana";
  kana: string;          // required. The Japanese as read
  meaning: string;       // required. Literal English; "(…)" marks words Japanese leaves out, shown lighter
  kanji?: string;
  romaji?: string;
  loose?: string;        // a natural rendering, only ever in addition to the literal one
  note?: string;         // behind "More"
  // form cards: what the form is made from and what it is
  base?: string; form?: string; register?: string; verbClass?: string;
  // the sentence the word was met in; surface must occur exactly once in line
  line?: string; lineEn?: string; speaker?: string; surface?: string;
  // an everyday example of our own
  example?: string; exampleEn?: string; exampleLoose?: string;
  order?: number;              // position when the deck introduces in order
  recognitionOnly?: boolean;   // never asked in production, whatever the deck says
}
```

Changes from the old built-card format, all renames for clarity: `context` → `speaker`, `vclass` → `verbClass`, `recogOnly` → `recognitionOnly`, and a new `kind`, `name`, for proper nouns (Pokémon, moves, items, places). The source-specific kinds (`pokemon`, `move`, `item`, `term`) and the per-package colors go away; kinds are linguistic and fixed in Kotoba. The `set` field of kana cards goes into `note`. Placeholders like `{player}` are the source's business: Midori fills them in before sending.

The server validates every card and rejects what doesn't fit, with the reason: missing required fields, an unknown kind, a `surface` that isn't in `line` exactly once. Nothing is guessed.

### API

Every call carries the key in `x-kotoba-key`. CORS is open, since the key is a header and there are no cookies; Midori calls from its own origin.

| Call | Does |
|---|---|
| `GET /api/state` | Everything the app needs: settings, decks, cards, progress. |
| `PUT /api/decks/:deck` | Creates the deck or updates it. Body: any of `title`, `description`, `enabled`, `production`, `introduce`; `title` is required to create. |
| `DELETE /api/decks/:deck` | Deletes the deck, its cards and their progress. |
| `POST /api/decks/:deck/reset` | Wipes the progress of the deck's cards, keeps the cards. |
| `GET /api/decks/:deck/cards` | The deck's cards, so a source can see what exists. |
| `POST /api/decks/:deck/cards` | Body `{ cards: CardInput[] }`. A new source is created; a known one has its content replaced and keeps its progress. Answers `{ created, updated, unchanged, rejected: [{ source, error }] }`, so a re-import is idempotent and a corrected translation reaches the deck. |
| `DELETE /api/decks/:deck/cards` | Body `{ sources: string[] }`. Removes those cards and their progress. Sources go in the body because they may contain slashes. |
| `POST /api/review` | `{ card, side, schedule }`: the new schedule of one side. |
| `POST /api/settings` | `{ newPerDay }`. |

Sources only ever use the deck `PUT` (to make sure their deck exists), and the two card calls. Offline queueing is the source's job: Midori queues cards while there's no signal and sends them later.

### Storage

Vercel Blob, as before: immutable snapshots named by a counter, newest found by listing, old ones pruned. There are two series now, so a review never rewrites the cards:

- `kotoba/v3/library/`: settings, decks and cards. Changes when cards come in or a deck is edited.
- `kotoba/v3/progress/`: the schedules. Changes on every answer.

Two writes to the same series can't overwrite each other: a snapshot's name is its version, writing a name that exists fails, and the loser reloads and applies its change again. Snapshots are pruned only when they are a minute old, so a name is never freed while a writer could still want it. This needs `@vercel/blob` 1.0 or later. If a real database is ever needed (Postgres through the Vercel marketplace), only `api/_store.ts` changes. The old `kotoba/state/` snapshots are left alone and ignored.

### The app

Review, Practice, Cards, Settings, as now. What changes:

- Review takes due cards from every enabled deck, plus today's new cards up to `newPerDay`. A deck that introduces in order (Kana) gives its next card in order; the rest come at random. Recognition before production, never both sides of one card on the same day.
- Practice filters by deck and by kind.
- Cards is grouped by deck. A card's detail has Remove Card, and so does the back of a card in Review.
- Settings: new cards per day; one block per deck with its toggle, Say It in Japanese, Reset Progress and Delete Deck; Starter Decks, with Kana to add; the key.
- No chapters, no positions, no slots, no per-package colors, no pixel font.

### Starter decks

Kana is a JSON file of cards served with the app (`public/starters/kana.json`, generated by `tools/kana.py`). Adding it from Settings sends it through the same `PUT` and `POST` as any source. Kotoba has no second code path for it; a future N5 kanji deck works the same way.

## Midori

Not built yet. What it gets from Kotoba now, unchanged, as its starting point: the Pokémon package (extraction, corpus, translations and the hand-written cards), the sentence splitter and translation checker, and the pixel font. The plan for it:

1. **The disassembly as a dependency**: Narishma-gb/pokegreen pinned as a submodule at a known commit, never edited. A build step extracts every line with its label, decoded through the game's character table, and later the maps, NPCs and warps. Labels are our stable IDs, so moving the pin is a deliberate step that re-runs the checks.
2. **Our layer, keyed by label**: the sentence splits, word breakdowns, glosses and literal translations, validated at build time against the extracted text, so a drifted translation fails the build.
3. **Reading in context**: the line on screen, broken down sentence by sentence, with a button to send a word to Kotoba as a card (`source` = label plus the word).
4. **Finding the line**: the game runs in the page in a Game Boy emulator compiled to WebAssembly. A breakpoint on the text-printing routine reads the address of the text about to be printed, and the symbol map turns it into its label: the exact line, nothing guessed. Which emulator is the first experiment: it has to allow breakpoints, or at least an execution hook, from JavaScript. A location-organized catalog with the map stays an option for playing on the real Game Boy.
5. **The ROM is uploaded, never shipped**: the learner picks the ROM file once per device and the page keeps it in IndexedDB. The build assembles Green V1.0 and V1.1 from the disassembly only to produce each one's symbol map and SHA-1 (82c0eef4… and 4b97cd44…). The ROMs themselves are not published. On upload the page hashes the file and uses that revision's map; any other file is refused with a clear message. Labels are the same in both revisions, only addresses differ, so the layer and the card sources serve both. Red would be the same mechanism, left out for now.

Running the assembly without an emulator, recompiled to WebAssembly, was considered and rejected: the code drives the Game Boy's video, sound, banking and interrupts directly, so it would need that hardware recreated anyway, which is what an emulator is.

Waiting on Thijs: the cartridge dump, which is the file he uploads and tells us his revision. Until then, development uses ROMs built locally, which never leave the workspace.

## The trip deck

Last, once the API exists. Not 1,700 candidates: a shortlist of 5 to 10 per day that Thijs picks from, sent as a `trip` deck. Lines Claude composed are credited to Claude, a card doesn't need a quoted sentence, and basics may be in. The pilot day and the extraction live on the `japan-2026` branch of this repo for now.
