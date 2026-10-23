#!/usr/bin/env python3
"""Validate every package under packages/ and build public/packages/<id>.json for the app.

A package is a directory with:
  package.json       id, title, description; optional kinds (beyond the core word, form,
                     ending, kana), slots (placeholders in strings, with the label the app
                     shows), and settings (a schema the app renders; a text setting with a
                     slot fills that placeholder)
  groups.json        the package's ordered groups; the position setting gates by them
  strings/<group>.json   {"strings": [{label, text, sentences, speaker?, list?}]} — optional
  translations/<group>.json   label → {who?, sentences: [{ja, en}]} — optional
  cards/*.json       cards; a card either names a string (ref "group/label", units
                     [first, last], surface occurring exactly once in those units) or
                     carries its group explicitly and is an everyday example

Nothing is guessed: a card that does not validate fails the build. The output carries each
card with its package, group, context (who said the line), the quoted sentence and its
translation, and ids namespaced as "<package>/<id>".
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGES = os.path.join(ROOT, "packages")
OUT = os.path.join(ROOT, "public", "packages")
CORE_KINDS = {"word", "form", "ending", "kana"}
SETTING_TYPES = {"text", "number", "choice"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_package(directory, errors):
    manifest = load(os.path.join(directory, "package.json"))
    package_id = manifest["id"]
    if package_id != os.path.basename(directory): errors.append(f"{package_id}: directory is named {os.path.basename(directory)}")
    groups = load(os.path.join(directory, "groups.json"))
    group_ids = [group["id"] for group in groups]
    kinds = CORE_KINDS | set(manifest.get("kinds", {}))
    for key, setting in manifest.get("settings", {}).items():
        if setting.get("type") not in SETTING_TYPES: errors.append(f"{package_id}: setting {key} has type {setting.get('type')}, not one of {sorted(SETTING_TYPES)}")

    strings, translations = {}, {}
    strings_dir, translations_dir = os.path.join(directory, "strings"), os.path.join(directory, "translations")
    if os.path.isdir(strings_dir):
        for fn in os.listdir(strings_dir):
            group = fn[:-5]
            if group not in group_ids: errors.append(f"{package_id}: strings/{fn} is not a group"); continue
            for entry in load(os.path.join(strings_dir, fn))["strings"]:
                strings[f"{group}/{entry['label']}"] = entry
            path = os.path.join(translations_dir, fn)
            if os.path.exists(path):
                for label, translation in load(path).items():
                    translations[f"{group}/{label}"] = translation

    cards, ids = [], set()

    def attach(card):
        ref = card.get("ref")
        if not ref:
            if card.get("group") not in group_ids: errors.append(f"{package_id}/{card['id']}: no ref and group {card.get('group')} is not a group"); return card
            return card
        entry, translation = strings.get(ref), translations.get(ref)
        if not entry: errors.append(f"{package_id}/{card['id']}: unknown ref {ref}"); return card
        if not translation: errors.append(f"{package_id}/{card['id']}: {ref} has no translation"); return card
        units, surface = card.get("units"), card.get("surface")
        count = len(entry["sentences"])
        if not (isinstance(units, list) and len(units) == 2 and all(isinstance(u, int) for u in units) and 0 <= units[0] <= units[1] < count):
            errors.append(f"{package_id}/{card['id']}: units {units} are not a valid range for {ref} with {count} units"); return card
        first, last = units
        sentence = " ".join(entry["sentences"][first:last + 1])
        if not surface or sentence.count(surface) != 1: errors.append(f"{package_id}/{card['id']}: surface {surface!r} does not occur exactly once in {ref}#{first}-{last}: {sentence}"); return card
        card["group"] = ref.split("/")[0]
        context = entry.get("speaker") or translation.get("who")
        if context: card["context"] = context
        card["line"] = sentence
        card["lineEn"] = " ".join(pair["en"] for pair in translation["sentences"][first:last + 1])
        return card

    for fn in sorted(os.listdir(os.path.join(directory, "cards"))):
        for card in load(os.path.join(directory, "cards", fn)):
            if card["id"] in ids: errors.append(f"{package_id}: duplicate id {card['id']}")
            ids.add(card["id"])
            if card.get("kind") not in kinds: errors.append(f"{package_id}/{card['id']}: kind {card.get('kind')} is neither core nor declared by the package")
            card = attach(dict(card))
            card["id"] = f"{package_id}/{card['id']}"
            card["package"] = package_id
            cards.append(card)

    order = {group: index for index, group in enumerate(group_ids)}
    cards.sort(key=lambda card: (order.get(card.get("group"), 99), card.get("kind", ""), card.get("order", 0), card["id"]))
    return {**manifest, "groups": groups, "cards": cards}


def main():
    errors, built = [], []
    for name in sorted(os.listdir(PACKAGES)):
        directory = os.path.join(PACKAGES, name)
        if os.path.isfile(os.path.join(directory, "package.json")):
            built.append(build_package(directory, errors))
    if errors:
        print("\n".join(errors), file=sys.stderr); sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    for package in built:
        with open(os.path.join(OUT, package["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(package, f, ensure_ascii=False)
        print(f"{package['id']:16} {len(package['cards']):4} cards in {len(package['groups'])} groups")
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump([{"id": p["id"], "title": p["title"], "description": p.get("description", "")} for p in built], f, ensure_ascii=False)


if __name__ == "__main__":
    main()
