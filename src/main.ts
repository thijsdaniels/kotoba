import "./style.css";
import type { Card, CardInput, CardProgress, Deck, Kind, Settings, Side } from "../api/_contract";
import { api, readKey, writeKey } from "./api";
import { currentRecall, dayOf, formatInterval, schedule, type Grade, type Schedule } from "./srs";

/* Kotoba knows decks and cards, nothing about where they came from. Every card belongs to one deck;
   the deck says whether it is in play, whether its cards are also asked in production, and how new cards come in. */

interface QueueEntry { id: string; side: Side }
interface StarterDeck { deck: Pick<Deck, "id" | "title" | "description" | "introduce" | "production">; cards: CardInput[] }

const KIND_LABELS: Record<Kind, string> = {
  noun: "Noun", pronoun: "Pronoun", name: "Name", verb: "Verb", "i-adjective": "い-adjective", "na-adjective": "な-adjective", "pre-noun": "Pre-noun",
  adverb: "Adverb", conjunction: "Conjunction", interjection: "Interjection", particle: "Particle", auxiliary: "Auxiliary", prefix: "Prefix",
  suffix: "Suffix", expression: "Expression", pattern: "Pattern", kana: "Kana",
};
const kindLabel = (card: Card) => card.kinds.map(kind => KIND_LABELS[kind] ?? kind).join(" · ");
const isKind = (card: Card, kind: Kind) => card.kinds.includes(kind);
const STARTERS = [{ id: "kana", file: "/starters/kana.json", title: "Kana", description: "Hiragana and katakana, in gojūon order." }];
const PRACTICE_BUTTONS: [string, string, Grade][] = [["Again", "again", 0], ["Good", "good", 2]];
const REVIEW_BUTTONS: [string, string, Grade][] = [["Again", "again", 0], ["Hard", "hard", 1], ["Good", "good", 2], ["Easy", "easy", 3]];

const byId = (id: string) => document.getElementById(id)!;
const escapeHtml = (text: unknown) => String(text ?? "").replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]!));

/* state */
let decks = new Map<string, Deck>();
let cards = new Map<string, Card>();
let progress: Record<string, CardProgress> = {};
let settings: Settings = { newPerDay: 20 };
let loaded = false;
let queue: QueueEntry[] = [];
let current: QueueEntry | null = null;
let revealed = false, drawn = false, busy = false, justDrawn = false, flipped = false;
let openId: string | null = null;
let view: "review" | "practice" | "cards" | "settings" = "review";
// practice filters: the chosen decks and kinds; an empty set means all of them
let chosenDecks = new Set<string>();
let chosenKinds = new Set<string>();
let openFilter: "deck" | "kind" | null = null;
let openDecks = new Set<string>(); // decks unfolded in the card list; everything starts folded
try {
  openDecks = new Set(JSON.parse(localStorage.getItem("kotoba-open-decks") ?? "[]") as string[]);
  chosenDecks = new Set(JSON.parse(localStorage.getItem("kotoba-decks") ?? "[]") as string[]);
  chosenKinds = new Set(JSON.parse(localStorage.getItem("kotoba-kinds") ?? "[]") as string[]);
} catch { /* private mode */ }
let pendingWrite: Promise<unknown> = Promise.resolve();

/* decks and sides */
const deckOf = (card: Card) => decks.get(card.deck);
const inPlay = (card: Card) => deckOf(card)?.enabled === true;
const kindColor = (card: Card) => `--kc: var(--k-${card.kinds[0]})`;
const deckTitle = (card: Card) => deckOf(card)?.title ?? card.deck;
// implied words that Japanese leaves out are stored as "(I)" and shown lighter, without brackets
const implied = (text: unknown) => escapeHtml(text).replace(/\(([^()]*)\)/g, '<span class="imp">$1</span>');
// highlight the word inside a line, at the range the source gave ([start, length]; the server checked it's inside)
function mark(line: string | undefined, surface: [number, number] | undefined): string {
  if (!line || !surface) return escapeHtml(line);
  const [at, length] = surface;
  return escapeHtml(line.slice(0, at)) + "<mark>" + escapeHtml(line.slice(at, at + length)) + "</mark>" + escapeHtml(line.slice(at + length));
}

