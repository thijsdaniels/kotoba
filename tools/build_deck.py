#!/usr/bin/env python3
"""Build deck/cards.json from deck/vocab/*.json, the corpus and its translations.

Each hand-written card names the corpus string it was taken from (`ref`, as
"<stage>/<label>"). The build attaches that string's speaker and the paragraph that
contains the word, with its translation, and stamps the card with the ref's stage.
Pokémon, moves and items that a stage's data introduces but no hand-written card
covers get a plain card with the English name. Kana get one card each.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(HERE, "corpus")
DECK = os.path.join(HERE, "deck")

HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
ROMA = "a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa wo n".split()


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def english(const):
    special = {"NIDORAN_M": "Nidoran♂", "NIDORAN_F": "Nidoran♀", "MR_MIME": "Mr. Mime", "FARFETCHD": "Farfetch'd", "POKE_BALL": "Poké Ball",
               "TM_42": "TM42", "OAKS_PARCEL": "Oak's Parcel", "POKEDEX": "Pokédex", "PARLYZ_HEAL": "Parlyz Heal", "THUNDERSHOCK": "Thundershock", "SOLARBEAM": "Solarbeam"}
    return special.get(const, " ".join(w.capitalize() for w in const.lower().split("_")))


def main():
    stages_cfg = load(os.path.join(CORPUS, "stages.json"))["stages"]
    order = [s["id"] for s in stages_cfg]
    strings, translations = {}, {}
    for fn in os.listdir(os.path.join(CORPUS, "stages")):
        sid = fn[:-5]
        for e in load(os.path.join(CORPUS, "stages", fn))["strings"]:
            strings[f"{sid}/{e['label']}"] = e
        p = os.path.join(CORPUS, "translations", fn)
        if os.path.exists(p):
            for label, t in load(p).items():
                translations[f"{sid}/{label}"] = t
    pokemon = {p["const"]: p for p in load(os.path.join(CORPUS, "data", "pokemon.json"))}
    moves = {m["const"]: m for m in load(os.path.join(CORPUS, "data", "moves.json"))}
    items = {i["const"]: i for i in load(os.path.join(CORPUS, "data", "items.json"))}

    cards, ids, errors = [], set(), []
    covered_kana = set()

    def attach(card, file_stage):
        ref = card.pop("ref", None)
        if not ref:
            # a card with no game line: an everyday example only; it belongs to the stage of its file
            card["stage"] = file_stage; return card
        if ref not in strings:
            errors.append(f"{card['id']}: unknown ref {ref}"); return card
        s, t = strings[ref], translations.get(ref, {})
        card["stage"] = ref.split("/")[0]
        card["ref"] = ref
        if s.get("speaker"): card["speaker"] = s["speaker"]
        if t.get("who"): card["who"] = t["who"]
        paras_ja = s["text"].split("\n\n")
        paras_en = t.get("en", "").split("\n\n")
        core = re.sub(r"[〜～\s\u3000]", "", card.get("kana", "")).split("／")[0].strip()
        flat = [p.replace("\u3000", "").replace(" ", "").replace("\n", "") for p in paras_ja]
        # like the app's highlighter: the word itself, else its longest prefix of at least two characters (verb stems)
        pick = None
        probes = [core[:n] for n in range(len(core), 1, -1)]
        # conjugated stems of short godan verbs: いく → いっ, いき, いけ...; and the example sentence for grammar cards
        shifts = {"う": "わいっえお", "く": "かきっけこ", "ぐ": "がぎんげご", "す": "さしせそ", "つ": "たちってと", "ぬ": "なにんねの", "ぶ": "ばびんべぼ", "む": "まみんめも", "る": "らりっれろ"}
        if len(core) == 2 and core[-1] in shifts:
            probes += [core[0] + k for k in shifts[core[-1]]]
        if core == "する": probes += ["し", "さ", "せ"]
        if card.get("example"): probes.insert(0, card["example"].replace(" ", "").replace("\u3000", ""))
        for part in probes:
            pick = next((i for i, p in enumerate(flat) if part in p), None)
            if pick is not None: break
        if pick is not None and len(paras_en) == len(paras_ja):
            card["line"], card["lineEn"] = paras_ja[pick].replace("\n", " "), paras_en[pick]
        else:
            card["line"], card["lineEn"] = s["text"].replace("\n\n", " / ").replace("\n", " "), t.get("en", "")
            if pick is None and core: card["lineNote"] = "word not found in the line"
        if t.get("loose") and pick is None: card["lineLoose"] = t["loose"]
        return card

    for fn in sorted(os.listdir(os.path.join(DECK, "vocab"))):
        for c in load(os.path.join(DECK, "vocab", fn)):
            if c["id"] in ids: errors.append(f"duplicate id {c['id']}")
            ids.add(c["id"])
            covered_kana.add(re.sub(r"[〜～\s]", "", c["kana"]))
            cards.append(attach(dict(c), fn[:-5]))

    # Pokémon, moves and items from the stage data that nobody wrote a card for
    for sid in order:
        st = load(os.path.join(CORPUS, "stages", sid + ".json"))
        for p in st["pokemon"]:
            if p["new"] and p["ja"] not in covered_kana:
                covered_kana.add(p["ja"]); ids.add("p-" + p["const"].lower())
                cards.append({"id": "p-" + p["const"].lower(), "kind": "pokemon", "kana": p["ja"], "meaning": english(p["const"]), "scope": "game", "stage": sid,
                              "note": f"No. {p['dex']}, {' / '.join(t.capitalize() for t in p['types'])}. Met at level {', '.join(map(str, p['levels']))}." if p["levels"] else f"No. {p['dex']}, {' / '.join(t.capitalize() for t in p['types'])}."})
        for m in st["moves"]:
            if m["ja"] not in covered_kana:
                covered_kana.add(m["ja"]); ids.add("m-" + m["const"].lower())
                cards.append({"id": "m-" + m["const"].lower(), "kind": "move", "kana": m["ja"], "meaning": english(m["const"]), "scope": "game", "stage": sid,
                              "note": f"Known by {english(m['learnedBy'])}."})
        for i in st["items"]:
            if i.get("ja") and i["ja"] not in covered_kana:
                covered_kana.add(i["ja"]); ids.add("i-" + i["const"].lower())
                cards.append({"id": "i-" + i["const"].lower(), "kind": "item", "kana": i["ja"], "meaning": english(i["const"]), "scope": "game", "stage": sid})

    # kana
    for i, ch in enumerate(HIRA):
        cards.append({"id": f"k-hira-{ROMA[i]}", "kind": "kana", "kana": ch, "meaning": ROMA[i], "set": "hira", "order": 9001 + i, "stage": "intro", "recogOnly": True})
    for i, ch in enumerate("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"):
        cards.append({"id": f"k-kata-{ROMA[i]}", "kind": "kana", "kana": ch, "meaning": ROMA[i], "set": "kata", "order": 9047 + i, "stage": "intro", "recogOnly": True})

    for c in cards:
        if c.get("stage") not in order and c.get("stage") != "system":
            errors.append(f"{c['id']}: stage {c.get('stage')}")
    if errors:
        print("\n".join(errors), file=sys.stderr); sys.exit(1)
    cards.sort(key=lambda c: (order.index(c["stage"]) if c["stage"] in order else 99, c["kind"], c["id"]))
    with open(os.path.join(DECK, "cards.json"), "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)
    from collections import Counter
    print(f"{len(cards)} cards:", dict(Counter(c['stage'] for c in cards)))
    print("by kind:", dict(Counter(c['kind'] for c in cards)))
    print("lines not matched:", sum(1 for c in cards if c.get("lineNote")))


if __name__ == "__main__":
    main()
