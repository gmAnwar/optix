// GATE del addendum: C1/C3/C4 son de VISIBILIDAD y no deben mover ningún número.
// C2 mueve una sola cosa: las 2 campañas de asesores pasan de invisibles a
// visibles bajo su propia línea, y su gasto NO entra a captación.
//
// SNAPSHOT CONGELADO: se construye UN doc en memoria y AMBOS lados corren contra
// ESE MISMO objeto. Leer prod dos veces daría diffs por el cron (2x/día) y no se
// sabría si fue el código. Criterio RELACIONAL: idéntico a sí mismo.
//
//   run:  node tests/plaza-visibility.gate.mjs <antes.html> <despues.html>
//
// Para reproducirlo desde git:
//   git show <sha-antes>:ads-analytics.html > /tmp/before.html
//   node tests/plaza-visibility.gate.mjs /tmp/before.html ads-analytics.html
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const [ANTES, DESPUES] = process.argv.slice(2);
const ROOT = path.resolve(ANTES, "..");

// ── El snapshot. Una sola definición, usada por los dos lados. ──
// Réplica del mtd de PROD (29-jul) + las 2 campañas de asesores + una sin
// clasificar + la escondida a propósito, para que el gate las vea a todas.
const CAP_GMZ = "120232281266000053";
const PROMO   = "120214624885210053";
const VAC     = "120225742406730053";
const RECO    = "120241819818390053";          // escondida A PROPÓSITO ("otro")
const CAP_MTY = "120253441913040054";
const ASE_MTY = "120254056172260054";          // asesores, cuenta Monterrey
const ASE_OLD = "120250181230340053";          // asesores, cuenta vieja
const SIN_MAP = "120299999999999999";          // ausente del mapa

const cap = (o) => ({ count: 0, trc: 0, gmz: 0, mty: 0, other: 0, ...o });
const funnel = () => ({ llamada: { count: 3, cost: 100 }, cita: { count: 2, cost: 150 }, a_espera: { count: 1, cost: 200 } });
const ad = (id, camp, spend, c, cClose) => ({
  ad_id: id, ad_name: "ad-" + id, code: id, status: "ACTIVE",
  campaign_id: camp, campaign_name: "camp-" + camp, adset_id: "as-" + id, adset_name: "adset - (BB) x",
  spend, mensajes: 10, costo_msg: 50, funnel: funnel(),
  captacion: c, captacion_first_touch: c, captacion_close: cClose || c,
  cac_captacion: 1000, cac_captacion_close: 1000, cac_captacion_first_touch: 1000,
  cac_venta: null, roas: null, ventas_ok: 0, object_type: "VIDEO",
});

const SNAPSHOT = {
  _meta: { generated_at: "2026-07-29T23:25:32Z" },
  data: {
    _meta: {
      period_from: "2026-07-01", period_to: "2026-07-29", period: "mtd",
      coverage_attribution: { close_pct: 53.8, first_pct: 84.6 },
      coverage: { plaza_distribution: { trc: 6, gmz: 16, mty: 4 } },
      constants: { comision_venta: 65000, cac_target: 4500 },
    },
    totals: {
      spend: 121221, mensajes: 200, costo_msg: 606,
      cac_blended_total: 4662, cac_paid_blended: 6380, captac_blended: 26,
      roas: null, cac_venta: null, spend_sin_captacion: 40000,
      funnel: { llamada: { count: 20, cost: 6061 }, cita: { count: 10, cost: 12122 }, a_espera: { count: 4, cost: 30305 } },
      captacion: cap({ count: 19, trc: 4, gmz: 11, mty: 4 }),
    },
    familia: [], buckets: [], cclkk: [],
    campaigns: [
      ad("AD_GMZ", CAP_GMZ, 70000, cap({ count: 11, gmz: 11 }), cap({ count: 8, gmz: 8 })),
      ad("AD_TRC", CAP_GMZ, 29770, cap({ count: 4, trc: 4 }), cap({ count: 6, trc: 6 })),
      ad("AD_MTY", CAP_MTY, 20000, cap({ count: 4, mty: 4 }), cap({ count: 0 })),
      ad("AD_PROMO", PROMO, 5000, cap({ count: 0 })),
      ad("AD_VAC", VAC, 3000, cap({ count: 0 })),
      ad("AD_RECO", RECO, 2000, cap({ count: 0 })),      // escondida a propósito
      ad("AD_ASE_MTY", ASE_MTY, 790, cap({ count: 0 })), // asesores (C2)
      ad("AD_ASE_OLD", ASE_OLD, 786, cap({ count: 0 })), // asesores (C2)
      ad("AD_SIN_MAP", SIN_MAP, 1200, cap({ count: 0 })),// sin clasificar (C3)
    ],
  },
};

// ── Runner: corre el script de una versión del HTML contra el snapshot ──
const noop = () => {};
class FakeEl {
  constructor(t) { this.tagName = t; this._html = ""; this._text = ""; this.children = []; this.style = {}; this.dataset = {}; this.classList = { add: noop, remove: noop, toggle: noop, contains: () => false }; this.className = ""; this.hidden = false; this.attributes = {}; }
  set innerHTML(v) { this._html = v == null ? "" : String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = v == null ? "" : String(v); }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); this._html = ""; return c; }
  addEventListener() {} removeEventListener() {}
  setAttribute(k, v) { this.attributes[k] = v; } getAttribute(k) { return this.attributes[k]; }
  querySelector() { return null; } querySelectorAll() { return []; } contains() { return false; } focus() {}
}

