# Kotoba

Learning Japanese from text you have actually met: the lines of ポケットモンスター 緑, one stage of the game at a time, and whatever else gets packaged the same way.

The app is a spaced-repetition deck (FSRS) over cards that quote the exact sentence a word was met in. It knows nothing about any particular source. Everything source-specific lives in a package.

## Layout

```
packages/
  kana/             hiragana and katakana, generated in gojūon order
  pokemon-green/    every string the game can show, built from the pokegreen disassembly
tools/
  sentences.py          the one rule that cuts a string into sentence units
  check_translations.py refuses translations whose units disagree with the splitter; lists what's untranslated
  build_packages.py     validates every package and builds public/packages/<id>.json for the app
  prebuild.mjs          runs the package build and stamps the service worker before every app build
src/                    the app: main.ts (interface), srs.ts (scheduler), api.ts (client)
api/                    Vercel functions: the learner's state in Vercel Blob
```

## A package

A package is a directory under `packages/` with a fixed authoring format. How the files get there is the package's own business: the Pokémon package generates them from the ROM with its `tools/`, another package may be written by hand. Every package goes through the same validator, and nothing is guessed: a card that doesn't validate fails the build.

```
package.json      id, title, description; optional kinds, slots and settings (below)
chapters.json       the package's ordered chapters: stages, chapters, days
strings/<chapter>.json        {"strings": [{label, text, sentences, speaker?, list?}]}
translations/<chapter>.json   label → {who?, sentences: [{ja, en}]}, one English unit per Japanese unit
cards/*.json      the cards
```

- A string is cut into sentence units by `tools/sentences.py` (after ！？。 or at the end of a text box; menus are one unit per line). Translations are written against those units, one literal English unit per Japanese unit, so a card can quote exactly the sentence its word is in. Words Japanese leaves out but English needs are in parentheses, which the app renders lighter. `who` names the speaker in English when the string doesn't carry one.
- A card that quotes a string carries `ref` (`"<chapter>/<label>"`), `units` (`[first, last]`, usually one sentence; a range when the source closes a box mid-sentence) and `surface` (the word as it appears there, which must occur exactly once in the quoted units). The build attaches the sentence, its translation and the speaker as `context`. A card without a ref is an everyday example and carries its `chapter` explicitly.
- Kinds: `word`, `form`, `ending` and `kana` are core kinds the app treats specially. A package declares any other kind it uses in its manifest, with a label and colors, and the app renders them like the core ones.
- Slots: a string may contain placeholders such as `{player}`; the manifest's `slots` give the label the app shows for each, and a text setting with a `slot` fills that placeholder with its value.
- Settings: the manifest declares what the package needs, as `{ key: { type: "text" | "number" | "choice", label, help?, default?, max?, min?, slot?, options? } }`, and the app renders it under Settings. Every package also gets a toggle and an "I'm At" position over its chapters; a position that isn't set means the latest chapter, so everything is open.
- Card ids are namespaced as `<package>/<id>` in the built output; progress is keyed by that.

### Rebuilding the Pokémon package

```
git clone --depth 1 https://github.com/Narishma-gb/pokegreen ../pokegreen
python3 packages/pokemon-green/tools/extract.py ../pokegreen
python3 packages/pokemon-green/tools/extract_data.py ../pokegreen
python3 packages/pokemon-green/tools/build_corpus.py
python3 packages/pokemon-green/tools/generate_cards.py
python3 tools/check_translations.py
python3 tools/build_packages.py
```

Inside the package: `stages.json` (stages in play order with their map scripts, wild maps, trainers, items, marts and level cap), `engine.json` (where each engine string is first met: a stage, "system", or a move/effect/item trigger), `raw/` and `data/` (extracted from the disassembly), `coverage.json` (sources no stage claims yet). `build_corpus.py` writes `strings/` and `chapters.json`, with the menus and messages that have no place in the game as the first chapter so they are always open. `generate_cards.py` writes `cards/generated.json`: a plain card for every Pokémon, move and mart item a stage introduces that no hand-written card covers. `tools/vocab_candidates.py <stage>` lists vocabulary in a stage's strings that no card covers yet, for curating. The generated files are committed so the app can be built without the disassembly.

## The app

Vite, plain TypeScript, no framework. At start it loads `public/packages/index.json` and every package, merges the cards into one deck, and installs each package's kind colors as CSS variables. Review mixes every enabled package; Practice filters by chapter and kind; the Cards list is grouped by package and chapter.

Progress and settings live in Vercel Blob through the functions in `api/`: one immutable JSON snapshot per write, newest found by listing, old ones pruned. The state carries a `format` number and `load()` upgrades older snapshots. Settings: `newPerDay`, `produce` (the kinds that also get a production side; kana never do), and `packages` (per package: `enabled`, `position`, `values` for the manifest's settings). Routes: `GET /api/state`, `POST /api/answer`, `POST /api/settings`, `POST /api/reset`. Every call needs the shared key in `x-kotoba-key`; the page stores it after opening `/?key=…` once, or from Settings.

Deployed on Vercel from `main`. Environment: `KOTOBA_KEY` (the shared key) and `BLOB_READ_WRITE_TOKEN` (set by the connected store).