const practicing = () => view === "practice";
const inPractice = (card: Card) => inPlay(card) && (!chosenKinds.size || card.kinds.some(kind => chosenKinds.has(kind))) && (!chosenDecks.size || chosenDecks.has(card.deck));
// every card is asked for recognition; production only when its deck asks for it, and never for kana
const sidesOf = (card: Card): Side[] => (isKind(card, "kana") || card.recognitionOnly || !deckOf(card)?.production ? ["recognition"] : ["recognition", "production"]);
const scheduleOf = (card: Card, side: Side): Schedule | null => progress[card.id]?.[side] ?? null;
// every side is its own card for the scheduler; this lists them all
const allEntries = () => { const out: { id: string; side: Side; card: Card }[] = []; for (const [id, card] of cards) for (const side of sidesOf(card)) out.push({ id, side, card }); return out; };
const shuffle = <T,>(items: T[]) => { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; };

/* the review queue: everything due, plus today's ration of new cards from every enabled deck */
function newCardsToday(): QueueEntry[] {
  const today = dayOf(), now = Date.now();
  const picks: QueueEntry[] = [], inQueue = new Set<string>();
  let introduced = 0;
  const unseen: { id: string; side: Side; card: Card }[] = [];
  for (const entry of allEntries()) {
    const existing = scheduleOf(entry.card, entry.side);
    if (existing) { if (existing.first === today) { introduced++; inQueue.add(entry.id); } if (existing.due <= now) inQueue.add(entry.id); continue; }
    if (inPlay(entry.card)) unseen.push(entry);
  }
  const ration = Math.max(0, settings.newPerDay - introduced);
  // A deck that introduces in order hands out its next card whenever one of its slots comes up, so the decks still mix at random.
  const ordered = new Map<string, typeof unseen>();
  for (const entry of unseen) if (deckOf(entry.card)?.introduce === "in order") ordered.set(entry.card.deck, [...(ordered.get(entry.card.deck) ?? []), entry]);
  for (const list of ordered.values()) list.sort((a, b) => (a.card.order ?? Infinity) - (b.card.order ?? Infinity) || a.card.added - b.card.added);
  for (const slot of shuffle([...unseen])) {
    if (picks.length >= ration) break;
    const candidate = ordered.has(slot.card.deck) ? ordered.get(slot.card.deck)!.shift() : slot;
    if (!candidate || inQueue.has(candidate.id)) continue;
    // recognition before production, and never both sides of one card on the same day
    if (candidate.side === "production" && !scheduleOf(candidate.card, "recognition")) continue;
    picks.push({ id: candidate.id, side: candidate.side }); inQueue.add(candidate.id);
  }
  return picks;
}
function counts() {
  const now = Date.now();
  let due = 0, total = 0;
  for (const { card, side } of allEntries()) {
    if (practicing() ? !inPractice(card) : !inPlay(card)) continue;
    total++;
    const existing = scheduleOf(card, side);
    if (existing && existing.due <= now) due++;
  }
  return { due, fresh: newCardsToday().length, total };
}
function buildQueue() {
  const now = Date.now();
  current = null; revealed = false; drawn = false;
  if (practicing()) {
    // weighted random: the shakier the card, the earlier it tends to come up; unseen cards are the shakiest
    const pool = allEntries().filter(({ card }) => inPractice(card))
      .map(({ id, side, card }) => ({ id, side, key: -Math.log(Math.random()) / (0.05 + 1 - currentRecall(scheduleOf(card, side), now)) }));
    queue = pool.sort((a, b) => a.key - b.key).map(({ id, side }) => ({ id, side }));
    return;
  }
  const due: QueueEntry[] = [];
  for (const { id, side, card } of allEntries()) { const existing = scheduleOf(card, side); if (inPlay(card) && existing && existing.due <= now) due.push({ id, side }); }
  queue = shuffle([...due, ...newCardsToday()]);
}
function say(text: string) { byId("message").textContent = text; }
function enqueueWrite(work: () => Promise<unknown>) {
  pendingWrite = pendingWrite.then(work).catch(error => say(`Couldn't save, ${error?.message ?? "error"}. Reload the page to try again.`));
  return pendingWrite;
}
function deckElement() { return byId(practicing() ? "deck-practice" : "deck-review"); }
function draw() { current = queue.shift() ?? null; revealed = false; drawn = true; justDrawn = true; render(); }
function answer(grade: Grade) {
  if (!current || busy) return;
  const card = cards.get(current.id);
  if (!card) { draw(); return; }
  if (practicing()) {
    if (grade === 0) queue.splice(Math.min(queue.length, 3), 0, { ...current });
  } else {
    const next = schedule(scheduleOf(card, current.side), grade);
    progress[card.id] = { ...(progress[card.id] ?? {}), [current.side]: next };
    const { id, side } = current;
    enqueueWrite(() => api.review(id, side, next));
    if (next.ivl === 0) queue.splice(Math.min(queue.length, 3), 0, { ...current });
  }
  const element = deckElement().querySelector(".card");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (element && !reduceMotion) { busy = true; element.classList.add("out"); setTimeout(() => { busy = false; draw(); }, 200); }
  else draw();
}
function reveal() {
  const element = deckElement().querySelector(".card");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (element && !reduceMotion) { busy = true; element.classList.add("flip-out"); setTimeout(() => { busy = false; revealed = true; flipped = true; render(); }, 80); }
  else { revealed = true; render(); }
}
// Removes a card for good: out of the deck, its progress gone. Any queue it is in skips it from here on.
function removeCard(card: Card) {
  if (!confirm(`Remove ${card.kana} from ${deckTitle(card)}? Its progress goes with it.`)) return;
  cards.delete(card.id);
  delete progress[card.id];
  queue = queue.filter(entry => entry.id !== card.id);
  if (current?.id === card.id) { current = null; drawn = false; }
  if (openId === card.id) openId = null;
  enqueueWrite(() => api.removeCards(card.deck, [card.source]));
  if (view === "review" || view === "practice") { if (queue.length) draw(); else render(); } else render();
}

