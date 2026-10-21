#!/usr/bin/env python3
"""Assemble corpus/stages/<stage>.json from the raw extraction, stages.json and engine.json.

Each stage file holds every game string first met at that stage (with source file,
label and speaker), the Pokémon you can have or face there with the moves they can
know, the moves and items that become relevant, and the stage's level cap.

Engine strings are placed by corpus/engine.json: a fixed stage, "system" (always
unlocked, written to corpus/stages/system.json), "skip", "later", or a trigger that is
resolved against the stages' move, effect and item pools. Strings whose trigger is not
reached by any mapped stage are listed under "deferred" in corpus/coverage.json, along
with raw sources no stage claims, so nothing stays untagged by accident.
"""
import fnmatch, json, os, sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(HERE, "corpus")


def load(name):
    with open(os.path.join(CORPUS, name), encoding="utf-8") as f:
        return json.load(f)


def dump(name, data):
    with open(os.path.join(CORPUS, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def main():
    cfg = load("stages.json")
    engine = load("engine.json")
    raw = {}
    for fn in sorted(os.listdir(os.path.join(CORPUS, "raw"))):
        d = load(os.path.join("raw", fn))
        raw[d["source"]] = d["entries"]
    pokemon = {p["const"]: p for p in load("data/pokemon.json")}
    moves = {m["const"]: m for m in load("data/moves.json")}
    items = {i["const"]: i for i in load("data/items.json")}
    wild = load("data/wild.json")
    marts = load("data/marts.json")

    def moves_known(const, level):
        p = pokemon[const]
        return list(OrderedDict.fromkeys(p["startMoves"] + [l["move"] for l in p["learnset"] if l["level"] <= level]))

    # pass 1: per-stage pools of Pokémon, moves, effects and items, cumulative in play order
    stages = []
    seen_pokemon, seen_moves, seen_items, party = set(), set(), set(), set()
    cumulative = []  # (stage id, moves so far, effects so far, items so far)
    all_moves, all_effects, all_items = set(), set(), set()
    for stage in cfg["stages"]:
        cap = stage.get("levelCap", 0)
        mons = OrderedDict()
        if stage["id"] == "pallet":
            for const in ("BULBASAUR", "CHARMANDER", "SQUIRTLE"):
                mons[const] = {"levels": [5], "yours": True}
        for map_name in stage.get("wild", []):
            for kind, block in wild.get(map_name, {}).items():
                for slot in block["slots"]:
                    mons.setdefault(slot["pokemon"], {"levels": [], "yours": True})["levels"].append(slot["level"])
        for t in stage.get("trainers", []):
            mons.setdefault(t["pokemon"], {"levels": [], "yours": False})["levels"].append(t["level"])
        stage_pokemon, stage_moves = [], []
        for const, info in mons.items():
            top = max(info["levels"] + ([cap] if info["yours"] else []))
            known = moves_known(const, top)
            stage_pokemon.append({"const": const, "ja": pokemon[const]["ja"], "dex": pokemon[const]["dex"], "types": pokemon[const]["types"],
                                  "levels": sorted(set(info["levels"])), "moves": known, "new": const not in seen_pokemon})
            seen_pokemon.add(const)
            for mv in known:
                if mv not in seen_moves:
                    seen_moves.add(mv); stage_moves.append({"const": mv, "ja": moves[mv]["ja"], "effect": moves[mv].get("effect"), "learnedBy": const})
        # Pokémon you caught earlier keep leveling: their moves up to this stage's cap count too
        for const in sorted(party):
            if const in mons: continue
            for mv in moves_known(const, cap):
                if mv not in seen_moves:
                    seen_moves.add(mv); stage_moves.append({"const": mv, "ja": moves[mv]["ja"], "effect": moves[mv].get("effect"), "learnedBy": const})
        party |= {c for c, i in mons.items() if i["yours"]}
        stage_items = []
        for it in stage.get("items", []) + [x for clerk in stage.get("marts", []) for x in marts.get(clerk, [])]:
            if it not in seen_items:
                seen_items.add(it); stage_items.append({"const": it, "ja": items.get(it, {}).get("ja")})
        all_moves |= {m["const"] for m in stage_moves}
        all_effects |= {m["effect"] for m in stage_moves if m.get("effect")}
        all_items |= {i["const"] for i in stage_items}
        cumulative.append((stage["id"], set(all_moves), set(all_effects), set(all_items)))
        stages.append({"id": stage["id"], "name": stage["name"], "levelCap": cap, "strings": [], "pokemon": stage_pokemon, "moves": stage_moves, "items": stage_items})
    by_id = {s["id"]: s for s in stages}

    def resolve(spec):
        if isinstance(spec, str):
            return spec
        for sid, mv, ef, it in cumulative:
            if "move" in spec and set(spec["move"]) & mv: return sid
            if "effect" in spec and any(fnmatch.fnmatch(e, pat) for e in ef for pat in spec["effect"]): return sid
            if "item" in spec and set(spec["item"]) & it: return sid
        return "later"

    # pass 2: place strings
    claimed, deferred, skipped = set(), [], 0
    system = {"id": "system", "name": "Menus and Messages", "strings": []}
    for stage in cfg["stages"]:
        for src in stage.get("sources", []):
            if src not in raw:
                print(f"warning: {stage['id']} lists {src} but it has no text", file=sys.stderr); continue
            if src in claimed:
                print(f"error: {src} is claimed twice", file=sys.stderr); sys.exit(1)
            claimed.add(src)
            for e in raw[src]:
                by_id[stage["id"]]["strings"].append({"source": src, **e})
    for src, default in engine["files"].items():
        if src not in raw:
            print(f"warning: engine.json lists {src} but it has no text", file=sys.stderr); continue
        if src in claimed:
            print(f"error: {src} is claimed by a stage and by engine.json", file=sys.stderr); sys.exit(1)
        claimed.add(src)
        overrides = engine["labels"].get(src, {})
        for e in raw[src]:
            spec = overrides.get(e["label"], default)
            where = resolve(spec)
            entry = {"source": src, **e}
            if not isinstance(spec, str): entry["trigger"] = spec
            if where == "skip": skipped += 1
            elif where == "system": system["strings"].append(entry)
            elif where == "later": deferred.append(entry)
            elif where in by_id: by_id[where]["strings"].append(entry)
            else: print(f"error: {src} {e['label']} maps to unknown stage {where}", file=sys.stderr); sys.exit(1)

    os.makedirs(os.path.join(CORPUS, "stages"), exist_ok=True)
    for s in stages:
        dump(os.path.join("stages", s["id"] + ".json"), s)
        print(f"{s['id']:16} {len(s['strings']):4} strings  {len(s['pokemon']):2} pokemon  {len(s['moves']):2} moves  {len(s['items']):2} items")
    dump(os.path.join("stages", "system.json"), system)
    print(f"{'system':16} {len(system['strings']):4} strings")
    unclaimed = sorted(s for s in raw if s not in claimed)
    dump("coverage.json", {"claimed": sorted(claimed), "unclaimed": unclaimed, "deferred": deferred})
    print(f"{len(claimed)} sources claimed, {len(unclaimed)} not yet in any stage, {len(deferred)} engine strings deferred, {skipped} skipped")


if __name__ == "__main__":
    main()
