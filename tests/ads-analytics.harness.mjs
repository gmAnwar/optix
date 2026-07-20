// Offline harness for ads-analytics.html (F1 — lente de creativos).
// Fixture-loader pattern: stub firebase/fetch/DOM, feed a synthetic
// ads-manager-v2 doc + the REAL committed taxonomy, run the ACTUAL page
// script in a vm, and assert the join (pills, "Sin clasificar", campos
// faltantes, punto de confianza, derivación de línea, filtro de línea).
//   run:  node tests/ads-analytics.harness.mjs
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "ads-analytics.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mainScript = blocks[blocks.length - 1];

// ── Synthetic metrics doc: {_meta, data:{_meta, totals, campaigns[]}} ──
const mkFunnel = () => ({ llamada: { count: 3, conv_pct: 40, cost: 100 }, cita: { count: 2, conv_pct: 30, cost: 150 }, a_espera: { count: 1, conv_pct: 20, cost: 200 } });
const mkCap = (n) => ({ count: n, trc: n, gmz: 0 });
const ad = (ad_id, campaign_id, name) => ({
  ad_id, ad_name: name, code: name, status: "ACTIVE",
  campaign_id, campaign_name: "camp-" + campaign_id, adset_id: "as-" + ad_id, adset_name: "adset",
  spend: 5000, mensajes: 20, costo_msg: 250, funnel: mkFunnel(),
  captacion: mkCap(1), captacion_close: mkCap(1), captacion_first_touch: mkCap(1),
  cac_captacion: 5000, cac_captacion_close: 5000, cac_captacion_first_touch: 5000,
  cac_venta: null, roas: null, ventas_ok: 0, object_type: "VIDEO",
});
const CAP1 = "120232281266000053", PROMO = "120214624885210053", VAC = "120225742406730053", RECO = "120241819818390053";
const FIXTURE = {
  _meta: { generated_at: "2026-07-20T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-02-01", period_to: "2026-07-20", coverage_attribution: { close_pct: 80, first_pct: 60 } },
    totals: { spend: 40000, mensajes: 160, costo_msg: 250, cac_blended_total: 5000, cac_paid_blended: 5000, roas: 1.2, captac_blended: 8, cac_venta: 65000, spend_sin_captacion: 0, funnel: { llamada: { count: 24, conv_pct: 40, cost: 100 }, cita: { count: 16, cost: 150 }, a_espera: { count: 8, cost: 200 } }, captacion: mkCap(8), captacion_close: mkCap(8), captacion_first_touch: mkCap(8) },
    familia: [], buckets: [], cclkk: [],
    campaigns: [
      ad("120243031112680053", CAP1, "OA10 tagged-alta"),      // A: tagged alta
      ad("120238570383350053", CAP1, "OA12 tagged-media"),     // B: tagged media
      ad("120241353761680053", CAP1, "OA14 tagged-baja"),      // C: tagged baja
      ad("120241353924300053", CAP1, "OA15 tagged-notalento"), // D: tagged, missing talento
      ad("555000000000000001", CAP1, "OA99 untagged-cap"),     // E: untagged, captacion campaign
      ad("555000000000000002", PROMO, "OA98 untagged-promo"),  // F: untagged, promo campaign
      ad("555000000000000003", RECO, "OA97 untagged-reco"),    // G: untagged, reconocimiento
      ad("555000000000000004", VAC, "OA96 untagged-vac"),      // H: untagged, vacantes
    ],
  },
};

// ── Fake DOM ──
const noop = () => {};
const mkClassList = () => ({ add: noop, remove: noop, toggle: noop, contains: () => false });
class FakeEl {
  constructor(tag) { this.tagName = tag; this._html = ""; this._text = ""; this.children = []; this.style = {}; this.dataset = {}; this.classList = mkClassList(); this.className = ""; this.hidden = false; this.attributes = {}; this.draggable = false; }
  set innerHTML(v) { this._html = v == null ? "" : String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = v == null ? "" : String(v); }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); this._html = ""; return c; }
  addEventListener() {} removeEventListener() {}
  setAttribute(k, v) { this.attributes[k] = v; } getAttribute(k) { return this.attributes[k]; }
  querySelector() { return null; } querySelectorAll() { return []; } contains() { return false; } focus() {}
}
const elements = {};
const document = {
  getElementById(id) { return elements[id] || (elements[id] = new FakeEl("div")); },
  createElement(tag) { return new FakeEl(tag); },
  querySelectorAll() { return []; }, querySelector() { return null; }, addEventListener() {},
};
function serialize(el) {
  if (!el) return "";
  if (el.children && el.children.length) return el.children.map(serialize).join("");
  return el._html || "";
}