/* card faces */
function questionLabel(card: Card, recognition: boolean) {
  if (recognition) return isKind(card, "kana") ? "Read it" : isKind(card, "pattern") ? "What does it do?" : "What does it mean?";
  return "Say it in Japanese";
}
function frontHtml(card: Card, recognition: boolean) {
  if (isKind(card, "kana")) return `<div class="kglyph">${escapeHtml(card.kana)}</div>`;
  if (recognition) return `<div class="big">${escapeHtml(card.kana)}</div>`;
  return `<div class="mid">${implied(card.meanings.map(meaning => meaning.split(" · ")[0]).join("; "))}</div>`; // the primary glosses are the cue; the nuance waits for the answer
}
// an everyday example is our own text: highlight the dictionary form when it appears as written, otherwise nothing
const exampleSurface = (card: Card): [number, number] | undefined => { const core = card.kana.replace(/[〜～]/g, "").split("／")[0].trim(); const at = card.example?.indexOf(core) ?? -1; return core && at >= 0 ? [at, core.length] : undefined; };
const exampleHtml = (card: Card, cls: string) => `<div class="${cls}">${cls === "ex" ? `<span class="jp">${mark(card.example, exampleSurface(card))}</span>` : mark(card.example, exampleSurface(card))}<span class="en">${implied(card.exampleEn ?? "")}</span>${card.exampleLoose ? `<span class="en"><i>${implied(card.exampleLoose)}</i></span>` : ""}</div>`;
const lineHtml = (card: Card, cls: string) => `<div class="${cls}">${card.speaker ? `<span class="who">${escapeHtml(card.speaker)}</span>` : ""}${mark(card.line, card.surface)}${card.lineEn ? `<span class="en">${implied(card.lineEn)}</span>` : ""}</div>`;
function quoteHtml(card: Card) {
  if (card.line) return lineHtml(card, "tcard-art");
  if (card.example) return exampleHtml(card, "tcard-art");
  return "";
}
function meaningHtml(card: Card) {
  let html = implied(card.meanings.join("; "));
  if (card.loose) html += `<span class="loose">${implied(card.loose)}</span>`;
  return html;
}
function answerHtml(card: Card) {
  const title = isKind(card, "kana")
    ? `<span class="kglyph">${escapeHtml(card.kana)}</span>`
    : `<span class="jp">${escapeHtml(card.kana)}</span>${card.kanji ? `<span class="kanji">${escapeHtml(card.kanji)}</span>` : ""}`;
  let more = "";
  if (card.note) more += `<div class="note">${implied(card.note)}</div>`;
  if (card.line && card.example) more += exampleHtml(card, "ex");
  return `<div class="tcard-head"><span>${escapeHtml(kindLabel(card))}</span><span class="r">${escapeHtml(card.romaji ?? "")}</span></div>
    <div class="tcard-body"><div class="tcard-title">${title}</div><div class="tcard-meaning">${meaningHtml(card)}</div>${quoteHtml(card)}
    <details class="more" style="padding:0"><summary>More</summary><div class="morebox">${more}<button class="del" id="remove-card">Remove Card</button></div></details></div>`;
}
function listDetailHtml(card: Card) {
  let html = `<div class="ans">${meaningHtml(card)}</div>`;
  const sub = [card.kanji ? `<span class="kanji">${escapeHtml(card.kanji)}</span>` : "", card.romaji ? `<span class="romaji">${escapeHtml(card.romaji)}</span>` : ""].join("");
  if (sub) html += `<div class="sub">${sub}</div>`;
  if (card.note) html += `<div class="note">${implied(card.note)}</div>`;
  if (card.example) html += exampleHtml(card, "ex");
  if (card.line) html += lineHtml(card, "dialog");
  return `<div class="back">${html}<button class="del" data-remove="${escapeHtml(card.id)}">Remove Card</button></div>`;
}

