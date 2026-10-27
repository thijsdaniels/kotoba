import type { VercelRequest, VercelResponse } from "@vercel/node";
import { DECK_ID, type Deck, type Introduce } from "../../_contract.js";
import { admit, body, segment } from "../../_http.js";
import { library, progress, update } from "../../_store.js";

const TITLE_LIMIT = 80;
const DESCRIPTION_LIMIT = 300;

// PUT creates the deck or changes it: any of title, description, enabled, production, introduce; title is needed to create.
// DELETE removes the deck, its cards and their progress.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!admit(request, response, ["PUT", "DELETE"])) return;
  const id = segment(request, "deck");
  if (!DECK_ID.test(id)) return response.status(400).json({ error: "a deck id is lowercase letters, digits and dashes" });

  if (request.method === "DELETE") {
    const removed = await update(library, data => {
      const cards = Object.values(data.cards).filter(card => card.deck === id).map(card => card.id);
      for (const card of cards) delete data.cards[card];
      const existed = id in data.decks;
      delete data.decks[id];
      return existed ? cards : null;
    });
    if (!removed) return response.status(404).json({ error: `no deck ${id}` });
    await update(progress, data => { for (const card of removed) delete data.cards[card]; });
    return response.json({ deleted: id, cards: removed.length });
  }

  const patch = body(request);
  const problems: string[] = [];
  const text = (field: string, limit: number) => {
    const value = patch[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim()) { problems.push(`${field} must be text`); return undefined; }
    return value.trim().slice(0, limit);
  };
  const flag = (field: string) => {
    const value = patch[field];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") { problems.push(`${field} must be true or false`); return undefined; }
    return value;
  };
  const title = text("title", TITLE_LIMIT), description = text("description", DESCRIPTION_LIMIT);
  const enabled = flag("enabled"), production = flag("production");
  let introduce: Introduce | undefined;
  if (patch.introduce !== undefined) {
    if (patch.introduce === "random" || patch.introduce === "in order") introduce = patch.introduce;
    else problems.push(`introduce must be "random" or "in order"`);
  }
  if (problems.length) return response.status(400).json({ error: problems.join("; ") });

  const deck = await update(library, data => {
    const existing = data.decks[id];
    if (!existing && !title) return null;
    const next: Deck = existing ? { ...existing } : { id, title: title!, enabled: true, production: false, introduce: "random", created: Date.now() };
    if (title !== undefined) next.title = title;
    if (description !== undefined) next.description = description;
    if (enabled !== undefined) next.enabled = enabled;
    if (production !== undefined) next.production = production;
    if (introduce !== undefined) next.introduce = introduce;
    data.decks[id] = next;
    return next;
  });
  if (!deck) return response.status(400).json({ error: "title is required to create a deck" });
  response.json(deck);
}
