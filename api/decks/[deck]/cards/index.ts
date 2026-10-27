import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cardId, DECK_ID, validateCard, type CardInput, type ImportResponse } from "../../../_contract.js";
import { admit, body, segment } from "../../../_http.js";
import { library, load, progress, update } from "../../../_store.js";

const BATCH_LIMIT = 2000;
const contentOf = (card: CardInput) => JSON.stringify(card);

// GET: the deck's cards, so a source can see what exists.
// POST { cards }: a new source is created, a known one has its content replaced and keeps its progress.
// DELETE { sources }: removes those cards and their progress.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!admit(request, response, ["GET", "POST", "DELETE"])) return;
  const deck = segment(request, "deck");
  if (!DECK_ID.test(deck)) return response.status(400).json({ error: "a deck id is lowercase letters, digits and dashes" });

  if (request.method === "GET") {
    const { data } = await load(library);
    if (!data.decks[deck]) return response.status(404).json({ error: `no deck ${deck}` });
    return response.json({ cards: Object.values(data.cards).filter(card => card.deck === deck) });
  }

  if (request.method === "DELETE") {
    const { sources } = body(request);
    if (!Array.isArray(sources) || !sources.every(source => typeof source === "string")) return response.status(400).json({ error: "expected sources as a list" });
    const ids = (sources as string[]).map(source => cardId(deck, source));
    const removed = await update(library, data => ids.filter(id => { const found = data.cards[id]?.deck === deck; delete data.cards[id]; return found; }));
    await update(progress, data => { for (const id of ids) delete data.cards[id]; });
    return response.json({ removed: removed.map(id => id.slice(deck.length + 1)) });
  }

  const { cards } = body(request);
  if (!Array.isArray(cards)) return response.status(400).json({ error: "expected cards as a list" });
  if (cards.length > BATCH_LIMIT) return response.status(400).json({ error: `at most ${BATCH_LIMIT} cards at a time` });
  const result: ImportResponse = { created: [], updated: [], unchanged: [], rejected: [] };
  const valid: CardInput[] = [], seen = new Set<string>();
  for (const raw of cards) {
    const checked = validateCard(raw);
    if ("error" in checked) { result.rejected.push(checked); continue; }
    if (seen.has(checked.card.source)) { result.rejected.push({ source: checked.card.source, error: "source appears twice in this batch" }); continue; }
    seen.add(checked.card.source);
    valid.push(checked.card);
  }
  const outcome = await update(library, data => {
    if (!data.decks[deck]) return null;
    const sorted: Omit<ImportResponse, "rejected"> = { created: [], updated: [], unchanged: [] };
    const now = Date.now();
    for (const card of valid) {
      const id = cardId(deck, card.source), existing = data.cards[id];
      if (existing) {
        const { id: _id, deck: _deck, added, ...content } = existing;
        if (contentOf(content) === contentOf(card)) { sorted.unchanged.push(card.source); continue; }
        data.cards[id] = { ...card, id, deck, added };
        sorted.updated.push(card.source);
      } else {
        data.cards[id] = { ...card, id, deck, added: now };
        sorted.created.push(card.source);
      }
    }
    return sorted;
  });
  if (!outcome) return response.status(404).json({ error: `no deck ${deck}; create it with PUT /api/decks/${deck} first` });
  response.json({ ...outcome, rejected: result.rejected });
}
