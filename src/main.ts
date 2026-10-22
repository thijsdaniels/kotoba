import "./style.css";
import { api, readKey, writeKey, type Settings, type Side, type State } from "./api";
import { currentRecall, dayOf, formatInterval, schedule, type Grade, type Schedule } from "./srs";

type Kind = "word" | "form" | "ending" | "kana" | "pokemon" | "move" | "item";
interface Card {
  id: string; kind: Kind; stage: string; kana: string; meaning: string;
  kanji?: string; romaji?: string; loose?: string; scope?: string; note?: string;
  base?: string; form?: string; register?: string; vclass?: string; recogOnly?: boolean;
  speaker?: string; who?: string; line?: string; lineEn?: string; surface?: string;
  example?: string; exampleEn?: string; exampleLoose?: string; set?: "hira" | "kata"; order?: number;
}
interface Stage { id: string; name: string }
interface QueueEntry { id: string; side: Side }

const KINDS: Record<Kind, string> = { word: "Word", form: "Form", ending: "Ending", kana: "Kana", pokemon: "Pokémon", move: "Move", item: "Jargon" };
const FILTERS: [string, string][] = [["all", "All"], ["word", "Words"], ["grammar", "Grammar"], ["kana", "Kana"], ["pokemon", "Pokémon"], ["move", "Moves"], ["item", "Jargon"]];
const PRACTICE_BUTTONS: [string, string, Grade][] = [["Forgot", "again", 0], ["Got It", "good", 2]];
const REVIEW_BUTTONS: [string, string, Grade][] = [["Forgot", "again", 0], ["Barely", "hard", 1], ["Got It", "good", 2], ["Instant", "easy", 3]];

