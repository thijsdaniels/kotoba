#!/usr/bin/env python3
"""Report strings without a translation and translations without a string, per stage."""
import json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(HERE, "corpus")
ok = True
for fn in sorted(os.listdir(os.path.join(CORPUS, "stages"))):
    sid = fn[:-5]
    with open(os.path.join(CORPUS, "stages", fn), encoding="utf-8") as f:
        labels = [e["label"] for e in json.load(f)["strings"]]
    path = os.path.join(CORPUS, "translations", fn)
    tr = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    missing = [l for l in labels if l not in tr]
    extra = [k for k in tr if k not in labels]
    print(f"{sid:16} {len(labels) - len(missing):4}/{len(labels):<4} translated" + (f"  missing {len(missing)}" if missing else "") + (f"  stale {extra}" if extra else ""))
    if extra: ok = False
sys.exit(0 if ok else 1)
