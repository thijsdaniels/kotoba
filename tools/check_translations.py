#!/usr/bin/env python3
"""Validate the translations against the corpus.

For every placed string there must be a translation whose `sentences` are pairs whose
`ja` fields equal, in order, what tools/sentences.py cuts from the string, each with a
non-empty `en`. Translations for strings that no longer exist are reported as stale.
Exit status is non-zero when anything is wrong, so this can gate a build.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sentences import split_sentences

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(HERE, "corpus")


def main():
    problems = 0
    for fn in sorted(os.listdir(os.path.join(CORPUS, "stages"))):
        sid = fn[:-5]
        with open(os.path.join(CORPUS, "stages", fn), encoding="utf-8") as f:
            strings = {e["label"]: e for e in json.load(f)["strings"]}
        path = os.path.join(CORPUS, "translations", fn)
        translations = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        missing, broken = [], []
        for label, entry in strings.items():
            t = translations.get(label)
            if not t: missing.append(label); continue
            expected = split_sentences(entry["text"], entry.get("list", False))
            pairs = t.get("sentences", [])
            if [p.get("ja") for p in pairs] != expected: broken.append(f"{label}: ja units differ from the splitter")
            elif any(not p.get("en", "").strip() for p in pairs): broken.append(f"{label}: empty en")
        stale = [label for label in translations if label not in strings]
        problems += len(broken) + len(stale)
        print(f"{sid:16} {len(strings) - len(missing):4}/{len(strings):<4} translated" + (f"  missing {len(missing)}" if missing else "") + (f"  stale {stale}" if stale else ""))
        for b in broken: print("   ", b)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