async function measure(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
  const elements = {};
  const document = {
    getElementById: (id) => elements[id] || (elements[id] = new FakeEl("div")),
    createElement: (t) => new FakeEl(t),
    querySelectorAll: () => [], querySelector: () => null, addEventListener: noop,
  };
  const TAXPATH = path.join(ROOT, "assets/ads-analytics/ads-taxonomy.json");
  const TAX = fs.existsSync(TAXPATH) ? JSON.parse(fs.readFileSync(TAXPATH, "utf8")) : { ads: {} };
  const firebase = {
    initializeApp: noop,
    auth: () => ({ onAuthStateChanged: noop }),
    firestore: () => ({ doc: (p) => ({ get: async () => (
      p.endsWith("ads-manager-v2-mtd") || p.endsWith("ads-manager-v2-since_feb")
        ? { exists: true, data: () => SNAPSHOT } : { exists: false }) }) }),
  };
  const ctx = vm.createContext({
    document, firebase, console: { log: noop, warn: noop, error: noop },
    setTimeout, clearTimeout, URLSearchParams, Promise, JSON, Math,
    fetch: async (u) => String(u).includes("taxonomy")
      ? { ok: true, status: 200, json: async () => TAX } : { ok: false, status: 404, json: async () => ({}) },
    window: { location: { search: "?client=inmobili" } },
  });
  vm.runInContext(main, ctx, { filename: path.basename(htmlPath) });
  await vm.runInContext("loadFromFirestore()", ctx);
  const call = (e) => vm.runInContext(e, ctx);

  // Suma de captaciones bajo LINEA=captacion, calculada como lo hace la página.
  // Antes de C2/C3 la línea se derivaba igual; el punto es que el agregado NO
  // cambie al mover campañas de/hacia "otro"/"sin clasificar".
  const sumCaptacUnderLinea = call(`(function(){
    var p = currentPeriod() || {}; var out = 0;
    (p.campaigns || []).forEach(function(a){
      if (typeof passesLineaFilter === "function" && !passesLineaFilter({ ...a, level: "ad" })) return;
      var c = a.captacion || {}; out += (c.count || 0);
    });
    return out;
  })()`);

  const T = call("(currentPeriod()||{}).totals || {}");
  // Gasto visible por línea (para probar la única dirección en que C2 mueve algo).
  const spendByLinea = call(`(function(){
    var p = currentPeriod() || {}; var out = {};
    (p.campaigns || []).forEach(function(a){
      var L = typeof lineaFor === "function" ? lineaFor({ ...a, level: "ad" }) : "?";
      out[L] = (out[L] || 0) + (a.spend || 0);
    });
    return out;
  })()`);
  return {
    captac_blended: T.captac_blended,
    cac_blended_total: T.cac_blended_total,
    spend: T.spend,
    captac_under_captacion: sumCaptacUnderLinea,
    header_captac: elements["ctx-captac"] ? elements["ctx-captac"].textContent : null,
    header_cac: elements["cac-big"] ? elements["cac-big"].textContent : null,
    spendByLinea,
  };
}

const a = await measure(ANTES);
const b = await measure(DESPUES);

const rows = [
  ["totals.captac_blender (leadtime)", "captac_blended", true],
  ["totals.cac_blended_total", "cac_blended_total", true],
  ["totals.spend", "spend", true],
  ["Σ captaciones bajo LINEA=captacion", "captac_under_captacion", true],
  ["header captaciones (render)", "header_captac", true],
  ["header CAC (render)", "header_cac", true],
];
let bad = 0;
console.log("=".repeat(78));
console.log("GATE — snapshot CONGELADO, mismo objeto para ambos lados");
console.log("=".repeat(78));
console.log(`${"métrica".padEnd(38)} ${"ANTES".padStart(14)} ${"DESPUÉS".padStart(14)}  ¿=?`);
console.log("-".repeat(78));
for (const [label, key] of rows) {
  const same = String(a[key]) === String(b[key]);
  if (!same) bad++;
  console.log(`${label.padEnd(38)} ${String(a[key]).padStart(14)} ${String(b[key]).padStart(14)}  ${same ? "✓" : "✗ SE MOVIÓ"}`);
}
console.log("-".repeat(78));
console.log("\nGasto visible por LÍNEA (única dirección en que C2 mueve algo):");
const keys = [...new Set([...Object.keys(a.spendByLinea), ...Object.keys(b.spendByLinea)])].sort();
console.log(`  ${"línea".padEnd(20)} ${"ANTES".padStart(10)} ${"DESPUÉS".padStart(10)}`);
for (const k of keys) {
  console.log(`  ${k.padEnd(20)} ${String(a.spendByLinea[k] ?? "—").padStart(10)} ${String(b.spendByLinea[k] ?? "—").padStart(10)}`);
}
// El gasto de asesores NO puede haber entrado a captación.
const capA = a.spendByLinea.captacion || 0, capB = b.spendByLinea.captacion || 0;
console.log(`\n  captación: ${capA} → ${capB}  ${capA === capB ? "✓ idéntico (asesores NO entró)" : "✗ SE MOVIÓ"}`);
if (capA !== capB) bad++;

console.log("\n" + "=".repeat(78));
if (bad) { console.log(`✗ ${bad} MÉTRICA(S) SE MOVIERON — PARAR`); process.exit(1); }
console.log("✓ GATE OK — ningún agregado se movió; solo cambió la visibilidad");
console.log("=".repeat(78));
