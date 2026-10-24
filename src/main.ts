import "./style.css";
import { api, readKey, writeKey, type PackageSettings, type SettingsPatch, type Side, type State } from "./api";
import { currentRecall, dayOf, formatInterval, schedule, type Grade, type Schedule } from "./srs";

/* A package is a built bundle of cards with its own chapters, kinds, placeholders and settings (see tools/build_packages.py).
   The core kinds are the ones the app treats specially; everything else is a plain kind the package declares. */
interface Card {
  id: string; package: string; kind: string; chapter: string; kana: string; meaning: string;
  kanji?: string; romaji?: string; loose?: string; note?: string;
  base?: string; form?: string; register?: string; vclass?: string; recogOnly?: boolean;
  context?: string; line?: string; lineEn?: string; surface?: string;
  example?: string; exampleEn?: string; exampleLoose?: string; set?: "hira" | "kata"; order?: number;
}
interface Chapter { id: string; name: string }
interface KindSpec { label: string; color?: string; colorDark?: string }
interface SettingSpec { type: "text" | "number" | "choice"; label: string; help?: string; default?: string | number; max?: number; min?: number; slot?: string; options?: [string, string][] }
interface Package {
  id: string; title: string; description?: string; chapters: Chapter[]; cards: Card[];
  kinds?: Record<string, KindSpec>; slots?: Record<string, string>; settings?: Record<string, SettingSpec>;
}
interface QueueEntry { id: string; side: Side }

const CORE_KINDS: Record<string, KindSpec> = { word: { label: "Word" }, form: { label: "Form" }, ending: { label: "Ending" }, kana: { label: "Kana" } };
const PRACTICE_BUTTONS: [string, string, Grade][] = [["Again", "again", 0], ["Good", "good", 2]];
const REVIEW_BUTTONS: [string, string, Grade][] = [["Again", "again", 0], ["Hard", "hard", 1], ["Good", "good", 2], ["Easy", "easy", 3]];

