// ═══════════════════════════════════════════════════════════════════════════
// HARNESS node determinista — Promoción Inventario Inmobili [OPTIX-S97-PROMO-V7]
//
// Prueba las funciones PURAS de modules/promocion-inmobili.js (derivarCubeta,
// mergeItems, formateadores). Sin browser, sin red, sin Firebase: fixtures
// sintéticas que espejan el shape real del KV promocion-v1.
//
// Correr:  node tests/promocion-inmobili.harness.mjs
// Exit 0 = todos PASS · exit 1 = algún FAIL (imprime cuál).
// ═══════════════════════════════════════════════════════════════════════════
import {
  derivarCubeta, derivarFalta, mergeItems, contarCubetas, docIdDe, copyLleno,
  fmtPrecio, fmtFecha, fmtDias, fmtHace, diasDesde, aDate, plazaLabel,
  promesaDot, adsManagerUrl, enRango, exportWhatsApp, ADS_ACCOUNT,
  restaurarCampos,
} from '../modules/promocion-inmobili.js';

let pass = 0;
let fail = 0;
const resultados = [];

function caso(nombre, cond, detalle) {
  if (cond) { pass += 1; resultados.push(`PASS ${nombre}`); }
  else { fail += 1; resultados.push(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

// Fixture base: property del KV con el shape real de promocion-v1.
function prop(overrides = {}) {
  return {
    id: 554, office: 'gomez', propiedad: 'Ampl. Zaragoza Sur',
    ciudad: 'Torreón, Coah.', precio: 670000, f_captacion: '2026-06-09',
    plazo: 60, estado: 'activa', obs_raw: 'SIN CERRAR',
    material: false, link_drive: null, copy: null, subida: false,
    fuente_venta: null, missing_from_sheet: false,
    timeline: {
      first_seen: '2026-07-03T22:08:42+00:00', material_at: null, copy_at: null,
      listo_at: null, subida_at: null, cerrada_at: null,
    },
    ...overrides,
  };
}

const HOY = new Date('2026-07-07T12:00:00');

// ── derivarCubeta: los 12 casos del SPEC ──────────────────────────────────

caso('activa sin nada → esperando',
  derivarCubeta(prop(), null) === 'esperando');

caso('activa+material sin copy → esperando',
  derivarCubeta(prop({ material: true }), null) === 'esperando');

caso('activa+material sin copy → falta Copy',
  derivarFalta(prop({ material: true })) === 'Copy');

caso('activa+material+copy → lista',
  derivarCubeta(prop({ material: true, copy: 'Casa lista' }), null) === 'lista');

caso('lista+subida → activas',
  derivarCubeta(prop({ material: true, copy: 'Casa lista' }), { subida: true, apagada: false }) === 'activas');

caso('subida + estado vendida → apagar',
  derivarCubeta(prop({ estado: 'vendida', obs_raw: 'OK' }), { subida: true, apagada: false }) === 'apagar');

caso('subida + estado descartada → apagar',
  derivarCubeta(prop({ estado: 'descartada', obs_raw: 'Sale del inventario' }), { subida: true, apagada: false }) === 'apagar');

caso('apagada → apagadas (gana sobre todo)',
  derivarCubeta(prop({ estado: 'vendida' }), { subida: true, apagada: true }) === 'apagadas');

caso('vendida sin subida → null (histórica, no aparece)',
  derivarCubeta(prop({ estado: 'vendida' }), null) === null);

caso('descartada sin subida → null',
  derivarCubeta(prop({ estado: 'descartada' }), null) === null);

caso('revertir: subida false de vuelta → lista',
  derivarCubeta(prop({ material: true, copy: 'Casa lista' }), { subida: false, subida_at: null, apagada: false }) === 'lista');

caso('fs null usa placeholders del KV (subida=false)',
  derivarCubeta(prop({ material: true, copy: 'C' }), null) === 'lista');

caso('missing_from_sheet no altera la cubeta',
  derivarCubeta(prop({ missing_from_sheet: true, material: true, copy: 'C' }), null) === 'lista'
  && derivarCubeta(prop({ missing_from_sheet: true, estado: 'vendida' }), { subida: true, apagada: false }) === 'apagar');

// Extras de borde del clasificador de cubetas.
caso('copy solo espacios NO cuenta como lleno → esperando',
  derivarCubeta(prop({ material: true, copy: '   ' }), null) === 'esperando');

caso('apagada gana aunque estado activa',
  derivarCubeta(prop(), { subida: true, apagada: true }) === 'apagadas');

caso('derivarFalta: ambos',
  derivarFalta(prop()) === 'Material + Copy');

caso('derivarFalta: solo Material',
  derivarFalta(prop({ copy: 'Hay copy' })) === 'Material');

caso('derivarFalta: nada falta → null',
  derivarFalta(prop({ material: true, copy: 'C' })) === null);

// ── merge: Firestore SIEMPRE gana sobre placeholders del KV ───────────────

{
  const kvProps = [
    prop({ id: 1, material: true, copy: 'C' }),                       // sin doc FS
    prop({ id: 2, material: true, copy: 'C', subida: true,           // KV con basura
           fuente_venta: 'pauta', timeline: { ...prop().timeline, subida_at: '2026-01-01' } }),
    prop({ id: 3, estado: 'vendida' }),
  ];
  const fsMap = new Map([
    ['gomez_2', { subida: false, subida_at: null, fuente_venta: null, adset_id: 'AD123' }],
    ['gomez_3', { subida: true, apagada: true, apagada_at: '2026-07-01', fuente_venta: 'organico' }],
  ]);
  const items = mergeItems(kvProps, fsMap);
  const by = Object.fromEntries(items.map((x) => [x.p.id, x]));

  caso('docId formato office_id', docIdDe(kvProps[0]) === 'gomez_1');
  caso('merge: sin doc FS → subida false (placeholder)', by[1].subida === false && by[1].cubeta === 'lista');
  caso('merge: FS gana sobre KV para subida (KV=true, FS=false)', by[2].subida === false, `subida=${by[2].subida}`);
  caso('merge: FS gana para fuente_venta (KV=pauta, FS=null)', by[2].fuente_venta === null);
  caso('merge: FS gana para subida_at (KV=2026-01-01, FS=null)', by[2].subida_at === null);
  caso('merge: adset_id llega del FS', by[2].adset_id === 'AD123');
  caso('merge: apagada del FS → cubeta apagadas', by[3].cubeta === 'apagadas' && by[3].fuente_venta === 'organico');

  const counts = contarCubetas(items);
  caso('contarCubetas: lista=2, apagadas=1, todas=3',
    counts.lista === 2 && counts.apagadas === 1 && counts.todas === 3,
    JSON.stringify(counts));
}

// ── Formateadores ──────────────────────────────────────────────────────────

caso('fmtPrecio 670000 → $670K', fmtPrecio(670000) === '$670K', fmtPrecio(670000));
caso('fmtPrecio 2600000 → $2.6M', fmtPrecio(2600000) === '$2.6M', fmtPrecio(2600000));
caso('fmtPrecio 1100000 → $1.1M', fmtPrecio(1100000) === '$1.1M', fmtPrecio(1100000));
caso('fmtPrecio 890000 → $890K', fmtPrecio(890000) === '$890K', fmtPrecio(890000));
caso('fmtPrecio 12000000 → $12M', fmtPrecio(12000000) === '$12M', fmtPrecio(12000000));
caso('fmtPrecio null → vacío', fmtPrecio(null) === '');
caso('fmtPrecio 500 → $500', fmtPrecio(500) === '$500');

caso('fmtFecha ISO date-only mismo año → "9 jun"', fmtFecha('2026-06-09', HOY) === '9 jun', fmtFecha('2026-06-09', HOY));
caso('fmtFecha año distinto → "1 ago 23"', fmtFecha('2023-08-01', HOY) === '1 ago 23', fmtFecha('2023-08-01', HOY));
caso('fmtFecha null → —', fmtFecha(null, HOY) === '—');
caso('fmtFecha Timestamp-like (toDate)', fmtFecha({ toDate: () => new Date('2026-07-01T10:00:00') }, HOY) === '1 jul');

caso('diasDesde f_captacion 2026-06-09 al 2026-07-07 = 28', diasDesde('2026-06-09', HOY) === 28, String(diasDesde('2026-06-09', HOY)));
caso('diasDesde null → null', diasDesde(null, HOY) === null);
caso('fmtDias null → —', fmtDias(null) === '—');
caso('fmtDias 3 → "3 d"', fmtDias(3) === '3 d');

caso('fmtHace 2h', fmtHace(new Date(HOY.getTime() - 2 * 3600e3), HOY) === 'hace 2 h');
caso('fmtHace 35min', fmtHace(new Date(HOY.getTime() - 35 * 60e3), HOY) === 'hace 35 min');
caso('fmtHace 3d', fmtHace(new Date(HOY.getTime() - 72 * 3600e3), HOY) === 'hace 3 d');

caso('plazaLabel gomez → Gómez Palacio', plazaLabel('gomez') === 'Gómez Palacio');
caso('plazaLabel torreon → Torreón', plazaLabel('torreon') === 'Torreón');
caso('plazaLabel desconocido → passthrough', plazaLabel('mty') === 'mty');

caso('promesaDot edad>plazo → red', promesaDot(61, 60) === 'red');
caso('promesaDot edad>0.8*plazo → amber', promesaDot(49, 60) === 'amber');
caso('promesaDot edad ok → null', promesaDot(10, 60) === null);
caso('promesaDot plazo null → null', promesaDot(10, null) === null);

caso('adsManagerUrl con adset (act numérico sin prefijo)',
  adsManagerUrl('120241353924300053') ===
  'https://adsmanager.facebook.com/adsmanager/manage/adsets?act=936995767352512&selected_adset_ids=120241353924300053',
  adsManagerUrl('120241353924300053'));
caso('adsManagerUrl sin adset → solo cuenta', adsManagerUrl(null).endsWith('?act=936995767352512'));
caso('ADS_ACCOUNT es el de Inmobili', ADS_ACCOUNT === 'act_936995767352512');

// ── enRango (temporalidad de Apagadas) ─────────────────────────────────────

caso('enRango este-mes: 1-jul sí', enRango('2026-07-01', 'este-mes', HOY) === true);
caso('enRango este-mes: 30-jun no', enRango('2026-06-30', 'este-mes', HOY) === false);
caso('enRango mes-pasado: 15-jun sí', enRango('2026-06-15', 'mes-pasado', HOY) === true);
caso('enRango 3-meses: 20-abr sí', enRango('2026-04-20', '3-meses', HOY) === true);
caso('enRango 3-meses: 1-ene no', enRango('2026-01-01', '3-meses', HOY) === false);
caso('enRango todo: null sí', enRango(null, 'todo', HOY) === true);
caso('enRango este-mes: null no', enRango(null, 'este-mes', HOY) === false);

// ── exportWhatsApp ─────────────────────────────────────────────────────────

{
  const items = mergeItems([
    prop({ id: 10, propiedad: 'Casa A', material: true }),       // falta Copy
    prop({ id: 11, propiedad: 'Casa B' }),                       // falta ambos
  ], new Map());
  const txt = exportWhatsApp(items);
  caso('exportWhatsApp formato "ID · propiedad · falta X"',
    txt === '10 · Casa A · falta Copy\n11 · Casa B · falta Material + Copy', JSON.stringify(txt));
}

// ── copyLleno / aDate bordes ───────────────────────────────────────────────

caso('copyLleno null → false', copyLleno(null) === false);
caso('copyLleno "x" → true', copyLleno('x') === true);
caso('aDate ISO datetime', aDate('2026-07-03T22:08:42+00:00') instanceof Date);
caso('aDate basura → null', aDate('no-fecha') === null);

// ── [V71] restaurarCampos: base del Deshacer universal ─────────────────────

{
  // Apagar una vendida: previo capturado ANTES tenía apagada=false (o ausente).
  const previoActiva = { subida: true, apagada: false, apagada_at: null, fuente_venta: null, adset_id: 'AD1' };
  const restore = restaurarCampos(previoActiva, ['apagada', 'apagada_at', 'fuente_venta']);
  caso('restaurarCampos: apagada→false, ts/fuente→null',
    restore.apagada === false && restore.apagada_at === null && restore.fuente_venta === null,
    JSON.stringify(restore));
  caso('restaurarCampos NO toca campos fuera de la lista (adset_id intacto)',
    !('adset_id' in restore) && !('subida' in restore));
}

{
  // Reactivar: previo tenía apagada=true + apagada_at + fuente. El Deshacer de
  // Reactivar debe restaurar EXACTAMENTE ese estado pre-reactivación.
  const previoApagada = { subida: true, apagada: true, apagada_at: '2026-07-08T01:00:00+00:00', fuente_venta: 'pauta' };
  const undo = restaurarCampos(previoApagada, ['apagada', 'apagada_at', 'fuente_venta']);
  caso('reactivar undo restaura apagada=true + ts + fuente exactos',
    undo.apagada === true && undo.apagada_at === '2026-07-08T01:00:00+00:00' && undo.fuente_venta === 'pauta',
    JSON.stringify(undo));
}

{
  // Recordar: previo sin recordado_at (campo ausente) → undo lo restaura a null.
  const previoSinRec = { subida: false };
  const undo = restaurarCampos(previoSinRec, ['recordado_at']);
  caso('recordar undo: campo ausente → null (no undefined)', undo.recordado_at === null);
  // Previo CON recordado_at → undo restaura ese valor.
  const previoConRec = { recordado_at: '2026-07-01T00:00:00+00:00' };
  caso('recordar undo: restaura recordado_at previo',
    restaurarCampos(previoConRec, ['recordado_at']).recordado_at === '2026-07-01T00:00:00+00:00');
}

// ── [V71] Transición de Reactivar (vía derivarCubeta) ──────────────────────

{
  // Apagada → Reactivar (apagada:false). La derivación la regresa sola:
  // vendida+subida → 'apagar'; activa+subida → 'activas'.
  const vendida = prop({ estado: 'vendida' });
  caso('reactivar vendida pautada → apagar',
    derivarCubeta(vendida, { subida: true, apagada: false }) === 'apagar');
  const activa = prop({ estado: 'activa' });
  caso('reactivar activa pautada → activas',
    derivarCubeta(activa, { subida: true, apagada: false }) === 'activas');
  caso('antes de reactivar (apagada:true) → apagadas',
    derivarCubeta(vendida, { subida: true, apagada: true }) === 'apagadas');
}

// ── [V71] mergeItems expone nota + trazabilidad ────────────────────────────

{
  const kv = [prop({ id: 1, material: true, copy: 'C' })];
  const fs = new Map([['gomez_1', {
    subida: true, adset_id: 'AD9', nota: 'llamar al dueño',
    updated_by: 'uid-abc123', updated_by_name: 'Mario', updated_at: '2026-07-08T10:00:00+00:00',
  }]]);
  const it = mergeItems(kv, fs)[0];
  caso('mergeItems: nota expuesta', it.nota === 'llamar al dueño');
  caso('mergeItems: updated_by_name expuesto', it.updated_by_name === 'Mario');
  caso('mergeItems: updated_by expuesto', it.updated_by === 'uid-abc123');
  caso('mergeItems: updated_at expuesto', it.updated_at === '2026-07-08T10:00:00+00:00');
  // Doc viejo sin estos campos → null (no rompe).
  const viejo = mergeItems([prop({ id: 2 })], new Map([['gomez_2', { subida: false }]]))[0];
  caso('mergeItems: doc viejo sin nota/traza → null',
    viejo.nota === null && viejo.updated_by_name === null && viejo.updated_at === null);
}

// ── Reporte ────────────────────────────────────────────────────────────────
for (const r of resultados) console.log(r);
console.log(`\n${pass} PASS, ${fail} FAIL de ${pass + fail} casos`);
process.exit(fail > 0 ? 1 : 0);
