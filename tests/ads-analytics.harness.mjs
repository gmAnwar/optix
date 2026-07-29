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
// Shape del doc v2 post-Monterrey: `mty` hermana de trc/gmz + `other`.
// Invariante que el tablero asume: trc + gmz + mty + other === count.
const mkCap = (n) => ({ count: n, trc: n, gmz: 0, mty: 0, other: 0 });
// (a) plaza mty poblada.
const mkCapMty = (n) => ({ count: n, trc: 0, gmz: 0, mty: n, other: 0 });
// (b) `other` > 0 — captaciones sin plaza resuelta por el pipeline.
const mkCapOther = (plazaN, otherN) =>
  ({ count: plazaN + otherN, trc: plazaN, gmz: 0, mty: 0, other: otherN });
// Desglose que NO suma al count → bug de datos, debe verse (⚠), no silencio.
const mkCapMismatch = () => ({ count: 5, trc: 1, gmz: 1, mty: 0, other: 0 });
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
// [OPTIX-INMOBILI-FRONT-PLAZA] Campañas de la cuenta de Monterrey.
const CAP_MTY = "120253441913040054";            // OA1 Monterrey Captación → captacion
const VAC_MTY = "120254009359270054";            // OA2 Vacantes WP → vacantes
// (d) campaign_id que NO está en CAMPAIGN_LINEA → cae a "otro" → invisible.
// Es el caso real de las campañas "Asesores", dejadas fuera a propósito.
const CAMP_SIN_LINEA = "120254056172260054";     // OA3 Monterrey Asesores
// Ads de Monterrey: NINGUNO está en ads-taxonomy.json (se generó con la cuenta
// vieja), así que su línea sale solo del campaign_id.
const MTY_AD = "555000000000000010";
const MTY_AD_OTHER = "555000000000000011";
const MTY_AD_MISMATCH = "555000000000000012";
const ASESORES_AD = "555000000000000013";

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
      // (a) Monterrey — captación real en la plaza nueva.
      { ...ad(MTY_AD, CAP_MTY, "mty-captacion"),
        captacion: mkCapMty(3), captacion_close: mkCapMty(3), captacion_first_touch: mkCapMty(3) },
      // (b) other > 0 — plaza sin resolver, NO se esconde.
      { ...ad(MTY_AD_OTHER, CAP_MTY, "mty-other"),
        captacion: mkCapOther(1, 2), captacion_close: mkCapOther(1, 2), captacion_first_touch: mkCapOther(1, 2) },
      // desglose que no cuadra → marcador ⚠ visible.
      { ...ad(MTY_AD_MISMATCH, CAP_MTY, "mty-mismatch"),
        captacion: mkCapMismatch(), captacion_close: mkCapMismatch(), captacion_first_touch: mkCapMismatch() },
      // (d) campaña fuera de CAMPAIGN_LINEA.
      ad(ASESORES_AD, CAMP_SIN_LINEA, "asesores-sin-linea"),
    ],
  },
};

