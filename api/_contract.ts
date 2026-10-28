// What Kotoba stores and what a source sends it. SPEC.md describes the contract; this is the one place it is enforced.

// Parts of speech for a word, plus Kotoba's own kinds: form (a conjugation drill) and kana.
export const KINDS = ["noun", "pronoun", "name", "verb", "i-adjective", "na-adjective", "pre-noun", "adverb", "conjunction", "interjection",
  "particle", "auxiliary", "prefix", "suffix", "expression", "form", "kana"] as const;
export type Kind = (typeof KINDS)[number];
export type Side = "recognition" | "production";
export type Introduce = "random" | "in order";

// What a source sends. `source` is the source's own stable ID for the card, unique within the deck, derived from
// facts about what the card is (SPEC.md, Identity). `meanings` are the senses the learner has met, one per entry.
// `surface` is where the word sits in `line`: [start, length], as JavaScript indexes strings.
export interface CardInput {
  source: string;
  kind: Kind;
  kana: string;
  meanings: string[];
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
  surface?: [number, number];
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

const TEXT_FIELDS = ["kanji", "romaji", "loose", "note", "base", "form", "register", "verbClass", "line", "lineEn", "speaker", "example", "exampleEn", "exampleLoose"] as const;
const ALLOWED = new Set<string>(["source", "kind", "kana", "meanings", ...TEXT_FIELDS, "surface", "order", "recognitionOnly"]);
const MEANINGS_LIMIT = 20;
const TEXT_LIMIT = 2000;
const SOURCE_LIMIT = 200;

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
  if (typeof input.kana !== "string" || !input.kana.trim()) return fail("kana is required");
  if (input.kana.length > TEXT_LIMIT) return fail(`kana is longer than ${TEXT_LIMIT} characters`);
  const meanings = input.meanings;
  if (!Array.isArray(meanings) || !meanings.length) return fail("meanings is required: a list of at least one meaning");
  if (meanings.length > MEANINGS_LIMIT) return fail(`at most ${MEANINGS_LIMIT} meanings`);
  if (meanings.some(meaning => typeof meaning !== "string" || !meaning.trim())) return fail("every meaning must be text");
  if (meanings.some(meaning => (meaning as string).length > TEXT_LIMIT)) return fail(`a meaning is longer than ${TEXT_LIMIT} characters`);
  if (new Set(meanings.map(meaning => (meaning as string).trim())).size !== meanings.length) return fail("meanings has the same meaning twice");
  const card: CardInput = { source, kind: input.kind as Kind, kana: input.kana.trim(), meanings: meanings.map(meaning => (meaning as string).trim()) };
  for (const field of TEXT_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") return fail(`${field} must be text`);
    if (value.length > TEXT_LIMIT) return fail(`${field} is longer than ${TEXT_LIMIT} characters`);
    if (value.trim()) card[field] = value.trim();
  }
  if (input.order !== undefined) {
    if (typeof input.order !== "number" || !Number.isFinite(input.order)) return fail("order must be a number");
    card.order = input.order;
  }
  if (input.recognitionOnly !== undefined) {
    if (typeof input.recognitionOnly !== "boolean") return fail("recognitionOnly must be true or false");
    if (input.recognitionOnly) card.recognitionOnly = true;
  }
  if (input.surface !== undefined) {
    const range = input.surface;
    if (!card.line) return fail("surface needs a line to be in");
    // only that it's a range inside the line: whether it's the right word, only the source can know
    if (!Array.isArray(range) || range.length !== 2 || !range.every(n => Number.isInteger(n))) return fail("surface must be [start, length], two whole numbers");
    const [start, length] = range as [number, number];
    if (start < 0 || length < 1 || start + length > card.line.length) return fail(`surface [${start}, ${length}] isn't inside line`);
    card.surface = [start, length];
  }
  if (card.lineEn && !card.line) return fail("lineEn needs a line");
  if ((card.exampleEn || card.exampleLoose) && !card.example) return fail("exampleEn needs an example");
  return { card };
}

// A card stored before Oct 28 had one `meaning` and a `surface` that was the text itself; it reads as the current
// shape: `meanings: [meaning]`, and the surface as a range where it occurs exactly once (otherwise it's dropped).
export function upgradeStored(card: Card): Card {
  const old = card as Omit<Card, "surface"> & { meaning?: string; surface?: unknown };
  if (old.meanings === undefined && typeof old.meaning === "string") { old.meanings = [old.meaning]; delete old.meaning; }
  if (typeof old.surface === "string") {
    const text = old.surface, at = old.line?.indexOf(text) ?? -1;
    if (at >= 0 && old.line!.indexOf(text, at + 1) < 0) old.surface = [at, text.length]; else delete old.surface;
  }
  return old as Card;
}
