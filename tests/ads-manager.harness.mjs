// Offline harness para ads-manager.html — superficie de PLAZA + honestidad.
// [OPTIX-INMOBILI-FRONT-PLAZA]
//
// Por qué existe: ads-manager.html y ads-analytics.html son gemelos copy-paste.
// La misma lógica de plaza vive en los dos, incluida la cláusula LOAD-BEARING
// del filtro (`|| captac === 0`) que es lo único que evita una tabla vacía en
// ventanas cortas. Sin este archivo, una regresión en el gemelo pasa muda.
//
// No re-testea todo el tablero: solo lo que este PR toca.
//   run:  node tests/ads-manager.harness.mjs
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "ads-manager.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mainScript = blocks[blocks.length - 1];

const CAP1 = "120232281266000053";
const CAP_MTY = "120253441913040054";

// Shape del doc v2 post-Monterrey.
const cap = (o) => ({ count: 0, trc: 0, gmz: 0, mty: 0, other: 0, ...o });
const mkFunnel = () => ({ llamada: { count: 3, conv_pct: 40, cost: 100 }, cita: { count: 2, conv_pct: 30, cost: 150 }, a_espera: { count: 1, conv_pct: 20, cost: 200 } });
const ad = (ad_id, campaign_id, name, c) => ({
  ad_id, ad_name: name, code: name, status: "ACTIVE",
  campaign_id, campaign_name: "camp-" + campaign_id, adset_id: "as-" + ad_id, adset_name: "adset",
  spend: 5000, mensajes: 20, costo_msg: 250, funnel: mkFunnel(),
  captacion: c, captacion_close: c, captacion_first_touch: c,
  cac_captacion: 5000, cac_captacion_close: 5000, cac_captacion_first_touch: 5000,
  cac_venta: null, roas: null, ventas_ok: 0, object_type: "VIDEO",
});

const FIXTURE = {
  _meta: { generated_at: "2026-07-20T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-02-01", period_to: "2026-07-20", coverage_attribution: { close_pct: 80, first_pct: 60 } },
    totals: { spend: 40000, mensajes: 160, costo_msg: 250, cac_blended_total: 5000, cac_paid_blended: 5000,
              roas: 1.2, captac_blended: 8, cac_venta: 65000, spend_sin_captacion: 0,
              funnel: { llamada: { count: 24, conv_pct: 40, cost: 100 }, cita: { count: 16, cost: 150 }, a_espera: { count: 8, cost: 200 } },
              captacion: cap({ count: 8, trc: 5, gmz: 0, mty: 3 }) },
    familia: [{ letter: "MA", captac: 2, trc: 0, gmz: 0, mty: 2, overlap: 1, none_active: 1 }],
    buckets: [], cclkk: [{ code: "CC1", name: "x", adset_id: "as1", captac: 3, trc: 1, gmz: 0, mty: 2, spend: 900 }],
    campaigns: [
      ad("AD_TRC", CAP1, "trc-ad", cap({ count: 2, trc: 2 })),
      ad("AD_MTY", CAP_MTY, "mty-ad", cap({ count: 3, mty: 3 })),
      ad("AD_OTHER", CAP_MTY, "other-ad", cap({ count: 3, trc: 1, other: 2 })),
      ad("AD_BAD", CAP_MTY, "mismatch-ad", cap({ count: 5, trc: 1, gmz: 1 })),
      ad("AD_ZERO", CAP1, "zero-ad", cap({ count: 0 })),
    ],
  },
};
// mtd: réplica del PROD del 29-jul. Monterrey resuelve en ENGANCHE pero da 0 en
// CIERRE (nomenclatura de sus ads). `plaza_distribution` = conteo REAL de filas de
// Leadtime por plaza → es el denominador que permite degradar por plaza.
const FIXTURE_MTD = {
  _meta: { generated_at: "2026-07-29T23:25:32Z" },
  data: {
    _meta: { period_from: "2026-07-01", period_to: "2026-07-29",
             coverage_attribution: { close_pct: 53.8, first_pct: 84.6 },
             coverage: { plaza_distribution: { trc: 6, gmz: 16, mty: 4 } } },
    totals: { spend: 121221, mensajes: 200, costo_msg: 606, cac_blended_total: 4662,
              captac_blended: 26, cac_paid_blended: 6380, roas: null, cac_venta: null,
              spend_sin_captacion: 40000,
              funnel: { llamada: { count: 20, cost: 6061 }, cita: { count: 10, cost: 12122 }, a_espera: { count: 4, cost: 30305 } },
              captacion: cap({ count: 19, trc: 4, gmz: 11, mty: 4 }) },
    familia: [], buckets: [], cclkk: [],
    campaigns: [
      { ...ad("AD_GMZ_MTD", CAP1, "gmz-mtd", cap({ count: 11, gmz: 11 })),
        captacion_close: cap({ count: 8, gmz: 8 }), captacion_first_touch: cap({ count: 11, gmz: 11 }) },
      { ...ad("AD_TRC_MTD", CAP1, "trc-mtd", cap({ count: 4, trc: 4 })),
        captacion_close: cap({ count: 6, trc: 6 }), captacion_first_touch: cap({ count: 4, trc: 4 }) },
      // Monterrey: Enganche 4, CIERRE 0 ← el caso real.
      { ...ad("AD_MTY_MTD", CAP_MTY, "mty-mtd", cap({ count: 4, mty: 4 })),
        captacion_close: cap({ count: 0 }), captacion_first_touch: cap({ count: 4, mty: 4 }) },
    ],
  },
};

