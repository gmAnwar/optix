// ═══════════════════════════════════════════════════════════════════════════
// PROMOCIÓN INVENTARIO INMOBILI — Frontend v7 interno [OPTIX-S97-PROMO-V7]
//
// Vista INTERNA (equipo Anwar+Mario) del ciclo de promoción de propiedades:
// lee el KV del pipeline M1 (via Worker view=promocion) + estado operativo
// en Firestore (workspaces/{wsId}/promocion-inmobili/{office}_{id}) y deriva
// las cubetas Apagar / Lista / Esperando / Activas / Apagadas.
//
// Regla dura: NINGÚN link de esta vista se comparte al cliente.
//
// Arquitectura de datos:
// - KV (fuente sheet, refresco ~30 min): id, propiedad, precio, estado,
//   f_captacion, plazo, material, link_drive, copy, timeline{...}.
// - Firestore (fuente equipo, tiempo real): subida, subida_at, adset_id,
//   apagada, apagada_at, fuente_venta, recordado_at. Para subida/subida_at/
//   fuente_venta el doc Firestore SIEMPRE gana sobre el KV (el KV trae
//   placeholders de M1: subida=false, subida_at=null, fuente_venta=null).
// - Escrituras con optimistic UI: se actualiza local, se escribe, y si falla
//   se revierte el control + toast (permission-denied con mensaje explícito
//   — las rules viven en consola Firebase, no en el repo).
//
// Este módulo es ES module: las funciones puras se exportan para el harness
// node (tests/promocion-inmobili.harness.mjs); el wiring de browser corre
// solo si window existe.
// ═══════════════════════════════════════════════════════════════════════════

export const PROMO_ENDPOINT =
  'https://optix-proxy.anwarhsg.workers.dev/client_data_public?client=inmobili&view=promocion';

// Cuenta de Meta Ads de Inmobili — verificada por Anwar (Checkpoint 1,
// 2026-07-07). Misma de clients/inmobili/ads_manager_config.py en optix-loops.
export const ADS_ACCOUNT = 'act_936995767352512';

export const CUBETAS = ['apagar', 'lista', 'esperando', 'activas', 'apagadas'];

const PLAZA_LABELS = { gomez: 'Gómez Palacio', torreon: 'Torreón' };

// ── Funciones puras (node-safe, testeadas en el harness) ──────────────────

export function docIdDe(p) {
  return `${p.office}_${p.id}`;
}

export function copyLleno(copy) {
  return typeof copy === 'string' && copy.trim() !== '';
}

/**
 * Deriva la cubeta de una property. p = property del KV, fs = doc Firestore
 * (o null → placeholders del KV, que son todos false/null).
 * missing_from_sheet NO altera la derivación (solo agrega chip en UI).
 * Retorna 'apagadas'|'apagar'|'activas'|'lista'|'esperando'|null.
 * null = no aparece (vendida/descartada histórica sin ciclo de subida).
 */
export function derivarCubeta(p, fs) {
  const sub = fs ? !!fs.subida : false;
  const apag = fs ? !!fs.apagada : false;
  if (apag) return 'apagadas';
  if (sub && p.estado !== 'activa') return 'apagar';   // vendida O descartada
  if (sub && p.estado === 'activa') return 'activas';
  if (p.estado === 'activa' && p.material && copyLleno(p.copy)) return 'lista';
  if (p.estado === 'activa') return 'esperando';
  return null;
}

/** Qué falta para estar lista: 'Material' | 'Copy' | 'Material + Copy' | null */
export function derivarFalta(p) {
  const faltaMat = !p.material;
  const faltaCopy = !copyLleno(p.copy);
  if (faltaMat && faltaCopy) return 'Material + Copy';
  if (faltaMat) return 'Material';
  if (faltaCopy) return 'Copy';
  return null;
}

/**
 * Merge KV + Firestore → items del view-model. fsMap: Map(docId → data) o
 * un objeto plano. Para subida/subida_at/fuente_venta SIEMPRE gana Firestore
 * (fs === null ⇒ placeholders: subida=false, subida_at=null, fuente_venta=null
 * — NO se usan los del KV aunque algún día traigan valor).
 */
export function mergeItems(kvProps, fsMap) {
  const get = (id) =>
    fsMap ? (typeof fsMap.get === 'function' ? fsMap.get(id) : fsMap[id]) || null : null;
  return (kvProps || []).map((p) => {
    const docId = docIdDe(p);
    const fs = get(docId);
    return {
      p,
      fs,
      docId,
      cubeta: derivarCubeta(p, fs),
      subida: fs ? !!fs.subida : false,
      subida_at: fs ? fs.subida_at || null : null,
      adset_id: fs ? fs.adset_id || null : null,
      apagada: fs ? !!fs.apagada : false,
      apagada_at: fs ? fs.apagada_at || null : null,
      fuente_venta: fs ? fs.fuente_venta || null : null,
      recordado_at: fs ? fs.recordado_at || null : null,
    };
  });
}

export function contarCubetas(items) {
  const counts = { todas: 0, apagar: 0, lista: 0, esperando: 0, activas: 0, apagadas: 0 };
  for (const it of items) {
    if (!it.cubeta) continue;
    counts[it.cubeta] += 1;
    counts.todas += 1;
  }
  return counts;
}

// ── Fechas/números (es-MX) ─────────────────────────────────────────────────