// ── Fake firebase + fetch ──
const firebase = {
  initializeApp: noop,
  auth: () => ({ onAuthStateChanged: (cb) => { firebase._authCb = cb; } }),
  firestore: () => ({ doc: (p) => ({ get: async () => (p.includes("ads-manager-v2-since_feb") ? { exists: true, data: () => FIXTURE } : { exists: false }) }) }),
};
const fetch = async (url) => {
  if (String(url).includes("ads-taxonomy.json")) {
    const txt = fs.readFileSync(path.join(ROOT, "assets/ads-analytics/ads-taxonomy.json"), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const sandbox = { document, firebase, fetch, console, setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math, window: { location: { search: "?client=inmobili" } } };
const ctx = vm.createContext(sandbox);
vm.runInContext(mainScript, ctx, { filename: "ads-analytics.inline.js" });
await vm.runInContext("loadFromFirestore()", ctx);

// ── Assertions ──
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("  ✗ FAIL:", msg); } };
const call = (expr) => vm.runInContext(expr, ctx);
const tbodyHtml = serialize(elements["tbody"]);

ok(tbodyHtml.includes("120243031112680053"), "A (tagged alta) shows in Captación");
ok(tbodyHtml.includes("120238570383350053"), "B (tagged media) shows");
ok(tbodyHtml.includes("120241353761680053"), "C (tagged baja) shows");
ok(tbodyHtml.includes("120241353924300053"), "D (missing talento) shows");
ok(tbodyHtml.includes("555000000000000001"), "E (untagged, captacion campaign) shows");
ok(!tbodyHtml.includes("555000000000000002"), "F (promo) hidden from Captación");
ok(!tbodyHtml.includes("555000000000000003"), "G (reconocimiento→otro) hidden");
ok(!tbodyHtml.includes("555000000000000004"), "H (vacantes) hidden from Captación");

ok(tbodyHtml.includes("pill pill-nc"), "NC pill rendered");
ok(tbodyHtml.includes("pill pill-angulo"), "Ángulo pill rendered");
ok(tbodyHtml.includes("pill pill-none") && tbodyHtml.includes("Sin clasificar"), "Sin clasificar pill for E");
ok(tbodyHtml.includes("tag-empty"), "tag-empty (—) rendered");
ok(tbodyHtml.includes("conf conf-alta"), "green confidence dot (alta)");
ok(tbodyHtml.includes("conf conf-media"), "amber confidence dot (media)");
ok(tbodyHtml.includes("conf conf-baja"), "hollow red confidence dot (baja)");

ok(call("tagCell({level:'ad',ad_id:'120243031112680053'},'nc')").includes("pill-nc"), "tagCell nc → pill");
ok(call("tagCell({level:'ad',ad_id:'ZZZ'},'angulo')").includes("Sin clasificar"), "untagged angulo → Sin clasificar");
ok(call("tagCell({level:'ad',ad_id:'ZZZ'},'nc')").includes("tag-empty"), "untagged nc → —");
ok(call("tagCell({level:'ad',ad_id:'120241353924300053'},'talento')").includes("tag-empty"), "missing talento → —");
ok(call("tagCell({level:'campaign'},'nc')").includes("tag-empty"), "rollup row → —");
ok(call("confDot({level:'ad',ad_id:'120241353761680053'})").includes("conf-baja"), "confDot baja");
ok(call("confDot({level:'ad',ad_id:'ZZZ'})") === "", "confDot untagged → empty");

ok(call("lineaFor({level:'ad',ad_id:'120243031112680053'})") === "captacion", "lineaFor tagged → tag.linea");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${CAP1}'})`) === "captacion", "derive captacion");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${PROMO}'})`) === "promo_inventario", "derive promo");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${VAC}'})`) === "vacantes", "derive vacantes");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${RECO}'})`) === "otro", "reconocimiento → otro");
ok(call("lineaFor({level:'ad',ad_id:'x',campaign_id:'999'})") === "otro", "unmapped campaign → otro");
ok(call(`passesLineaFilter({level:'ad',ad_id:'x',campaign_id:'${PROMO}'})`) === false, "promo ad fails captacion filter");

ok(call("currentTree().length") === 1, "currentTree (captacion) → 1 campaign");
ok(call("currentTree()[0].children.reduce((s,as)=>s+as.children.length,0)") === 5, "captacion campaign holds 5 ads (A–E)");
ok(tbodyHtml.includes("anuncios"), "total row present");
ok(call("Object.keys(taxonomy.ads).length") === 4, "taxonomy loaded (4 seeded ads)");

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