// Ventana donde la atribución per-ad colapsó (14d real del 29-jul).
const FIXTURE_14D = {
  _meta: { generated_at: "2026-07-29T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-07-16", period_to: "2026-07-29", lag_warning: true,
             coverage_attribution: { close_pct: 0, first_pct: 0 },
             coverage: { plaza_distribution: { trc: 2, gmz: 7, mty: 3 } } },
    totals: { spend: 45301, mensajes: 60, costo_msg: 755, cac_blended_total: 5033, captac_blended: 9,
              cac_paid_blended: null, roas: null, cac_venta: null, spend_sin_captacion: 45301,
              funnel: { llamada: { count: 6, cost: 7550 }, cita: { count: 2, cost: 22650 }, a_espera: { count: 0, cost: null } },
              captacion: cap({}) },
    familia: [], buckets: [], cclkk: [],
    campaigns: [ad("AD_TRC", CAP1, "trc-14d", cap({})), ad("AD_MTY", CAP_MTY, "mty-14d", cap({}))],
  },
};
const DOCS = { since_feb: FIXTURE, "14d": FIXTURE_14D, mtd: FIXTURE_MTD };

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
  auth: () => ({ onAuthStateChanged: (cb) => { firebase._authCb = cb; } }),
  firestore: () => ({ doc: (p) => ({ get: async () => {
    const hit = Object.keys(DOCS).find(k => p.endsWith("ads-manager-v2-" + k));
    return hit ? { exists: true, data: () => DOCS[hit] } : { exists: false };
  } }) }),
};

const sandbox = { document, firebase, console, setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math,
                  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
                  window: { location: { search: "?client=inmobili" } } };
const ctx = vm.createContext(sandbox);
vm.runInContext(mainScript, ctx, { filename: "ads-manager.inline.js" });
await vm.runInContext("loadFromFirestore()", ctx);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("  ✗ FAIL:", msg); } };
const call = (expr) => vm.runInContext(expr, ctx);
const tbody = serialize(elements["tbody"]);

// ── PLAZAS: única fuente de verdad, y en paridad con el gemelo ──
ok(call("PLAZA_KEYS.join(',')") === "trc,gmz,mty", "PLAZAS trae las 3 oficinas");
ok(call("PLAZAS.mty") === "Monterrey", "PLAZAS.mty = Monterrey");
call("buildPlazaSegments()");
const seg = serialize(elements["plaza-seg"]);
ok((seg.match(/data-plaza=/g) || []).length === 4, "segmentos = Todas + 3 plazas (derivados)");
ok(seg.includes('data-plaza="mty"'), "segmento Monterrey presente");
call("buildCapa4Header()");
ok(serialize(elements["cclkk-head"]).includes("MON"), "columna Monterrey en header de Capa 4");

// ── Desglose por plaza ──
const bd = (c) => call(`plazaBreakdownHtml(calcRow(${JSON.stringify({ level: "ad", captacion_close: c })}))`);
ok(bd(cap({ count: 3, mty: 3 })).includes("M3"), "desglose muestra M3");
ok(bd(cap({ count: 3, trc: 1, other: 2 })).includes("?2"), "other>0 visible como '?2'");
ok(!bd(cap({ count: 3, trc: 1, other: 2 })).includes("plaza-mismatch"), "plazas+other==count → sin ⚠");
ok(bd(cap({ count: 5, trc: 1, gmz: 1 })).includes("⚠"), "desglose≠count → ⚠ visible");
ok(tbody.includes("plaza-mismatch"), "el ad con desglose roto lo muestra en la tabla");
ok(tbody.includes("AD_MTY"), "ad de Monterrey visible");