// (c) Periodo con leadtime_total > 0 pero suma per-ad === 0: la atribución
// colapsó. Réplica del 14d real medido el 29-jul (9 captaciones, 0/29 ads).
const ZERO = () => ({ count: 0, trc: 0, gmz: 0, mty: 0, other: 0 });
const adZero = (id, camp, name) => ({
  ...ad(id, camp, name),
  captacion: ZERO(), captacion_close: ZERO(), captacion_first_touch: ZERO(),
  cac_captacion: null, cac_captacion_close: null, cac_captacion_first_touch: null,
});
const FIXTURE_14D = {
  _meta: { generated_at: "2026-07-29T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-07-16", period_to: "2026-07-29", lag_warning: true,
             coverage_attribution: { close_pct: 0, first_pct: 0 } },
    // captac_blended = 9 → captaciones REALES; el header no se degrada nunca.
    totals: { spend: 45301, mensajes: 60, costo_msg: 755, cac_blended_total: 5033,
              cac_paid_blended: null, roas: null, captac_blended: 9, cac_venta: null,
              spend_sin_captacion: 45301,
              funnel: { llamada: { count: 6, conv_pct: 10, cost: 7550 }, cita: { count: 2, cost: 22650 }, a_espera: { count: 0, cost: null } },
              captacion: ZERO(), captacion_close: ZERO(), captacion_first_touch: ZERO() },
    familia: [], buckets: [], cclkk: [],
    campaigns: [adZero(capAlta, CAP1, "cap-alta-14d"), adZero(MTY_AD, CAP_MTY, "mty-14d")],
  },
};
// Periodo con leadtime_total === 0: ceros HONESTOS, no se degrada nada.
const FIXTURE_3D = {
  _meta: { generated_at: "2026-07-29T10:00:00Z" },
  data: {
    _meta: { period_from: "2026-07-27", period_to: "2026-07-29", lag_warning: true, coverage_attribution: {} },
    totals: { spend: 11958, captac_blended: 0, cac_blended_total: null,
              funnel: { llamada: { count: 0 }, cita: { count: 0 }, a_espera: { count: 0 } },
              captacion: ZERO(), captacion_close: ZERO(), captacion_first_touch: ZERO() },
    familia: [], buckets: [], cclkk: [],
    campaigns: [adZero(capAlta, CAP1, "cap-alta-3d")],
  },
};
const DOCS_BY_PATH = { since_feb: FIXTURE, "14d": FIXTURE_14D, "3d": FIXTURE_3D };

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
  firestore: () => ({ doc: (p) => ({ get: async () => {
    const hit = Object.keys(DOCS_BY_PATH).find(k => p.endsWith("ads-manager-v2-" + k));
    return hit ? { exists: true, data: () => DOCS_BY_PATH[hit] } : { exists: false };
  } }) }),
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
// Post-Monterrey la vista Captación abarca DOS campañas: la de Gómez (CAP1) y
// la de Monterrey (CAP_MTY). Antes de mapear CAP_MTY en CAMPAIGN_LINEA, la de
// Monterrey caía a "otro" y la vista mostraba 1 sola — ese era el bloqueante.
ok(call("currentTree().length") === 2, "currentTree (captación) → 2 campañas (Gómez + Monterrey)");
ok(call("currentTree().reduce((s,c)=>s+c.children.reduce((t,as)=>t+as.children.length,0),0)") === 9,
   "captación → 9 ads (6 de Gómez + 3 de Monterrey)");
ok(call(`currentTree().some(c => c.campaign_id === "${CAP_MTY}")`),
   "la campaña de Monterrey está en el árbol de Captación");
ok(tbody.includes("anuncios"), "total row present");
ok(call("Object.keys(taxonomy.ads).length") === TIDS.length, `taxonomía cargada (${TIDS.length} ads)`);

// ══════════════════════════════════════════════════════════════════════════
// [OPTIX-INMOBILI-FRONT-PLAZA] Tercera plaza + honestidad en ventanas cortas
// ══════════════════════════════════════════════════════════════════════════

// ── PLAZAS como única fuente de verdad ──
ok(call("PLAZA_KEYS.join(',')") === "trc,gmz,mty", "PLAZAS trae las 3 oficinas");
ok(call("PLAZAS.mty") === "Monterrey", "PLAZAS.mty = Monterrey");
// Segmentos del filtro derivados, no hardcodeados: 'Todas' + una por plaza.
call("buildPlazaSegments()");
const seg = serialize(elements["plaza-seg"]);
ok(seg.includes('data-plaza="mty"') && seg.includes("Monterrey"), "segmento Monterrey construido desde PLAZAS");
ok(PLAZA_SEG_COUNT() === 4, "segmentos = Todas + 3 plazas");
function PLAZA_SEG_COUNT() { return (seg.match(/data-plaza=/g) || []).length; }
// Header de Capa 4 derivado.
call("buildCapa4Header()");
const c4h = serialize(elements["cclkk-head"]);
ok(c4h.includes("MON") || c4h.includes("Monterrey"), "columna de Monterrey en Capa 4");

