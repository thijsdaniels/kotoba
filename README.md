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
  translations/     one JSON per stage, keyed by label: literal English, an optional looser rendering, and who says it
tools/
  extract.py        disassembly → corpus/raw
  extract_data.py   disassembly → corpus/data
  build_corpus.py   corpus/raw + data + stages.json + engine.json → corpus/stages
  check_translations.py  which strings still lack a translation
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
- Translations are literal, line for line; a looser rendering may sit next to one in `loose`, never instead of it. Words Japanese leaves out but English needs are in parentheses, which the app renders lighter. `who` names the speaker in English when the game doesn't write one inline.
