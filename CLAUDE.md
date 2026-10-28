# Kotoba

A spaced-repetition app (FSRS) over the Japanese Thijs has actually met. It holds no content of its own: sources such
as Midori (../midori) send cards through its API, each into its own deck. `SPEC.md` is the design and the card
contract; `README.md` the layout and the API in short. Read `SPEC.md` before changing the API or the card shape.

## Rules

- **The card contract is shared.** `api/_contract.ts` is the contract in code, and Midori builds cards against it.
  Change it only together with `SPEC.md`, and say what a source has to change.
- **A card is identified by its `source`**, the source's own stable ID. Re-sending a card updates it in place and keeps
  its progress; never key anything on content.
- **`meaning` is literal**, `loose` a natural rendering in addition, never instead: the same split as Midori's glosses
  and translations, with the same sense in both.
- **The server validates and rejects with a reason**; it never guesses or repairs a card.
- **Storage** is two snapshot series in Vercel Blob (library and progress) with optimistic concurrency: writes never
  overwrite (`allowOverwrite: false`), the loser reloads and retries, old snapshots are pruned after a minute. Only
  `api/_store.ts` knows about Blob.
- Plain TypeScript and Vite, no framework, no new dependencies without a reason.

## Working with Thijs

- Plans and known gaps are GitHub issues, not notes in the docs; the docs describe what is.
- Live at kotoba.thijsdaniels.vercel.app, deployed by Vercel from `main`. Environment: `KOTOBA_KEY` and
  `BLOB_READ_WRITE_TOKEN`. Every API call needs the key in `x-kotoba-key`; don't print or commit it.
- When he asks a question, answer it and wait; build when he says so. When something he asks for has a good reason
  against it, say so before changing it.
