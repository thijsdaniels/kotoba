import type { VercelRequest, VercelResponse } from "@vercel/node";

// Every handler starts here: CORS for sources on other origins (the key is a header and there are no cookies,
// so an open origin gives nothing away), then the method, then the shared key set as KOTOBA_KEY on the project.
// Returns false when the request has been answered already.
export function admit(request: VercelRequest, response: VercelResponse, methods: string[]): boolean {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type, x-kotoba-key");
  response.setHeader("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") { response.status(204).end(); return false; }
  if (!methods.includes(request.method ?? "")) { response.status(405).json({ error: `use ${methods.join(" or ")}` }); return false; }
  const expected = process.env.KOTOBA_KEY;
  if (!expected) { response.status(500).json({ error: "KOTOBA_KEY is not configured" }); return false; }
  if (request.headers["x-kotoba-key"] !== expected) { response.status(401).json({ error: "wrong key" }); return false; }
  return true;
}

// The body as an object, whatever the client sent; a missing or malformed one is an empty object.
export function body(request: VercelRequest): Record<string, unknown> {
  const value = request.body;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// A path segment such as :deck, from the file name's [deck].
export function segment(request: VercelRequest, name: string): string {
  const value = request.query[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