const byId = (id: string) => document.getElementById(id)!;
const escapeHtmlOnly = (text: unknown) => String(text ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
// {player} and {rival} become the names from the settings; other slots the game fills at runtime are shown as a light label
const SLOT_LABELS: Record<string, string> = { enemy: "enemy", mon: "your Pokémon", name: "name", n: "number", trainer: "trainer", target: "target", user: "user", learnmovemon: "Pokémon", boxmonnicks: "Pokémon", boxnumstring: "number", item: "item", move: "move" };
const fillSlots = (html: string) => html.replace(/\{(\w+)\}/g, (_, slot: string) =>
  slot === "player" ? escapeHtmlOnly(state.settings.playerName || "タイス")
  : slot === "rival" ? escapeHtmlOnly(state.settings.rivalName || "シゲル")
  : `<span class="slot">${escapeHtmlOnly(SLOT_LABELS[slot] ?? slot)}</span>`);
const escapeHtml = (text: unknown) => fillSlots(escapeHtmlOnly(text));
// implied words that Japanese leaves out are stored as "(I)" and shown lighter, without brackets
const implied = (text: unknown) => escapeHtml(text).replace(/\(([^()]*)\)/g, '<span class="imp">$1</span>');
// highlight an exact surface form inside a line; nothing is guessed, the deck build has checked it occurs once
function mark(line: string | undefined, surface: string | undefined): string {
  if (!line || !surface) return escapeHtml(line);
  const at = line.indexOf(surface);
  if (at < 0) return escapeHtml(line);
  return escapeHtml(line.slice(0, at)) + "<mark>" + escapeHtml(surface) + "</mark>" + escapeHtml(line.slice(at + surface.length));
}

/* state */
let cards = new Map<string, Card>();
let stages: Stage[] = [];
let state: State = { version: 0, settings: { newPerDay: 12, stage: "viridian" }, srs: {} };
let loaded = false;
let queue: QueueEntry[] = [];
let current: QueueEntry | null = null;
let revealed = false, drawn = false, busy = false, justDrawn = false, flipped = false;
let openId: string | null = null;
let view: "review" | "practice" | "cards" | "settings" = "review";
let mode = "all";
let kanaFont: "game" | "normal" = "game";
try { mode = localStorage.getItem("kotoba-mode") ?? "all"; kanaFont = (localStorage.getItem("kotoba-kfont") as "game" | "normal") ?? "game"; } catch { /* private mode */ }
let pendingWrite: Promise<unknown> = Promise.resolve();

const practicing = () => view === "practice";
const kindOf = (card: Card): Kind => (KINDS[card.kind] ? card.kind : "word");
const isGrammar = (card: Card) => card.kind === "form" || card.kind === "ending";
const isGame = (card: Card) => card.kind === "pokemon" || card.kind === "move" || card.kind === "item" || card.scope === "game";
const inMode = (card: Card) =>
  mode === "all" ? true
  : mode === "word" ? card.kind === "word" && !isGame(card)
  : mode === "grammar" ? isGrammar(card)
  : mode === "kana" ? card.kind === "kana"
  : mode === "pokemon" ? card.kind === "pokemon"
  : mode === "move" ? card.kind === "move"
  : card.kind === "item" || (card.kind === "word" && card.scope === "game");
// a card with no stage, or one that isn't in the list, stays locked until it's fixed; system cards are always open
const stageIndex = (id: string | undefined) => { const index = stages.findIndex(stage => stage.id === id); return index < 0 ? Infinity : index; };
const stageLabel = (id: string | undefined) => stages.find(stage => stage.id === id)?.name ?? (id === "system" ? "Menus and Messages" : "No stage");
const unlocked = (card: Card) => card.stage === "system" || stageIndex(card.stage) <= stageIndex(state.settings.stage);
const sidesOf = (card: Card): Side[] => (card.kind === "kana" || card.recogOnly ? ["r"] : ["r", "p"]);
const scheduleOf = (card: Card, side: Side): Schedule | null => state.srs[card.id]?.[side] ?? null;
// every side is its own card for the scheduler; this lists them all
const allEntries = () => { const out: { id: string; side: Side; card: Card }[] = []; for (const [id, card] of cards) for (const side of sidesOf(card)) out.push({ id, side, card }); return out; };
const kindColor = (card: Card) => `--kc: var(--k-${kindOf(card)})`;
const shuffle = <T,>(items: T[]) => { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; };

/* the review queue: everything due, plus today's ration of new cards from the unlocked part of the game */
function newCardsToday(): QueueEntry[] {
  const today = dayOf(), now = Date.now();
  const picks: QueueEntry[] = [], inQueue = new Set<string>();
  let introduced = 0;
  const unseen: { lang: { id: string; side: Side; card: Card }[]; kana: { id: string; side: Side; card: Card }[] } = { lang: [], kana: [] };
  for (const entry of allEntries()) {
    const existing = scheduleOf(entry.card, entry.side);
    if (existing) { if (existing.first === today) { introduced++; inQueue.add(entry.id); } if (existing.due <= now) inQueue.add(entry.id); continue; }
    if (!unlocked(entry.card)) continue;
    unseen[entry.card.kind === "kana" ? "kana" : "lang"].push(entry);
  }
  const ration = Math.max(0, state.settings.newPerDay - introduced);
  // kana are introduced in gojūon order, everything else at random; no two sides of one word on the same day, recognition before production
  const kanaInOrder = unseen.kana.sort((a, b) => (a.card.order ?? 0) - (b.card.order ?? 0));
  let nextKana = 0;
  for (const slot of shuffle([...unseen.lang, ...unseen.kana])) {
    if (picks.length >= ration) break;
    const candidate = slot.card.kind === "kana" ? kanaInOrder[nextKana++] : slot;
    if (!candidate || inQueue.has(candidate.id)) continue;
    if (candidate.side === "p" && !scheduleOf(candidate.card, "r")) continue;
    picks.push({ id: candidate.id, side: candidate.side }); inQueue.add(candidate.id);
  }
  return picks;
}
function counts() {
  const now = Date.now();
  let due = 0, total = 0;
  for (const { card, side } of allEntries()) {
    const existing = scheduleOf(card, side);
    if (practicing() && !inMode(card)) continue;
    if (!existing && !unlocked(card)) continue;
    total++;
    if (existing && existing.due <= now) due++;
  }
  return { due, fresh: newCardsToday().length, total };
}
function buildQueue() {
  const now = Date.now();
  current = null; revealed = false; drawn = false;
  if (practicing()) {
    // weighted random: the shakier the card, the earlier it tends to come up; unseen cards are the shakiest
    const pool = allEntries().filter(({ card }) => inMode(card) && unlocked(card))
      .map(({ id, side, card }) => ({ id, side, key: -Math.log(Math.random()) / (0.05 + 1 - currentRecall(scheduleOf(card, side), now)) }));
    queue = pool.sort((a, b) => a.key - b.key).map(({ id, side }) => ({ id, side }));
    return;
  }
  const due: QueueEntry[] = [];
  for (const { id, side, card } of allEntries()) { const existing = scheduleOf(card, side); if (existing && existing.due <= now) due.push({ id, side }); }
  queue = shuffle([...due, ...newCardsToday()]);
}
function enqueueWrite(work: () => Promise<unknown>) {
  pendingWrite = pendingWrite.then(work).catch(error => { byId("message").textContent = `Couldn't save, ${error?.message ?? "error"}. Reload the page to try again.`; });
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
    state.srs[card.id] = { ...(state.srs[card.id] ?? {}), [current.side]: next };
    const { id, side } = current;
    enqueueWrite(() => api.answer(id, side, next));
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

/* card faces */
const formLabel = (card: Card) => [card.base, card.form, card.register, card.vclass].filter(Boolean).join(" · ");
const fontButton = (extra = "") => `<button class="kfont" id="kfont"${extra}>${kanaFont === "game" ? "Game Font" : "Normal Font"}</button>`;
const glyph = (card: Card) => `<span class="kglyph${kanaFont === "normal" ? " normal" : ""}">${escapeHtml(card.kana)}</span>`;
function questionLabel(card: Card, recognition: boolean) {
  if (recognition) return card.kind === "kana" ? "Read it" : card.kind === "pokemon" ? "Which Pokémon?" : card.kind === "move" ? "Which move?" : "What does it mean?";
  return card.kind === "form" ? "Conjugate" : "Say it in Japanese";
}
function frontHtml(card: Card, recognition: boolean) {
  if (card.kind === "kana") return `${fontButton()}<div class="kglyph${kanaFont === "normal" ? " normal" : ""}">${escapeHtml(card.kana)}</div>`;
  if (card.kind === "form" && !recognition) return `<div class="mid">${escapeHtml(card.base)}</div><div class="task">${escapeHtml([card.form, card.register].filter(Boolean).join(", "))}</div>`;
  if (recognition) return `<div class="big">${escapeHtml(card.kana)}</div>`;
  const prompt = isGame(card) && card.kind !== "word" ? String(card.meaning).split(" · ")[0] : card.meaning;
  return `<div class="mid">${implied(prompt)}</div>`;
}
// an everyday example is our own text: highlight the dictionary form when it appears as written, otherwise nothing
const exampleSurface = (card: Card) => { const core = card.kana.replace(/[〜～]/g, "").split("／")[0].trim(); return card.example?.includes(core) ? core : undefined; };
function quoteHtml(card: Card) {
  if (card.line) {
    const who = card.speaker ?? card.who;
    return `<div class="tcard-art">${who ? `<span class="who">${escapeHtml(who)}</span>` : ""}${mark(card.line, card.surface)}<span class="en">${implied(card.lineEn ?? "")}</span></div>`;
  }
  if (card.example) return `<div class="tcard-art">${mark(card.example, exampleSurface(card))}<span class="en">${implied(card.exampleEn ?? "")}</span>${card.exampleLoose ? `<span class="en"><i>${implied(card.exampleLoose)}</i></span>` : ""}</div>`;
  return "";
}
function answerHtml(card: Card) {
  const kind = KINDS[kindOf(card)];
  let title: string, meaning: string;
  if (card.kind === "kana") { title = glyph(card) + fontButton(' style="align-self:center"'); meaning = escapeHtml(card.meaning) + `<span class="sub">${card.set === "kata" ? "katakana" : "hiragana"}</span>`; }
  else if (card.kind === "form") { title = `<span class="jp">${escapeHtml(card.kana)}</span>`; meaning = implied(card.meaning) + (card.loose ? `<span class="loose">${implied(card.loose)}</span>` : "") + `<span class="sub">${escapeHtml(formLabel(card))}</span>`; }
  else { title = `<span class="jp">${escapeHtml(card.kana)}</span>${card.kanji ? `<span class="kanji">${escapeHtml(card.kanji)}</span>` : ""}`; meaning = implied(card.meaning) + (card.loose ? `<span class="loose">${implied(card.loose)}</span>` : ""); }
  let more = "";
  if (card.note) more += `<div class="note">${implied(card.note)}</div>`;
  if (card.line && card.example) more += `<div class="ex"><span class="jp">${mark(card.example, exampleSurface(card))}</span><span class="en">${implied(card.exampleEn ?? "")}</span>${card.exampleLoose ? `<span class="en"><i>${implied(card.exampleLoose)}</i></span>` : ""}</div>`;
  return `<div class="tcard-head"><span>${escapeHtml(kind)}${card.kind === "form" && card.form ? " · " + escapeHtml(card.form) : ""}</span><span class="r">${escapeHtml(card.romaji ?? "")}</span></div>
    <div class="tcard-body"><div class="tcard-title">${title}</div><div class="tcard-meaning">${meaning}</div>${quoteHtml(card)}
    ${more ? `<details class="more" style="padding:0"><summary>More</summary><div class="morebox">${more}</div></details>` : ""}</div>`;
}
function listDetailHtml(card: Card) {
  let html = "";
  if (card.kind === "kana") html += `<div class="ans">${escapeHtml(card.meaning)}</div><div class="sub">${card.set === "kata" ? "katakana" : "hiragana"}</div>`;
  else if (card.kind === "form") html += `<div class="ans">${implied(card.meaning)}</div>${card.loose ? `<div class="loose">${implied(card.loose)}</div>` : ""}<div class="sub">${escapeHtml(formLabel(card))}</div>`;
  else html += `<div class="ans">${implied(card.meaning)}</div>${card.loose ? `<div class="loose">${implied(card.loose)}</div>` : ""}<div class="sub">${card.kanji ? `<span class="kanji">${escapeHtml(card.kanji)}</span>` : ""}${card.romaji ? `<span class="romaji">${escapeHtml(card.romaji)}</span>` : ""}</div>`;
  let more = "";
  if (card.note) more += `<div class="note">${implied(card.note)}</div>`;
  if (card.example) more += `<div class="ex"><span class="jp">${mark(card.example, exampleSurface(card))}</span><span class="en">${implied(card.exampleEn ?? "")}</span></div>`;
  if (card.line) more += `<div class="dialog">${card.speaker || card.who ? `<span class="who">${escapeHtml(card.speaker ?? card.who)}</span>` : ""}${mark(card.line, card.surface)}<span class="en">${implied(card.lineEn ?? "")}</span></div>`;
  if (more) html += `<div class="morebox">${more}</div>`;
  return `<div class="back">${html}</div>`;
}

/* views */
function renderFilter() {
  byId("filter").innerHTML = FILTERS.map(([id, label]) => `<button data-mode="${id}" aria-pressed="${id === mode}">${id === "all" ? "" : `<span class="dot" style="--kc: var(--k-${id === "grammar" ? "form" : id})"></span>`}${label}</button>`).join("");
}
function renderDeck() {
  const container = deckElement(), practice = practicing();
  if (practice) renderFilter();
  const shell = (inner: string) => `<div class="stack"><div class="card">${inner}</div></div>`;
  if (!readKey()) { container.innerHTML = shell(`<div class="empty"><span class="big">カギが ない</span><span>This device has no key yet. Enter it under Settings.</span></div>`); return; }
  if (!loaded) { container.innerHTML = shell(`<div class="empty"><span class="big">ロード中…</span><span>Loading your deck</span></div>`); return; }
  const unders = () => queue.slice(0, 2).map((entry, index) => { const card = cards.get(entry.id); return card ? `<div class="under${index ? " u2" : ""}" style="${kindColor(card)}"></div>` : ""; }).join("");
  if (!drawn) {
    if (!queue.length) {
      if (practice) { container.innerHTML = shell(`<div class="empty"><span class="big">なにも ない</span><span>Nothing to practice with this filter yet. Move further in the game under Settings, or pick another filter.</span></div>`); return; }
      const seen = allEntries().filter(({ card, side }) => scheduleOf(card, side));
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
  const recognition = current.side === "r", existing = scheduleOf(card, current.side);
  const buttons = practice ? PRACTICE_BUTTONS : REVIEW_BUTTONS;
  const body = revealed
    ? answerHtml(card) + `<div class="actions${practice ? " two" : ""}">${buttons.map(([label, cls, grade]) => `<button class="g-${cls}" data-grade="${grade}">${label}</button>`).join("")}</div>`
    : `<div class="dir"><span class="tag">${escapeHtml(KINDS[kindOf(card)])}</span><span>${practice ? "practice" : existing ? "review" : "new"} · ${queue.length} left</span></div><div class="front">${frontHtml(card, recognition)}<div class="hint">${questionLabel(card, recognition)}</div></div><button class="show" id="show">Show Answer</button>`;
  container.innerHTML = `<div class="stack">${unders()}<div class="card ${revealed ? "a" : "q"}${justDrawn ? " drawn" : ""}${flipped ? " flip-in" : ""}" style="${kindColor(card)}">${body}</div></div>`;
  justDrawn = false; flipped = false;
  const fontToggle = document.getElementById("kfont");
  if (fontToggle) fontToggle.onclick = () => { kanaFont = kanaFont === "game" ? "normal" : "game"; try { localStorage.setItem("kotoba-kfont", kanaFont); } catch { /* private mode */ } render(); };
  if (revealed) container.querySelectorAll<HTMLButtonElement>("[data-grade]").forEach(button => button.onclick = () => answer(Number(button.dataset.grade) as Grade));
  else byId("show").onclick = reveal;
}
function status(card: Card): [string, string] {
  const now = Date.now(), schedules = sidesOf(card).map(side => scheduleOf(card, side));
  if (!schedules[0]) return unlocked(card) ? ["new", "new"] : ["locked", "locked"];
  const due = Math.min(...schedules.filter(Boolean).map(entry => entry!.due));
  if (due <= now) return ["due", "due"];
  return ["", "in " + formatInterval(due - now)];
}
function renderCards() {
  const query = (byId("search") as HTMLInputElement).value.trim().toLowerCase();
  const order = new Map(stages.map((stage, index) => [stage.id, index]));
  const items = [...cards.values()]
    .filter(card => !query || [card.kana, card.kanji, card.romaji, card.meaning, card.base, card.form, card.speaker, card.who, card.stage, KINDS[kindOf(card)]].some(field => String(field ?? "").toLowerCase().includes(query)))
    .sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99) || a.kind.localeCompare(b.kind) || (a.order ?? 0) - (b.order ?? 0) || a.kana.localeCompare(b.kana, "ja"));
  const list = byId("list");
  if (!items.length) { list.innerHTML = `<div class="empty">No matches.</div>`; return; }
  list.innerHTML = items.slice(0, 400).map(card => {
    const [cls, label] = status(card), open = openId === card.id;
    const tag = `<span class="tag">${escapeHtml(card.kind === "form" ? (card.form ?? "form") : KINDS[kindOf(card)])}</span>`;
    return `<div class="item" style="${kindColor(card)}"><button data-id="${escapeHtml(card.id)}" aria-expanded="${open}"><span class="k">${escapeHtml(card.kana)}${card.kanji ? `<small>${escapeHtml(card.kanji)}</small>` : ""}${tag}</span><span class="chip ${cls}">${label}</span><span class="m">${implied(card.meaning)}</span></button>
      ${open ? `<div class="detail">${listDetailHtml(card)}<div class="sub">${escapeHtml(stageLabel(card.stage))}</div></div>` : ""}</div>`;
  }).join("") + (items.length > 400 ? `<div class="empty">${items.length - 400} more. Narrow the search.</div>` : "");
  list.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(button => button.onclick = () => { openId = openId === button.dataset.id ? null : button.dataset.id!; renderCards(); });
}
function renderSettings() {
  const select = byId("setting-stage") as HTMLSelectElement;
  if (!select.options.length) select.innerHTML = stages.map(stage => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`).join("");
  select.value = state.settings.stage;
  const newInput = byId("setting-new") as HTMLInputElement;
  if (document.activeElement !== newInput) newInput.value = String(state.settings.newPerDay);
  const keyInput = byId("setting-key") as HTMLInputElement;
  if (document.activeElement !== keyInput) keyInput.value = readKey();
  const playerInput = byId("setting-player") as HTMLInputElement, rivalInput = byId("setting-rival") as HTMLInputElement;
  if (document.activeElement !== playerInput) playerInput.value = state.settings.playerName ?? "";
  if (document.activeElement !== rivalInput) rivalInput.value = state.settings.rivalName ?? "";
  let open = 0, locked = 0;
  for (const card of cards.values()) { if (unlocked(card)) open++; else locked++; }
  byId("setting-stage-help").textContent = `Cards from later in the game stay out of Review and Practice until you get there. ${open} unlocked` + (locked ? `, ${locked} waiting.` : ".");
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
function saveSettings(patch: Partial<Settings>) {
  state.settings = { ...state.settings, ...patch };
  enqueueWrite(() => api.settings(patch));
}

for (const name of ["review", "practice", "cards", "settings"] as const) byId("tab-" + name).onclick = () => showTab(name);
byId("filter").onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
  if (!button || button.dataset.mode === mode) return;
  mode = button.dataset.mode!; try { localStorage.setItem("kotoba-mode", mode); } catch { /* private mode */ }
  buildQueue(); render();
};
byId("search").oninput = renderCards;
(byId("setting-stage") as HTMLSelectElement).onchange = event => { saveSettings({ stage: (event.target as HTMLSelectElement).value }); buildQueue(); render(); };
(byId("setting-new") as HTMLInputElement).onchange = event => { const input = event.target as HTMLInputElement; const value = Math.max(0, Math.min(100, Math.round(Number(input.value) || 0))); input.value = String(value); saveSettings({ newPerDay: value }); render(); };
(byId("setting-player") as HTMLInputElement).onchange = event => saveSettings({ playerName: (event.target as HTMLInputElement).value.trim() });
(byId("setting-rival") as HTMLInputElement).onchange = event => saveSettings({ rivalName: (event.target as HTMLInputElement).value.trim() });
(byId("setting-key") as HTMLInputElement).onchange = event => { writeKey((event.target as HTMLInputElement).value.trim()); void start();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* offline shell is optional */ }); };

async function start() {
  render();
  if (!readKey()) return;
  try {
    const [deck, stageList] = await Promise.all([
      fetch("/cards.json").then(response => response.json() as Promise<Card[]>),
      fetch("/stages.json").then(response => response.json() as Promise<Stage[]>),
    ]);
    cards = new Map(deck.map(card => [card.id, card]));
    stages = stageList;
  } catch (error) {
    byId("message").textContent = `Couldn't load the deck, ${(error as Error).message}.`;
    render(); return;
  }
  try {
    state = await api.state();
    loaded = true;
    buildQueue();
    byId("message").textContent = "";
  } catch (error) {
    byId("message").textContent = navigator.onLine === false || (error as Error).message === "Failed to fetch"
      ? "You're offline. Reviewing needs a connection to save your progress; the Cards tab still works."
      : `Couldn't load your progress, ${(error as Error).message}. Check the key under Settings.`;
  }
  render();
}
void start();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* offline shell is optional */ });
