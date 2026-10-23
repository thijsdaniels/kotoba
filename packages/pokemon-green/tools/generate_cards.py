#!/usr/bin/env python3
"""Write cards/generated.json: a plain card for every Pokémon, move and mart item a stage
introduces that no hand-written card covers (same kana), with the English name as the
meaning. Run after build_corpus.py and whenever the hand-written cards change.
"""
import json, os, re

PACKAGE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIAL_NAMES = {"NIDORAN_M": "Nidoran♂", "NIDORAN_F": "Nidoran♀", "MR_MIME": "Mr. Mime", "FARFETCHD": "Farfetch'd", "POKE_BALL": "Poké Ball",
                 "TM_42": "TM42", "OAKS_PARCEL": "Oak's Parcel", "POKEDEX": "Pokédex", "PARLYZ_HEAL": "Parlyz Heal", "THUNDERSHOCK": "Thundershock", "SOLARBEAM": "Solarbeam"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def english(const):
    return SPECIAL_NAMES.get(const, " ".join(word.capitalize() for word in const.lower().split("_")))


def main():
    covered = set()
    for fn in os.listdir(os.path.join(PACKAGE, "cards")):
        if fn == "generated.json": continue
        for card in load(os.path.join(PACKAGE, "cards", fn)):
            covered.add(re.sub(r"[〜～\s]", "", card["kana"]))
    cards = []
    for group in load(os.path.join(PACKAGE, "groups.json")):
        stage = load(os.path.join(PACKAGE, "strings", group["id"] + ".json"))
        for p in stage.get("pokemon", []):
            if p["new"] and p["ja"] not in covered:
                covered.add(p["ja"])
                types = " / ".join(t.capitalize() for t in p["types"])
                levels = f" Met at level {', '.join(map(str, p['levels']))}." if p["levels"] else ""
                cards.append({"id": "p-" + p["const"].lower(), "kind": "pokemon", "group": group["id"], "kana": p["ja"], "meaning": english(p["const"]), "note": f"No. {p['dex']}, {types}.{levels}"})
        for m in stage.get("moves", []):
            if m["ja"] not in covered:
                covered.add(m["ja"])
                cards.append({"id": "m-" + m["const"].lower(), "kind": "move", "group": group["id"], "kana": m["ja"], "meaning": english(m["const"]), "note": f"Known by {english(m['learnedBy'])}."})
        for i in stage.get("items", []):
            if i.get("ja") and i["ja"] not in covered:
                covered.add(i["ja"])
                cards.append({"id": "i-" + i["const"].lower(), "kind": "item", "group": group["id"], "kana": i["ja"], "meaning": english(i["const"])})
    with open(os.path.join(PACKAGE, "cards", "generated.json"), "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)
    print(f"{len(cards)} generated cards")


if __name__ == "__main__":
    main()
