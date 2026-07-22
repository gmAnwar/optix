// Offline harness for ads-analytics.html (F1 — lente de creativos).
// Fixture-loader pattern: stub firebase/fetch/DOM, feed un doc ads-manager-v2
// sintético + la taxonomía REAL commiteada, corre el código REAL de la página
// en un vm, y verifica el join. DISEÑO DATA-DRIVEN: recorre cada ad tageado y
// exige que tagCell/confDot rindan según SU propia data → verde ante cualquier
// composición de taxonomía (v1 baja-heavy, v2 solo alta/media, futuras).
//   run:  node tests/ads-analytics.harness.mjs
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "ads-analytics.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mainScript = blocks[blocks.length - 1];

const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/ads-analytics/ads-taxonomy.json"), "utf8"));
const TIDS = Object.keys(TAX.ads), T = k => TAX.ads[k];
const DIMS = ["nc", "angulo", "tipo", "formato", "talento"];
// Espeja isEmptyTag / escHtml de la página.
const isEmpty = v => v == null || v === "" || v === "—" || v === "-";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Picks para el render smoke (OPCIONALES — undefined si el bucket no existe).
const capOf = extra => TIDS.find(k => T(k).linea === "captacion" && extra(k));
const capAngSet = capOf(k => !isEmpty(T(k).angulo));
const capAngNull = capOf(k => T(k).angulo == null);            // v2: undefined
const capBaja = capOf(k => T(k).confianza === "baja");         // v2: undefined
const capTalDash = capOf(k => isEmpty(T(k).talento));
const promoAd = TIDS.find(k => T(k).linea === "promo_inventario");
const vacAd = TIDS.find(k => T(k).linea === "vacantes");       // v2: undefined
const talReal = TIDS.find(k => !isEmpty(T(k).talento));
const capForRender = [...new Set([capAngSet, capAngNull, capBaja, capTalDash].filter(Boolean))];

// ── Synthetic metrics doc: {_meta, data:{_meta, totals, campaigns[]}} ──
const mkFunnel = () => ({ llamada: { count: 3, conv_pct: 40, cost: 100 }, cita: { count: 2, conv_pct: 30, cost: 150 }, a_espera: { count: 1, conv_pct: 20, cost: 200 } });
const mkCap = n => ({ count: n, trc: n, gmz: 0 });
const ad = (ad_id, campaign_id, name) => ({
  ad_id, ad_name: name, code: name, status: "ACTIVE",
  campaign_id, campaign_name: "camp-" + campaign_id, adset_id: "as-" + ad_id, adset_name: "adset",
  spend: 5000, mensajes: 20, costo_msg: 250, funnel: mkFunnel(),
  captacion: mkCap(1), captacion_close: mkCap(1), captacion_first_touch: mkCap(1),
  cac_captacion: 5000, cac_captacion_close: 5000, cac_captacion_first_touch: 5000,
  cac_venta: null, roas: null, ventas_ok: 0, object_type: "VIDEO",
});
const CAP1 = "120232281266000053", PROMOC = "120214624885210053", VAC = "120225742406730053", RECO = "120241819818390053";
const UNTAGGED = "555000000000000001";
const FIXTURE = {
  _meta: { generated_at: "2026-07-22T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-02-01", period_to: "2026-07-22", coverage_attribution: { close_pct: 80, first_pct: 60 } },
    totals: { spend: 40000, mensajes: 160, costo_msg: 250, cac_blended_total: 5000, cac_paid_blended: 5000, roas: 1.2, captac_blended: 8, cac_venta: 65000, spend_sin_captacion: 0, funnel: { llamada: { count: 24, conv_pct: 40, cost: 100 }, cita: { count: 16, cost: 150 }, a_espera: { count: 8, cost: 200 } }, captacion: mkCap(8), captacion_close: mkCap(8), captacion_first_touch: mkCap(8) },
    familia: [], buckets: [], cclkk: [],
    campaigns: [
      ...capForRender.map((id, i) => ad(id, CAP1, "cap-" + i)),
      ad(UNTAGGED, CAP1, "untagged"),
      ...(promoAd ? [ad(promoAd, PROMOC, "promo")] : []),
      ...(vacAd ? [ad(vacAd, VAC, "vac")] : []),
    ],
  },
};
const expectedCapAds = capForRender.length + 1; // picks captación + untagged

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
const firebase = {
  initializeApp: noop,
  auth: () => ({ onAuthStateChanged: cb => { firebase._authCb = cb; } }),
  firestore: () => ({ doc: p => ({ get: async () => (p.includes("ads-manager-v2-since_feb") ? { exists: true, data: () => FIXTURE } : { exists: false }) }) }),
};
const fetch = async url => (String(url).includes("ads-taxonomy.json") ? { ok: true, status: 200, json: async () => TAX } : { ok: false, status: 404, json: async () => ({}) });

const sandbox = { document, firebase, fetch, console, setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math, window: { location: { search: "?client=inmobili" } } };
const ctx = vm.createContext(sandbox);
vm.runInContext(mainScript, ctx, { filename: "ads-analytics.inline.js" });
await vm.runInContext("loadFromFirestore()", ctx);

// ── Assertions ──
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("  ✗ FAIL:", msg); } };
const skip = msg => console.log("  ⊘ skip:", msg);
const call = expr => vm.runInContext(expr, ctx);
const tc = (id, dim) => call(`tagCell({level:'ad',ad_id:${JSON.stringify(id)}},'${dim}')`);
const tbody = serialize(elements["tbody"]);