/* views */
function renderFilter() {
  const deckChoices: [string, string][] = [...decks.values()].filter(deck => deck.enabled).map(deck => [deck.id, deck.title]);
  for (const id of chosenDecks) if (!deckChoices.some(([choice]) => choice === id)) chosenDecks.delete(id); // a deck switched off drops out of the filter
  // only the kinds there are cards of (and any still chosen), in the order of KINDS
  const present = new Set([...cards.values()].flatMap(card => card.kinds as string[]));
  const kindChoices: [string, string][] = Object.entries(KIND_LABELS).filter(([id]) => present.has(id) || chosenKinds.has(id));
  const summary = (name: string, chosen: Set<string>, choices: [string, string][]) =>
    `${name}: ${chosen.size ? choices.filter(([id]) => chosen.has(id)).map(([, label]) => label).join(", ") : "All"}`;
  byId("filters").innerHTML = `<button data-open="deck">${escapeHtml(summary("Decks", chosenDecks, deckChoices))}</button><button data-open="kind">${escapeHtml(summary("Kinds", chosenKinds, kindChoices))}</button>`;
  if (openFilter) {
    const [title, chosen, choices] = openFilter === "deck" ? ["Decks", chosenDecks, deckChoices] as const : ["Kinds", chosenKinds, kindChoices] as const;
    byId("filter-dialog-title").textContent = title;
    byId("filter-options").dataset.filter = openFilter;
    byId("filter-options").innerHTML = choices.map(([id, label]) => `<label>${openFilter === "kind" ? `<span class="dot" style="--kc: var(--k-${id})"></span>` : ""}<span class="name">${escapeHtml(label)}</span><input type="checkbox" data-choice="${escapeHtml(id)}"${chosen.has(id) ? " checked" : ""}></label>`).join("");
  }
}
function renderDeck() {
  const container = deckElement(), practice = practicing();
  if (practice) renderFilter();
  const shell = (inner: string) => `<div class="stack"><div class="card">${inner}</div></div>`;
  if (!readKey()) { container.innerHTML = shell(`<div class="empty"><span class="big">カギが ない</span><span>This device has no key yet. Enter it under Settings.</span></div>`); return; }
  if (!loaded) { container.innerHTML = shell(`<div class="empty"><span class="big">ロード中…</span><span>Loading your decks</span></div>`); return; }
  if (!cards.size) {
    container.innerHTML = shell(`<div class="empty"><span class="big">なにも ない</span><span>No cards yet. Add a starter deck under Settings, or send cards from a source.</span></div>`);
    return;
  }
  const unders = () => queue.slice(0, 2).map((entry, index) => { const card = cards.get(entry.id); return card ? `<div class="under${index ? " u2" : ""}" style="${kindColor(card)}"></div>` : ""; }).join("");
  if (!drawn) {
    if (!queue.length) {
      if (practice) { container.innerHTML = shell(`<div class="empty"><span class="big">なにも ない</span><span>Nothing to practice with this filter. Pick another, or switch a deck on under Settings.</span></div>`); return; }
      const seen = allEntries().filter(({ card, side }) => inPlay(card) && scheduleOf(card, side));
      const nextDue = Math.min(...seen.map(({ card, side }) => scheduleOf(card, side)!.due));
      container.innerHTML = shell(`<div class="empty"><span class="big">おつかれさま！</span><span>Done for today.${isFinite(nextDue) ? " Next card in " + formatInterval(Math.max(60000, nextDue - Date.now())) + "." : ""}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px"><button class="primary ghost" id="go-practice" style="width:auto;padding:10px 18px;margin:0">Practice Instead</button></div></div>`);
      byId("go-practice").onclick = () => showTab("practice");
      return;
    }
    draw(); return;
  }
  if (!current) { drawn = false; buildQueue(); renderDeck(); return; }
  const card = cards.get(current.id);
  if (!card) { draw(); return; }
  const recognition = current.side === "recognition", existing = scheduleOf(card, current.side);
  const buttons = practice ? PRACTICE_BUTTONS : REVIEW_BUTTONS;
  const body = revealed
    ? answerHtml(card) + `<div class="actions${practice ? " two" : ""}">${buttons.map(([label, cls, grade]) => `<button class="g-${cls}" data-grade="${grade}">${label}</button>`).join("")}</div>`
    : `<div class="dir"><span class="tag">${escapeHtml(kindLabel(card))}</span><span>${practice ? "practice" : existing ? "review" : "new"} · ${queue.length} left</span></div><div class="front">${frontHtml(card, recognition)}<div class="hint">${questionLabel(card, recognition)}</div></div><button class="show" id="show">Show Answer</button>`;
  container.innerHTML = `<div class="stack">${unders()}<div class="card ${revealed ? "a" : "q"}${justDrawn ? " drawn" : ""}${flipped ? " flip-in" : ""}" style="${kindColor(card)}">${body}</div></div>`;
  justDrawn = false; flipped = false;
  if (revealed) {
    container.querySelectorAll<HTMLButtonElement>("[data-grade]").forEach(button => button.onclick = () => answer(Number(button.dataset.grade) as Grade));
    byId("remove-card").onclick = () => removeCard(card);
  } else byId("show").onclick = reveal;
}
function status(card: Card): [string, string] {
  const now = Date.now(), schedules = sidesOf(card).map(side => scheduleOf(card, side));
  if (!inPlay(card)) return ["off", "off"];
  if (!schedules[0]) return ["new", "new"];
  const due = Math.min(...schedules.filter(Boolean).map(entry => entry!.due));
  if (due <= now) return ["due", "due"];
  return ["", "in " + formatInterval(due - now)];
}
function renderCards() {
  const query = (byId("search") as HTMLInputElement).value.trim().toLowerCase();
  const deckOrder = new Map([...decks.values()].sort((a, b) => a.created - b.created).map((deck, index) => [deck.id, index]));
  const items = [...cards.values()]
    .filter(card => !query || [card.kana, card.kanji, card.romaji, card.meanings.join("; "), card.speaker, deckTitle(card), kindLabel(card)].some(field => String(field ?? "").toLowerCase().includes(query)))
    .sort((a, b) => (deckOrder.get(a.deck) ?? 99) - (deckOrder.get(b.deck) ?? 99) || (a.order ?? Infinity) - (b.order ?? Infinity) || a.kinds[0].localeCompare(b.kinds[0]) || a.kana.localeCompare(b.kana, "ja"));
  const list = byId("list");
  if (!items.length) { list.innerHTML = `<div class="empty">${cards.size ? "No matches." : "No cards yet."}</div>`; return; }
  const countBy = new Map<string, number>();
  for (const card of items) countBy.set(card.deck, (countBy.get(card.deck) ?? 0) + 1);
  list.innerHTML = items.map((card, index) => {
    const folded = !openDecks.has(card.deck) && !query;
    const heading = index === 0 || items[index - 1].deck !== card.deck
      ? `<button class="group" data-deck="${escapeHtml(card.deck)}" aria-expanded="${!folded}"><span>${escapeHtml(deckTitle(card))}</span><span>${countBy.get(card.deck)} cards${inPlay(card) ? "" : " · off"}</span></button>` : "";
    if (folded) return heading;
    const [cls, label] = status(card), open = openId === card.id;
    const tag = `<span class="tag">${escapeHtml(kindLabel(card))}</span>`;
    const meaning = implied(card.meanings.join("; "));
    return heading + `<div class="item" style="${kindColor(card)}"><button data-id="${escapeHtml(card.id)}" aria-expanded="${open}"><span class="k">${escapeHtml(card.kana)}${card.kanji ? `<small>${escapeHtml(card.kanji)}</small>` : ""}${tag}</span><span class="chip ${cls}">${label}</span><span class="m">${meaning}</span></button>
      ${open ? `<div class="detail">${listDetailHtml(card)}</div>` : ""}</div>`;
  }).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(button => button.onclick = () => { openId = openId === button.dataset.id ? null : button.dataset.id!; renderCards(); });
  list.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach(button => button.onclick = () => { const card = cards.get(button.dataset.remove!); if (card) removeCard(card); });
  list.querySelectorAll<HTMLButtonElement>("[data-deck]").forEach(button => button.onclick = () => {
    const deck = button.dataset.deck!;
    if (openDecks.has(deck)) openDecks.delete(deck); else openDecks.add(deck);
    try { localStorage.setItem("kotoba-open-decks", JSON.stringify([...openDecks])); } catch { /* private mode */ }
    renderCards();
  });
}
// one block per deck: on or off, production, and the operations on the deck as a whole
function deckSettingsHtml(deck: Deck) {
  let total = 0, fresh = 0, producible = 0;
  for (const card of cards.values()) {
    if (card.deck !== deck.id) continue;
    total++;
    if (!scheduleOf(card, "recognition")) fresh++;
    if (!isKind(card, "kana") && !card.recognitionOnly) producible++;
  }
  const fields = !deck.enabled ? "" : `
    ${producible ? `<div class="field"><label class="toggle"><span><span class="label">Say It in Japanese</span><span class="help">Also ask these cards from the English, as a second card that starts a day after the first.</span></span><input type="checkbox" data-deck="${escapeHtml(deck.id)}" data-production${deck.production ? " checked" : ""}></label></div>` : ""}`;
  return `<div class="setting deck">
    <label class="toggle"><span><span class="label">${escapeHtml(deck.title)}</span><span class="help">${deck.description ? escapeHtml(deck.description) + " " : ""}${total} ${total === 1 ? "card" : "cards"}, ${fresh} not seen yet.</span></span><input type="checkbox" data-deck="${escapeHtml(deck.id)}" data-enabled${deck.enabled ? " checked" : ""}></label>
    ${fields}
    <div class="deck-actions"><button class="del" data-deck="${escapeHtml(deck.id)}" data-reset>Reset Progress</button><button class="del" data-deck="${escapeHtml(deck.id)}" data-delete>Delete Deck</button></div>
  </div>`;
}
function renderSettings() {
  const newInput = byId("setting-new") as HTMLInputElement;
  if (document.activeElement !== newInput) newInput.value = String(settings.newPerDay);
  const keyInput = byId("setting-key") as HTMLInputElement;
  if (document.activeElement !== keyInput) keyInput.value = readKey();
  const sorted = [...decks.values()].sort((a, b) => a.created - b.created);
  byId("setting-decks").innerHTML = sorted.length ? sorted.map(deckSettingsHtml).join("") : `<div class="setting"><span class="label">Decks</span><span class="help">No decks yet.</span></div>`;
  const starters = loaded ? STARTERS.filter(starter => !decks.has(starter.id)) : [];
  byId("setting-starters").innerHTML = !starters.length ? "" : `<div class="setting"><span class="label">Starter Decks</span>
    ${starters.map(starter => `<div class="starter"><span><span class="name">${escapeHtml(starter.title)}</span><span class="help">${escapeHtml(starter.description)}</span></span><button class="primary ghost" data-starter="${escapeHtml(starter.file)}">Add</button></div>`).join("")}</div>`;
}
function render() {
  const { due, fresh, total } = counts();
  byId("stat-due").textContent = String(due); byId("stat-new").textContent = String(fresh); byId("stat-total").textContent = String(total);
  if (view === "review" || view === "practice") renderDeck();
  if (view === "cards") renderCards();
  if (view === "settings") renderSettings();
}
function showTab(which: typeof view) {
  const changed = which !== view;
  view = which;
  for (const name of ["review", "practice", "cards", "settings"] as const) { byId("tab-" + name).setAttribute("aria-selected", String(name === which)); (byId("view-" + name) as HTMLElement).hidden = name !== which; }
  if (changed && (which === "review" || which === "practice")) buildQueue();
  render();
}
function changeDeck(id: string, patch: Partial<Pick<Deck, "enabled" | "production">>) {
  const deck = decks.get(id);
  if (!deck) return;
  decks.set(id, { ...deck, ...patch });
  enqueueWrite(() => api.putDeck(id, patch));
  buildQueue(); render();
}
// Adds a starter deck through the same calls any source uses, then reloads everything from the server.
async function addStarter(file: string) {
  say("Adding the deck…");
  try {
    const starter = await fetch(file).then(response => response.json() as Promise<StarterDeck>);
    const { id, ...deck } = starter.deck;
    await api.putDeck(id, deck);
    const result = await api.addCards(id, starter.cards);
    if (result.rejected.length) throw new Error(`${result.rejected.length} cards were rejected, the first because ${result.rejected[0].error}`);
    await reload();
    say("");
  } catch (error) {
    say(`Couldn't add the deck, ${(error as Error).message}.`);
  }
}

