#!/usr/bin/env python3
"""Assemble corpus/stages/<stage>.json from the raw extraction and corpus/stages.json.

Each stage file holds every game string first met at that stage (with source file,
label and speaker), the Pokémon first encounterable there with the moves they can
know up to the stage's level cap, the moves and items that become relevant, and a
coverage section. Also writes corpus/coverage.json listing raw sources that no stage
claims, so nothing stays untagged by accident.
"""
import json, os, sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(HERE, "corpus")


def load(name):
    with open(os.path.join(CORPUS, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    cfg = load("stages.json")
    raw = {}
    for fn in sorted(os.listdir(os.path.join(CORPUS, "raw"))):
        d = load(os.path.join("raw", fn))
        raw[d["source"]] = d["entries"]
    pokemon = {p["const"]: p for p in load("data/pokemon.json")}
    moves = {m["const"]: m for m in load("data/moves.json")}
    items = {i["const"]: i for i in load("data/items.json")}
    wild = load("data/wild.json")
    marts = load("data/marts.json")

    claimed, seen_pokemon, seen_moves, seen_items = set(), set(), set(), set()
    os.makedirs(os.path.join(CORPUS, "stages"), exist_ok=True)
    # the starters and the rival's starter are met in Oak's lab
    extra_pokemon = {"pallet": ["BULBASAUR", "CHARMANDER", "SQUIRTLE"]}
    for stage in cfg["stages"]:
        cap = stage.get("levelCap", 0)
        strings = []
        for src in stage.get("sources", []):
            if src not in raw:
                print(f"warning: {stage['id']} lists {src} but it has no text", file=sys.stderr)
                continue
            if src in claimed:
                print(f"error: {src} is claimed twice", file=sys.stderr); sys.exit(1)
            claimed.add(src)
            for e in raw[src]:
                strings.append({"source": src, **e})
        mons = OrderedDict()
        for const in extra_pokemon.get(stage["id"], []):
            mons[const] = {"levels": []}
        for map_name in stage.get("wild", []):
            for kind, block in wild.get(map_name, {}).items():
                for slot in block["slots"]:
                    mons.setdefault(slot["pokemon"], {"levels": []})["levels"].append(slot["level"])
        stage_pokemon = []
        for const, info in mons.items():
            p = pokemon[const]
            known = [m for m in p["startMoves"]] + [l["move"] for l in p["learnset"] if l["level"] <= max(cap, max(info["levels"] or [0]))]
            entry = {"const": const, "ja": p["ja"], "dex": p["dex"], "types": p["types"], "levels": sorted(set(info["levels"])),
                     "moves": list(OrderedDict.fromkeys(known)), "new": const not in seen_pokemon}
            seen_pokemon.add(const)
            stage_pokemon.append(entry)
        stage_moves = []
        for p in stage_pokemon:
            for mv in p["moves"]:
                if mv not in seen_moves:
                    seen_moves.add(mv); stage_moves.append({"const": mv, "ja": moves[mv]["ja"], "learnedBy": p["const"]})
        stage_items = []
        for clerk in stage.get("marts", []):
            for it in marts.get(clerk, []):
                if it not in seen_items:
                    seen_items.add(it); stage_items.append({"const": it, "ja": items[it]["ja"], "from": clerk})
        out = {"id": stage["id"], "name": stage["name"], "levelCap": cap, "strings": strings,
               "pokemon": stage_pokemon, "moves": stage_moves, "items": stage_items}
        with open(os.path.join(CORPUS, "stages", stage["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f"{stage['id']:16} {len(strings):4} strings  {len(stage_pokemon):2} pokemon  {len(stage_moves):2} moves  {len(stage_items):2} items")
    unclaimed = sorted(s for s in raw if s not in claimed)
    with open(os.path.join(CORPUS, "coverage.json"), "w", encoding="utf-8") as f:
        json.dump({"claimed": sorted(claimed), "unclaimed": unclaimed}, f, ensure_ascii=False, indent=1)
    print(f"{len(claimed)} sources claimed, {len(unclaimed)} not yet in any stage")


if __name__ == "__main__":
    main()
