#!/usr/bin/env python3
"""Write public/starters/kana.json: the Kana starter deck, one recognition-only card per kana in gojūon order.

Run from the repo root. The app adds it through the same API as any other source."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIRAGANA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
KATAKANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
ROMAJI = "a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa wo n".split()

cards = []
for script, name, characters in (("hira", "hiragana", HIRAGANA), ("kata", "katakana", KATAKANA)):
    for index, character in enumerate(characters):
        cards.append({
            "source": f"{script}-{ROMAJI[index]}",
            "kind": "kana",
            "kana": character,
            "meanings": [ROMAJI[index]],
            "note": name,
            "order": len(cards),
            "recognitionOnly": True,
        })

starter = {
    "deck": {"id": "kana", "title": "Kana", "description": "Hiragana and katakana, in gojūon order.", "introduce": "in order", "production": False},
    "cards": cards,
}
with open(os.path.join(ROOT, "public", "starters", "kana.json"), "w", encoding="utf-8") as file:
    json.dump(starter, file, ensure_ascii=False, indent=1)
print(f"{len(cards)} kana cards")