// ── (a) plaza mty se ve y el desglose suma al count ──
ok(tbody.includes(MTY_AD), "(a) ad de Monterrey visible en vista Captación");
const bdMty = call(`plazaBreakdownHtml(calcRow(${JSON.stringify({ level: "ad", captacion_close: { count: 3, trc: 0, gmz: 0, mty: 3, other: 0 } })}))`);
ok(bdMty.includes("M3"), "(a) desglose muestra M3 para Monterrey");
ok(!bdMty.includes("plaza-mismatch"), "(a) desglose que cuadra → sin marcador ⚠");
ok(!bdMty.includes("T0·G0<"), "(a) ya NO pinta solo T·G");

// ── (b) other > 0 se muestra, no se esconde ──
const bdOther = call(`plazaBreakdownHtml(calcRow(${JSON.stringify({ level: "ad", captacion_close: { count: 3, trc: 1, gmz: 0, mty: 0, other: 2 } })}))`);
ok(bdOther.includes("?2"), "(b) other>0 se muestra como segmento '?2'");
ok(!bdOther.includes("plaza-mismatch"), "(b) plazas + other == count → sin ⚠");

// ── desglose que NO cuadra → visible, nunca silencio ni throw ──
const bdBad = call(`plazaBreakdownHtml(calcRow(${JSON.stringify({ level: "ad", captacion_close: { count: 5, trc: 1, gmz: 1, mty: 0, other: 0 } })}))`);
ok(bdBad.includes("plaza-mismatch") && bdBad.includes("⚠"), "desglose≠count → marcador ⚠ visible");
ok(bdBad.includes("title="), "desglose≠count → tooltip explicando");
ok(tbody.includes("plaza-mismatch"), "el ad con desglose roto renderiza el marcador en la tabla");

// ── filtro de plaza: lookup por llave + cláusula load-bearing ──
const adMtyRow = { level: "ad", ad_id: MTY_AD, campaign_id: CAP_MTY, captacion_close: { count: 3, trc: 0, gmz: 0, mty: 3, other: 0 } };
const adTrcRow = { level: "ad", ad_id: "x", campaign_id: CAP1, captacion_close: { count: 2, trc: 2, gmz: 0, mty: 0, other: 0 } };
const adZeroRow = { level: "ad", ad_id: "z", campaign_id: CAP1, captacion_close: { count: 0, trc: 0, gmz: 0, mty: 0, other: 0 } };
const withPlaza = (pf, row) => { call(`plazaFilter = ${JSON.stringify(pf)}`); return call(`passesPlazaFilter(${JSON.stringify(row)})`); };
ok(withPlaza("mty", adMtyRow) === true,  "filtro mty deja pasar ad de Monterrey");
ok(withPlaza("mty", adTrcRow) === false, "filtro mty NO deja pasar ad de Torreón");
ok(withPlaza("trc", adTrcRow) === true,  "filtro trc sigue funcionando");
ok(withPlaza("trc", adMtyRow) === false, "filtro trc NO deja pasar ad de Monterrey");
ok(withPlaza("all", adMtyRow) === true,  "filtro all deja pasar todo");
// *** LOAD-BEARING: sin esta cláusula la tabla queda vacía en ventanas cortas. ***
ok(withPlaza("mty", adZeroRow) === true, "LOAD-BEARING: ad con captac=0 visible con filtro mty");
ok(withPlaza("trc", adZeroRow) === true, "LOAD-BEARING: ad con captac=0 visible con filtro trc");
call('plazaFilter = "all"');

// ── (d) campaign_id fuera de CAMPAIGN_LINEA → "otro" → invisible ──
ok(call(`lineaFor({level:'ad',ad_id:'${ASESORES_AD}',campaign_id:'${CAMP_SIN_LINEA}'})`) === "otro",
   "(d) campaña sin entrada en CAMPAIGN_LINEA → otro");
