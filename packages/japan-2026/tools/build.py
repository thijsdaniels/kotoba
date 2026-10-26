#!/usr/bin/env python3
"""Build the Japan 2026 package's standard files from its day files.

The package is written by hand, one file per day in days/ (days/<chapter>.json), so that a
day's lines and the cards quoting them sit together:

  {
    "chapter": {"id": "oct13", "name": "Oct 13 · Into the Kiso Valley"},
    "lines": [{"label", "who", "text", "en": [one literal English unit per Japanese unit], "list"?}],
    "cards": [{...card, "ref"?: "<label in this day>", "units"?: [first, last]}]
  }

A line is something Thijs said, heard, asked how to say, or read. Its text is cut into units
by tools/sentences.py like any other string, and "en" must match those units one to one.
A card's "ref" names a line of the same day ("units" defaults to [0, 0]); a card without a
ref is a word met without a sentence (a thing seen, a word explained) and its "note" says where.

This writes chapters.json, strings/, translations/ and cards/ for tools/build_packages.py,
which validates them like every other package. Run it before that build.
"""
import json, os, sys

PACKAGE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(PACKAGE)), "tools"))
from sentences import split_sentences  # noqa: E402


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def main():
    days_dir = os.path.join(PACKAGE, "days")
    with open(os.path.join(days_dir, "order.json"), encoding="utf-8") as f:
        order = json.load(f)
    errors, chapters, seen_ids = [], [], set()
    for name in ("strings", "translations", "cards"):
        directory = os.path.join(PACKAGE, name)
        if os.path.isdir(directory):
            for fn in os.listdir(directory): os.remove(os.path.join(directory, fn))
    for chapter_id in order:
        with open(os.path.join(days_dir, chapter_id + ".json"), encoding="utf-8") as f:
            day = json.load(f)
        chapter = day["chapter"]
        if chapter["id"] != chapter_id: errors.append(f"days/{chapter_id}.json: chapter id is {chapter['id']}")
        chapters.append(chapter)
        strings, translations, labels = [], {}, set()
        for line in day.get("lines", []):
            label = line["label"]
            if label in labels: errors.append(f"{chapter_id}: duplicate line {label}")
            labels.add(label)
            units = split_sentences(line["text"], line.get("list", False))
            if len(units) != len(line["en"]): errors.append(f"{chapter_id}/{label}: {len(units)} Japanese units {units} but {len(line['en'])} English")
            entry = {"label": label, "text": line["text"], "sentences": units}
            if line.get("list"): entry["list"] = True
            strings.append(entry)
            translations[label] = {"who": line["who"], "sentences": [{"ja": ja, "en": en} for ja, en in zip(units, line["en"])]}
        cards = []
        for card in day.get("cards", []):
            card = dict(card)
            if card["id"] in seen_ids: errors.append(f"{chapter_id}: card {card['id']} already exists on an earlier day")
            seen_ids.add(card["id"])
            if "ref" in card:
                if card["ref"] not in labels: errors.append(f"{chapter_id}/{card['id']}: no line {card['ref']}")
                card["ref"] = f"{chapter_id}/{card['ref']}"
                card.setdefault("units", [0, 0])
            else:
                card["chapter"] = chapter_id
            cards.append(card)
        if strings:
            write(os.path.join(PACKAGE, "strings", chapter_id + ".json"), {"strings": strings})
            write(os.path.join(PACKAGE, "translations", chapter_id + ".json"), translations)
        write(os.path.join(PACKAGE, "cards", chapter_id + ".json"), cards)
    if errors:
        print("\n".join(errors), file=sys.stderr); sys.exit(1)
    write(os.path.join(PACKAGE, "chapters.json"), chapters)
    print(f"japan-2026: {len(chapters)} days, {len(seen_ids)} cards")


if __name__ == "__main__":
    main()
