#!/usr/bin/env python3
"""Write cards/kana.json: one recognition-only card per kana, numbered in gojūon order."""
import json, os

PACKAGE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
ROMA = "a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa wo n".split()

cards = []
for index, ch in enumerate(HIRA):
    cards.append({"id": f"hira-{ROMA[index]}", "kind": "kana", "chapter": "hiragana", "kana": ch, "meaning": ROMA[index], "set": "hira", "order": index, "recogOnly": True})
for index, ch in enumerate(KATA):
    cards.append({"id": f"kata-{ROMA[index]}", "kind": "kana", "chapter": "katakana", "kana": ch, "meaning": ROMA[index], "set": "kata", "order": len(HIRA) + index, "recogOnly": True})
with open(os.path.join(PACKAGE, "cards", "kana.json"), "w", encoding="utf-8") as f:
    json.dump(cards, f, ensure_ascii=False, indent=1)
print(f"{len(cards)} kana cards")
