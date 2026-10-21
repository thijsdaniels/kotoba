#!/usr/bin/env python3
"""Extract every Japanese string from the pokegreen disassembly into corpus/raw/*.json.

Usage: tools/extract.py /path/to/pokegreen

One JSON file per source file that contains text. Each entry is one text block:
the label it hangs off, the lines as the game shows them, and the speaker when the
text names one (NAME『). Placeholders stay as {player}, {rival}, {target}, {user}.
"""
import json, os, re, sys

SOURCE_DIRS = ["scripts", "engine", "home", "data"]
CHAR_SUBS = {
    "#": "ポケモン", "<PC>": "パソコン", "<TM>": "わざマシン", "<TRAINER>": "トレーナー",
    "<ROCKET>": "ロケットだん", "<⋯>": "……", "<PLAYER>": "{player}", "<RIVAL>": "{rival}",
    "<TARGET>": "{target}", "<USER>": "{user}", "<LV>": "Lv", "<do>": "ど", "<ID>": "ID",
    "<ED>": "", "<_CONT>": "", "<CONT>": "", "<NEXT>": "", "<LINE>": "", "<PARA>": "", "<DONE>": "",
    "<PROMPT>": "", "<NULL>": "", "<SCROLL>": "",
}
TEXT_MACROS = {"text", "line", "cont", "para", "next", "db", "text_start"}
END_MACROS = {"done", "prompt", "text_end", "text_asm", "text_far", "text_low", "text_waitbutton",
              "text_promptbutton", "text_pause", "text_dots", "text_decimal", "text_bcd", "text_ram",
              "text_bcd", "sound_get_item_1", "sound_get_item_2", "sound_get_key_item", "sound_caught_mon",
              "sound_dex_page_added", "sound_level_up", "sound_cry_nidorina", "sound_cry_pidgeot", "sound_cry_dewgong"}
STRING_RE = re.compile(r'^\s*(\w+)\s+"((?:[^"\\]|\\.)*)"')
LABEL_RE = re.compile(r'^(\.?\w+):')
SPEAKER_RE = re.compile(r'^([^『「]{1,12})『')


def clean(s):
    for k, v in CHAR_SUBS.items():
        s = s.replace(k, v)
    s = s.replace("@", "")
    return s.strip("　 ")


def parse_file(path):
    blocks, current, label, parent = [], None, None, None
    with open(path, encoding="utf-8") as f:
        for n, raw in enumerate(f, 1):
            line = raw.split(";")[0].rstrip()
            m = LABEL_RE.match(line)
            if m:
                if current and current["lines"]:
                    blocks.append(current)
                name = m.group(1)
                if name.startswith("."):
                    label = parent + name if parent else name
                else:
                    parent = label = name
                current = {"label": label, "line": n, "lines": [], "paragraphs": 0}
                continue
            m = STRING_RE.match(line)
            if m and current is not None:
                macro, s = m.group(1), m.group(2)
                if macro not in TEXT_MACROS:
                    continue
                if macro == "para":
                    current["paragraphs"] += 1
                    current["lines"].append("")
                text = clean(s)
                if macro == "db" and not any("぀" <= ch <= "ヿ" for ch in text):
                    continue  # ascii data, not game text
                if text == "" and macro != "para":
                    continue
                current["lines"].append(text)
                continue
            macro = line.strip().split(" ")[0] if line.strip() else ""
            if macro in END_MACROS and current and current["lines"]:
                blocks.append(current)
                current = {"label": label, "line": n, "lines": [], "paragraphs": 0, "continuation": True}
    if current and current["lines"]:
        blocks.append(current)
    out = []
    for b in blocks:
        if not any(b["lines"]):
            continue
        joined = "\n".join(b["lines"]).strip()
        joined = re.sub(r"\n{3,}", "\n\n", joined)
        sp = SPEAKER_RE.match(joined)
        entry = {"label": b["label"], "line": b["line"], "text": joined}
        if sp:
            entry["speaker"] = sp.group(1)
            entry["text"] = joined[sp.end():].strip()
        if b.get("continuation"):
            entry["continuation"] = True
        out.append(entry)
    return out


def main(root):
    outdir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "corpus", "raw")
    os.makedirs(outdir, exist_ok=True)
    total, files = 0, 0
    for d in SOURCE_DIRS:
        for dirpath, _, names in os.walk(os.path.join(root, d)):
            for name in sorted(names):
                if not name.endswith(".asm"):
                    continue
                path = os.path.join(dirpath, name)
                entries = parse_file(path)
                if not entries:
                    continue
                rel = os.path.relpath(path, root)
                with open(os.path.join(outdir, rel.replace("/", "__").replace(".asm", ".json")), "w", encoding="utf-8") as f:
                    json.dump({"source": rel, "entries": entries}, f, ensure_ascii=False, indent=1)
                total += len(entries); files += 1
    print(f"{total} text blocks from {files} files → {outdir}")


if __name__ == "__main__":
    main(sys.argv[1])
