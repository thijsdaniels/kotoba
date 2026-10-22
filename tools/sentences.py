"""The one rule that cuts a game string into sentences.

A unit ends after ！, ？ or 。. Text-box and paragraph breaks are not boundaries, since
the game breaks boxes mid-sentence; they become spaces. A paragraph with no kana at all
(a row of ……) is a unit of its own. List-style entries (menus, option screens) are one
unit per line. Whatever survives is stripped of surrounding whitespace; empty units are
dropped.

Translations are written against these units, one English unit per Japanese unit, and
the validators refuse anything that disagrees with this function.
"""
import re

TERMINATORS = "！？。"


def split_sentences(text: str, is_list: bool = False) -> list[str]:
    if is_list:
        return [line.strip("\u3000 ") for line in text.split("\n") if line.strip("\u3000 ")]
    units: list[str] = []
    pending = ""  # text carried across a box break until a terminator closes it
    for paragraph in text.split("\n\n"):
        flat = re.sub(r"[\s\u3000]*\n[\s\u3000]*", " ", paragraph.strip()).strip("\u3000 ")
        if not flat:
            continue
        if not re.search(r"[\u3040-\u30ff]", flat):
            if pending: units.append(pending); pending = ""
            units.append(flat); continue
        flat = (pending + " " + flat) if pending else flat
        pending = ""
        start = 0
        for i, ch in enumerate(flat):
            if ch in TERMINATORS and (i + 1 == len(flat) or flat[i + 1] not in TERMINATORS):
                unit = flat[start:i + 1].strip("\u3000 ")
                if unit: units.append(unit)
                start = i + 1
        pending = flat[start:].strip("\u3000 ")
    if pending: units.append(pending)
    return units
