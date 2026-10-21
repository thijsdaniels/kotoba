import type { VercelRequest, VercelResponse } from "@vercel/node";

// One shared key, set as KOTOBA_KEY on the project. The page sends it as a header.
export function authorized(request: VercelRequest, response: VercelResponse): boolean {
  const expected = process.env.KOTOBA_KEY;
  const given = request.headers["x-kotoba-key"];
  if (!expected) { response.status(500).json({ error: "KOTOBA_KEY is not configured" }); return false; }
  if (given !== expected) { response.status(401).json({ error: "wrong key" }); return false; }
  return true;
}
