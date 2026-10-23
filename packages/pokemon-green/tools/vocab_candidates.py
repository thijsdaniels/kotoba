#!/usr/bin/env python3
"""List vocabulary in a stage's strings that no deck card covers yet.

Usage: tools/vocab_candidates.py <stage> [--all]

Tokenizes each string (the game's own spaces first, then SudachiPy inside a chunk,
which is unreliable on kana-only text, so this is a candidate list for a human to
curate, not a deck). A lemma counts as covered when a card in this stage or an
earlier one has it as kana, base, or inside its kana. Needs: pip install sudachipy sudachidict_core
"""
import json, os, re, sys
from collections import Counter, defaultdict

PACKAGE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = PACKAGE
DECK = os.path.join(PACKAGE, "cards")
CONTENT = {"名詞", "動詞", "形容詞", "副詞", "連体詞", "感動詞", "代名詞", "形状詞", "接続詞"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(stage, show_all=False):
    from sudachipy import Dictionary, SplitMode
    tok = Dictionary().tokenizer()
    order = [s["id"] for s in load(os.path.join(CORPUS, "stages.json"))["stages"]]
    upto = order[: order.index(stage) + 1] if stage in order else [stage]
    covered = set()
    for sid in upto + ["system"]:
        p = os.path.join(DECK, sid + ".json")
        if not os.path.exists(p): continue
        for c in load(p):
            for k in ("kana", "base"):
                if c.get(k): covered.add(re.sub(r"[〜～]", "", c[k]).split("／")[0].strip())
    strings = load(os.path.join(CORPUS, "strings", stage + ".json"))["strings"]
    seen, example, split_chunks = Counter(), {}, []
    for e in strings:
        for chunk in re.split(r"[\s　]+", e["text"]):
            chunk = chunk.strip("！？…「」。、·⋯()")
            if not chunk or "{" in chunk: continue
            ms = [m for m in tok.tokenize(chunk, SplitMode.C) if m.part_of_speech()[0] in CONTENT]
            if len(ms) > 1: split_chunks.append((chunk, [m.surface() for m in ms]))
            for m in ms:
                lemma = m.dictionary_form()
                if len(lemma) < 2 and m.part_of_speech()[0] != "動詞": continue
                key = (lemma, m.part_of_speech()[0], m.normalized_form())
                seen[key] += 1
                example.setdefault(key, (chunk, e["label"]))
    rows = []
    for (lemma, pos, norm), n in seen.most_common():
        is_covered = lemma in covered or any(lemma in c for c in covered if len(c) >= len(lemma))
        if is_covered and not show_all: continue
        chunk, label = example[(lemma, pos, norm)]
        rows.append(f"{n:3} {'✓' if is_covered else ' '} {lemma:10} {pos:4} {norm:10} {chunk:16} {label}")
    print("\n".join(rows))
    print(f"\n{len(rows)} candidates; chunks the tokenizer split (check these by hand):")
    for chunk, parts in split_chunks[:400]:
        print("  ", chunk, "→", " + ".join(parts))


if __name__ == "__main__":
    main(sys.argv[1], "--all" in sys.argv)
