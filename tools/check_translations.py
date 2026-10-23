#!/usr/bin/env python3
"""Validate every package's translations against its strings.

For every string there must be a translation whose `sentences` are pairs whose `ja`
fields equal, in order, what tools/sentences.py cuts from the string, each with a
non-empty `en`. Translations for strings that no longer exist are reported as stale.
Exit status is non-zero when anything is wrong, so this can gate a build.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sentences import split_sentences

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGES = os.path.join(ROOT, "packages")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_group(name, strings_path, translations_path):
    """Print one line for the group and return how many things are wrong."""
    strings = {entry["label"]: entry for entry in load(strings_path)["strings"]}
    translations = load(translations_path) if os.path.exists(translations_path) else {}
    missing, broken = [], []
    for label, entry in strings.items():
        translation = translations.get(label)
        if not translation: missing.append(label); continue
        expected = split_sentences(entry["text"], entry.get("list", False))
        pairs = translation.get("sentences", [])
        if [pair.get("ja") for pair in pairs] != expected: broken.append(f"{label}: ja units differ from the splitter")
        elif any(not pair.get("en", "").strip() for pair in pairs): broken.append(f"{label}: empty en")
    stale = [label for label in translations if label not in strings]
    print(f"{name:32} {len(strings) - len(missing):4}/{len(strings):<4} translated" + (f"  missing {len(missing)}" if missing else "") + (f"  stale {stale}" if stale else ""))
    for problem in broken: print("   ", problem)
    return len(broken) + len(stale)


def main():
    problems = 0
    for package in sorted(os.listdir(PACKAGES)):
        strings_dir = os.path.join(PACKAGES, package, "strings")
        if not os.path.isdir(strings_dir): continue
        for fn in sorted(os.listdir(strings_dir)):
            problems += check_group(f"{package}/{fn[:-5]}", os.path.join(strings_dir, fn), os.path.join(PACKAGES, package, "translations", fn))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
