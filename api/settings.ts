import type { VercelRequest, VercelResponse } from "@vercel/node";
import { admit, body } from "./_http.js";
import { library, update } from "./_store.js";

// Body: { newPerDay }
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!admit(request, response, ["POST"])) return;
  const { newPerDay } = body(request);
  if (typeof newPerDay !== "number" || !Number.isFinite(newPerDay)) return response.status(400).json({ error: "expected newPerDay as a number" });
  const settings = await update(library, data => {
    data.settings.newPerDay = Math.max(0, Math.min(100, Math.round(newPerDay)));
    return data.settings;
  });
  response.json({ settings });
}
