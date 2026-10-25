# japan-2026

Japanese that Thijs actually met on his four-week trip through Japan in October 2026: things he said, things said to him, signs and menus he read. Built by hand, in the same format as every other package, so the app can mix it into the deck.

This file is the brief for the session that builds it. Read the repository README first for the package format; it is the contract, and `tools/build_packages.py` enforces it.

## What this package is for

The card's value is the memory. Reading きろく on a card is one thing; reading いっこずつ？ and remembering the bun stall in Nikkō where the vendor asked it is another. So every quoted string in this package must be something that was really said or seen, with where and when. A word Thijs looked up afterwards is still welcome, but as an everyday example, not a quote.

The first exchange, which is also the test case for the whole package (Oct 23, a steamed-bun stall): Thijs asked for two kinds of bun with "X と Y を ひとつ ください", the vendor asked いっこずつ？ (one of each?), and he learned afterwards that two each is ふたつずつ, having guessed にずつ.

## Where the material is

- The trip journal: repository `thijsdaniels/japan-2026`, `data/trip.js`, one entry per day. This is the source of truth for dates and places, and for any Japanese he wrote down at the time.
- The chats in the Trip to Japan project: around two dozen long sessions, several compressed by the token limit. Exchanges in Japanese came up in some of them, usually as a question to Claude about something he had just said or heard. Search for kana, for "said", "asked", "sign", "menu", "vendor", "clerk", and for place names from the journal.
- Memory: the project's `japanese-learning` file and the trip file.

Treat a chat's compressed summary as weaker evidence than the journal or his own words in an uncompressed turn. If a line can't be traced to one of those, don't present it as a quote.

## Step 1: the candidate list, before any package files

Produce `packages/japan-2026/candidates.md` and stop for Thijs's review. One entry per exchange:

```
### 2026-10-23 · Nikkō · steamed-bun stall
Evidence: chat "…" (turn where he describes it) / journal entry Oct 23
- Thijs: X と Y を ひとつ ください
- Vendor: いっこずつ？
Learned afterwards, not said: ふたつずつ (two each)
Candidate cards: ずつ (each), いっこ (one, counter こ), ひとつ, ください
```

Include everything found, flagged by confidence, including things that are probably not usable, so he can decide. He is the only one who knows which lines he actually said and heard, and he will correct wording: a half-remembered line from a summary is not a quote until he confirms it.

## Step 2: the package, after his review

Layout, like every package:

```
package.json         id "japan-2026", title "Japan 2026", a one-line description; no kinds, no slots, no settings
chapters.json        one chapter per day that has material, in date order: { "id": "2026-10-23", "name": "Oct 23 · Nikkō" }
strings/<day>.json   {"strings": [{ "label", "text", "sentences", "speaker" }]}
translations/<day>.json   label → { "sentences": [{ "ja", "en" }] }
cards/<day>.json     the cards
```

Conventions, the same as the game package:

- `text` is the line as said, in kana (kanji only if he read it that way, on a sign or a menu). `sentences` must be exactly what `tools/sentences.py` cuts from `text`; run `python3 tools/check_translations.py` to be sure. A line is usually one unit.
- `speaker` is the context the card shows above the quote: "Thijs", "Bun-stall vendor, Nikkō", "Sign at Nikkō station". Required for every string; this is the provenance.
- Translations are strict and literal, one English unit per Japanese unit. Words Japanese leaves out but English needs go in parentheses, "(one) of each?", and nowhere else; the app renders them lighter. No loose paraphrase in the `en` field; a `loose` field on the card can carry a natural rendering in addition.
- A card quoting a line carries `ref` ("<chapter>/<label>"), `units` ([first, last], usually [0, 0]) and `surface` (the word exactly as it occurs in that line, once). A card for something learned afterwards has no `ref`, carries `chapter` explicitly, and may have `example` and `exampleEn` written as an everyday sentence; the app shows it differently from a quote.
- Kinds: `word`, `form`, `ending` only; this package declares none of its own. A counter like こ or つ, or a particle like ずつ, is an `ending` with the 〜 prefix in its kana (〜ずつ), like the game package does.
- Card ids are short romaji, unique within the package (`zutsu`, `ikko`, `hitotsu`); the build namespaces them.
- Meanings: primary gloss first, " · " then nuance, as in the game package; no Japanese inside the meaning (it is the production prompt), notes carry explanations.
- No parentheses in UI text except for implied words. Title Case for labels. American English.
- Every card must build: `python3 tools/build_packages.py` refuses anything that doesn't validate, and that is the point.

## What not to do

- Don't invent example sentences and present them as quotes. The quote is the memory; a made-up one is worth less than no card.
- Don't add settings, kinds or slots to the manifest; this package needs none. If something seems to need one, write it up as a question instead.
- Don't touch the app or the game package. If the format turns out not to fit something real (a sign with no sentence, a menu that is a list, an exchange with three speakers), say so with the concrete case; the format is allowed to change, but by discussion, not by a workaround in the data.
- Don't generate the package from the journal with a script. There is nothing to automate yet; the first package is written by hand so the format is tested by a human reading the result.

## Done looks like

`python3 tools/build_packages.py` lists `japan-2026` with its cards and chapters; `python3 tools/check_translations.py` is clean; the package is committed on a branch and pushed, with the candidate list left in place as the record of what was considered. Thijs enables it under Settings.
