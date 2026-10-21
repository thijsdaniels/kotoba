import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorized } from "./_auth.js";
import { update, type Side } from "./_store.js";

// Body: { id, side, schedule } — the new FSRS state of one side of one card.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!authorized(request, response)) return;
  if (request.method !== "POST") return response.status(405).end();
  const { id, side, schedule } = request.body ?? {};
  if (typeof id !== "string" || (side !== "r" && side !== "p") || typeof schedule !== "object") return response.status(400).json({ error: "expected id, side and schedule" });
  const state = await update(current => {
    current.srs[id] = { ...(current.srs[id] ?? {}), [side as Side]: schedule };
  });
  response.json({ version: state.version });
}