/** Normaliza Timestamp compat de Firestore | Date | ISO string → Date|null */
export function aDate(v) {
  if (v == null) return null;
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Días enteros transcurridos desde v hasta hoy (Date). null si v inválida. */
export function diasDesde(v, hoy) {
  const d = aDate(v);
  if (!d) return null;
  const ref = hoy instanceof Date ? hoy : new Date();
  const ms = ref.getTime() - d.getTime();
  return Math.floor(ms / 86400000);
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "12 may" | "12 may 25" si el año difiere del actual. '—' si null. */
export function fmtFecha(v, hoy) {
  const d = aDate(v);
  if (!d) return '—';
  const ref = hoy instanceof Date ? hoy : new Date();
  const base = `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
  return d.getFullYear() === ref.getFullYear() ? base : `${base} ${String(d.getFullYear()).slice(2)}`;
}

/** $670,000 → "$670K" · 2600000 → "$2.6M" · null → '' */
export function fmtPrecio(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return '';
  if (n >= 1e6) {
    const m = n / 1e6;
    const s = m >= 10 ? Math.round(m).toString() : (Math.round(m * 10) / 10).toString();
    return `$${s.replace(/\.0$/, '')}M`;
  }
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

export function fmtDias(n) {
  return n == null ? '—' : `${n} d`;
}

/** "hace 2 h" | "hace 35 min" | "hace 3 d" desde un ISO/Date. */
export function fmtHace(v, ahora) {
  const d = aDate(v);
  if (!d) return '—';
  const ref = ahora instanceof Date ? ahora : new Date();
  const min = Math.max(0, Math.floor((ref.getTime() - d.getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function plazaLabel(office) {
  return PLAZA_LABELS[office] || office || '—';
}

/** Dot de promesa: 'red' si edad > plazo, 'amber' si edad > 0.8*plazo, null. */
export function promesaDot(edadDias, plazo) {
  if (edadDias == null || plazo == null || typeof plazo !== 'number' || plazo <= 0) return null;
  if (edadDias > plazo) return 'red';
  if (edadDias > 0.8 * plazo) return 'amber';
  return null;
}

/** URL deep-link Ads Manager. act numérico SIN prefijo act_ (formato oficial
 * de la UI: /adsmanager/manage/adsets?act=N&selected_adset_ids=ID). */
export function adsManagerUrl(adsetId) {
  const act = ADS_ACCOUNT.replace(/^act_/, '');
  const base = `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}`;
  return adsetId ? `${base}&selected_adset_ids=${encodeURIComponent(adsetId)}` : base;
}

/** Filtro de temporalidad sobre apagada_at (solo cubeta apagadas).
 * rango: 'este-mes'|'mes-pasado'|'3-meses'|'todo' */
export function enRango(apagadaAt, rango, hoy) {
  if (rango === 'todo') return true;
  const d = aDate(apagadaAt);
  if (!d) return false;
  const ref = hoy instanceof Date ? hoy : new Date();
  if (rango === 'este-mes') {
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  }
  if (rango === 'mes-pasado') {
    const prev = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    return d.getFullYear() === prev.getFullYear() && d.getMonth() === prev.getMonth();
  }
  if (rango === '3-meses') {
    return ref.getTime() - d.getTime() <= 92 * 86400000;
  }
  return true;
}

/** Texto de export WhatsApp para cubeta esperando: "ID · propiedad · falta X" */
export function exportWhatsApp(items) {
  return items
    .map((it) => `${it.p.id} · ${it.p.propiedad} · falta ${derivarFalta(it.p) || '—'}`)
    .join('\n');
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════════════
// Browser wiring — solo corre en el SPA (index.html). Node no entra aquí.
// ═══════════════════════════════════════════════════════════════════════════
if (typeof window !== 'undefined' && typeof document !== 'undefined') {

  const S = {
    kv: null,            // payload del Worker
    fsMap: new Map(),    // docId → data Firestore
    items: [],           // merge
    tab: 'todas',
    busqueda: '',
    plaza: 'todas',
    rango: 'este-mes',
    seleccion: new Set(),   // docIds — no cruza cubetas
    seleccionCubeta: null,
    fuenteSel: new Map(),   // docId → 'pauta'|'organico' (transitorio pre-apagar)
    noticesCerrados: new Set(),
    cargando: false,
    error: null,
  };

  let toastTimer = null;

  function wsId() {
    return window.currentAgencia || 'optimizads';
  }

  function fsCol() {
    if (!window.firebaseDb) return null;
    return window.firebaseDb
      .collection('workspaces').doc(wsId())
      .collection('promocion-inmobili');
  }

  // ── Carga: KV + colección Firestore en paralelo ──
  async function cargar() {
    S.cargando = true;
    S.error = null;
    render();
    try {
      const [kvResp, fsSnap] = await Promise.all([
        fetch(PROMO_ENDPOINT).then((r) => {
          if (!r.ok) throw new Error(`Worker HTTP ${r.status}`);
          return r.json();
        }),
        fsCol() ? fsCol().get() : Promise.resolve(null),
      ]);
      S.kv = kvResp;
      S.fsMap = new Map();
      if (fsSnap) fsSnap.forEach((doc) => S.fsMap.set(doc.id, doc.data()));
      S.items = mergeItems(kvResp.properties, S.fsMap);
    } catch (e) {
      console.error('[promocion] carga falló', e);
      S.error = e.code === 'permission-denied'
        ? 'Sin permisos de lectura en Firestore — falta rule en consola'
        : String(e.message || e);
    }
    S.cargando = false;
    render();
  }

  // ── Escritura optimistic: muta fsMap local, re-renderea, escribe; si
  // falla revierte + toast explícito. ──
  async function escribir(docId, patch, opts) {
    const previo = S.fsMap.get(docId) ? { ...S.fsMap.get(docId) } : null;
    const local = { ...(previo || {}), ...patch };
    // Optimistic local: serverTimestamp aún no existe → usa Date local para pintar.
    for (const k of Object.keys(local)) {
      if (local[k] === '__SERVER_TS__') local[k] = new Date();
    }
    S.fsMap.set(docId, local);
    S.items = mergeItems(S.kv ? S.kv.properties : [], S.fsMap);
    render();

    const col = fsCol();
    if (!col) {
      revertir_();
      toast('Firestore no disponible (¿sesión sin auth?)', null);
      return false;
    }
    const fv = window.firebase && window.firebase.firestore
      ? window.firebase.firestore.FieldValue : null;
    const wire = { ...patch };
    for (const k of Object.keys(wire)) {
      if (wire[k] === '__SERVER_TS__') wire[k] = fv ? fv.serverTimestamp() : new Date();
    }
    wire.updated_by = window.currentUser ? window.currentUser.uid : null;
    wire.updated_at = fv ? fv.serverTimestamp() : new Date();
    try {
      await col.doc(docId).set(wire, { merge: true });
      return true;
    } catch (e) {
      console.error('[promocion] write falló', docId, e);
      revertir_();
      toast(
        e.code === 'permission-denied'
          ? 'Sin permisos — falta rule en consola Firebase'
          : 'Error al guardar: ' + (e.message || e.code || e),
        null
      );
      return false;
    }

    function revertir_() {
      if (previo) S.fsMap.set(docId, previo);
      else S.fsMap.delete(docId);
      S.items = mergeItems(S.kv ? S.kv.properties : [], S.fsMap);
      render();
    }
  }

  // ── Acciones de fila ──
  async function accionSubir(docId, checked) {
    if (checked) {
      const it = S.items.find((x) => x.docId === docId);
      const ok = await escribir(docId, { subida: true, subida_at: '__SERVER_TS__' });
      if (ok) {
        toast(`Subida marcada — ${it ? it.p.propiedad : docId}`, () =>
          escribir(docId, { subida: false, subida_at: null })
        );
      }
    }
  }

  async function accionRevertir(docId) {
    const ok = await escribir(docId, { subida: false, subida_at: null });
    if (ok) toast('Campaña revertida a Lista para subir', () =>
      escribir(docId, { subida: true, subida_at: '__SERVER_TS__' })
    );
  }

  async function accionApagar(docId) {
    const it = S.items.find((x) => x.docId === docId);
    if (!it) return;
    const fuente = S.fuenteSel.get(docId) || null;
    if (it.p.estado === 'vendida' && !fuente) {
      render(); // regresa el switch a ON
      toast('Elige cómo se vendió antes de apagar', null);
      return;
    }
    const patch = { apagada: true, apagada_at: '__SERVER_TS__' };
    if (it.p.estado === 'vendida') patch.fuente_venta = fuente;
    const ok = await escribir(docId, patch);
    if (ok) {
      S.fuenteSel.delete(docId);
      toast(
        'Campaña apagada' + (fuente ? ` — vendida por ${fuente === 'pauta' ? 'pauta' : 'orgánico'}` : ''),
        () => escribir(docId, { apagada: false, apagada_at: null, fuente_venta: null })
      );
    }
  }

  async function accionRecordar(docId) {
    await escribir(docId, { recordado_at: '__SERVER_TS__' });
  }

  async function accionAdset(docId, valor) {
    const v = (valor || '').trim();
    const it = S.items.find((x) => x.docId === docId);
    if (it && (it.adset_id || null) === (v || null)) return; // sin cambio
    await escribir(docId, { adset_id: v || null });
  }

  function accionCopiarCopy(docId) {
    const it = S.items.find((x) => x.docId === docId);
    if (!it || !copyLleno(it.p.copy)) return;
    copiarClipboard(it.p.copy);
  }

  function copiarClipboard(texto) {
    if (navigator.clipboard) navigator.clipboard.writeText(texto);
    const c = document.getElementById('pv-copied');
    if (c) {
      c.classList.add('show');
      setTimeout(() => c.classList.remove('show'), 1300);
    }
  }

  // ── Bulk ──
  function itemsSeleccionados() {
    return S.items.filter((x) => S.seleccion.has(x.docId));
  }

  async function bulkMarcarSubidas() {
    for (const it of itemsSeleccionados()) {
      await escribir(it.docId, { subida: true, subida_at: '__SERVER_TS__' });
    }
    limpiarSeleccion();
    toast('Seleccionadas marcadas como subidas', null);
  }

  function bulkCopiarCopies() {
    const texto = itemsSeleccionados()
      .filter((it) => copyLleno(it.p.copy))
      .map((it) => it.p.copy)
      .join('\n\n');
    if (texto) copiarClipboard(texto);
    else toast('Ninguna seleccionada tiene copy', null);
  }

  async function bulkRecordar() {
    for (const it of itemsSeleccionados()) {
      await escribir(it.docId, { recordado_at: '__SERVER_TS__' });
    }
    limpiarSeleccion();
    toast('Recordatorio registrado para todas', null);
  }

  function bulkExportWhatsApp() {
    const texto = exportWhatsApp(itemsSeleccionados());
    if (texto) copiarClipboard(texto);
  }

  async function bulkApagar() {
    const sel = itemsSeleccionados();
    const sinFuente = sel.filter((it) => it.p.estado === 'vendida' && !S.fuenteSel.get(it.docId));
    if (sinFuente.length > 0) {
      toast(`Elige cómo se vendió en ${sinFuente.length} vendida(s) antes de apagar`, null);
      return;
    }
    for (const it of sel) {
      const patch = { apagada: true, apagada_at: '__SERVER_TS__' };
      if (it.p.estado === 'vendida') patch.fuente_venta = S.fuenteSel.get(it.docId);
      await escribir(it.docId, patch);
      S.fuenteSel.delete(it.docId);
    }
    limpiarSeleccion();
    toast('Seleccionadas apagadas', null);
  }

  async function bulkRevertir() {
    for (const it of itemsSeleccionados()) {
      await escribir(it.docId, { subida: false, subida_at: null });
    }
    limpiarSeleccion();
    toast('Seleccionadas revertidas a Lista', null);
  }

  function limpiarSeleccion() {
    S.seleccion.clear();
    S.seleccionCubeta = null;
    render();
  }

  // ── Toast con Deshacer (5s, barra) ──
  function toast(texto, onUndo) {
    const el = document.getElementById('pv-toast');
    if (!el) return;
    el.querySelector('.pv-toast-txt').textContent = texto;
    const undoBtn = el.querySelector('.pv-toast-undo');
    undoBtn.style.display = onUndo ? '' : 'none';
    undoBtn.onclick = () => {
      el.classList.remove('show');
      if (onUndo) onUndo();
    };
    el.classList.add('show');
    const bar = el.querySelector('.pv-toast-bar');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = 'width 5s linear';
      bar.style.width = '0%';
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function filtrar(items) {
    const q = S.busqueda.trim().toLowerCase();
    return items.filter((it) => {
      if (!it.cubeta) return false;
      if (S.plaza !== 'todas' && it.p.office !== S.plaza) return false;
      if (q) {
        const hay = `${it.p.id} ${it.p.propiedad} ${plazaLabel(it.p.office)} ${it.p.office}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (it.cubeta === 'apagadas' && !enRango(it.apagada_at, S.rango, new Date())) return false;
      return true;
    });
  }

  function render() {
    const root = document.getElementById('view-promocion');
    if (!root) return;

    if (S.cargando && !S.kv) {
      root.innerHTML = `<div class="pv-loading">Cargando inventario…</div>`;
      return;
    }
    if (S.error && !S.kv) {
      root.innerHTML = `<div class="pv-error">⚠️ ${escapeHtml(S.error)}
        <button class="pv-tbtn" data-action="refrescar">Reintentar</button></div>`;
      return;
    }
    if (!S.kv) { root.innerHTML = ''; return; }

    const hoy = new Date();
    const visibles = filtrar(S.items);
    const counts = contarCubetas(filtrar(S.items.map((x) => x))); // counts respetan búsqueda/plaza
    const porCubeta = {};
    for (const c of CUBETAS) porCubeta[c] = visibles.filter((x) => x.cubeta === c);

    // Notices
    const numApagar = S.items.filter((x) => x.cubeta === 'apagar').length;
    const esperando7 = S.items.filter(
      (x) => x.cubeta === 'esperando' && (diasDesde(x.p.timeline.first_seen, hoy) || 0) > 7
    ).length;
    const offices = [...new Set(S.items.filter((x) => x.cubeta).map((x) => x.p.office))];

    root.innerHTML = `
      <div class="pv-metarow">
        <span class="pv-title">Promoción de Inventario</span>
        <span class="pv-acct">Inmobili <span class="pv-acct-sub">${escapeHtml(ADS_ACCOUNT)}</span></span>
        <span class="pv-right">
          <span class="pv-meta"><span class="pv-dot pv-dot-green"></span> Datos de ${escapeHtml(fmtHace(S.kv.meta.generated_at, hoy))}</span>
          <button class="pv-iconbtn" data-action="refrescar" title="Refrescar">⟳</button>
        </span>
      </div>
      ${renderNotices(numApagar, esperando7)}
      ${renderTabs(counts)}
      ${renderToolbar(offices)}
      ${renderBulkbar()}
      ${renderSecciones(porCubeta, hoy)}
    `;
    root.querySelectorAll('.pv-adset-in').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
      inp.addEventListener('blur', (e) => accionAdset(e.target.dataset.docid, e.target.value));
    });
  }

  function renderNotices(numApagar, esperando7) {
    const n = [];
    if (numApagar > 0 && !S.noticesCerrados.has('apagar')) {
      n.push(`<div class="pv-notice"><span class="pv-dot pv-dot-red"></span>
        <span><b>${numApagar} ${numApagar === 1 ? 'propiedad vendida/descartada sigue' : 'propiedades vendidas/descartadas siguen'} activa${numApagar === 1 ? '' : 's'}</b> — conviene apagar.</span>
        <a href="#" data-action="go" data-tab="apagar">Ver</a>
        <button class="pv-x" data-action="cerrar-notice" data-notice="apagar">×</button></div>`);
    }
    if (esperando7 > 0 && !S.noticesCerrados.has('esperando')) {
      n.push(`<div class="pv-notice"><span class="pv-dot pv-dot-amber"></span>
        <span><b>${esperando7} propiedad${esperando7 === 1 ? '' : 'es'}</b> lleva${esperando7 === 1 ? '' : 'n'} +7 días esperando al cliente.</span>
        <a href="#" data-action="go" data-tab="esperando">Ver</a>
        <button class="pv-x" data-action="cerrar-notice" data-notice="esperando">×</button></div>`);
    }
    const warnings = (S.kv.meta.warnings || []);
    if (warnings.length > 0 && !S.noticesCerrados.has('warnings')) {
      n.push(`<div class="pv-notice pv-notice-grey"><span class="pv-dot pv-dot-grey"></span>
        <span>${warnings.length} warning(s) del pipeline: ${escapeHtml(warnings.join(' · '))}</span>
        <button class="pv-x" data-action="cerrar-notice" data-notice="warnings">×</button></div>`);
    }
    return n.join('');
  }

  function renderTabs(counts) {
    const defs = [
      ['todas', 'Todas'], ['apagar', 'Apagar'], ['lista', 'Lista para subir'],
      ['esperando', 'Esperando cliente'], ['activas', 'Activas'], ['apagadas', 'Apagadas'],
    ];
    return `<div class="pv-tabs">${defs.map(([k, label]) =>
      `<button class="pv-tab${S.tab === k ? ' active' : ''}" data-action="go" data-tab="${k}">
        ${label} <span class="pv-badge">${counts[k] || 0}</span></button>`
    ).join('')}</div>`;
  }

  function renderToolbar(offices) {
    const plazaOpts = [`<option value="todas"${S.plaza === 'todas' ? ' selected' : ''}>Plaza: Todas</option>`]
      .concat(offices.map((o) =>
        `<option value="${escapeHtml(o)}"${S.plaza === o ? ' selected' : ''}>${escapeHtml(plazaLabel(o))}</option>`));
    const rangos = [['este-mes', 'Este mes'], ['mes-pasado', 'Mes pasado'], ['3-meses', 'Últimos 3 meses'], ['todo', 'Todo']];
    const rangoVisible = S.tab === 'todas' || S.tab === 'apagadas';
    return `<div class="pv-toolbar">
      <input class="pv-search" placeholder="Buscar por nombre, ID o plaza" value="${escapeHtml(S.busqueda)}" data-action="buscar">
      <select class="pv-tbtn" data-action="plaza">${plazaOpts.join('')}</select>
      ${rangoVisible ? `<select class="pv-tbtn" data-action="rango" title="Solo aplica al histórico de Apagadas">
        ${rangos.map(([k, l]) => `<option value="${k}"${S.rango === k ? ' selected' : ''}>Apagadas: ${l}</option>`).join('')}
      </select>` : ''}
    </div>`;
  }

  function renderBulkbar() {
    const n = S.seleccion.size;
    if (n === 0 || !S.seleccionCubeta) return '';
    const acciones = {
      lista: `<button class="pv-bulk-primary" data-action="bulk-subidas">Marcar subidas</button>
              <button data-action="bulk-copies">Copiar copies</button>`,
      esperando: `<button class="pv-bulk-primary" data-action="bulk-recordar">Recordar a todas</button>
                  <button data-action="bulk-whatsapp">Exportar para WhatsApp</button>`,
      apagar: `<button class="pv-bulk-primary" data-action="bulk-apagar">Apagar seleccionadas</button>`,
      activas: `<button data-action="bulk-revertir">Revertir</button>`,
    };
    return `<div class="pv-bulkbar">
      <span class="pv-bulk-cnt">${n} seleccionada${n === 1 ? '' : 's'}</span>
      <span class="pv-bulk-sep"></span>
      <span>${acciones[S.seleccionCubeta] || ''}</span>
      <button class="pv-bulk-clear" data-action="bulk-clear">Cancelar</button>
    </div>`;
  }

  function chipMissing(it) {
    return it.p.missing_from_sheet
      ? ` <span class="pv-chip-amber" title="La fila ya no está en el sheet — se conserva el último estado">fuera del sheet</span>`
      : '';
  }

  function celName(it) {
    const sub = fmtPrecio(it.p.precio);
    return `<td class="pv-c-name"><div class="pv-name">
      <span class="pv-idtag">${escapeHtml(String(it.p.id))}</span>${escapeHtml(it.p.propiedad)}${chipMissing(it)}
      ${sub ? `<span class="pv-sub">${escapeHtml(sub)}</span>` : ''}
    </div></td>`;
  }

  function celChk(it) {
    const checked = S.seleccion.has(it.docId) ? ' checked' : '';
    return `<td class="pv-c-chk"><input type="checkbox" class="pv-rowchk" data-action="sel" data-docid="${escapeHtml(it.docId)}" data-cubeta="${it.cubeta}"${checked}></td>`;
  }

  function renderSecciones(porCubeta, hoy) {
    const defs = [
      ['apagar', 'Apagar pendiente', 'var(--pv-red)', 'Avisó venta/descarte · falta apagar campaña'],
      ['lista', 'Lista para subir', 'var(--pv-green)', 'Material + copies listos · falta subir'],
      ['esperando', 'Esperando cliente', 'var(--pv-amber)', 'Falta entrega · la etiqueta dice qué'],
      ['activas', 'Activas', 'var(--pv-blue-track)', 'Campaña corriendo · si se vende, salta a Apagar'],
      ['apagadas', 'Apagadas', '#bcc0c4', 'Cerradas · filtradas por temporalidad (arriba)'],
    ];
    return defs.map(([cubeta, titulo, color, desc]) => {
      if (S.tab !== 'todas' && S.tab !== cubeta) return '';
      const items = porCubeta[cubeta];
      if (S.tab === 'todas' && items.length === 0) return '';
      const filas = items.map((it) => filaDe(cubeta, it, hoy)).join('');
      const vacia = `<tr><td colspan="10" class="pv-empty">Nada en esta cubeta.</td></tr>`;
      return `<div class="pv-section">
        <div class="pv-section-bar"><span class="pv-sdot" style="background:${color}"></span>
          <h2>${titulo}</h2><span class="pv-cnt">${items.length}</span><span class="pv-desc">${desc}</span></div>
        <div class="pv-card"><div class="pv-scroll"><table class="pv-table">
          ${headerDe(cubeta)}
          <tbody>${filas || vacia}</tbody>
          ${footerDe(cubeta, items, hoy)}
        </table></div></div>
      </div>`;
    }).join('');
  }

  function headerDe(cubeta) {
    const chk = `<th class="pv-c-chk"><input type="checkbox" class="pv-rowchk" data-action="sel-all" data-cubeta="${cubeta}"></th>`;
    const H = {
      apagar: `<tr>${chk}<th class="pv-c-sw"></th><th class="pv-c-name">Propiedad</th><th>Plaza</th><th>Adset activo</th><th>Avisó vendida</th><th>¿Cómo se vendió?</th><th class="pv-num">Acción</th></tr>`,
      lista: `<tr>${chk}<th class="pv-c-sw">Subir</th><th class="pv-c-name">Propiedad</th><th>Plaza</th><th class="pv-num">Captada</th><th class="pv-num">Promesa</th><th class="pv-num">En estado</th><th>Material</th><th>Copy</th><th>Adset</th></tr>`,
      esperando: `<tr>${chk}<th class="pv-c-sw"></th><th class="pv-c-name">Propiedad</th><th>Plaza</th><th class="pv-num">Promesa</th><th class="pv-num">En estado</th><th>Falta</th><th>Material</th><th>Copy</th><th>Recordatorio</th></tr>`,
      activas: `<tr>${chk}<th class="pv-c-sw">Estado</th><th class="pv-c-name">Propiedad</th><th>Plaza</th><th class="pv-num">Subida</th><th>Adset</th><th>Material</th><th class="pv-num">Acción</th></tr>`,
      apagadas: `<tr><th class="pv-c-chk"></th><th class="pv-c-sw"></th><th class="pv-c-name">Propiedad</th><th>Plaza</th><th>Adset</th><th class="pv-num">Apagada</th><th>Se vendió por</th></tr>`,
    };
    return `<thead>${H[cubeta]}</thead>`;
  }

  function filaDe(cubeta, it, hoy) {
    const plaza = `<td data-l="Plaza" class="pv-muted">${escapeHtml(plazaLabel(it.p.office))}</td>`;
    const material = it.p.material
      ? `<td data-l="Material"><span class="pv-chk-ok">✓</span> ${it.p.link_drive ? `<a class="pv-lnk" href="${escapeHtml(it.p.link_drive)}" target="_blank" rel="noopener">Drive ↗</a>` : '<span class="pv-lnk-off">sin link</span>'}</td>`
      : `<td data-l="Material"><span class="pv-x-mut">—</span> <span class="pv-lnk-off">sin link</span></td>`;
    const copyBtn = copyLleno(it.p.copy)
      ? `<td data-l="Copy"><button class="pv-mini pv-mini-blue" data-action="copiar" data-docid="${escapeHtml(it.docId)}">Copiar</button></td>`
      : `<td data-l="Copy"><span class="pv-x-mut">—</span></td>`;
    const adsetCell = it.adset_id
      ? `<span class="pv-adset">${escapeHtml(it.adset_id)}</span>`
      : `<span class="pv-adset-empty"><span class="pv-dot pv-dot-amber"></span>sin adset</span>`;
    const edad = diasDesde(it.p.f_captacion, hoy);

    if (cubeta === 'apagar') {
      const dias = diasDesde(it.p.timeline.cerrada_at, hoy);
      const fuente = S.fuenteSel.get(it.docId);
      const selFuente = it.p.estado === 'vendida'
        ? `<span class="pv-srcsel">
            <button class="${fuente === 'pauta' ? 'sel' : ''}" data-action="fuente" data-docid="${escapeHtml(it.docId)}" data-fuente="pauta">Pauta</button>
            <button class="${fuente === 'organico' ? 'sel' : ''}" data-action="fuente" data-docid="${escapeHtml(it.docId)}" data-fuente="organico">Orgánico</button>
          </span>`
        : `<span class="pv-muted" title="Descartada: apagar sin pedir fuente">no aplica</span>`;
      return `<tr class="${S.seleccion.has(it.docId) ? 'pv-sel' : ''}">${celChk(it)}
        <td class="pv-c-sw"><label class="pv-switch"><input type="checkbox" checked data-action="apagar" data-docid="${escapeHtml(it.docId)}"><span class="pv-track"></span></label></td>
        ${celName(it)}${plaza}
        <td data-l="Adset">${adsetCell}</td>
        <td data-l="Avisó" class="pv-muted">${dias == null ? '—' : `hace ${dias} d`}</td>
        <td data-l="¿Cómo?">${selFuente}</td>
        <td class="pv-num" data-l="Acción">${it.adset_id ? `<a class="pv-lnk" href="${adsManagerUrl(it.adset_id)}" target="_blank" rel="noopener">Abrir en Ads Manager ↗</a>` : '<span class="pv-lnk-off">sin adset</span>'}</td>
      </tr>`;
    }
    if (cubeta === 'lista') {
      const enEstado = diasDesde(it.p.timeline.listo_at, hoy);
      const dot = promesaDot(edad, it.p.plazo);
      return `<tr class="${S.seleccion.has(it.docId) ? 'pv-sel' : ''}">${celChk(it)}
        <td class="pv-c-sw"><label class="pv-switch"><input type="checkbox" data-action="subir" data-docid="${escapeHtml(it.docId)}"><span class="pv-track"></span></label></td>
        ${celName(it)}${plaza}
        <td class="pv-num" data-l="Captada"><span class="pv-big">${escapeHtml(fmtFecha(it.p.f_captacion, hoy))}</span></td>
        <td class="pv-num" data-l="Promesa">${dot ? `<span class="pv-due"><span class="pv-dot pv-dot-${dot}"></span><span class="pv-big">${escapeHtml(fmtDias(it.p.plazo))}</span></span>` : `<span class="pv-big">${escapeHtml(fmtDias(it.p.plazo))}</span>`}</td>
        <td class="pv-num" data-l="En estado"><span class="pv-big">${escapeHtml(fmtDias(enEstado))}</span></td>
        ${material}${copyBtn}
        <td data-l="Adset"><input class="pv-adset-in" placeholder="adset…" value="${escapeHtml(it.adset_id || '')}" data-docid="${escapeHtml(it.docId)}"></td>
      </tr>`;
    }
    if (cubeta === 'esperando') {
      const enEstado = diasDesde(it.p.timeline.first_seen, hoy);
      const dot = promesaDot(edad, it.p.plazo);
      const rec = it.recordado_at
        ? `<button class="pv-mini pv-mini-rec" data-action="recordar" data-docid="${escapeHtml(it.docId)}">Recordado hace ${diasDesde(it.recordado_at, hoy)} d</button>`
        : `<button class="pv-mini" data-action="recordar" data-docid="${escapeHtml(it.docId)}">Recordar</button>`;
      return `<tr class="${S.seleccion.has(it.docId) ? 'pv-sel' : ''}">${celChk(it)}
        <td class="pv-c-sw"><label class="pv-switch disabled"><input type="checkbox" disabled><span class="pv-track"></span></label></td>
        ${celName(it)}${plaza}
        <td class="pv-num" data-l="Promesa">${dot ? `<span class="pv-due"><span class="pv-dot pv-dot-${dot}"></span><span class="pv-big">${escapeHtml(fmtDias(it.p.plazo))}</span></span>` : `<span class="pv-big">${escapeHtml(fmtDias(it.p.plazo))}</span>`}</td>
        <td class="pv-num" data-l="En estado"><span class="pv-big">${escapeHtml(fmtDias(enEstado))}</span></td>
        <td data-l="Falta"><span class="pv-miss"><span class="pv-dot pv-dot-amber"></span>${escapeHtml(derivarFalta(it.p) || '—')}</span></td>
        ${material}
        <td data-l="Copy">${copyLleno(it.p.copy) ? '<span class="pv-chk-ok">✓</span>' : '<span class="pv-x-mut">—</span>'}</td>
        <td data-l="Recordatorio">${rec}</td>
      </tr>`;
    }
    if (cubeta === 'activas') {
      return `<tr class="${S.seleccion.has(it.docId) ? 'pv-sel' : ''}">${celChk(it)}
        <td class="pv-c-sw"><label class="pv-switch"><input type="checkbox" checked data-action="revertir" data-docid="${escapeHtml(it.docId)}"><span class="pv-track"></span></label></td>
        ${celName(it)}${plaza}
        <td class="pv-num" data-l="Subida"><span class="pv-big">${escapeHtml(fmtFecha(it.subida_at, hoy))}</span></td>
        <td data-l="Adset">${adsetCell}</td>
        ${material}
        <td class="pv-num" data-l="Acción"><a class="pv-lnk" href="${adsManagerUrl(it.adset_id)}" target="_blank" rel="noopener">Ver en Ads Manager ↗</a></td>
      </tr>`;
    }
    // apagadas
    const pill = it.fuente_venta
      ? `<span class="pv-srcpill ${it.fuente_venta === 'pauta' ? 'pauta' : 'org'}"><span class="pv-dot"></span>${it.fuente_venta === 'pauta' ? 'Pauta' : 'Orgánico'}</span>`
      : '<span class="pv-x-mut">—</span>';
    return `<tr class="pv-row-off">
      <td class="pv-c-chk"></td>
      <td class="pv-c-sw"><span class="pv-dot pv-dot-grey"></span></td>
      ${celName(it)}${plaza}
      <td data-l="Adset">${adsetCell}</td>
      <td class="pv-num" data-l="Apagada"><span class="pv-big">${escapeHtml(fmtFecha(it.apagada_at, hoy))}</span></td>
      <td data-l="Fuente">${pill}</td>
    </tr>`;
  }

  function footerDe(cubeta, items, hoy) {
    const n = items.length;
    let txt = '';
    if (cubeta === 'apagar') txt = `${n} propiedad${n === 1 ? '' : 'es'} por apagar`;
    if (cubeta === 'lista') txt = `${n} propiedad${n === 1 ? '' : 'es'} lista${n === 1 ? '' : 's'} para subir`;
    if (cubeta === 'esperando') {
      const mas7 = items.filter((x) => (diasDesde(x.p.timeline.first_seen, hoy) || 0) > 7).length;
      txt = `${n} propiedad${n === 1 ? '' : 'es'} esperando${mas7 ? ` · ${mas7} lleva${mas7 === 1 ? '' : 'n'} +7 días` : ''}`;
    }
    if (cubeta === 'activas') txt = `${n} campaña${n === 1 ? '' : 's'} activa${n === 1 ? '' : 's'}`;
    if (cubeta === 'apagadas') {
      const pauta = items.filter((x) => x.fuente_venta === 'pauta').length;
      const org = items.filter((x) => x.fuente_venta === 'organico').length;
      txt = `${n} apagada${n === 1 ? '' : 's'} · ${pauta} pauta · ${org} orgánico`;
    }
    return `<tfoot><tr><td colspan="10">${txt}</td></tr></tfoot>`;
  }

  // ── Delegación de eventos ──
  function onScreenEvent(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    const docId = t.dataset.docid;

    if (e.type === 'input' && action === 'buscar') { S.busqueda = t.value; renderPreservandoBusqueda(); return; }
    if (e.type === 'change') {
      if (action === 'plaza') { S.plaza = t.value; render(); return; }
      if (action === 'rango') { S.rango = t.value; render(); return; }
      if (action === 'subir') { accionSubir(docId, t.checked); return; }
      if (action === 'revertir') { if (!t.checked) accionRevertir(docId); return; }
      if (action === 'apagar') { if (!t.checked) accionApagar(docId); return; }
      if (action === 'sel') { toggleSel(docId, t.dataset.cubeta, t.checked); return; }
      if (action === 'sel-all') { toggleSelAll(t.dataset.cubeta, t.checked); return; }
      return;
    }
    if (e.type !== 'click') return;
    if (action === 'go') { e.preventDefault(); S.tab = t.dataset.tab; limpiarSeleccion(); return; }
    if (action === 'cerrar-notice') { S.noticesCerrados.add(t.dataset.notice); render(); return; }
    if (action === 'refrescar') { cargar(); return; }
    if (action === 'copiar') { accionCopiarCopy(docId); return; }
    if (action === 'recordar') { accionRecordar(docId); return; }
    if (action === 'fuente') { S.fuenteSel.set(docId, t.dataset.fuente); render(); return; }
    if (action === 'bulk-clear') { limpiarSeleccion(); return; }
    if (action === 'bulk-subidas') { bulkMarcarSubidas(); return; }
    if (action === 'bulk-copies') { bulkCopiarCopies(); return; }
    if (action === 'bulk-recordar') { bulkRecordar(); return; }
    if (action === 'bulk-whatsapp') { bulkExportWhatsApp(); return; }
    if (action === 'bulk-apagar') { bulkApagar(); return; }
    if (action === 'bulk-revertir') { bulkRevertir(); return; }
  }

  function renderPreservandoBusqueda() {
    const inp = document.querySelector('#view-promocion .pv-search');
    const pos = inp ? inp.selectionStart : null;
    render();
    const inp2 = document.querySelector('#view-promocion .pv-search');
    if (inp2) { inp2.focus(); if (pos != null) inp2.setSelectionRange(pos, pos); }
  }

  function toggleSel(docId, cubeta, checked) {
    if (checked && S.seleccionCubeta && S.seleccionCubeta !== cubeta) {
      S.seleccion.clear(); // la selección no cruza cubetas
    }
    if (checked) { S.seleccion.add(docId); S.seleccionCubeta = cubeta; }
    else {
      S.seleccion.delete(docId);
      if (S.seleccion.size === 0) S.seleccionCubeta = null;
    }
    render();
  }

  function toggleSelAll(cubeta, checked) {
    if (checked) {
      if (S.seleccionCubeta && S.seleccionCubeta !== cubeta) S.seleccion.clear();
      S.seleccionCubeta = cubeta;
      for (const it of filtrar(S.items)) if (it.cubeta === cubeta) S.seleccion.add(it.docId);
      if (S.seleccion.size === 0) S.seleccionCubeta = null;
    } else {
      for (const it of S.items) if (it.cubeta === cubeta) S.seleccion.delete(it.docId);
      if (S.seleccion.size === 0) S.seleccionCubeta = null;
    }
    render();
  }

  // ── Montaje del screen ──
  function montarScreen() {
    const screen = document.getElementById('screen-promocion');
    if (!screen || screen.dataset.montado) return;
    screen.dataset.montado = '1';
    screen.innerHTML = `
      <div class="pv-screen-header">
        <div class="logo-mark" style="margin:0; cursor:pointer;" onclick="showScreen('agencia')" title="Ir al inicio">
          <div class="logo-icon" style="width:32px;height:32px;font-size:13px;background:var(--accent);color:#000;">X</div>
          <div class="logo-text" style="font-size:18px;">Opti<span>x</span></div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button onclick="enterAs('tareas')" class="pv-hdr-lnk">✅ Tareas</button>
          <button class="pv-hdr-lnk pv-hdr-activo">📣 Promoción</button>
          <div class="user-badge-slot"></div>
        </div>
      </div>
      <div class="pv-body"><div id="view-promocion"></div></div>
      <div class="pv-toast" id="pv-toast"><span class="pv-toast-txt"></span>
        <button class="pv-toast-undo">Deshacer</button><span class="pv-toast-bar"></span></div>
      <div class="pv-copied" id="pv-copied">Copiado ✓</div>
    `;
    screen.addEventListener('click', onScreenEvent);
    screen.addEventListener('change', onScreenEvent);
    screen.addEventListener('input', onScreenEvent);
  }

  // Entrada a la vista (el tab del sidebar la llama). Gate real = login del
  // SPA (sin currentUser no hay firebaseDb utilizable) + gate de workspace
  // del tab (mismo que tab-tareas, en openClient).
  window.enterPromocion = function () {
    montarScreen();
    if (typeof window.showScreen === 'function') window.showScreen('promocion');
    if (!S.kv && !S.cargando) cargar();
    else render();
  };
}