const byId = (id: string) => document.getElementById(id)!;
const escapeHtmlOnly = (text: unknown) => String(text ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

/* state */
let packages = new Map<string, Package>();
let cards = new Map<string, Card>();
let state: State = { format: 2, version: 0, settings: { newPerDay: 20, produce: ["word"], packages: {} }, srs: {} };
let loaded = false;
let queue: QueueEntry[] = [];
let current: QueueEntry | null = null;
let revealed = false, drawn = false, busy = false, justDrawn = false, flipped = false;
let openId: string | null = null;
let view: "review" | "practice" | "cards" | "settings" = "review";
// practice filters: the chosen chapters (as "package/chapter") and kinds; an empty set means all of them
let chosenChapters = new Set<string>();
let chosenKinds = new Set<string>();
let openFilter: "chapter" | "kind" | null = null;
let openChapters = new Set<string>(); // chapters unfolded in the card list; everything starts folded
let kanaFont: "game" | "normal" = "game";
try {
  openChapters = new Set(JSON.parse(localStorage.getItem("kotoba-open-chapters") ?? "[]") as string[]);
  chosenChapters = new Set(JSON.parse(localStorage.getItem("kotoba-chapters") ?? "[]") as string[]);
  chosenKinds = new Set(JSON.parse(localStorage.getItem("kotoba-kinds") ?? "[]") as string[]);
  kanaFont = (localStorage.getItem("kotoba-kfont") as "game" | "normal") ?? "game";
} catch { /* private mode */ }
let pendingWrite: Promise<unknown> = Promise.resolve();

/* packages, chapters and kinds */
const packageSettings = (id: string): PackageSettings => state.settings.packages[id] ?? {};
const packageEnabled = (id: string) => packageSettings(id).enabled !== false;
const packageOf = (card: Card) => packages.get(card.package);
const chapterKey = (card: Card) => `${card.package}/${card.chapter}`;
const chapterIndex = (pkg: Package, id: string | undefined) => { const index = pkg.chapters.findIndex(chapter => chapter.id === id); return index < 0 ? Infinity : index; };
// the position is the last open chapter; absent means the latest, so everything is open
const positionIndex = (pkg: Package) => { const position = packageSettings(pkg.id).position; return position === undefined ? pkg.chapters.length - 1 : chapterIndex(pkg, position); };
// a card whose chapter is not in its package's list stays locked until the package is fixed
const unlocked = (card: Card) => { const pkg = packageOf(card); return !!pkg && packageEnabled(pkg.id) && chapterIndex(pkg, card.chapter) <= positionIndex(pkg); };
const chapterName = (card: Card) => packageOf(card)?.chapters.find(chapter => chapter.id === card.chapter)?.name ?? "No chapter";
const kindSpec = (card: Card): KindSpec => CORE_KINDS[card.kind] ?? packageOf(card)?.kinds?.[card.kind] ?? { label: card.kind };
const kindVar = (packageId: string, kind: string) => (CORE_KINDS[kind] ? `--k-${kind}` : `--k-${packageId}-${kind}`);
const kindColor = (card: Card) => `--kc: var(${kindVar(card.package, card.kind)})`;
// every kind in play: the core ones, then each enabled package's own
function allKinds(): [string, KindSpec, string][] {
  const out: [string, KindSpec, string][] = Object.entries(CORE_KINDS).map(([kind, spec]) => [kind, spec, `--k-${kind}`]);
  for (const pkg of packages.values()) if (packageEnabled(pkg.id)) for (const [kind, spec] of Object.entries(pkg.kinds ?? {})) out.push([kind, spec, kindVar(pkg.id, kind)]);
  return out;
}
// a package's declared colors become CSS variables, light and dark, so the stylesheet treats its kinds like the core ones
function installKindColors() {
  const light: string[] = [], dark: string[] = [];
  for (const pkg of packages.values()) for (const [kind, spec] of Object.entries(pkg.kinds ?? {})) {
    if (spec.color) light.push(`${kindVar(pkg.id, kind)}: ${spec.color}`);
    if (spec.colorDark ?? spec.color) dark.push(`${kindVar(pkg.id, kind)}: ${spec.colorDark ?? spec.color}`);
  }
  byId("package-colors").textContent = `:root { ${light.join("; ")} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark.join("; ")} } }
:root[data-theme="dark"] { ${dark.join("; ")} }`;
}

/* placeholders: a setting bound to a slot fills it; any other slot is shown as the package's label for it */
function slotFillers() {
  const fill = new Map<string, string>(), labels = new Map<string, string>();
  for (const pkg of packages.values()) {
    for (const [slot, label] of Object.entries(pkg.slots ?? {})) labels.set(slot, label);
    for (const [key, spec] of Object.entries(pkg.settings ?? {})) if (spec.slot) fill.set(spec.slot, String(packageSettings(pkg.id).values?.[key] ?? spec.default ?? ""));
  }
  return { fill, labels };
}
const fillSlots = (html: string) => {
  const { fill, labels } = slotFillers();
  return html.replace(/\{(\w+)\}/g, (_, slot: string) => fill.has(slot) ? escapeHtmlOnly(fill.get(slot)) : `<span class="slot">${escapeHtmlOnly(labels.get(slot) ?? slot)}</span>`);
};
const escapeHtml = (text: unknown) => fillSlots(escapeHtmlOnly(text));
// implied words that Japanese leaves out are stored as "(I)" and shown lighter, without brackets
const implied = (text: unknown) => escapeHtml(text).replace(/\(([^()]*)\)/g, '<span class="imp">$1</span>');
// highlight an exact surface form inside a line; nothing is guessed, the package build has checked it occurs once
function mark(line: string | undefined, surface: string | undefined): string {
  if (!line || !surface) return escapeHtml(line);
  const at = line.indexOf(surface);
  if (at < 0) return escapeHtml(line);
  return escapeHtml(line.slice(0, at)) + "<mark>" + escapeHtml(surface) + "</mark>" + escapeHtml(line.slice(at + surface.length));
}

const practicing = () => view === "practice";
const inPractice = (card: Card) => unlocked(card) && (!chosenKinds.size || chosenKinds.has(card.kind)) && (!chosenChapters.size || chosenChapters.has(chapterKey(card)));
// every card is asked for recognition; production only for the kinds chosen in Settings, and never for kana
const sidesOf = (card: Card): Side[] => (card.kind === "kana" || card.recogOnly || !state.settings.produce.includes(card.kind) ? ["r"] : ["r", "p"]);
const scheduleOf = (card: Card, side: Side): Schedule | null => state.srs[card.id]?.[side] ?? null;
// every side is its own card for the scheduler; this lists them all
const allEntries = () => { const out: { id: string; side: Side; card: Card }[] = []; for (const [id, card] of cards) for (const side of sidesOf(card)) out.push({ id, side, card }); return out; };
const shuffle = <T,>(items: T[]) => { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; };

/* the review queue: everything due, plus today's ration of new cards from the unlocked part of every package */
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
    if (practicing() && !inPractice(card)) continue;
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
    const pool = allEntries().filter(({ card }) => inPractice(card))
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
  if (recognition) return card.kind === "kana" ? "Read it" : CORE_KINDS[card.kind] ? "What does it mean?" : `Which ${kindSpec(card).label.toLowerCase()}?`;
  return card.kind === "form" ? "Conjugate" : "Say it in Japanese";
}
function frontHtml(card: Card, recognition: boolean) {
  if (card.kind === "kana") return `${fontButton()}<div class="kglyph${kanaFont === "normal" ? " normal" : ""}">${escapeHtml(card.kana)}</div>`;
  if (card.kind === "form" && !recognition) return `<div class="mid">${escapeHtml(card.base)}</div><div class="task">${escapeHtml([card.form, card.register].filter(Boolean).join(", "))}</div>`;
  if (recognition) return `<div class="big">${escapeHtml(card.kana)}</div>`;
  return `<div class="mid">${implied(String(card.meaning).split(" · ")[0])}</div>`; // the primary gloss is the cue; the nuance waits for the answer
}
// an everyday example is our own text: highlight the dictionary form when it appears as written, otherwise nothing
const exampleSurface = (card: Card) => { const core = card.kana.replace(/[〜～]/g, "").split("／")[0].trim(); return card.example?.includes(core) ? core : undefined; };
function quoteHtml(card: Card) {
  if (card.line) return `<div class="tcard-art">${card.context ? `<span class="who">${escapeHtml(card.context)}</span>` : ""}${mark(card.line, card.surface)}<span class="en">${implied(card.lineEn ?? "")}</span></div>`;
  if (card.example) return `<div class="tcard-art">${mark(card.example, exampleSurface(card))}<span class="en">${implied(card.exampleEn ?? "")}</span>${card.exampleLoose ? `<span class="en"><i>${implied(card.exampleLoose)}</i></span>` : ""}</div>`;
  return "";
}
function answerHtml(card: Card) {
  const kind = kindSpec(card).label;
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
  if (card.line) more += `<div class="dialog">${card.context ? `<span class="who">${escapeHtml(card.context)}</span>` : ""}${mark(card.line, card.surface)}<span class="en">${implied(card.lineEn ?? "")}</span></div>`;
  if (more) html += `<div class="morebox">${more}</div>`;
  return `<div class="back">${html}</div>`;
}