for (const name of ["review", "practice", "cards", "settings"] as const) byId("tab-" + name).onclick = () => showTab(name);
byId("filters").onclick = event => {
  const head = (event.target as HTMLElement).closest<HTMLElement>("[data-open]");
  if (!head) return;
  openFilter = head.dataset.open as "deck" | "kind"; renderFilter();
  (byId("filter-dialog") as HTMLDialogElement).showModal();
};
const filterDialog = byId("filter-dialog") as HTMLDialogElement;
filterDialog.onclose = () => { openFilter = null; renderFilter(); };
filterDialog.onclick = event => { if (event.target === filterDialog) filterDialog.close(); }; // a tap on the backdrop closes it
byId("filter-done").onclick = () => filterDialog.close();
byId("filter-options").onchange = event => {
  const box = event.target as HTMLInputElement;
  if (!box.dataset.choice) return;
  const which = box.closest<HTMLElement>("[data-filter]")!.dataset.filter, chosen = which === "deck" ? chosenDecks : chosenKinds;
  if (box.checked) chosen.add(box.dataset.choice); else chosen.delete(box.dataset.choice);
  try { localStorage.setItem(which === "deck" ? "kotoba-decks" : "kotoba-kinds", JSON.stringify([...chosen])); } catch { /* private mode */ }
  buildQueue(); render();
};
byId("search").oninput = renderCards;
(byId("setting-new") as HTMLInputElement).onchange = event => {
  const input = event.target as HTMLInputElement;
  const value = Math.max(0, Math.min(100, Math.round(Number(input.value) || 0)));
  input.value = String(value); settings = { ...settings, newPerDay: value };
  enqueueWrite(() => api.settings({ newPerDay: value })); buildQueue(); render();
};
byId("setting-decks").onchange = event => {
  const input = event.target as HTMLInputElement;
  const id = input.dataset.deck;
  if (!id) return;
  if ("enabled" in input.dataset) changeDeck(id, { enabled: input.checked });
  if ("production" in input.dataset) changeDeck(id, { production: input.checked });
};
byId("setting-decks").onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-deck]");
  const deck = button && decks.get(button.dataset.deck!);
  if (!button || !deck) return;
  if ("reset" in button.dataset) {
    if (!confirm(`Reset your progress in ${deck.title}? Every card in it comes back as new.`)) return;
    for (const card of cards.values()) if (card.deck === deck.id) delete progress[card.id];
    enqueueWrite(() => api.resetDeck(deck.id));
  } else if ("delete" in button.dataset) {
    if (!confirm(`Delete ${deck.title}? Its cards and your progress in them are gone for good.`)) return;
    for (const card of [...cards.values()]) if (card.deck === deck.id) { cards.delete(card.id); delete progress[card.id]; }
    decks.delete(deck.id);
    chosenDecks.delete(deck.id);
    enqueueWrite(() => api.deleteDeck(deck.id));
  } else return;
  buildQueue(); render();
};
byId("setting-starters").onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-starter]");
  if (button) { button.disabled = true; void addStarter(button.dataset.starter!); }
};
(byId("setting-key") as HTMLInputElement).onchange = event => { writeKey((event.target as HTMLInputElement).value.trim()); void start(); };

async function reload() {
  const state = await api.state();
  settings = state.settings;
  decks = new Map(state.decks.map(deck => [deck.id, deck]));
  cards = new Map(state.cards.map(card => [card.id, card]));
  progress = state.progress;
  loaded = true;
  buildQueue();
  render();
}
async function start() {
  render();
  if (!readKey()) return;
  try {
    await reload();
    say("");
  } catch (error) {
    say(navigator.onLine === false || (error as Error).message === "Failed to fetch"
      ? "You're offline. Reviewing needs a connection to save your progress."
      : `Couldn't load your decks, ${(error as Error).message}. Check the key under Settings.`);
    render();
  }
}
void start();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* offline shell is optional */ });
