"""The one rule that cuts a game string into sentences.

A unit ends after ！, ？ or 。, or at the end of a text box (the game usually closes a box
at a sentence end even when it writes no punctuation). Line breaks inside a box become
spaces. A box with no kana at all (a row of ……) is a unit of its own. List-style entries
(menus, option screens) are one unit per line. Whatever survives is stripped of
surrounding whitespace; empty units are dropped.

The few boxes the game closes mid-sentence yield half-sentence units; a card that needs
the whole sentence quotes a range of units.

Translations are written against these units, one English unit per Japanese unit, and
the validators refuse anything that disagrees with this function.
"""
import re

TERMINATORS = "！？。"


def split_sentences(text: str, is_list: bool = False) -> list[str]:
    if is_list:
        return [line.strip("\u3000 ") for line in text.split("\n") if line.strip("\u3000 ")]
    units: list[str] = []
    for box in text.split("\n\n"):
        flat = re.sub(r"[\s\u3000]*\n[\s\u3000]*", " ", box.strip()).strip("\u3000 ")
        if not flat:
            continue
        start = 0
        for i, ch in enumerate(flat):
            if ch in TERMINATORS and (i + 1 == len(flat) or flat[i + 1] not in TERMINATORS):
                unit = flat[start:i + 1].strip("\u3000 ")
                if unit: units.append(unit)
                start = i + 1
        rest = flat[start:].strip("\u3000 ")
        if rest: units.append(rest)
    return units
