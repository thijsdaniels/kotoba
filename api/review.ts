import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Schedule, Side } from "./_contract.js";
import { admit, body } from "./_http.js";
import { progress, update } from "./_store.js";

const SIDES: Side[] = ["recognition", "production"];

// Body: { card, side, schedule }, the new FSRS schedule of one side of one card, computed by the app.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!admit(request, response, ["POST"])) return;
  const { card, side, schedule } = body(request);
  if (typeof card !== "string" || !SIDES.includes(side as Side) || !schedule || typeof schedule !== "object") {
    return response.status(400).json({ error: "expected card, side (recognition or production) and schedule" });
  }
  await update(progress, data => {
    data.cards[card] = { ...(data.cards[card] ?? {}), [side as Side]: schedule as Schedule };
  });
  response.json({ ok: true });
}
