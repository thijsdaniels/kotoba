#!/usr/bin/env python3
"""Build deck/cards.json from deck/vocab/*.json, the corpus and its translations.

A hand-written card that quotes the game names the string it came from (`ref`, as
"<stage>/<label>"), the sentence in it (`sentence`, an index into the splitter's units)
and the word's surface form there (`surface`, which must occur exactly once in that
sentence). The build attaches that sentence, its translation and the speaker, and stamps
the card with the ref's stage. Nothing is guessed: a card that doesn't validate fails the
build. A card without a ref is an everyday example and belongs to its file's stage.

Pokémon, moves and items that a stage's data introduces but no hand-written card covers
get a plain card with the English name. Kana get one card each.
"""
import json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(HERE, "corpus")
DECK = os.path.join(HERE, "deck")

HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
ROMA = "a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa wo n".split()
SPECIAL_NAMES = {"NIDORAN_M": "Nidoran♂", "NIDORAN_F": "Nidoran♀", "MR_MIME": "Mr. Mime", "FARFETCHD": "Farfetch'd", "POKE_BALL": "Poké Ball",
                 "TM_42": "TM42", "OAKS_PARCEL": "Oak's Parcel", "POKEDEX": "Pokédex", "PARLYZ_HEAL": "Parlyz Heal", "THUNDERSHOCK": "Thundershock", "SOLARBEAM": "Solarbeam"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def english(const):
    return SPECIAL_NAMES.get(const, " ".join(word.capitalize() for word in const.lower().split("_")))


def main():
    stage_order = [s["id"] for s in load(os.path.join(CORPUS, "stages.json"))["stages"]]
    strings, translations = {}, {}
    for fn in os.listdir(os.path.join(CORPUS, "stages")):
        sid = fn[:-5]
        for entry in load(os.path.join(CORPUS, "stages", fn))["strings"]:
            strings[f"{sid}/{entry['label']}"] = entry
        path = os.path.join(CORPUS, "translations", fn)
        if os.path.exists(path):
            for label, translation in load(path).items():
                translations[f"{sid}/{label}"] = translation
    pokemon = {p["const"]: p for p in load(os.path.join(CORPUS, "data", "pokemon.json"))}
    moves = {m["const"]: m for m in load(os.path.join(CORPUS, "data", "moves.json"))}
    items = {i["const"]: i for i in load(os.path.join(CORPUS, "data", "items.json"))}

    cards, ids, errors, covered_kana = [], set(), [], set()

    def attach(card, file_stage):
        ref = card.get("ref")
        if not ref:
            card["stage"] = file_stage
            return card
        entry, translation = strings.get(ref), translations.get(ref)
        if not entry: errors.append(f"{card['id']}: unknown ref {ref}"); return card
        if not translation: errors.append(f"{card['id']}: {ref} has no translation"); return card
        index, surface = card.get("sentence"), card.get("surface")
        if not isinstance(index, int) or not (0 <= index < len(entry["sentences"])): errors.append(f"{card['id']}: sentence {index} out of range for {ref}"); return card
        sentence = entry["sentences"][index]
        if not surface or sentence.count(surface) != 1: errors.append(f"{card['id']}: surface {surface!r} does not occur exactly once in {ref}#{index}: {sentence}"); return card
        card["stage"] = ref.split("/")[0]
        if entry.get("speaker"): card["speaker"] = entry["speaker"]
        if translation.get("who"): card["who"] = translation["who"]
        card["line"] = sentence
        card["lineEn"] = translation["sentences"][index]["en"]
        return card

    for fn in sorted(os.listdir(os.path.join(DECK, "vocab"))):
        for card in load(os.path.join(DECK, "vocab", fn)):
            if card["id"] in ids: errors.append(f"duplicate id {card['id']}")
            ids.add(card["id"])
            covered_kana.add(re.sub(r"[〜～\s]", "", card["kana"]))
            cards.append(attach(dict(card), fn[:-5]))

    # Pokémon, moves and items from the stage data that nobody wrote a card for
    for sid in stage_order:
        stage = load(os.path.join(CORPUS, "stages", sid + ".json"))
        for p in stage["pokemon"]:
            if p["new"] and p["ja"] not in covered_kana:
                covered_kana.add(p["ja"]); ids.add("p-" + p["const"].lower())
                types = " / ".join(t.capitalize() for t in p["types"])
                levels = f" Met at level {', '.join(map(str, p['levels']))}." if p["levels"] else ""
                cards.append({"id": "p-" + p["const"].lower(), "kind": "pokemon", "kana": p["ja"], "meaning": english(p["const"]), "scope": "game", "stage": sid, "note": f"No. {p['dex']}, {types}.{levels}"})
        for m in stage["moves"]:
            if m["ja"] not in covered_kana:
                covered_kana.add(m["ja"]); ids.add("m-" + m["const"].lower())
                cards.append({"id": "m-" + m["const"].lower(), "kind": "move", "kana": m["ja"], "meaning": english(m["const"]), "scope": "game", "stage": sid, "note": f"Known by {english(m['learnedBy'])}."})
        for i in stage["items"]:
            if i.get("ja") and i["ja"] not in covered_kana:
                covered_kana.add(i["ja"]); ids.add("i-" + i["const"].lower())
                cards.append({"id": "i-" + i["const"].lower(), "kind": "item", "kana": i["ja"], "meaning": english(i["const"]), "scope": "game", "stage": sid})

    for i, ch in enumerate(HIRA):
        cards.append({"id": f"k-hira-{ROMA[i]}", "kind": "kana", "kana": ch, "meaning": ROMA[i], "set": "hira", "order": 9001 + i, "stage": "intro", "recogOnly": True})
    for i, ch in enumerate(KATA):
        cards.append({"id": f"k-kata-{ROMA[i]}", "kind": "kana", "kana": ch, "meaning": ROMA[i], "set": "kata", "order": 9047 + i, "stage": "intro", "recogOnly": True})

    for card in cards:
        if card.get("stage") not in stage_order and card.get("stage") != "system":
            errors.append(f"{card['id']}: stage {card.get('stage')}")
    if errors:
        print("\n".join(errors), file=sys.stderr); sys.exit(1)
    cards.sort(key=lambda c: (stage_order.index(c["stage"]) if c["stage"] in stage_order else 99, c["kind"], c["id"]))
    with open(os.path.join(DECK, "cards.json"), "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)
    print(f"{len(cards)} cards:", dict(Counter(c["stage"] for c in cards)))
    print("by kind:", dict(Counter(c["kind"] for c in cards)))


if __name__ == "__main__":
    main()
