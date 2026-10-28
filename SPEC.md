# Kotoba and Midori: the split

Decided on Oct 27, 2026; the card identity, meanings and particles on Oct 28. Where the code and this file disagree, one of them is wrong.

## Three repos

- **japan-2026**: the trip journal. Untouched by any of this.
- **kotoba**: the review app. It owns the decks, the cards in them, and the learner's progress, and exposes a small API for adding cards. It holds no card content of its own and knows nothing about Pokémon, kana or the trip.
- **midori**: the Pokémon Green companion. The game in an emulator in the page, the disassembly as a pinned dependency, and our layer on the script: sentence splits, literal glosses, natural translations and word cards. It talks to Kotoba only through the API.

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
  source: string;        // required. Stable within the deck, from facts about the card, never its wording: "つかまえる#捕まえる", "hira-a", "2026-10-13/sumimasen"
  kind: "noun" | "pronoun" | "name" | "verb" | "i-adjective" | "na-adjective" | "pre-noun" | "adverb" | "conjunction"
      | "interjection" | "particle" | "auxiliary" | "prefix" | "suffix" | "expression" | "form" | "kana";
  kana: string;          // required. The Japanese as read
  meanings: string[];    // required, at least one. Literal English, one entry per sense the learner has met; "(…)" marks words Japanese leaves out, shown lighter
  kanji?: string;
  romaji?: string;
  loose?: string;        // a natural rendering, only ever in addition to the literal one
  note?: string;         // behind "More"
  // form cards: what the form is made from and what it is
  base?: string; form?: string; register?: string; verbClass?: string;
  // the sentence the word was met in; surface is where the word sits in it: [start, length], as JavaScript indexes
  // strings (line.slice(start, start + length)); Kotoba checks only that it's inside the line
  line?: string; lineEn?: string; speaker?: string; surface?: [number, number];
  // an everyday example of our own
  example?: string; exampleEn?: string; exampleLoose?: string;
  order?: number;              // position when the deck introduces in order
  recognitionOnly?: boolean;   // never asked in production, whatever the deck says
}
```

**Identity.** A card's `source` is derived from facts about what the card is, so the same thing always gets the same ID and nothing about it is chosen: Midori's word cards use the dictionary form, plus `#` and the kanji when the word has kanji, plus `@` and the kind (`が@particle`, `ポケモン@name`, `する@verb`, `つかまえる#捕まえる@verb`, `はし#橋@noun` and `はし#箸@noun` apart). The kind is always there, so a word used as two kinds is two cards (`どれ@pronoun`, which, and `どれ@interjection`, let's see) and meeting a new use later never moves an existing card. The kana is what the game prints; the kanji, an annotation of ours, only tells apart words that sound alike. Never a hash of the content or a label: rewording a meaning must not make a new card.

**Meanings.** One card per word, not per sense: a word met in a second sense keeps its card and gains a meaning. `meanings` lists only the senses the learner has met, never the whole dictionary entry. Kotoba shows them joined with "; ".

**Merging is the source's job.** Kotoba replaces a known card's content on re-import, as for any correction; it never merges or guesses. A source that adds a sense first reads the card (`GET …/cards`), appends the new meaning if that exact string isn't there, and sends the whole card. Exact matching works because the source keeps its wording consistent (Midori's corpus check reports a word whose meanings differ between occurrences).

**Correcting a source** (a fixed dictionary form, kanji or kind) makes a new card: the old one keeps its progress until it's deleted. Moving a card and its progress to a new source is [issue #1](https://github.com/thijsdaniels/kotoba/issues/1).

Oct 28 changes: `meaning` became `meanings`, `surface` became a range instead of the text (which had to occur exactly once, and short words occur inside others all the time), and the kind `particle` was added (particles are learned for what they do, not what they mean). Cards stored in the old shape are read as the new one: `meanings: [meaning]`, and the surface text as its range where it occurs once. The Kana starter is regenerated.

**Kinds** are parts of speech, as Japanese grammar has them (学校文法), so a card says how its word behaves: noun, pronoun (おれ, ここ, それ: who uses which says a lot), name (proper nouns: Pokémon, people, places, items), verb, い-adjective, な-adjective, pre-noun (連体詞: この, その, どの, only ever before a noun), adverb, conjunction, interjection, particle, auxiliary (助動詞: だ, です, ます, らしい, which conjugate where particles don't), prefix and suffix (お, ご; counters, さん, たち), and expression for a set phrase learned whole (おまちどうさまでした). `pattern` is a grammar point (文型) rather than a word: its `kana` is the pattern (〜ば, 〜ませんでした, 〜ている), its meaning what the pattern does, and its line the sentence it was met in, the word that has it marked; Midori's source for one is the pattern and `@pattern` (`ば@pattern`, `ている@pattern`). A word's conjugation is one pattern, as learners are taught it: きませんでした is くる and 〜ませんでした, not ます, ない and た. `form` and `kana` are Kotoba's own: a conjugation drill and a kana card. The app colors them in families: nouns, names, verbs, adjectives, other content words, grammar.

Oct 29 changes: the kinds `word` and `ending` gave way to parts of speech. The few cards stored with them (Midori's, none reviewed yet) were sent again with their new kind, under their new source, which now ends in `@` and the kind; the old ones were removed.

Changes from the old built-card format, all renames for clarity: `context` → `speaker`, `vclass` → `verbClass`, `recogOnly` → `recognitionOnly`, and a new `kind`, `name`, for proper nouns (Pokémon, moves, items, places). The source-specific kinds (`pokemon`, `move`, `item`, `term`) and the per-package colors go away; kinds are linguistic and fixed in Kotoba. The `set` field of kana cards goes into `note`. Placeholders like `{player}` are the source's business: Midori fills them in before sending.

The server validates every card and rejects what doesn't fit, with the reason: missing required fields, an unknown kind, a `surface` range outside `line`. Nothing is guessed. Whether the range is the right word only the source can know (unspaced text has no word boundaries for Kotoba to check), so the source checks it before sending: Midori asserts the slice is the word as its breakdown has it, and a hand-written source finds the word with a helper that refuses when it occurs more than once.

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

Built; its README describes it. What concerns the split:

1. **What it sends.** A word card from the reading panel's word card, into the deck `midori`: `kana` the dictionary form, `kanji`, `kind` (its part of speech, as in its corpus), `meanings` the sense on that occurrence's card, `note` its grammar and notes, and the sentence it was met in as `line` (Japanese, with names filled in), `lineEn` (the natural translation), `surface` (the range of the word in it, checked against the breakdown before sending) and `speaker`. The first sentence a word was sent from stays its example.
2. **Its IDs** follow Identity above, from the corpus: dictionary form, plus `#` and the kanji. Midori's corpus check fails a word that has kanji in one occurrence and none in another, since that would split one word into two cards.
3. **Merging** follows the rule above: a word already in the deck in another sense gets that sense appended.
4. **Marking**: it reads the deck's cards to mark words already sent.
5. **Offline**: sends wait in a queue on the device until there's signal, then read, merge and send.
6. **The key and Kotoba's address** are set in Midori's settings and kept on the device.

The ROM is uploaded once per device and kept in IndexedDB, never shipped; the build assembles Green V1.1 only for its symbol map and hash (4b97cd44…). Thijs's cartridge is V1.1.

## The trip deck

Last, once the API exists. Not 1,700 candidates: a shortlist of 5 to 10 per day that Thijs picks from, sent as a `trip` deck. Lines Claude composed are credited to Claude, a card doesn't need a quoted sentence, and basics may be in. The pilot day and the extraction live on the `japan-2026` branch of this repo for now.