// ── Filtro de plaza + cláusula LOAD-BEARING ──
const row = (id, c) => ({ level: "ad", ad_id: id, campaign_id: CAP1, captacion_close: c });
const withPlaza = (pf, r) => { call(`plazaFilter = ${JSON.stringify(pf)}`); return call(`passesPlazaFilter(${JSON.stringify(r)})`); };
ok(withPlaza("mty", row("a", cap({ count: 3, mty: 3 }))) === true,  "filtro mty pasa ad de Monterrey");
ok(withPlaza("mty", row("b", cap({ count: 2, trc: 2 }))) === false, "filtro mty bloquea ad de Torreón");
ok(withPlaza("trc", row("b", cap({ count: 2, trc: 2 }))) === true,  "filtro trc sigue funcionando");
ok(withPlaza("gmz", row("c", cap({ count: 2, gmz: 2 }))) === true,  "filtro gmz sigue funcionando");
ok(withPlaza("all", row("a", cap({ count: 3, mty: 3 }))) === true,  "filtro all pasa todo");
// *** LOAD-BEARING *** — sin esto la tabla queda VACÍA en ventanas cortas.
ok(withPlaza("mty", row("z", cap({ count: 0 }))) === true, "LOAD-BEARING: captac=0 visible con filtro mty");
ok(withPlaza("trc", row("z", cap({ count: 0 }))) === true, "LOAD-BEARING: captac=0 visible con filtro trc");
call('plazaFilter = "all"');

// ── Colapso de atribución derivado del dato ──
ok(call("attributionCollapsed()") === false, "since_feb con atribución → no degradado");
await vm.runInContext('switchPeriod("14d")', ctx);
ok(call("attributionCollapsed()") === true, "14d (leadtime 9, per-ad 0) → degradado");
const tbody14 = serialize(elements["tbody"]);
ok(tbody14.includes("sin datos suf."), "14d: celdas per-ad en gris");
ok(elements["ctx-captac"].textContent === "9", "14d: header captaciones = 9 INTACTO");
ok(elements["cac-big"].textContent === "$5,033", "14d: header CAC intacto");
ok(String(elements["lag-banner"].textContent).includes("ninguna captación pudo asignarse"), "banner describe lo observable");
ok(!String(elements["lag-banner"].textContent).includes("semanas"), "banner sin 'semanas de lag' (era falso)");
ok(!String(elements["lag-banner"].textContent).includes("Jenny"), "banner sin mecanismo");
// leadtime_total = 0 → ceros honestos, nada que degradar.
ok(call("attributionCollapsedFor({totals:{captac_blended:0},campaigns:[]})") === false,
   "leadtime_total=0 → NO degradado");
ok(call("attributionCollapsedFor(undefined)") === false, "doc ausente → sin badge");

// ── Paridad con el gemelo: la lógica compartida NO debe divergir ──
const analytics = fs.readFileSync(path.join(ROOT, "ads-analytics.html"), "utf8");
const shared = [
  "const PLAZAS = { trc: \"Torreón\", gmz: \"Gómez\", mty: \"Monterrey\" };",
  "if (c.captac === 0) return true;              // ← load-bearing, ver arriba",
  "return (c.captac_plaza[plazaFilter] || 0) > 0;",
  "function attributionCollapsedFor(p) {",
  "function realCaptacForSubset(p) {",
  "  const field = plazaFilter === \"all\" ? \"count\" : plazaFilter;",
  "const NODATA_TIP = \"Ninguna captación de esta vista pudo asignarse a un anuncio. \"",
];
shared.forEach(frag => ok(analytics.includes(frag) && html.includes(frag),
  "paridad gemelos: " + frag.slice(0, 46).trim()));

// ── C4: estado degradado sobre el SUBCONJUNTO (periodo + plaza + eje) ──
await vm.runInContext('switchPeriod("mtd")', ctx);
const setView = (plaza, eje) => {
  call(`plazaFilter = ${JSON.stringify(plaza)}`);
  call(`attribution = ${JSON.stringify(eje)}`);
  call("render()");
};
setView("all", "close");
ok(call("attributionCollapsed()") === false, "mtd/all/cierre: NO degrada");
// (iv) el caso real: Monterrey + Cierre.
setView("mty", "close");
ok(call("perAdCaptacSum(currentPeriod())") === 0, "(iv) mty/cierre: suma per-ad = 0");
ok(call("realCaptacForSubset(currentPeriod())") === 4, "(iv) mty/cierre: denominador real = 4");
ok(call("attributionCollapsed()") === true, "(iv) mty/cierre → DEGRADA");
ok(serialize(elements["tbody"]).includes("sin datos suf."), "(iv) mty/cierre: celdas en gris");
ok(elements["ctx-captac"].textContent === "26", "(iv) header captaciones INTACTO");
ok(elements["cac-big"].textContent === "$4,662", "(iv) header CAC INTACTO");
setView("mty", "first");
ok(call("attributionCollapsed()") === false, "mty/enganche → NO degrada");
// (v) sin denominador confiable → NO degrada.
await vm.runInContext('switchPeriod("since_feb")', ctx);
setView("mty", "close");
ok(call("realCaptacForSubset(currentPeriod())") === null, "(v) sin plaza_distribution → null");
ok(call("attributionCollapsed()") === false, "(v) sin denominador → NO degrada");
await vm.runInContext('switchPeriod("mtd")', ctx);
setView("zzz", "close");
ok(call("attributionCollapsed()") === false, "(v) plaza desconocida → NO degrada");
setView("all", "close");
ok(!call("NODATA_TIP").includes("ventana más larga"), "mensaje sin causa afirmada");

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
