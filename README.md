# Pokémon Kotoba

Learning Japanese from the text of ポケットモンスター 緑, one stage of the game at a time.

The source of truth is the game itself, through the [pokegreen](https://github.com/Narishma-gb/pokegreen) disassembly: every string the game can show, map by map, plus its data tables. From that we build a corpus per stage, then a flashcard deck, then a spaced-repetition app that only shows you what you have actually met in the game.

## Layout

```
corpus/
  stages.json       which disassembly sources, wild maps and marts belong to which stage, in play order
  raw/              every text block in the disassembly, one JSON per source file (generated)
  data/             Pokémon, moves, items, types, wild encounters, mart stock (generated)
  stages/           one JSON per stage: its strings, Pokémon with known moves, moves, items (generated)
  coverage.json     which sources are claimed by a stage and which are not yet (generated)
tools/
  extract.py        disassembly → corpus/raw
  extract_data.py   disassembly → corpus/data
  build_corpus.py   corpus/raw + data + stages.json → corpus/stages
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
- `levelCap` per stage bounds which level-up moves count as known. The game's own obedience ladder is 10 with no badges, then 30 after the Cascade Badge, 50 after Rainbow, 70 after Marsh, everything after Earth.
- Translations are literal. A looser rendering may be added next to one, never instead of it.