ok(!tbody.includes(ASESORES_AD), "(d) ad de campaña sin línea NO aparece en Captación");
// El fix del bloqueante: Monterrey Captación SÍ está mapeada.
ok(call(`lineaFor({level:'ad',ad_id:'nuevo',campaign_id:'${CAP_MTY}'})`) === "captacion",
   "CAMBIO 0: campaña de captación de Monterrey mapeada a captacion");
ok(call(`lineaFor({level:'ad',ad_id:'nuevo',campaign_id:'${VAC_MTY}'})`) === "vacantes",
   "CAMBIO 0: campaña de vacantes de Monterrey mapeada a vacantes");
// Sin tag en la taxonomía → pill rojo "Sin clasificar". Correcto y honesto.
ok(tc(MTY_AD, "angulo").includes("Sin clasificar"), "ad de Monterrey sin tag → 'Sin clasificar'");

// ── (c) colapso de atribución DERIVADO DEL DATO ──
// since_feb: hay atribución per-ad → NO degradado.
ok(call("attributionCollapsed()") === false, "(c) since_feb tiene atribución → no degradado");
// 14d: leadtime 9 > 0 y suma per-ad 0 → degradado.
await vm.runInContext('switchPeriod("14d")', ctx);
ok(call("period") === "14d", "(c) switch a 14d");
ok(call("perAdCaptacSum(currentPeriod())") === 0, "(c) 14d suma per-ad = 0");
ok(call("(currentPeriod().totals||{}).captac_blended") === 9, "(c) 14d leadtime_total = 9 (real)");
ok(call("attributionCollapsed()") === true, "(c) 14d → atribución colapsada");
const tbody14 = serialize(elements["tbody"]);
ok(tbody14.includes("sin datos suf."), "(c) 14d: celdas per-ad en gris 'sin datos suf.'");
ok(tbody14.includes("nodata"), "(c) 14d: clase .nodata aplicada");
ok(!tbody14.includes("plaza-mismatch"), "(c) 14d: sin falsos ⚠ de desglose");
// EL HEADER NO SE TOCA: captac_blended sigue siendo el número real.
ok(elements["ctx-captac"].textContent === "9", "(c) header captaciones = 9 INTACTO (dato real)");
ok(elements["cac-big"].textContent === "$5,033", "(c) header CAC intacto en ventana degradada");
ok(String(elements["lag-banner"].textContent).includes("ninguna captación pudo asignarse"),
   "(c) banner describe lo observable");
ok(!String(elements["lag-banner"].textContent).includes("semanas"),
   "banner ya NO afirma 'semanas de lag' (era falso: 2-12 días medidos)");
ok(!String(elements["lag-banner"].textContent).includes("Jenny"),
   "banner sin mecanismo (no nombra el origen del dato)");
// 3d: leadtime_total === 0 → ceros honestos, NO se degrada.
await vm.runInContext('switchPeriod("3d")', ctx);
ok(call("(currentPeriod().totals||{}).captac_blended") === 0, "3d leadtime_total = 0");
ok(call("attributionCollapsed()") === false, "leadtime_total=0 → NO degradado (ceros honestos)");
ok(!serialize(elements["tbody"]).includes("sin datos suf."), "3d: sin gris (nada que degradar)");
// El badge del menú usa la MISMA regla → nunca contradice a la tabla.
ok(call('attributionCollapsedFor((docsByPeriod["14d"]||{}).data)') === true, "badge 14d = degradado");
ok(call('attributionCollapsedFor((docsByPeriod["3d"]||{}).data)') === false, "badge 3d = limpio");
ok(call('attributionCollapsedFor(docsByPeriod["no_cargado"])') === false,
   "periodo sin doc cargado → sin badge (no afirmamos lo que no leímos)");
await vm.runInContext('switchPeriod("since_feb")', ctx);

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
