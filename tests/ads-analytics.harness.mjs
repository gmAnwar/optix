// Offline harness for ads-analytics.html (F1 — lente de creativos).
// Fixture-loader pattern: stub firebase/fetch/DOM, feed a synthetic
// ads-manager-v2 doc + the REAL committed taxonomy, run the ACTUAL page
// script in a vm, and assert the join. Los ad_ids de prueba se ELIGEN de la
// taxonomía real en runtime → el harness queda verde ante updates del archivo.
//   run:  node tests/ads-analytics.harness.mjs
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "ads-analytics.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mainScript = blocks[blocks.length - 1];

// Taxonomía real → elegir ad_ids representativos por criterio.
const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/ads-analytics/ads-taxonomy.json"), "utf8"));
const TIDS = Object.keys(TAX.ads), T = k => TAX.ads[k];
const DASH = v => v === "—" || v === "-";
const pick = (p, label) => { const k = TIDS.find(p); if (!k) throw new Error("fixture pick vacío: " + label); return k; };
const capAlta   = pick(k => T(k).linea === "captacion" && T(k).confianza === "alta", "cap+alta");
const capMedia  = pick(k => T(k).linea === "captacion" && T(k).confianza === "media", "cap+media");
const capBaja   = pick(k => T(k).linea === "captacion" && T(k).confianza === "baja" && T(k).angulo != null && !DASH(T(k).angulo), "cap+baja+angulo");
const capTalDash= pick(k => T(k).linea === "captacion" && DASH(T(k).talento), "cap+talento=—");
const capAngNull= pick(k => T(k).linea === "captacion" && T(k).angulo == null, "cap+angulo=null");
const promoAd   = pick(k => T(k).linea === "promo_inventario", "promo");
const vacAd     = pick(k => T(k).linea === "vacantes", "vacantes");
const talReal   = pick(k => T(k).talento != null && !DASH(T(k).talento), "talento real");

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
const CAP1 = "120232281266000053", PROMOC = "120214624885210053", RECO = "120241819818390053";
const UNTAGGED = "555000000000000001";           // no está en la taxonomía, campaña captación
const FIXTURE = {
  _meta: { generated_at: "2026-07-20T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-02-01", period_to: "2026-07-20", coverage_attribution: { close_pct: 80, first_pct: 60 } },
    totals: { spend: 40000, mensajes: 160, costo_msg: 250, cac_blended_total: 5000, cac_paid_blended: 5000, roas: 1.2, captac_blended: 8, cac_venta: 65000, spend_sin_captacion: 0, funnel: { llamada: { count: 24, conv_pct: 40, cost: 100 }, cita: { count: 16, cost: 150 }, a_espera: { count: 8, cost: 200 } }, captacion: mkCap(8), captacion_close: mkCap(8), captacion_first_touch: mkCap(8) },
    familia: [], buckets: [], cclkk: [],
    campaigns: [
      ad(capAlta, CAP1, "cap-alta"), ad(capMedia, CAP1, "cap-media"), ad(capBaja, CAP1, "cap-baja"),
      ad(capTalDash, CAP1, "cap-talento-dash"), ad(capAngNull, CAP1, "cap-ang-null"),
      ad(UNTAGGED, CAP1, "untagged"),
      ad(promoAd, PROMOC, "promo"), ad(vacAd, "120225742406730053", "vacantes"),
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
  if (String(url).includes("ads-taxonomy.json")) return { ok: true, status: 200, json: async () => TAX };
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
const tc = (id, dim) => call(`tagCell({level:'ad',ad_id:'${id}'},'${dim}')`);
const tbody = serialize(elements["tbody"]);

// Vista Captación (default): captación in, promo/vacantes out.
[capAlta, capMedia, capBaja, capTalDash, capAngNull, UNTAGGED].forEach(id =>
  ok(tbody.includes(id), "captación ad shown: " + id));
ok(!tbody.includes(promoAd), "promo ad hidden from Captación");
ok(!tbody.includes(vacAd), "vacantes ad hidden from Captación");

// Puntos de confianza + pills + Sin clasificar renderizados.
ok(tbody.includes("conf conf-alta"), "green dot (alta)");
ok(tbody.includes("conf conf-media"), "amber dot (media)");
ok(tbody.includes("conf conf-baja"), "hollow red dot (baja)");
ok(tbody.includes("pill pill-nc"), "NC pill");
ok(tbody.includes("pill pill-angulo"), "Ángulo pill");
ok(tbody.includes("pill pill-none") && tbody.includes("Sin clasificar"), "Sin clasificar pill");
ok(tbody.includes("tag-empty"), "tag-empty (—) rendered");

// *** SENTINELA "—": talento="—" NO debe ir en pill, sino vacío. ***
ok(tc(capTalDash, "talento").includes("tag-empty"), "talento='—' → tag-empty (no pill)");
ok(!tc(capTalDash, "talento").includes("pill-talento"), "talento='—' NUNCA rinde pill");
ok(tc(talReal, "talento").includes("pill-talento"), "talento real → pill");

// angulo:null (tagged) → "Sin clasificar" (no solo untagged).
ok(tc(capAngNull, "angulo").includes("Sin clasificar"), "angulo=null (tagged) → Sin clasificar");
ok(tc(capBaja, "angulo").includes("pill-angulo"), "angulo con valor → pill");

// Ad sin entrada en la taxonomía.
ok(tc("ZZZ_no_existe", "angulo").includes("Sin clasificar"), "untagged angulo → Sin clasificar");
ok(tc("ZZZ_no_existe", "nc").includes("tag-empty"), "untagged nc → —");
ok(call("tagCell({level:'campaign'},'nc')").includes("tag-empty"), "rollup row → —");

// Punto de confianza directo.
ok(call(`confDot({level:'ad',ad_id:'${capAlta}'})`).includes("conf-alta"), "confDot alta");
ok(call(`confDot({level:'ad',ad_id:'${capMedia}'})`).includes("conf-media"), "confDot media");
ok(call(`confDot({level:'ad',ad_id:'${capBaja}'})`).includes("conf-baja"), "confDot baja");
ok(call("confDot({level:'ad',ad_id:'ZZZ_no_existe'})") === "", "confDot untagged → vacío");

// Derivación / filtro de línea.
ok(call(`lineaFor({level:'ad',ad_id:'${capAlta}'})`) === "captacion", "lineaFor tagged captación");
ok(call(`lineaFor({level:'ad',ad_id:'${promoAd}'})`) === "promo_inventario", "lineaFor tagged promo");
ok(call(`lineaFor({level:'ad',ad_id:'${vacAd}'})`) === "vacantes", "lineaFor tagged vacantes");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${CAP1}'})`) === "captacion", "derive captación (untagged)");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${RECO}'})`) === "otro", "reconocimiento → otro");
ok(call(`passesLineaFilter({level:'ad',ad_id:'${promoAd}'})`) === false, "promo falla filtro captación");

// currentTree consistente (línea filtrada en el árbol) + taxonomía cargada.
ok(call("currentTree().length") === 1, "currentTree (captación) → 1 campaña");
ok(call("currentTree()[0].children.reduce((s,as)=>s+as.children.length,0)") === 6, "captación → 6 ads (5 tagged + 1 untagged)");
ok(tbody.includes("anuncios"), "total row present");
ok(call("Object.keys(taxonomy.ads).length") === TIDS.length, `taxonomía cargada (${TIDS.length} ads)`);

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