// *** DATA-DRIVEN: cada ad tageado rinde según su propia data. ***
let ddChecks = 0, ddBad = 0;
for (const id of TIDS) {
  for (const dim of DIMS) {
    const v = T(id)[dim], cell = tc(id, dim);
    const good = isEmpty(v)
      ? (dim === "angulo" ? cell.includes("Sin clasificar") : cell.includes("tag-empty"))
      : (cell.includes("pill-" + dim) && cell.includes(esc(v)));
    ddChecks++;
    if (!good) { ddBad++; if (ddBad <= 5) console.log("  ✗ tagCell(" + id + "," + dim + ") v=" + JSON.stringify(v) + " → " + cell.slice(0, 80)); }
  }
  const c = T(id).confianza, dot = call(`confDot({level:'ad',ad_id:${JSON.stringify(id)}})`);
  const dotGood = c === "alta" ? dot.includes("conf-alta") : c === "media" ? dot.includes("conf-media") : c === "baja" ? dot.includes("conf-baja") : dot === "";
  ddChecks++;
  if (!dotGood) { ddBad++; if (ddBad <= 5) console.log("  ✗ confDot(" + id + ") conf=" + c + " → " + dot); }
}
ok(ddBad === 0, `data-driven: ${ddChecks - ddBad}/${ddChecks} checks verdes sobre ${TIDS.length} ads tageados`);

// Render pipeline (vista Captación por default).
capForRender.forEach(id => ok(tbody.includes(id), "captación pick en tabla: " + id));
ok(tbody.includes(UNTAGGED), "untagged en tabla");
if (promoAd) ok(!tbody.includes(promoAd), "promo oculto de Captación"); else skip("no promo pick");
if (vacAd) ok(!tbody.includes(vacAd), "vacantes oculto"); else skip("no hay línea vacantes en la taxonomía");
ok(tbody.includes("pill pill-angulo") && tbody.includes("pill pill-nc"), "pills renderizados en tabla");
ok(tbody.includes("pill pill-none") && tbody.includes("Sin clasificar"), "Sin clasificar (untagged) en tabla");
ok(tbody.includes("tag-empty"), "tag-empty (—) en tabla");
ok(tbody.includes("conf conf-alta") || tbody.includes("conf conf-media"), "punto de confianza en tabla");

// SENTINELA "—": talento vacío NO va en pill.
if (capTalDash) {
  ok(tc(capTalDash, "talento").includes("tag-empty"), 'talento="—" → tag-empty');
  ok(!tc(capTalDash, "talento").includes("pill-talento"), 'talento="—" nunca pill');
} else skip("no hay talento='—' en la taxonomía");
if (talReal) ok(tc(talReal, "talento").includes("pill-talento"), "talento real → pill"); else skip("no hay talento real");

// angulo vacío → Sin clasificar (tagged si existe; siempre vía untagged).
if (capAngNull) ok(tc(capAngNull, "angulo").includes("Sin clasificar"), "angulo=null (tagged) → Sin clasificar"); else skip("no hay angulo=null en la taxonomía (v2)");
if (capBaja) ok(call(`confDot({level:'ad',ad_id:${JSON.stringify(capBaja)}})`).includes("conf-baja"), "confDot baja"); else skip("no hay confianza baja en la taxonomía (v2)");
ok(capAngSet && tc(capAngSet, "angulo").includes("pill-angulo"), "angulo con valor → pill");

// Invariantes (no dependen de la composición de la taxonomía).
ok(tc("ZZZ_no_existe", "angulo").includes("Sin clasificar"), "untagged angulo → Sin clasificar");
ok(tc("ZZZ_no_existe", "nc").includes("tag-empty"), "untagged nc → —");
ok(call("tagCell({level:'campaign'},'nc')").includes("tag-empty"), "rollup row → —");
ok(call("confDot({level:'ad',ad_id:'ZZZ_no_existe'})") === "", "confDot untagged → vacío");
ok(call(`lineaFor({level:'ad',ad_id:${JSON.stringify(capAngSet)}})`) === "captacion", "lineaFor tagged captación");
if (promoAd) ok(call(`lineaFor({level:'ad',ad_id:${JSON.stringify(promoAd)}})`) === "promo_inventario", "lineaFor tagged promo");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${CAP1}'})`) === "captacion", "derive captación (untagged)");
ok(call(`lineaFor({level:'ad',ad_id:'x',campaign_id:'${RECO}'})`) === "otro", "reconocimiento → otro");
ok(call(`passesLineaFilter({level:'ad',ad_id:'x',campaign_id:'${PROMOC}'})`) === false, "promo falla filtro captación");

// currentTree consistente + taxonomía cargada.
ok(call("currentTree().length") === 1, "currentTree (captación) → 1 campaña");
ok(call("currentTree()[0].children.reduce((s,as)=>s+as.children.length,0)") === expectedCapAds, `captación → ${expectedCapAds} ads`);
ok(tbody.includes("anuncios"), "total row present");
ok(call("Object.keys(taxonomy.ads).length") === TIDS.length && call("taxonomy.version") === TAX.version, `taxonomía v${TAX.version} cargada (${TIDS.length} ads)`);

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
