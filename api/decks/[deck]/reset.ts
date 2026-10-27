import type { VercelRequest, VercelResponse } from "@vercel/node";
import { DECK_ID } from "../../_contract.js";
import { admit, segment } from "../../_http.js";
import { library, load, progress, update } from "../../_store.js";

// Wipes the progress of every card in the deck; the cards stay, and come back as new.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!admit(request, response, ["POST"])) return;
  const id = segment(request, "deck");
  if (!DECK_ID.test(id)) return response.status(400).json({ error: "a deck id is lowercase letters, digits and dashes" });
  const { data } = await load(library);
  if (!data.decks[id]) return response.status(404).json({ error: `no deck ${id}` });
  const cards = Object.values(data.cards).filter(card => card.deck === id).map(card => card.id);
  // by prefix as well, so progress of cards removed earlier doesn't linger either
  await update(progress, schedules => { for (const card of Object.keys(schedules.cards)) if (card.startsWith(`${id}/`)) delete schedules.cards[card]; });
  response.json({ reset: id, cards: cards.length });
}