/* views */
// the chapters open for practice: each enabled package's chapters up to its position, labeled with the package when more than one is in play
function openChapterChoices(): [string, string][] {
  const enabled = [...packages.values()].filter(pkg => packageEnabled(pkg.id));
  const out: [string, string][] = [];
  for (const pkg of enabled) for (const chapter of pkg.chapters.slice(0, positionIndex(pkg) + 1)) out.push([`${pkg.id}/${chapter.id}`, enabled.length > 1 ? `${pkg.title} · ${chapter.name}` : chapter.name]);
  return out;
}
function renderFilter() {
  const chapterChoices = openChapterChoices();
  for (const id of chosenChapters) if (!chapterChoices.some(([choice]) => choice === id)) chosenChapters.delete(id); // a chapter locked again drops out of the filter
  const kindChoices: [string, string][] = allKinds().map(([kind, spec]) => [kind, spec.label]);
  const summary = (name: string, chosen: Set<string>, choices: [string, string][]) =>
    `${name}: ${chosen.size ? choices.filter(([id]) => chosen.has(id)).map(([, label]) => label).join(", ") : "All"}`;
  byId("filters").innerHTML = `<button data-open="chapter">${escapeHtml(summary("Chapters", chosenChapters, chapterChoices))}</button><button data-open="kind">${escapeHtml(summary("Kinds", chosenKinds, kindChoices))}</button>`;
  if (openFilter) {
    const [title, chosen, choices] = openFilter === "chapter" ? ["Chapters", chosenChapters, chapterChoices] as const : ["Kinds", chosenKinds, kindChoices] as const;
    const colorOf = new Map(allKinds().map(([kind, , variable]) => [kind, variable]));
    byId("filter-dialog-title").textContent = title;
    byId("filter-options").dataset.filter = openFilter;
    byId("filter-options").innerHTML = choices.map(([id, label]) => `<label>${openFilter === "kind" ? `<span class="dot" style="--kc: var(${colorOf.get(id)})"></span>` : ""}<span class="name">${escapeHtml(label)}</span><input type="checkbox" data-choice="${escapeHtml(id)}"${chosen.has(id) ? " checked" : ""}></label>`).join("");
  }
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
      if (practice) { container.innerHTML = shell(`<div class="empty"><span class="big">なにも ない</span><span>Nothing to practice with this filter yet. Move further under Settings, or pick another filter.</span></div>`); return; }
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
    : `<div class="dir"><span class="tag">${escapeHtml(kindSpec(card).label)}</span><span>${practice ? "practice" : existing ? "review" : "new"} · ${queue.length} left</span></div><div class="front">${frontHtml(card, recognition)}<div class="hint">${questionLabel(card, recognition)}</div></div><button class="show" id="show">Show Answer</button>`;
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
  const packageOrder = new Map([...packages.keys()].map((id, index) => [id, index]));
  const order = (card: Card) => { const pkg = packageOf(card); return (packageOrder.get(card.package) ?? 99) * 1000 + (pkg ? chapterIndex(pkg, card.chapter) : 999); };
  const items = [...cards.values()]
    .filter(card => !query || [card.kana, card.kanji, card.romaji, card.meaning, card.base, card.form, card.context, chapterName(card), kindSpec(card).label].some(field => String(field ?? "").toLowerCase().includes(query)))
    .sort((a, b) => order(a) - order(b) || a.kind.localeCompare(b.kind) || (a.order ?? 0) - (b.order ?? 0) || a.kana.localeCompare(b.kana, "ja"));
  const list = byId("list");
  if (!items.length) { list.innerHTML = `<div class="empty">No matches.</div>`; return; }
  const countBy = new Map<string, number>();
  for (const card of items) countBy.set(chapterKey(card), (countBy.get(chapterKey(card)) ?? 0) + 1);
  list.innerHTML = items.map((card, index) => {
    const key = chapterKey(card), folded = !openChapters.has(key);
    const heading = index === 0 || chapterKey(items[index - 1]) !== key
      ? `<button class="group" data-chapter="${escapeHtml(key)}" aria-expanded="${!folded}"><span>${escapeHtml(packages.size > 1 ? `${packageOf(card)?.title ?? card.package} · ${chapterName(card)}` : chapterName(card))}</span><span>${countBy.get(key)} cards${unlocked(card) ? "" : " · locked"}</span></button>` : "";
    if (folded) return heading;
    const [cls, label] = status(card), open = openId === card.id;
    const tag = `<span class="tag">${escapeHtml(kindSpec(card).label)}</span>`;
    const meaning = (card.kind === "form" && card.form ? `<span class="form">${escapeHtml(card.form)}</span> · ` : "") + implied(card.meaning);
    return heading + `<div class="item" style="${kindColor(card)}"><button data-id="${escapeHtml(card.id)}" aria-expanded="${open}"><span class="k">${escapeHtml(card.kana)}${card.kanji ? `<small>${escapeHtml(card.kanji)}</small>` : ""}${tag}</span><span class="chip ${cls}">${label}</span><span class="m">${meaning}</span></button>
      ${open ? `<div class="detail">${listDetailHtml(card)}</div>` : ""}</div>`;
  }).join("");
  list.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(button => button.onclick = () => { openId = openId === button.dataset.id ? null : button.dataset.id!; renderCards(); });
  list.querySelectorAll<HTMLButtonElement>("[data-chapter]").forEach(button => button.onclick = () => {
    const key = button.dataset.chapter!;
    if (openChapters.has(key)) openChapters.delete(key); else openChapters.add(key);
    try { localStorage.setItem("kotoba-open-chapters", JSON.stringify([...openChapters])); } catch { /* private mode */ }
    renderCards();
  });
}
// one block per package: on or off, the position in its chapters, and whatever settings its manifest declares
function packageSettingsHtml(pkg: Package) {
  const settings = packageSettings(pkg.id), enabled = packageEnabled(pkg.id);
  let open = 0, locked = 0;
  for (const card of pkg.cards) { if (unlocked(card)) open++; else locked++; }
  const position = settings.position ?? pkg.chapters[pkg.chapters.length - 1]?.id;
  const fields = !enabled ? "" : `
    <label class="field"><span class="label">Chapter</span><select data-package="${pkg.id}" data-position>${pkg.chapters.map(chapter => `<option value="${escapeHtml(chapter.id)}"${chapter.id === position ? " selected" : ""}>${escapeHtml(chapter.name)}</option>`).join("")}</select>
      <span class="help">Cards from later chapters stay out of Review and Practice until you move on. Set it one ahead of where you are to learn the words before you meet them. ${open} unlocked${locked ? `, ${locked} waiting.` : "."}</span></label>
    ${Object.entries(pkg.settings ?? {}).map(([key, spec]) => {
      const value = settings.values?.[key] ?? spec.default ?? "";
      const input = spec.type === "choice"
        ? `<select data-package="${pkg.id}" data-key="${key}">${(spec.options ?? []).map(([id, label]) => `<option value="${escapeHtml(id)}"${id === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`
        : spec.type === "number"
          ? `<input data-package="${pkg.id}" data-key="${key}" type="number" inputmode="numeric" value="${escapeHtmlOnly(value)}"${spec.min !== undefined ? ` min="${spec.min}"` : ""}${spec.max !== undefined ? ` max="${spec.max}"` : ""}>`
          : `<input data-package="${pkg.id}" data-key="${key}" autocomplete="off" value="${escapeHtmlOnly(value)}"${spec.max ? ` maxlength="${spec.max}"` : ""}>`;
      return `<label class="field"><span class="label">${escapeHtml(spec.label)}</span>${input}${spec.help ? `<span class="help">${escapeHtml(spec.help)}</span>` : ""}</label>`;
    }).join("")}`;
  return `<div class="setting package"><label class="toggle"><span><span class="label">${escapeHtml(pkg.title)}</span>${pkg.description ? `<span class="help">${escapeHtml(pkg.description)}</span>` : ""}</span><input type="checkbox" data-package="${pkg.id}" data-enabled${enabled ? " checked" : ""}></label>${fields}</div>`;
}
function renderSettings() {
  const newInput = byId("setting-new") as HTMLInputElement;
  if (document.activeElement !== newInput) newInput.value = String(state.settings.newPerDay);
  const keyInput = byId("setting-key") as HTMLInputElement;
  if (document.activeElement !== keyInput) keyInput.value = readKey();
  byId("setting-produce").innerHTML = allKinds().filter(([kind]) => kind !== "kana").map(([kind, spec, variable]) => `<button data-kind="${kind}" aria-pressed="${state.settings.produce.includes(kind)}"><span class="dot" style="--kc: var(${variable})"></span>${escapeHtml(spec.label)}</button>`).join("");
  if (!byId("setting-packages").contains(document.activeElement)) byId("setting-packages").innerHTML = [...packages.values()].map(packageSettingsHtml).join("");
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
function saveSettings(patch: SettingsPatch) {
  const packagesPatch = patch.packages ?? {};
  const merged = { ...state.settings.packages };
  for (const [id, entry] of Object.entries(packagesPatch)) merged[id] = { ...(merged[id] ?? {}), ...entry, values: { ...(merged[id]?.values ?? {}), ...(entry.values ?? {}) } };
  state.settings = { ...state.settings, ...patch, packages: merged };
  enqueueWrite(() => api.settings(patch));
}

for (const name of ["review", "practice", "cards", "settings"] as const) byId("tab-" + name).onclick = () => showTab(name);
byId("filters").onclick = event => {
  const head = (event.target as HTMLElement).closest<HTMLElement>("[data-open]");
  if (!head) return;
  openFilter = head.dataset.open as "chapter" | "kind"; renderFilter();
  (byId("filter-dialog") as HTMLDialogElement).showModal();
};
const filterDialog = byId("filter-dialog") as HTMLDialogElement;
filterDialog.onclose = () => { openFilter = null; renderFilter(); };
filterDialog.onclick = event => { if (event.target === filterDialog) filterDialog.close(); }; // a tap on the backdrop closes it
byId("filter-done").onclick = () => filterDialog.close();
byId("filter-options").onchange = event => {
  const box = event.target as HTMLInputElement;
  if (!box.dataset.choice) return;
  const which = box.closest<HTMLElement>("[data-filter]")!.dataset.filter, chosen = which === "chapter" ? chosenChapters : chosenKinds;
  if (box.checked) chosen.add(box.dataset.choice); else chosen.delete(box.dataset.choice);
  try { localStorage.setItem(which === "chapter" ? "kotoba-chapters" : "kotoba-kinds", JSON.stringify([...chosen])); } catch { /* private mode */ }
  buildQueue(); render();
};
byId("search").oninput = renderCards;
(byId("setting-new") as HTMLInputElement).onchange = event => { const input = event.target as HTMLInputElement; const value = Math.max(0, Math.min(100, Math.round(Number(input.value) || 0))); input.value = String(value); saveSettings({ newPerDay: value }); render(); };
byId("setting-produce").onclick = event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-kind]");
  if (!button) return;
  const kind = button.dataset.kind!;
  const produce = state.settings.produce.includes(kind) ? state.settings.produce.filter(chosen => chosen !== kind) : [...state.settings.produce, kind];
  saveSettings({ produce }); buildQueue(); render();
};
byId("setting-packages").onchange = event => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const id = input.dataset.package;
  if (!id) return;
  const patch: PackageSettings =
    "enabled" in input.dataset ? { enabled: (input as HTMLInputElement).checked }
    : "position" in input.dataset ? { position: input.value }
    : { values: { [input.dataset.key!]: input.type === "number" ? Number(input.value) : input.value.trim() } };
  saveSettings({ packages: { [id]: patch } });
  (input as HTMLElement).blur();
  buildQueue(); render();
};
(byId("setting-key") as HTMLInputElement).onchange = event => { writeKey((event.target as HTMLInputElement).value.trim()); void start(); };

async function start() {
  render();
  if (!readKey()) return;
  try {
    const index = await fetch("/packages/index.json").then(response => response.json() as Promise<{ id: string }[]>);
    const built = await Promise.all(index.map(entry => fetch(`/packages/${entry.id}.json`).then(response => response.json() as Promise<Package>)));
    packages = new Map(built.map(pkg => [pkg.id, pkg]));
    cards = new Map(built.flatMap(pkg => pkg.cards).map(card => [card.id, card]));
    installKindColors();
  } catch (error) {
    byId("message").textContent = `Couldn't load the packages, ${(error as Error).message}.`;
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
