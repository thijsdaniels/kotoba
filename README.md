# Pokémon Kotoba

Learning Japanese from the text of ポケットモンスター 緑, one stage of the game at a time.

The source of truth is the game itself, through the [pokegreen](https://github.com/Narishma-gb/pokegreen) disassembly: every string the game can show, map by map, plus its data tables. From that we build a corpus per stage, then a flashcard deck, then a spaced-repetition app that only shows you what you have actually met in the game.

## Layout

```
corpus/
  stages.json       the stages in play order: map scripts, wild maps, trainers, items, marts, level cap
  engine.json       where each engine string is first met: a stage, "system", or a move/effect/item trigger
  raw/              every text block in the disassembly, one JSON per source file (generated)
  data/             Pokémon, moves, items, types, wild encounters, mart stock (generated)
  stages/           one JSON per stage plus system.json: strings, Pokémon with known moves, moves, items (generated)
  coverage.json     sources no stage claims yet, and engine strings whose trigger lies past the mapped stages (generated)
  translations/     one JSON per stage, keyed by label: `sentences`, one {ja, en} pair per unit the splitter cuts, plus who says it
tools/
  extract.py        disassembly → corpus/raw
  extract_data.py   disassembly → corpus/data
  build_corpus.py   corpus/raw + data + stages.json + engine.json → corpus/stages
  sentences.py      the one rule that cuts a game string into sentence units
  check_translations.py  refuses translations whose units disagree with the splitter, and lists what's untranslated
```

## Rebuilding the corpus

```
git clone --depth 1 https://github.com/Narishma-gb/pokegreen ../pokegreen
python3 tools/extract.py ../pokegreen
python3 tools/extract_data.py ../pokegreen
python3 tools/build_corpus.py
```

The generated files are committed so the deck can be built without the disassembly.

## Conventions

- Placeholders in strings: `{player}`, `{rival}`, `{target}`, `{user}`. `#` in the ROM is already expanded to ポケモン, `<PC>` to パソコン, and so on.
- A speaker is recorded when the game writes it inline (`オーキド『…`); otherwise the label names the NPC.
- Every source file belongs to exactly one stage, the stage where its text is first met. `coverage.json` lists what is still unassigned; the goal is an empty list.
- `levelCap` per stage is the highest level your Pokémon plausibly have there; it bounds which level-up moves count as known. Wild and trainer Pokémon use their actual levels.
- Engine text has no map, so `engine.json` says where it is first met. Menus and messages with no place in the game at all are "system" and always unlocked. A string triggered by a move, a move effect or an item is placed at the first stage where that trigger is available, computed from the data, so "speed fell" lands where String Shot does.
- A string is cut into sentence units by `tools/sentences.py` (after ！？。; text-box breaks are not boundaries; menus are one unit per line). Translations are written against those units, one literal English unit per Japanese unit, so a card can quote exactly the sentence its word is in. `check_translations.py` refuses anything else. Words Japanese leaves out but English needs are in parentheses, which the app renders lighter. `who` names the speaker in English when the game doesn't write one inline.

## The deck

```
deck/
  vocab/<stage>.json  hand-written cards: words, forms, endings, Pokémon, moves, items, terms (names and game jargon); each names the corpus string it came from (`ref`)
  cards.json          the built deck (generated): every card with its stage, speaker, game line and translation, plus the kana
tools/
  vocab_candidates.py <stage>  vocabulary in a stage's strings that no card covers yet, for curating
  build_deck.py                deck/vocab + corpus + translations → deck/cards.json
```

A card that quotes the game carries `ref` (the string), `units` (`[first, last]`, the sentence units it quotes, usually one) and `surface` (the word as it appears there, which must occur exactly once in the quoted units); the build validates all three and attaches the sentence and its translation, with no guessing. A card's stage is the stage of its `ref`; a card without a ref is an everyday example and belongs to its file's stage. Pokémon, moves and mart items a stage introduces get a plain card automatically unless a hand-written one covers the same kana.

## The app

Vite, plain TypeScript, no framework. `src/main.ts` is the whole interface, `src/srs.ts` the FSRS scheduler, `src/api.ts` the client. The deck is a static asset (`public/cards.json`, copied from `deck/` at build time), so a change to the corpus or the vocabulary ships with the next push.

Progress and settings live in Vercel Blob through the functions in `api/`: one immutable JSON snapshot per write, newest found by listing, old ones pruned. Settings: `newPerDay`, `stage`, `produce` (the kinds that also get a production side; kana never do), the player and rival names. Routes: `GET /api/state`, `POST /api/answer`, `POST /api/settings`, `POST /api/reset`. Every call needs the shared key in `x-kotoba-key`; the page stores it after opening `/?key=…` once, or from Settings.

Deployed on Vercel from `main`. Environment: `KOTOBA_KEY` (the shared key) and `BLOB_READ_WRITE_TOKEN` (set by the connected store).
