#!/usr/bin/env python3
"""Extract game data tables from the pokegreen disassembly into data/*.json.

Usage: tools/extract_data.py /path/to/pokegreen

Produces: pokemon.json (internal id, dex number, Japanese name, types, level-1 moves,
level-up learnset, evolutions), moves.json, items.json, types.json, wild.json
(encounters per map), marts.json (stock per clerk).
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data")


def read(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8") as f:
        return f.read()


def consts(text, start=0):
    """Map constant names to ids from a const_def block (first block only)."""
    out, n = {}, start
    for line in text.splitlines():
        line = line.split(";")[0].strip()
        m = re.match(r"const_def(?:\s+(\d+))?", line)
        if m:
            n = int(m.group(1)) if m.group(1) else 0
            continue
        m = re.match(r"const\s+(\w+)", line)
        if m:
            out[m.group(1)] = n; n += 1
            continue
        m = re.match(r"const_skip(?:\s+(\d+))?", line)
        if m:
            n += int(m.group(1)) if m.group(1) else 1
    return out


def name_list(text, macro):
    return [m.group(1).replace("@", "") for m in re.finditer(rf'^\s*{macro}\s+"([^"]*)"', text, re.M)]


def main(root):
    os.makedirs(OUT, exist_ok=True)
    mon_ids = consts(read(root, "constants/pokemon_constants.asm"))
    dex_ids = consts(read(root, "constants/pokedex_constants.asm"))
    move_ids = consts(read(root, "constants/move_constants.asm"))
    item_ids = consts(read(root, "constants/item_constants.asm"))
    type_ids = consts(read(root, "constants/type_constants.asm"))
    id_to_mon = {v: k for k, v in mon_ids.items()}
    id_to_move = {v: k for k, v in move_ids.items()}
    id_to_item = {v: k for k, v in item_ids.items()}
    id_to_type = {v: k for k, v in type_ids.items()}

    mon_names = name_list(read(root, "data/pokemon/names.asm"), "dname")
    move_names = name_list(read(root, "data/moves/names.asm"), "li")
    item_names = name_list(read(root, "data/items/names.asm"), "li")
    type_names = {m.group(1).upper(): m.group(2).replace("@", "").strip("　") for m in re.finditer(r'^\.(\w+):\s*db "([^"]*)"', read(root, "data/types/names.asm"), re.M)}

    move_stats = {}
    for m in re.finditer(r"^\s*move\s+(\w+),\s*(\w+),\s*(\d+),\s*(\w+),\s*(\d+),\s*(\d+)", read(root, "data/moves/moves.asm"), re.M):
        move_stats[m.group(1)] = {"effect": m.group(2), "power": int(m.group(3)), "type": m.group(4), "accuracy": int(m.group(5)), "pp": int(m.group(6))}
    moves = [{"id": i + 1, "const": id_to_move.get(i + 1), "ja": n, **move_stats.get(id_to_move.get(i + 1), {})} for i, n in enumerate(move_names)]
    items = [{"id": i + 1, "const": id_to_item.get(i + 1), "ja": n} for i, n in enumerate(item_names)]

    # evolutions and level-up learnsets, per internal id
    evos_text = read(root, "data/pokemon/evos_moves.asm")
    learnsets = {}
    for m in re.finditer(r"^(\w+)EvosMoves:\n(.*?)(?=^\w+EvosMoves:|\Z)", evos_text, re.S | re.M):
        label, body = m.group(1), m.group(2)
        evos, learn, in_learn = [], [], False
        for line in body.splitlines():
            line = line.split(";")[0].strip()
            if line.startswith("db EVOLVE_LEVEL"):
                _, lvl, sp = [x.strip() for x in line[3:].split(",")]; evos.append({"method": "level", "level": int(lvl), "into": sp})
            elif line.startswith("db EVOLVE_ITEM"):
                _, item, _, sp = [x.strip() for x in line[3:].split(",")]; evos.append({"method": "item", "item": item, "into": sp})
            elif line.startswith("db EVOLVE_TRADE"):
                _, _, sp = [x.strip() for x in line[3:].split(",")]; evos.append({"method": "trade", "into": sp})
            elif line == "db 0":
                if in_learn: break
                in_learn = True
            elif in_learn and line.startswith("db "):
                lvl, mv = [x.strip() for x in line[3:].split(",")]; learn.append({"level": int(lvl), "move": mv})
        learnsets[label.upper()] = {"evolutions": evos, "learnset": learn}

    pokemon = []
    base_dir = os.path.join(root, "data/pokemon/base_stats")
    for fn in sorted(os.listdir(base_dir)):
        t = read(root, f"data/pokemon/base_stats/{fn}")
        dex = re.search(r"db (DEX_\w+)", t).group(1)
        types = re.search(r"db (\w+), (\w+) ; type", t).groups()
        lvl1 = re.search(r"db ([\w, ]+) ; level 1 learnset", t).group(1)
        const = dex[4:]
        internal = mon_ids.get(const)
        # evos_moves labels drop the underscore: NIDORAN_M → NidoranM
        key = const.replace("_", "")
        ls = learnsets.get(key, {"evolutions": [], "learnset": []})
        pokemon.append({
            "const": const, "id": internal, "dex": dex_ids[dex],
            "ja": mon_names[internal - 1] if internal else None,
            "types": sorted(set(types), key=types.index),
            "startMoves": [x.strip() for x in lvl1.split(",") if x.strip() != "NO_MOVE"],
            "learnset": ls["learnset"], "evolutions": ls["evolutions"],
        })
    pokemon.sort(key=lambda p: p["dex"])

    # wild encounters per map
    wild = {}
    wild_dir = os.path.join(root, "data/wild/maps")
    for fn in sorted(os.listdir(wild_dir)):
        t = read(root, f"data/wild/maps/{fn}")
        entry = {}
        for kind in ("grass", "water"):
            m = re.search(rf"def_{kind}_wildmons (\d+)(.*?)end_{kind}_wildmons", t, re.S)
            if not m or int(m.group(1)) == 0: continue
            slots = [{"level": int(a), "pokemon": b} for a, b in re.findall(r"db\s+(\d+),\s*(\w+)", m.group(2))]
            entry[kind] = {"rate": int(m.group(1)), "slots": slots}
        if entry: wild[fn[:-4]] = entry

    marts = {}
    for m in re.finditer(r"^(\w+)::\n\s*script_mart (.+)$", read(root, "data/items/marts.asm"), re.M):
        marts[m.group(1)] = [x.strip() for x in m.group(2).split(",")]

    types = [{"id": i, "const": c, "ja": type_names.get(c)} for c, i in sorted(type_ids.items(), key=lambda x: x[1])]

    for name, data in [("pokemon", pokemon), ("moves", moves), ("items", items), ("wild", wild), ("marts", marts), ("types", types)]:
        with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{len(pokemon)} pokemon, {len(moves)} moves, {len(items)} items, {len(wild)} wild maps, {len(marts)} marts")


if __name__ == "__main__":
    main(sys.argv[1])
