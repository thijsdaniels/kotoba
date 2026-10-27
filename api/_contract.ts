// What Kotoba stores and what a source sends it. SPEC.md describes the contract; this is the one place it is enforced.

export const KINDS = ["word", "expression", "form", "ending", "name", "kana"] as const;
export type Kind = (typeof KINDS)[number];
export type Side = "recognition" | "production";
export type Introduce = "random" | "in order";

// What a source sends. `source` is the source's own stable ID for the card, unique within the deck.
export interface CardInput {
  source: string;
  kind: Kind;
  kana: string;
  meaning: string;
  kanji?: string;
  romaji?: string;
  loose?: string;
  note?: string;
  base?: string;
  form?: string;
  register?: string;
  verbClass?: string;
  line?: string;
  lineEn?: string;
  speaker?: string;
  surface?: string;
  example?: string;
  exampleEn?: string;
  exampleLoose?: string;
  order?: number;
  recognitionOnly?: boolean;
}

// What Kotoba keeps: the input plus where it lives and when it came in.
export interface Card extends CardInput { id: string; deck: string; added: number }

export interface Deck {
  id: string;
  title: string;
  description?: string;
  enabled: boolean;
  production: boolean; // whether its cards also get a meaning → Japanese side
  introduce: Introduce;
  created: number;
}

export interface Settings { newPerDay: number }

export interface Schedule {
  reps: number;
  lapses: number;
  first?: string;
  last?: number;
  S?: number;
  D?: number;
  ivl: number;
  due: number;
}
export type CardProgress = Partial<Record<Side, Schedule>>;

// The two things stored, each in its own series of snapshots so a review never rewrites the cards.
export interface Library { settings: Settings; decks: Record<string, Deck>; cards: Record<string, Card> }
export interface Progress { cards: Record<string, CardProgress> }

// GET /api/state
export interface StateResponse { settings: Settings; decks: Deck[]; cards: Card[]; progress: Record<string, CardProgress> }
// POST /api/decks/:deck/cards
export interface ImportResponse { created: string[]; updated: string[]; unchanged: string[]; rejected: { source: string; error: string }[] }

export const DECK_ID = /^[a-z0-9-]{1,40}$/;
export const cardId = (deck: string, source: string) => `${deck}/${source}`;

const TEXT_FIELDS = ["kanji", "romaji", "loose", "note", "base", "form", "register", "verbClass", "line", "lineEn", "speaker", "surface", "example", "exampleEn", "exampleLoose"] as const;
const ALLOWED = new Set<string>(["source", "kind", "kana", "meaning", ...TEXT_FIELDS, "order", "recognitionOnly"]);
const TEXT_LIMIT = 2000;
const SOURCE_LIMIT = 200;

const occurrences = (text: string, part: string) => text.split(part).length - 1;

// Checks one card against the contract and returns it with its fields in a fixed order, or the reason it doesn't fit.
// Nothing is guessed: an unknown field is an error, so a misspelled one doesn't silently vanish.
export function validateCard(raw: unknown): { card: CardInput } | { error: string; source: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "a card must be an object", source: "" };
  const input = raw as Record<string, unknown>;
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const fail = (error: string) => ({ error, source });
  const unknown = Object.keys(input).filter(key => !ALLOWED.has(key));
  if (unknown.length) return fail(`unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  if (!source) return fail("source is required");
  if (source.length > SOURCE_LIMIT) return fail(`source is longer than ${SOURCE_LIMIT} characters`);
  if (!KINDS.includes(input.kind as Kind)) return fail(`kind must be one of ${KINDS.join(", ")}`);
  for (const field of ["kana", "meaning"] as const) {
    if (typeof input[field] !== "string" || !(input[field] as string).trim()) return fail(`${field} is required`);
  }
  const card: CardInput = { source, kind: input.kind as Kind, kana: (input.kana as string).trim(), meaning: (input.meaning as string).trim() };
  for (const field of ["kana", "meaning", ...TEXT_FIELDS] as const) {
    const value = input[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") return fail(`${field} must be text`);
    if (value.length > TEXT_LIMIT) return fail(`${field} is longer than ${TEXT_LIMIT} characters`);
    if (field !== "kana" && field !== "meaning" && value.trim()) card[field] = value.trim();
  }
  if (input.order !== undefined) {
    if (typeof input.order !== "number" || !Number.isFinite(input.order)) return fail("order must be a number");
    card.order = input.order;
  }
  if (input.recognitionOnly !== undefined) {
    if (typeof input.recognitionOnly !== "boolean") return fail("recognitionOnly must be true or false");
    if (input.recognitionOnly) card.recognitionOnly = true;
  }
  if (card.surface && !card.line) return fail("surface needs a line to be in");
  if (card.surface && card.line && occurrences(card.line, card.surface) !== 1) return fail(`surface "${card.surface}" must occur exactly once in line`);
  if (card.lineEn && !card.line) return fail("lineEn needs a line");
  if ((card.exampleEn || card.exampleLoose) && !card.example) return fail("exampleEn needs an example");
  return { card };
}
