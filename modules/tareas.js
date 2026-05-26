/**
 * OPTIX — Tareas Module (v2.0 Áreas + v4.0 Vista Clientes + Quick Client)
 * Extraído del bundle index.html en F1 (refactor/modulos-tareas).
 * Re-audit Paso 0.5 posteado en Slack #contexto-claude.
 *
 * Depende de:
 * - escapeHtml: import desde ./utils.js
 * - F2b: TAREAS_CLIENTE_COLORS ahora es export const local del módulo (single
 *   source of truth). Consumido por mi-semana.js vía named import. Shim previo
 *   en index.html <head> eliminado.
 *
 * Window-compat (initTareas()):
 * - HTML inline onclick/onkeydown handlers en index.html ejecutan en window
 *   scope, no en module scope. initTareas() asigna a window.* todas las
 *   funciones referenciadas desde HTML inline + strings de templates.
 * - Mi Semana (script clásico inline en index.html) consume Tareas via
 *   window.* (tareasCliEnsureAllInitialized, tareasCliAddObjetivo,
 *   tareasCliEditTareaNotas, _tareasCliMemCache).
 */

import { escapeHtml } from './utils.js';

// ════════════════════════════════════════════════════════════════
// QUICK CLIENT (S67 Bloque C) — antes index.html L6099-6293
// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════
// CLIENTE RÁPIDO — S67 Bloque C
// Modal mínimo (nombre + color) para crear clientes desde Tareas v4.0
// vista Clientes sin pasar por el wizard largo. Use case original: Taco
// Agency necesita N "clientes" tipo campañas/canales sin expediente.
// Aplica a ambos workspaces (optimizads + taco) — el wsId viene de
// currentAgencia. Persistencia: mismo flow que wizard largo (clients[]
// + saveClients → _fbSaveClients → workspaces/{wsId}/data/clients).
// ══════════════════════════════════════════

let _qcSelectedColor = null;

function _qcPaletteColors() {
  // Todos los colores de TAREAS_CLIENTE_COLORS excepto _fallback.
  return Object.entries(TAREAS_CLIENTE_COLORS)
    .filter(function(kv) { return kv[0] !== '_fallback'; })
    .map(function(kv) { return { key: kv[0], hex: kv[1] }; });
}

function _qcGetUsedColorsInWorkspace() {
  // Set de colores hex (lowercase) en uso por algún cliente del workspace activo.
  // Lee de clients[] que ya está filtrado por workspace via mergeClients.
  const wsId = currentAgencia === 'taco' ? 'taco' : 'optimizads';
  const used = new Set();
  clients.forEach(function(c) {
    if (c.workspaceId !== wsId) return;
    const col = c.color || TAREAS_CLIENTE_COLORS[c.id];
    if (col) used.add(String(col).toLowerCase());
  });
  return used;
}

function _qcNextFreeColor() {
  const used = _qcGetUsedColorsInWorkspace();
  const palette = _qcPaletteColors();
  for (let i = 0; i < palette.length; i++) {
    if (!used.has(palette[i].hex.toLowerCase())) return palette[i].hex;
  }
  // Paleta agotada: default al primero (Anwar verá warning si decide usarlo).
  return palette.length ? palette[0].hex : '#64748b';
}

function _qcClienteUsingColor(hex) {
  const wsId = currentAgencia === 'taco' ? 'taco' : 'optimizads';
  const targetLower = String(hex || '').toLowerCase();
  return clients.find(function(c) {
    if (c.workspaceId !== wsId) return false;
    const col = c.color || TAREAS_CLIENTE_COLORS[c.id];
    return col && String(col).toLowerCase() === targetLower;
  }) || null;
}

function _qcRenderSwatches() {
  const cont = document.getElementById('qc-swatches');
  if (!cont) return;
  const used = _qcGetUsedColorsInWorkspace();
  const palette = _qcPaletteColors();
  cont.innerHTML = palette.map(function(p) {
    const isSelected = (_qcSelectedColor || '').toLowerCase() === p.hex.toLowerCase();
    const isUsed = used.has(p.hex.toLowerCase());
    return ''
      + '<div onclick="_qcSelectColor(\'' + p.hex + '\')" data-color="' + p.hex + '" '
      +   'title="' + p.key + (isUsed ? ' · en uso' : ' · libre') + '" '
      +   'style="width:32px;height:32px;border-radius:8px;background:' + p.hex + ';'
      +   'cursor:pointer;position:relative;transition:transform 0.1s;'
      +   'border:2px solid ' + (isSelected ? 'var(--text)' : 'transparent') + ';'
      +   'box-shadow:0 0 0 2px ' + (isSelected ? 'var(--accent)' : 'transparent') + ';" '
      +   'onmouseover="this.style.transform=\'scale(1.08)\'" '
      +   'onmouseout="this.style.transform=\'scale(1)\'">'
      +   (isSelected ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:700;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.4);">✓</div>' : '')
      +   (isUsed && !isSelected ? '<div style="position:absolute;bottom:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:var(--text3);border:2px solid var(--surface);pointer-events:none;" title="ya en uso"></div>' : '')
      + '</div>';
  }).join('');
  _qcUpdateColorHint();
}

function _qcUpdateColorHint() {
  const hint = document.getElementById('qc-color-hint');
  if (!hint) return;
  if (!_qcSelectedColor) { hint.textContent = ''; return; }
  const existing = _qcClienteUsingColor(_qcSelectedColor);
  if (existing) {
    hint.textContent = '⚠ Este color ya lo usa ' + (existing.nombre || existing.id);
    hint.style.color = 'var(--yellow)';
  } else {
    hint.textContent = '✓ Color libre';
    hint.style.color = 'var(--text3)';
  }
}

function _qcSelectColor(hex) {
  _qcSelectedColor = hex;
  _qcRenderSwatches();
}

function _qcShowError(msg) {
  const el = document.getElementById('qc-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function _qcClearError() {
  const el = document.getElementById('qc-error');
  if (el) el.style.display = 'none';
}

// BUG #15 PARTE B helpers — toggle tipo + disabled state del btn Crear.
function _qcGetSelectedTipo() {
  const radio = document.querySelector('#qc-tipo-group input[name="qc-tipo"]:checked');
  return radio ? radio.value : null;
}

function _qcUpdateCreateBtn() {
  const btn = document.getElementById('qc-btn-crear');
  if (!btn) return;
  const tipo = _qcGetSelectedTipo();
  const nombreInput = document.getElementById('qc-nombre');
  const nombre = (nombreInput ? nombreInput.value : '').trim();
  const enabled = !!tipo && nombre.length > 0;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.4';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

function _qcOnTipoChange() {
  _qcClearError();
  _qcUpdateCreateBtn();
}

function openQuickClientModal() {
  // Reset state cada vez que se abre.
  _qcSelectedColor = _qcNextFreeColor();
  _qcClearError();
  const nombreInput = document.getElementById('qc-nombre');
  if (nombreInput) nombreInput.value = '';
  // PARTE B: limpiar selección de tipo (sin default) y deshabilitar btn Crear.
  document.querySelectorAll('#qc-tipo-group input[name="qc-tipo"]').forEach(function(r) { r.checked = false; });
  _qcUpdateCreateBtn();
  _qcRenderSwatches();
  document.getElementById('modal-quick-client').classList.add('open');
  setTimeout(function() {
    const i = document.getElementById('qc-nombre');
    if (i) i.focus();
  }, 50);
}

async function createQuickClient() {
  _qcClearError();
  // PARTE B: tipo requerido.
  const tipo = _qcGetSelectedTipo();
  if (tipo !== 'cliente' && tipo !== 'division') {
    _qcShowError('Selecciona si es cliente externo o división interna');
    return;
  }
  const nombreInput = document.getElementById('qc-nombre');
  const nombre = (nombreInput ? nombreInput.value : '').trim();
  if (!nombre) {
    _qcShowError('Nombre requerido');
    if (nombreInput) nombreInput.focus();
    return;
  }
  if (_clienteNombreExistsInActiveWorkspace(nombre)) {
    _qcShowError('Ya existe un cliente con ese nombre en este workspace');
    if (nombreInput) nombreInput.focus();
    return;
  }
  const color = _qcSelectedColor || _qcNextFreeColor();
  if (!color) {
    _qcShowError('Selecciona un color');
    return;
  }

  const wsId = currentAgencia === 'taco' ? 'taco' : 'optimizads';
  const colorDuplicado = _qcClienteUsingColor(color);

  // PARTE B: estructura por tipo.
  //  - cliente: shape completo con campos vacíos del expediente. Respeta los
  //    types que el resto del código asume: vault como array (.push/.slice),
  //    decisiones array, adn/objetivos/rendimiento/segmentos/validacion/creativos
  //    objetos (sub-secciones del wizard). sem_stars/sem_comm_count number.
  //  - division: shape mínimo. Sin expediente, sin semáforo. Solo metadata
  //    suficiente para Tareas Clientes + Mi Semana.
  const baseClient = {
    id: 'client-' + Date.now(),
    workspaceId: wsId,
    nombre: nombre,
    color: color,
    tipo: tipo,
    createdAt: new Date().toISOString(),
    createdBy: currentRol || 'unknown',
  };
  const client = (tipo === 'cliente')
    ? Object.assign({}, baseClient, {
        vault: [],
        decisiones: [],
        sem_stars: 0,
        sem_comm_count: 0,
        adn: {}, objetivos: {}, rendimiento: {}, segmentos: {}, validacion: {}, creativos: {},
      })
    : baseClient;

  // BUG #11 fix: loading state + await Firestore writes en paralelo con timeout.
  // Antes había dos fire-and-forget (saveClients L230 + seed tareas-clientes L247)
  // que dejaban window de race entre creación local y reload del usuario.
  const btn = document.getElementById('qc-btn-crear');
  const originalText = btn ? btn.textContent : 'Crear';
  if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

  clients.push(client);

  try {
    const withTimeout = function(p, ms) {
      return Promise.race([
        Promise.resolve(p),
        new Promise(function(_, rej) { setTimeout(function() { rej(new Error('Timeout Firestore')); }, ms); })
      ]);
    };
    const _tcRef = tareasCliFirestoreRef(client.id);
    const seedP = _tcRef ? _tcRef.set(tareasCliEmptyDoc(client.id)) : Promise.resolve();
    await Promise.all([
      withTimeout(saveClients(), 10000),
      withTimeout(seedP, 10000),
    ]);
    // Hidratar cache local tareas-clientes (lo que antes hacía el .then del fire-and-forget).
    try { tareasCliSaveCache(client.id, tareasCliEmptyDoc(client.id)); } catch (e) {}
  } catch (err) {
    console.error('[BUG#11] createQuickClient falló:', err);
    // Rollback del push local para que el cliente no quede zombie en la UI.
    const idx = clients.findIndex(function(c) { return c.id === client.id; });
    if (idx >= 0) clients.splice(idx, 1);
    // Rollback localStorage para consistencia con clients[] en memoria
    // (sin esto, el cliente falla en Firestore pero queda en 'oa-clients'
    // y mergeClients lo puede resucitar como zombie al recargar offline).
    try { localStorage.setItem("oa-clients", JSON.stringify(clients)); } catch(e){}
    _qcShowError(err && err.message === 'Timeout Firestore'
      ? 'Tardó demasiado en guardar. Verifica conexión y reintenta.'
      : 'Error al crear cliente. Intenta de nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    return;
  }

  // Audit + integraciones (mismo flow que wizard largo).
  if (window.OptixAudit) {
    try { window.OptixAudit.Audit.clientCreated(client.id, { nombre: client.nombre, workspaceId: client.workspaceId }); } catch (e) {}
  }
  if (window.OptixIntegraciones) {
    try { window.OptixIntegraciones.emit(window.OptixIntegraciones.OptixEvents.CLIENT_CREATED, { clientId: client.id, nombre: client.nombre }); } catch (e) {}
  }

  if (btn) { btn.textContent = originalText; btn.disabled = false; }
  closeModal('modal-quick-client');
  _qcSelectedColor = null;

  showToast("Cliente '" + nombre + "' creado", '✅');

  // Re-render Tareas v4.0 vista Clientes si está activa.
  // El onSnapshot de _fbOnClientsChange también dispara pero suele tener
  // latencia; render directo asegura update inmediato.
  if (typeof renderTareasCli === 'function') {
    try { renderTareasCli(); } catch (e) {}
  }

  // Warning post-creación si el color elegido ya estaba en uso por otro cliente.
  if (colorDuplicado) {
    setTimeout(function() {
      showToast("Color compartido con '" + (colorDuplicado.nombre || colorDuplicado.id) + "'", '⚠️');
    }, 1200);
  }
}

// ════════════════════════════════════════════════════════════════
// MÓDULO TAREAS v2.0 — antes index.html L8329-9170
// (escapeHtml() omitida aquí: viene del import de utils.js)
// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════
// MÓDULO TAREAS — v2.0 · 17 Mar 2026
// Arquitectura: PARA 3 niveles (Área → Proyecto → Tarea)
// Storage: localStorage bajo tareas_v2_{wsId}
// Solo visible para wsId = optimizads
// Fase 1: áreas + proyectos + tareas + checkbox
// Fase 2 (pending): fechas, Calendar, asignar a persona
// Fase 3 (pending): Firestore bajo workspaces/optimizads/tareas
// ══════════════════════════════════════════

function tareasGetKey() {
  const wsId = currentAgencia || 'optimizads';
  return 'tareas_v2_' + wsId;
}

// ── F3/F7: helpers de fecha y notas ──────────────────────
function tareasGetHoy() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}
function tareasFormatFecha(yyyymmdd) {
  if (!yyyymmdd) return '';
  const parts = yyyymmdd.split('-');
  if (parts.length !== 3) return yyyymmdd;
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const mi = parseInt(parts[1], 10) - 1;
  return parseInt(parts[2], 10) + ' ' + (meses[mi] || parts[1]);
}
function tareasRenderFechaChip(tarea) {
  // Compat: tarea.fecha legacy = fechaLimite
  const fechaIdeal = tarea.fechaIdeal || null;
  const fechaLimite = tarea.fechaLimite || tarea.fecha || null;
  if (!fechaIdeal && !fechaLimite) return '';
  const hoy = tareasGetHoy();
  const chips = [];
  if (fechaIdeal) {
    chips.push('<span class="tarea-fecha-chip" title="Fecha ideal">📅 ' + tareasFormatFecha(fechaIdeal) + '</span>');
  }
  if (fechaLimite) {
    let cls = 'tarea-fecha-chip';
    if (fechaLimite < hoy) cls += ' deadline-passed';
    else {
      // mañana = hoy + 1
      const d = new Date(hoy + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const manana = d.getFullYear() + '-' + m + '-' + day;
      if (fechaLimite === hoy || fechaLimite === manana) cls += ' deadline-near';
    }
    chips.push('<span class="' + cls + '" title="Fecha límite">⚠️ ' + tareasFormatFecha(fechaLimite) + '</span>');
  }
  return '<div class="tarea-fecha-chips">' + chips.join('') + '</div>';
}

// ── Firestore sync (workspaces/{wsId}/tareas/{uid}) ──────
let _tareasFirestoreUnsub = null;
let _tareasFirestoreSaveTimer = null;
let _tareasSubscribedPath = null;
function tareasFirestoreRef() {
  if (!window.firebaseDb || !window.currentUser) return null;
  const wsId = currentAgencia || 'optimizads';
  return window.firebaseDb
    .collection('workspaces').doc(wsId)
    .collection('tareas').doc(window.currentUser.uid);
}
async function tareasInitializeFromFirestore() {
  const ref = tareasFirestoreRef();
  if (!ref) return;
  if (_tareasFirestoreUnsub) {
    try { _tareasFirestoreUnsub(); } catch(e) {}
    _tareasFirestoreUnsub = null;
  }
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data();
      if (data && Array.isArray(data.areas)) {
        try { localStorage.setItem(tareasGetKey(), JSON.stringify({ areas: data.areas })); } catch(e) {}
        if (typeof renderTareas === 'function') {
          const screen = document.getElementById('screen-tareas');
          if (screen && screen.classList.contains('active')) renderTareas();
        }
      }
    } else {
      // Seed inicial: subir lo que tenga localStorage (incluye migración v1→v2)
      const local = tareasLoad();
      if (local && local.areas) {
        try {
          await ref.set({ areas: local.areas, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        } catch(e) { console.warn('[tareas] seed Firestore failed', e); }
      }
    }
    _tareasFirestoreUnsub = ref.onSnapshot(snap2 => {
      if (!snap2.exists) return;
      const d = snap2.data();
      if (!d || !Array.isArray(d.areas)) return;
      try { localStorage.setItem(tareasGetKey(), JSON.stringify({ areas: d.areas })); } catch(e) {}
      const screen = document.getElementById('screen-tareas');
      if (screen && screen.classList.contains('active') && typeof renderTareas === 'function') {
        renderTareas();
      }
    }, err => console.warn('[tareas] onSnapshot error', err));
  } catch (e) {
    console.warn('[tareas] Firestore init failed, fallback localStorage', e);
  }
}

// ── MIGRACIÓN v1 → v2 ─────────────────────────────
// Si existen datos v1 (areas[].tareas[]), los migra a v2 (areas[].proyectos[].tareas[])
// creando un proyecto "General" en cada área con las tareas existentes.
function tareasMigrateV1(oldData) {
  return {
    areas: oldData.areas.map(area => ({
      id: area.id,
      nombre: area.nombre,
      collapsed: area.collapsed || false,
      orden: area.orden || 0,
      proyectos: [
        {
          id: 'proy-' + area.id + '-general',
          nombre: 'General',
          collapsed: false,
          orden: 0,
          tareas: (area.tareas || []).map(t => ({ ...t }))
        }
      ]
    }))
  };
}

function tareasLoad() {
  // 1. Intentar cargar v2
  try {
    const raw = localStorage.getItem(tareasGetKey());
    if (raw) return JSON.parse(raw);
  } catch(e) {}

  // 2. Si existe v1, migrar automáticamente
  try {
    const wsId = currentAgencia || 'optimizads';
    const v1raw = localStorage.getItem('tareas_v1_' + wsId);
    if (v1raw) {
      const v1data = JSON.parse(v1raw);
      if (v1data?.areas?.[0]?.tareas) {
        const migrated = tareasMigrateV1(v1data);
        tareasSave(migrated);
        console.log('[Tareas] Migración v1→v2 completada');
        return migrated;
      }
    }
  } catch(e) {}

  // 3. Defaults frescos con 3 niveles
  return {
    areas: [
      {
        id: 'area-optimizads', nombre: 'OptimizAds', collapsed: false, orden: 0,
        proyectos: [
          { id: 'proy-oa-marca',  nombre: 'Marca Personal', collapsed: false, orden: 0, tareas: [] },
          { id: 'proy-oa-ops',    nombre: 'Operaciones',    collapsed: false, orden: 1, tareas: [] }
        ]
      },
      {
        id: 'area-taco', nombre: 'Taco Agency', collapsed: false, orden: 1,
        proyectos: [
          { id: 'proy-taco-usa', nombre: 'Clientes USA', collapsed: false, orden: 0, tareas: [] }
        ]
      },
      {
        id: 'area-marca', nombre: 'Marca Personal', collapsed: false, orden: 2,
        proyectos: [
          { id: 'proy-marca-funnel',    nombre: 'Funnel Diagnóstico Express', collapsed: false, orden: 0, tareas: [] },
          { id: 'proy-marca-contenido', nombre: 'Contenido',                  collapsed: false, orden: 1, tareas: [] }
        ]
      }
    ]
  };
}

function tareasSave(data) {
  try {
    localStorage.setItem(tareasGetKey(), JSON.stringify(data));
  } catch(e) { console.warn('tareasSave error', e); }
  // Debounce 1s para Firestore
  if (_tareasFirestoreSaveTimer) clearTimeout(_tareasFirestoreSaveTimer);
  _tareasFirestoreSaveTimer = setTimeout(() => {
    const ref = tareasFirestoreRef();
    if (!ref) return;
    ref.set({
      areas: data.areas || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(e => console.warn('[tareas] Firestore save failed', e));
  }, 1000);
}

// Contar pendientes globales para el badge del sidebar
function tareasCountPending() {
  const data = tareasLoad();
  return data.areas.reduce((total, area) =>
    total + (area.proyectos || []).reduce((s, p) =>
      s + (p.tareas || []).filter(t => !t.completado).length, 0), 0);
}

function tareasUpdateBadge() {
  const n = tareasCountPending();
  const badge = document.getElementById('tab-tareas-badge');
  if (badge) badge.textContent = n > 0 ? n + ' pendientes' : '';
}

// ── RENDER ──────────────────────────────────────────
function renderTareas() {
  const container = document.getElementById('tareas-body');
  if (!container) return;
  // Guard: si la vista activa es Clientes, no renderear Áreas (toggle v4.0)
  if (typeof tareasGetVistaActiva === 'function' && tareasGetVistaActiva() === 'clientes') return;

  // Lazy init/resubscribe Firestore para el (ws, uid) actual
  if (window.currentUser) {
    const wsId = currentAgencia || 'optimizads';
    const path = 'workspaces/' + wsId + '/tareas/' + window.currentUser.uid;
    if (_tareasSubscribedPath !== path) {
      _tareasSubscribedPath = path;
      tareasInitializeFromFirestore();
    }
  }

  const data = tareasLoad();
  const subtitle = document.getElementById('tareas-subtitle');
  const now = new Date();
  const lunes = new Date(now); lunes.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const dom = new Date(lunes); dom.setDate(lunes.getDate() + 6);
  const fmt = d => d.toLocaleDateString('es-MX', { day:'numeric', month:'short' });
  const totalPending = tareasCountPending();
  const totalAll = data.areas.reduce((s, a) =>
    s + (a.proyectos || []).reduce((sp, p) => sp + (p.tareas || []).length, 0), 0);
  const totalDone = totalAll - totalPending;
  if (subtitle) subtitle.textContent = `Semana ${fmt(lunes)}–${fmt(dom)} · ${totalDone}/${totalAll} completadas`;

  if (data.areas.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 40px; color:var(--text3);">
        <div style="font-size:48px; margin-bottom:16px;">📋</div>
        <div style="font-family:'Syne',sans-serif; font-weight:700; font-size:16px; color:var(--text2); margin-bottom:8px;">Sin áreas todavía</div>
        <div style="font-size:13px; line-height:1.6; margin-bottom:24px;">Crea tu primera área para empezar a organizar tus pendientes.</div>
        <button onclick="tareasAddArea()" class="btn btn-primary" style="font-size:13px;">＋ Nueva área</button>
      </div>`;
    tareasUpdateBadge();
    return;
  }

  container.innerHTML = data.areas.map(area => {
    const proyectos = area.proyectos || [];
    const pendientesArea = proyectos.reduce((s, p) => s + (p.tareas || []).filter(t => !t.completado).length, 0);
    const totalArea = proyectos.reduce((s, p) => s + (p.tareas || []).length, 0);

    const proyectosHTML = proyectos.map(proy => {
      const pendientesProy = (proy.tareas || []).filter(t => !t.completado).length;
      const totalProy = (proy.tareas || []).length;

      const tareasHTML = (proy.tareas || []).map(tarea => {
        const notaKey = area.id + '|' + proy.id + '|' + tarea.id;
        const notaOpen = window._tareasNotasOpen && window._tareasNotasOpen.has(notaKey);
        const hasNota = tarea.notas && tarea.notas.trim().length > 0;
        const fechaChip = tareasRenderFechaChip(tarea);
        const notaTextarea = notaOpen
          ? `<textarea class="tarea-nota-textarea" placeholder="Agrega una nota..." onblur="tareasSaveNota('${area.id}','${proy.id}','${tarea.id}', this.value)">${escapeHtml(tarea.notas || '')}</textarea>`
          : '';
        return `
        <div class="tarea-item" draggable="true"
             ondragstart="tareasDragStart(event,'${area.id}','${proy.id}','${tarea.id}')"
             ondragover="tareasDragOver(event,'${area.id}','${proy.id}','${tarea.id}')"
             ondragleave="tareasDragLeave(event)"
             ondrop="tareasDrop(event,'${area.id}','${proy.id}','${tarea.id}')"
             ondragend="tareasDragEnd(event)">
          <span class="tarea-drag-handle" title="Arrastrar para reordenar">⠿</span>
          <div class="tarea-check ${tarea.completado ? 'done' : ''}"
               onclick="tareasToggle('${area.id}','${proy.id}','${tarea.id}')"
               title="${tarea.completado ? 'Marcar pendiente' : 'Marcar completada'}">
            ${tarea.completado ? '<svg width="8" height="6" viewBox="0 0 9 7" fill="none"><polyline points="1,3.5 3.5,6 8,1" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
          </div>
          <div class="tarea-content">
            <div class="tarea-texto ${tarea.completado ? 'done' : ''}">${escapeHtml(tarea.texto)}</div>
            ${fechaChip}
            ${notaTextarea}
          </div>
          <div class="tarea-actions">
            <button class="tarea-nota-btn ${hasNota ? 'has-nota' : ''}" onclick="tareasToggleNotaInline('${area.id}','${proy.id}','${tarea.id}')" title="Nota">💬</button>
            <button class="tarea-delete" onclick="tareasDeleteTarea('${area.id}','${proy.id}','${tarea.id}')" title="Eliminar">✕</button>
          </div>
        </div>`;
      }).join('');

      return `
        <div class="tareas-proyecto ${proy.collapsed ? 'collapsed' : ''}" id="proy-${proy.id}">
          <div class="tareas-proyecto-header" onclick="tareasToggleProyecto('${area.id}','${proy.id}')">
            <span class="tareas-proyecto-arrow">▾</span>
            <span class="tareas-proyecto-nombre">${escapeHtml(proy.nombre)}</span>
            <span class="tareas-proyecto-count ${pendientesProy > 0 ? 'has-pending' : ''}">${pendientesProy > 0 ? pendientesProy + ' pend.' : (totalProy > 0 ? '✓' : '')}</span>
            <button onclick="event.stopPropagation(); tareasDeleteProyecto('${area.id}','${proy.id}')"
              style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:10px;padding:1px 5px;border-radius:4px;opacity:0;transition:opacity 0.15s;margin-left:4px;"
              onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'"
              title="Eliminar proyecto">✕</button>
          </div>
          <div class="tareas-proyecto-body">
            ${tareasHTML}
            <div id="input-container-${proy.id}"></div>
            <button class="tareas-add-btn" onclick="tareasShowInput('${area.id}','${proy.id}')">＋ Tarea</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="tareas-area ${area.collapsed ? 'collapsed' : ''}" id="area-${area.id}"
           ondragover="tareasAreaDragOver(event,'${area.id}')"
           ondragleave="tareasAreaDragLeave(event)"
           ondrop="tareasAreaDrop(event,'${area.id}')">
        <div class="tareas-area-header" onclick="tareasToggleArea('${area.id}')">
          <span class="tareas-area-drag-handle" title="Arrastrar para reordenar"
                draggable="true"
                ondragstart="tareasAreaDragStart(event,'${area.id}')"
                ondragend="tareasAreaDragEnd(event,'${area.id}')"
                onclick="event.stopPropagation()">⠿</span>
          <span class="tareas-area-arrow">▾</span>
          <span class="tareas-area-nombre">${escapeHtml(area.nombre)}</span>
          <span class="tareas-area-count ${pendientesArea > 0 ? 'has-pending' : ''}">${pendientesArea > 0 ? pendientesArea + ' pendientes' : (totalArea > 0 ? '✓ todo listo' : 'sin tareas')}</span>
          <button onclick="event.stopPropagation(); tareasDeleteArea('${area.id}')"
            style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;padding:2px 6px;border-radius:4px;opacity:0;transition:opacity 0.15s;"
            onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'"
            title="Eliminar área">✕</button>
        </div>
        <div class="tareas-area-body">
          ${proyectosHTML}
          <button class="tareas-add-proyecto-btn" onclick="tareasAddProyecto('${area.id}')">＋ Proyecto</button>
        </div>
      </div>`;
  }).join('');

  tareasUpdateBadge();
}

// ── ACTIONS — ÁREA ───────────────────────────────────
function tareasToggleArea(areaId) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  area.collapsed = !area.collapsed;
  tareasSave(data);
  renderTareas();
}

function tareasAddArea() {
  const nombre = prompt('Nombre del área (ej. EnPagos, Personal):');
  if (!nombre || !nombre.trim()) return;
  const data = tareasLoad();
  const id = 'area-' + Date.now();
  data.areas.push({
    id,
    nombre: nombre.trim(),
    collapsed: false,
    orden: data.areas.length,
    proyectos: [
      { id: 'proy-' + id + '-general', nombre: 'General', collapsed: false, orden: 0, tareas: [] }
    ]
  });
  tareasSave(data);
  renderTareas();
  showToast('Área creada', '✅');
}

function tareasDeleteArea(areaId) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const totalTareas = (area.proyectos || []).reduce((s, p) => s + (p.tareas || []).length, 0);
  const msg = totalTareas > 0
    ? `¿Eliminar el área "${area.nombre}" con ${totalTareas} tarea(s)?`
    : `¿Eliminar el área "${area.nombre}"?`;
  if (!confirm(msg)) return;
  data.areas = data.areas.filter(a => a.id !== areaId);
  tareasSave(data);
  renderTareas();
  showToast('Área eliminada', '🗑️');
}

// ── ACTIONS — PROYECTO ───────────────────────────────
function tareasToggleProyecto(areaId, proyId) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  proy.collapsed = !proy.collapsed;
  tareasSave(data);
  renderTareas();
}

function tareasAddProyecto(areaId) {
  const nombre = prompt('Nombre del proyecto:');
  if (!nombre || !nombre.trim()) return;
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  if (!area.proyectos) area.proyectos = [];
  area.proyectos.push({
    id: 'proy-' + Date.now(),
    nombre: nombre.trim(),
    collapsed: false,
    orden: area.proyectos.length,
    tareas: []
  });
  tareasSave(data);
  renderTareas();
  showToast('Proyecto creado', '✅');
}

function tareasDeleteProyecto(areaId, proyId) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  const tareaCount = (proy.tareas || []).length;
  const msg = tareaCount > 0
    ? `¿Eliminar el proyecto "${proy.nombre}" y sus ${tareaCount} tarea(s)?`
    : `¿Eliminar el proyecto "${proy.nombre}"?`;
  if (!confirm(msg)) return;
  area.proyectos = area.proyectos.filter(p => p.id !== proyId);
  tareasSave(data);
  renderTareas();
  showToast('Proyecto eliminado', '🗑️');
}

// ── ACTIONS — TAREA ──────────────────────────────────
function tareasToggle(areaId, proyId, tareaId) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  const tarea = (proy.tareas || []).find(t => t.id === tareaId);
  if (!tarea) return;
  tarea.completado = !tarea.completado;
  tarea.completadoAt = tarea.completado ? new Date().toISOString() : null;
  tareasSave(data);
  renderTareas();
}

function tareasShowInput(areaId, proyId) {
  const container = document.getElementById('input-container-' + proyId);
  if (!container) return;
  if (container.querySelector('.tareas-inline-input')) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="tareas-inline-container" id="inline-wrap-${proyId}"
         onfocusout="tareasMaybeBlurInput(event,'${areaId}','${proyId}')">
      <div class="tareas-inline-row">
        <input class="tareas-inline-input" id="new-tarea-input-${proyId}"
          type="text" placeholder="Describe la tarea y presiona Enter..."
          onkeydown="tareasHandleInputKey(event,'${areaId}','${proyId}')"
          style="flex:1;">
        <button type="button" class="tareas-fecha-toggle" id="fecha-toggle-${proyId}"
          onmousedown="event.preventDefault()"
          onclick="tareasToggleFechaInputs('${proyId}')" title="Agregar fecha">📅</button>
      </div>
      <div class="tareas-fecha-inputs" id="fecha-inputs-${proyId}">
        <div class="tareas-fecha-input-row">
          <label>📅 Ideal</label>
          <input type="date" id="fecha-ideal-${proyId}">
        </div>
        <div class="tareas-fecha-input-row">
          <label>⚠️ Límite</label>
          <input type="date" id="fecha-limite-${proyId}">
        </div>
      </div>
    </div>`;
  setTimeout(() => document.getElementById('new-tarea-input-' + proyId)?.focus(), 50);
}

function tareasHandleInputKey(e, areaId, proyId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = document.getElementById('new-tarea-input-' + proyId);
    const texto = input?.value?.trim();
    if (texto) {
      // F1: leer fechas, guardar y reabrir input para escribir la siguiente
      const fi = document.getElementById('fecha-ideal-' + proyId)?.value || null;
      const fl = document.getElementById('fecha-limite-' + proyId)?.value || null;
      // Detach focusout en wrapper para evitar doble-add con el render que viene
      const wrap = document.getElementById('inline-wrap-' + proyId);
      if (wrap) wrap.onfocusout = null;
      tareasAddTarea(areaId, proyId, texto, fi, fl);
      setTimeout(() => tareasShowInput(areaId, proyId), 0);
    } else {
      const c = document.getElementById('input-container-' + proyId);
      if(c) c.innerHTML = '';
    }
  }
  if (e.key === 'Escape') {
    const c = document.getElementById('input-container-' + proyId);
    if (c) c.innerHTML = '';
  }
}

function tareasMaybeBlurInput(e, areaId, proyId) {
  // Si el foco sigue dentro del wrapper (ej. usuario clickeó el input de fecha), no guardar.
  const wrap = document.getElementById('inline-wrap-' + proyId);
  if (wrap && e && e.relatedTarget && wrap.contains(e.relatedTarget)) return;
  setTimeout(() => {
    const w = document.getElementById('inline-wrap-' + proyId);
    if (!w) return;
    if (document.activeElement && w.contains(document.activeElement)) return;
    const input = document.getElementById('new-tarea-input-' + proyId);
    const texto = input?.value?.trim();
    if (texto) {
      const fi = document.getElementById('fecha-ideal-' + proyId)?.value || null;
      const fl = document.getElementById('fecha-limite-' + proyId)?.value || null;
      tareasAddTarea(areaId, proyId, texto, fi, fl);
    } else {
      const c = document.getElementById('input-container-' + proyId);
      if(c) c.innerHTML = '';
    }
  }, 150);
}

function tareasToggleFechaInputs(proyId) {
  const el = document.getElementById('fecha-inputs-' + proyId);
  if (!el) return;
  el.classList.toggle('open');
}

function tareasAddTarea(areaId, proyId, texto, fechaIdeal, fechaLimite) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  const tarea = {
    id: 'tarea-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    texto: texto.trim(),
    completado: false,
    completadoAt: null,
    fechaIdeal: fechaIdeal || null,
    fechaLimite: fechaLimite || null,
    fecha: null,           // Legacy compat (no usar)
    calendarEventId: null,
    asignadoA: null,
    notas: null,
    createdAt: new Date().toISOString()
  };
  if (!proy.tareas) proy.tareas = [];
  proy.tareas.push(tarea);
  tareasSave(data);
  renderTareas();
}

// ── F7: notas inline ─────────────────────────────────────
window._tareasNotasOpen = window._tareasNotasOpen || new Set();
function tareasToggleNotaInline(areaId, proyId, tareaId) {
  const key = areaId + '|' + proyId + '|' + tareaId;
  if (window._tareasNotasOpen.has(key)) window._tareasNotasOpen.delete(key);
  else window._tareasNotasOpen.add(key);
  renderTareas();
  if (window._tareasNotasOpen.has(key)) {
    setTimeout(() => {
      const ta = document.querySelector('.tarea-nota-textarea');
      // Buscar el textarea correcto: el último renderizado (heurística simple)
      const all = document.querySelectorAll('.tarea-nota-textarea');
      const last = all[all.length - 1];
      if (last) { last.focus(); last.setSelectionRange(last.value.length, last.value.length); }
    }, 30);
  }
}
function tareasSaveNota(areaId, proyId, tareaId, val) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  const tarea = (proy.tareas || []).find(t => t.id === tareaId);
  if (!tarea) return;
  const trimmed = (val || '').trim();
  tarea.notas = trimmed || null;
  tareasSave(data);
  // No re-render aquí: perdería foco. La próxima render mostrará el cambio.
}

// ── F6: drag & drop para reordenar tareas dentro del mismo proyecto ──
window._dragTareaCtx = null;
function tareasDragStart(e, areaId, proyId, tareaId) {
  // Si el target inicial es checkbox/delete/nota/textarea, abortar
  if (e.target && e.target.closest && e.target.closest('.tarea-check, .tarea-delete, .tarea-nota-btn, .tarea-nota-textarea, input, textarea')) {
    e.preventDefault();
    return false;
  }
  window._dragTareaCtx = { areaId: areaId, proyId: proyId, tareaId: tareaId };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', tareaId); } catch(err) {}
  }
  e.currentTarget.classList.add('dragging');
  // Evitar que dragstart burbujee al handler del área padre (defensa en profundidad)
  e.stopPropagation();
}
function tareasDragOver(e, areaId, proyId, tareaId) {
  const ctx = window._dragTareaCtx;
  if (!ctx || ctx.areaId !== areaId || ctx.proyId !== proyId) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const rect = e.currentTarget.getBoundingClientRect();
  const middle = rect.top + rect.height / 2;
  e.currentTarget.classList.remove('drop-before','drop-after');
  if (e.clientY < middle) e.currentTarget.classList.add('drop-before');
  else e.currentTarget.classList.add('drop-after');
}
function tareasDragLeave(e) {
  e.currentTarget.classList.remove('drop-before','drop-after');
}
function tareasDrop(e, areaId, proyId, targetTareaId) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drop-before','drop-after');
  const ctx = window._dragTareaCtx;
  window._dragTareaCtx = null;
  if (!ctx || ctx.areaId !== areaId || ctx.proyId !== proyId) return;
  if (ctx.tareaId === targetTareaId) return;
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  const arr = proy.tareas || [];
  const fromIdx = arr.findIndex(t => t.id === ctx.tareaId);
  if (fromIdx === -1) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const middle = rect.top + rect.height / 2;
  const insertAfter = e.clientY >= middle;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(t => t.id === targetTareaId);
  if (toIdx === -1) { arr.push(moved); proy.tareas = arr; tareasSave(data); renderTareas(); return; }
  if (insertAfter) toIdx += 1;
  arr.splice(toIdx, 0, moved);
  proy.tareas = arr;
  tareasSave(data);
  renderTareas();
}
function tareasDragEnd(e) {
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.tarea-item.drop-before, .tarea-item.drop-after')
    .forEach(el => el.classList.remove('drop-before','drop-after'));
  window._dragTareaCtx = null;
}

// ── F6b: drag & drop de cards de área ──────────────────
window._dragAreaId = null;
function tareasAreaDragStart(e, areaId) {
  // Dragstart nace en el handle span (draggable=true). No hay ambigüedad: aquí siempre es drag de área.
  window._dragAreaId = areaId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'area:' + areaId); } catch(err) {}
    // Ghost visual: usar la card entera, no el handle diminuto
    const areaEl = document.getElementById('area-' + areaId);
    if (areaEl && e.dataTransfer.setDragImage) {
      try { e.dataTransfer.setDragImage(areaEl, 20, 20); } catch(err) {}
    }
  }
  const areaEl2 = document.getElementById('area-' + areaId);
  if (areaEl2) areaEl2.classList.add('area-dragging');
}
function tareasAreaDragOver(e, areaId) {
  if (!window._dragAreaId || window._dragAreaId === areaId) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const rect = e.currentTarget.getBoundingClientRect();
  const middle = rect.left + rect.width / 2;
  e.currentTarget.classList.remove('area-drop-before','area-drop-after');
  if (e.clientX < middle) e.currentTarget.classList.add('area-drop-before');
  else e.currentTarget.classList.add('area-drop-after');
}
function tareasAreaDragLeave(e) {
  e.currentTarget.classList.remove('area-drop-before','area-drop-after');
}
function tareasAreaDrop(e, targetAreaId) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('area-drop-before','area-drop-after');
  const sourceId = window._dragAreaId;
  window._dragAreaId = null;
  if (!sourceId || sourceId === targetAreaId) return;
  const data = tareasLoad();
  const arr = data.areas || [];
  const fromIdx = arr.findIndex(a => a.id === sourceId);
  if (fromIdx === -1) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const middle = rect.left + rect.width / 2;
  const insertAfter = e.clientX >= middle;
  const [moved] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(a => a.id === targetAreaId);
  if (toIdx === -1) { arr.push(moved); }
  else {
    if (insertAfter) toIdx += 1;
    arr.splice(toIdx, 0, moved);
  }
  // Refrescar el campo orden para que sea consistente
  arr.forEach((a, i) => { a.orden = i; });
  data.areas = arr;
  tareasSave(data);
  renderTareas();
}
function tareasAreaDragEnd(e, areaId) {
  // currentTarget es el handle span. Limpiar visual del área por id.
  if (areaId) {
    const areaEl = document.getElementById('area-' + areaId);
    if (areaEl) areaEl.classList.remove('area-dragging');
  }
  document.querySelectorAll('.tareas-area.area-drop-before, .tareas-area.area-drop-after')
    .forEach(el => el.classList.remove('area-drop-before','area-drop-after'));
  document.querySelectorAll('.tareas-area.area-dragging')
    .forEach(el => el.classList.remove('area-dragging'));
  window._dragAreaId = null;
}

// ── F4: tareas pendientes hoy + render para Junior ─────────
function tareasGetPendientesHoy(clienteNombre) {
  if (!clienteNombre) return [];
  const data = tareasLoad();
  const hoy = tareasGetHoy();
  const needle = String(clienteNombre).toLowerCase();
  const matches = [];
  (data.areas || []).forEach(area => {
    if (!area.nombre || !area.nombre.toLowerCase().includes(needle)) return;
    (area.proyectos || []).forEach(proy => {
      (proy.tareas || []).forEach(tarea => {
        if (tarea.completado) return;
        const fl = tarea.fechaLimite || tarea.fecha;
        const fi = tarea.fechaIdeal;
        if (fl === hoy || fi === hoy || (fl && fl < hoy)) {
          matches.push({ areaId: area.id, proyId: proy.id, tarea: tarea });
        }
      });
    });
  });
  return matches;
}
function renderJrTareaPendiente(m) {
  const tarea = m.tarea;
  const areaId = m.areaId;
  const proyId = m.proyId;
  const fl = tarea.fechaLimite || tarea.fecha;
  const hoy = tareasGetHoy();
  const venc = fl && fl < hoy;
  const chip = fl
    ? `<span style="font-size:10px;font-family:'DM Mono',monospace;background:${venc ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.14)'};color:${venc ? 'var(--red)' : 'var(--yellow)'};padding:2px 7px;border-radius:4px;flex-shrink:0;">${venc ? '🔴' : '⚠️'} ${tareasFormatFecha(fl)}</span>`
    : '';
  const origenChip = '<span style="font-size:10px;font-family:\'DM Mono\',monospace;background:rgba(245,158,11,0.14);color:var(--yellow);padding:2px 7px;border-radius:4px;flex-shrink:0;">📂 Área interna</span>';
  const nota = tarea.notas
    ? `<div style="font-size:11px;color:var(--text3);font-style:italic;margin-top:4px;">${escapeHtml(tarea.notas)}</div>`
    : '';
  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px;cursor:pointer;transition:all 0.15s;" onclick="tareasToggle('${areaId}','${proyId}','${tarea.id}'); loadJrChecklist();" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="width:18px;height:18px;border:2px solid ${tarea.completado ? 'var(--green)' : 'var(--border2)'};border-radius:5px;background:${tarea.completado ? 'var(--green)' : 'transparent'};flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-top:1px;">
        ${tarea.completado ? '<svg width="10" height="8" viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/></svg>' : ''}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;color:${tarea.completado ? 'var(--text3)' : 'var(--text1)'};text-decoration:${tarea.completado ? 'line-through' : 'none'};line-height:1.4;">${escapeHtml(tarea.texto)}</div>
        ${nota}
      </div>
      ${chip}
      ${origenChip}
    </div>`;
}

// ── F5: Senior — panel de tareas del equipo (solo lectura) ──
function seniorToggleTareasPanel() {
  const panel = document.getElementById('sen-tareas-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  try { localStorage.setItem('sen-tareas-panel-open', isOpen ? '0' : '1'); } catch(e) {}
  if (!isOpen) renderSeniorTareasPanel();
}
function renderSeniorTareasPanel() {
  const content = document.getElementById('sen-tareas-panel-content');
  if (!content) return;
  const data = tareasLoad();
  const hoy = tareasGetHoy();
  let totalPendientes = 0;
  let totalVencidas = 0;
  const areasHTML = (data.areas || []).map(area => {
    const proyectosHTML = (area.proyectos || []).map(proy => {
      const pendientes = (proy.tareas || []).filter(t => !t.completado);
      if (pendientes.length === 0) return '';
      const tareasHTML = pendientes.map(t => {
        totalPendientes++;
        const fl = t.fechaLimite || t.fecha;
        const venc = fl && fl <= hoy;
        if (venc) totalVencidas++;
        const chip = fl
          ? `<span style="font-size:10px;font-family:'DM Mono',monospace;background:${venc ? 'rgba(239,68,68,0.14)' : 'var(--surface2)'};color:${venc ? 'var(--red)' : 'var(--text3)'};padding:2px 7px;border-radius:4px;margin-left:8px;flex-shrink:0;">${venc ? '🔴' : '📅'} ${tareasFormatFecha(fl)}</span>`
          : '';
        return `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px dashed var(--border);font-size:12px;color:var(--text2);"><span style="flex:1;min-width:0;">${escapeHtml(t.texto)}</span>${chip}</div>`;
      }).join('');
      return `
        <div style="margin:10px 0 14px 16px;">
          <div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:11px;color:var(--text3);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(proy.nombre)} · ${pendientes.length}</div>
          ${tareasHTML}
        </div>`;
    }).filter(s => s).join('');
    if (!proyectosHTML) return '';
    return `
      <div style="margin-bottom:14px;">
        <div style="font-family:'DM Sans',sans-serif;font-weight:700;font-size:13px;color:var(--text);margin-bottom:6px;">${escapeHtml(area.nombre)}</div>
        ${proyectosHTML}
      </div>`;
  }).filter(s => s).join('');

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-family:'DM Sans',sans-serif;font-weight:700;font-size:14px;color:var(--text);">✅ Tareas del equipo</div>
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text3);margin-top:2px;">Solo lectura · ${totalPendientes} pendiente${totalPendientes===1?'':'s'}</div>
      </div>
      ${totalVencidas > 0 ? `<div style="background:rgba(239,68,68,0.14);color:var(--red);font-family:'DM Mono',monospace;font-size:11px;padding:6px 12px;border-radius:8px;font-weight:600;">🔴 ${totalVencidas} vencida${totalVencidas===1?'':'s'}</div>` : ''}
    </div>`;

  content.innerHTML = header + (areasHTML || '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">Sin tareas pendientes 🎉</div>');
}

function tareasDeleteTarea(areaId, proyId, tareaId) {
  const data = tareasLoad();
  const area = data.areas.find(a => a.id === areaId);
  if (!area) return;
  const proy = (area.proyectos || []).find(p => p.id === proyId);
  if (!proy) return;
  proy.tareas = (proy.tareas || []).filter(t => t.id !== tareaId);
  tareasSave(data);
  renderTareas();
}

// ════════════════════════════════════════════════════════════════
// MÓDULO TAREAS v4.0 · Vista Clientes — antes index.html L9174-10691
// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// MÓDULO TAREAS — v4.0 · Vista Clientes
// SPEC: canvas Slack F0B1GB23QH1 "SPEC Optix — Tareas v4.0"
// Fase 2: storage layer (Firestore + localStorage cache + versionado optimista)
// Doc: workspaces/{wsId}/tareas-clientes/{clientId}
// ══════════════════════════════════════════════════════════════

// Paleta cliente (corrección S62.6.3.A — no choca con --green/--yellow).
// F2b (S74): single source of truth. Importada por modules/mi-semana.js como
// named import. Shim previo en index.html <head> eliminado en el mismo refactor.
export const TAREAS_CLIENTE_COLORS = {
  'enpagos':     '#059669',
  'inmobili':    '#a855f7',
  'bodygreen':   '#65a30d',
  'luzyla':      '#ca8a04',
  'divisas':     '#dc2626',
  'tuyo-health': '#06b6d4',
  'favio':       '#ec4899',
  '_fallback':   '#64748b'
};

const _tareasCliMemCache = {};
const _tareasCliUnsubs = {};       // { clientId: unsubFn }

function tareasCliCacheKey(clientId) {
  const wsId = currentAgencia || 'optimizads';
  return 'tareasCli_v1_' + wsId + '_' + clientId;
}

function tareasCliFirestoreRef(clientId) {
  if (!window.firebaseDb || !window.currentUser || !clientId) return null;
  const wsId = currentAgencia || 'optimizads';
  return window.firebaseDb
    .collection('workspaces').doc(wsId)
    .collection('tareas-clientes').doc(clientId);
}

function tareasCliEmptyDoc(clientId) {
  return {
    clientId: clientId,
    orden: 0,
    collapsed: false,
    version: 0,
    objetivos: [],
    updatedAt: null,
    updatedBy: null
  };
}

function tareasCliLoadCache(clientId) {
  try {
    const raw = localStorage.getItem(tareasCliCacheKey(clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    _tareasCliMemCache[clientId] = parsed;
    return parsed;
  } catch (e) {
    console.warn('[tareasCli] loadCache failed', clientId, e);
    return null;
  }
}

function tareasCliSaveCache(clientId, data) {
  try {
    localStorage.setItem(tareasCliCacheKey(clientId), JSON.stringify(data));
    _tareasCliMemCache[clientId] = data;
  } catch (e) {
    console.warn('[tareasCli] saveCache failed', clientId, e);
  }
}

// Toast de conflicto — modal CSS, NO alert() nativo (corrección G)
function tareasCliShowConflictToast(clientId) {
  const id = 'tareasCli-conflict-toast';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:var(--surface);border:1px solid var(--red);border-radius:10px;padding:14px 18px;font-family:\'DM Sans\',sans-serif;font-size:13px;color:var(--text);box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:340px;';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="font-weight:600;color:var(--red);margin-bottom:4px;">Conflicto de versión</div>'
    + '<div style="color:var(--text2);line-height:1.5;">Otro usuario editó <strong>' + escapeHtml(clientId) + '</strong>. Refrescando datos. Tu cambio se descartó — vuelve a aplicarlo.</div>';
  el.style.display = 'block';
  setTimeout(function() { if (el) el.style.display = 'none'; }, 6000);
}

async function tareasCliInitFromFirestore(clientId) {
  const ref = tareasCliFirestoreRef(clientId);
  if (!ref) return null;

  if (_tareasCliUnsubs[clientId]) {
    try { _tareasCliUnsubs[clientId](); } catch(e) {}
    delete _tareasCliUnsubs[clientId];
  }

  try {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : tareasCliEmptyDoc(clientId);
    tareasCliSaveCache(clientId, data);

    _tareasCliUnsubs[clientId] = ref.onSnapshot(function(snap2) {
      if (!snap2.exists) {
        tareasCliSaveCache(clientId, tareasCliEmptyDoc(clientId));
        return;
      }
      const d = snap2.data();
      if (!d) return;
      tareasCliSaveCache(clientId, d);
      if (typeof renderTareasCli === 'function') {
        try { renderTareasCli(); } catch(e) {}
      }
    }, function(err) { console.warn('[tareasCli] onSnapshot error', clientId, err); });

    return data;
  } catch (e) {
    console.warn('[tareasCli] init failed, fallback cache', clientId, e);
    return tareasCliLoadCache(clientId);
  }
}

function tareasCliUnsubAll() {
  Object.keys(_tareasCliUnsubs).forEach(function(k) {
    try { _tareasCliUnsubs[k](); } catch(e) {}
    delete _tareasCliUnsubs[k];
  });
}

// Save con versionado optimista — 3 retries con backoff 200/400/600ms.
// mutator: (baseDoc) => newDoc. Recibe un clon mutable; retorna el draft a persistir.
// Conflict tras 3 retries: toast + re-fetch + descartar cambio local (Opción A simplificada, S62.6.2 #2).
export async function tareasCliSave(clientId, mutator) {
  const ref = tareasCliFirestoreRef(clientId);
  if (!ref) {
    console.warn('[tareasCli] save: no ref (offline o unauth)', clientId);
    return null;
  }
  const delays = [200, 400, 600];

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const result = await window.firebaseDb.runTransaction(async function(tx) {
        const snap = await tx.get(ref);
        const baseDoc = snap.exists ? snap.data() : tareasCliEmptyDoc(clientId);
        const draft = mutator(JSON.parse(JSON.stringify(baseDoc)));
        if (!draft) throw new Error('MUTATOR_RETURNED_NULL');
        draft.clientId = clientId;
        draft.version = (baseDoc.version || 0) + 1;
        draft.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        draft.updatedBy = (window.currentUser && window.currentUser.uid) || 'anon';
        tx.set(ref, draft);
        return draft;
      });
      // serverTimestamp aún sin resolver hasta onSnapshot; cache local con Date.now() temporal
      tareasCliSaveCache(clientId, Object.assign({}, result, { updatedAt: Date.now() }));
      return result;
    } catch (e) {
      if (attempt < 3) {
        await new Promise(function(r) { setTimeout(r, delays[attempt]); });
        continue;
      }
      console.warn('[tareasCli] save failed after 3 retries', clientId, e);
      tareasCliShowConflictToast(clientId);
      try { await tareasCliInitFromFirestore(clientId); } catch(e2) {}
      return null;
    }
  }
  return null;
}

// ── Vista toggle Áreas/Clientes (corrección S62.6.3.E) ───────────────────────
// localStorage: 'tareas-vista-active' = 'areas' | 'clientes'

function tareasGetVistaActiva() {
  const stored = localStorage.getItem('tareas-vista-active');
  if (stored === 'areas' || stored === 'clientes') return stored;
  return 'areas';
}

function tareasSetVista(vista) {
  if (vista !== 'areas' && vista !== 'clientes') vista = 'areas';
  localStorage.setItem('tareas-vista-active', vista);
  tareasApplyVista();
}

function tareasApplyVista() {
  const vista = tareasGetVistaActiva();
  const areasBody = document.getElementById('tareas-body');
  const cliBody = document.getElementById('tareas-cli-body');
  const viewportMsg = document.getElementById('tareas-cli-viewport-msg');
  const btnAddArea = document.getElementById('btn-tareas-add-area');
  const toggle = document.getElementById('tareas-vista-toggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(function(b) {
      b.classList.toggle('active', b.dataset.vista === vista);
    });
  }
  const banner = document.getElementById('tareas-cli-atrasadas-banner');
  const btnHelp = document.getElementById('btn-tareas-cli-help');
  const btnQuickClient = document.getElementById('btn-quick-client');
  if (vista === 'areas') {
    if (areasBody) areasBody.style.display = '';
    if (cliBody) cliBody.style.display = 'none';
    if (viewportMsg) viewportMsg.style.display = 'none';
    if (banner) banner.style.display = 'none';
    if (btnAddArea) btnAddArea.style.display = '';
    if (btnHelp) btnHelp.style.display = 'none';
    if (btnQuickClient) btnQuickClient.style.display = 'none';
    if (typeof renderTareas === 'function') renderTareas();
    return;
  }
  // vista === 'clientes'
  if (areasBody) areasBody.style.display = 'none';
  if (btnAddArea) btnAddArea.style.display = 'none';
  if (btnHelp) btnHelp.style.display = '';
  if (btnQuickClient) btnQuickClient.style.display = '';
  if (window.innerWidth < 1280) {
    if (cliBody) cliBody.style.display = 'none';
    if (banner) banner.style.display = 'none';
    if (viewportMsg) viewportMsg.style.display = '';
    return;
  }
  if (viewportMsg) viewportMsg.style.display = 'none';
  if (cliBody) cliBody.style.display = '';
  renderTareasCli();
  if (typeof tareasCliRenderAtrasadasBanner === 'function') tareasCliRenderAtrasadasBanner();
  // Onboarding tooltip per-uid (S62.6.2 #8) — solo primera vez por user.
  if (typeof tareasCliMaybeShowOnboarding === 'function') tareasCliMaybeShowOnboarding();
}

// Re-evaluar al cruzar el threshold 1280
window.addEventListener('resize', function() {
  if (tareasGetVistaActiva() === 'clientes') {
    const screen = document.getElementById('screen-tareas');
    if (screen && screen.classList.contains('active')) tareasApplyVista();
  }
});

// ── CSS toggle (lazy, solo se inyecta una vez) ─────────────
function _ensureTareasCliCSS() {
  if (document.getElementById('tareasCliVistaCSS')) return;
  const s = document.createElement('style');
  s.id = 'tareasCliVistaCSS';
  s.textContent = ''
    + '.tareas-vista-toggle { display:inline-flex; background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:3px; gap:2px; }'
    + '.tareas-vista-toggle button { background:transparent; border:none; color:var(--text3); font-family:\'DM Sans\',sans-serif; font-size:12px; font-weight:600; padding:6px 12px; border-radius:6px; cursor:pointer; transition:all 0.15s; }'
    + '.tareas-vista-toggle button:hover:not(.active) { color:var(--text2); }'
    + '.tareas-vista-toggle button.active { background:var(--accent); color:#000; }'
    + '.tareas-cli-card { transition:border-color 0.15s; }'
    + '.tareas-cli-card:hover { border-color:var(--border2); }'
    // S67 1.3: botón "+ Subtask" oculto por default; aparece on-hover en tareas top-level.
    + '.tareas-cli-add-subtask-btn { opacity:0; transition:opacity 0.15s; }'
    + '.tareas-cli-tarea-row:hover .tareas-cli-add-subtask-btn { opacity:1; }'
    // delete-client-v1 polish: × minimalista, invisible default, aparece on-hover de la card.
    + '.tareas-cli-delete-btn { background:transparent; border:none; cursor:pointer; padding:0 4px; line-height:1; font-size:18px; color:#9ca3af; opacity:0; transition:opacity 150ms ease, color 150ms ease; flex-shrink:0; }'
    + '.tareas-cli-card:hover .tareas-cli-delete-btn { opacity:0.6; }'
    + '.tareas-cli-delete-btn:hover { opacity:1; color:#f87171; }';
  document.head.appendChild(s);
}
_ensureTareasCliCSS();

// ── Render vista Clientes (Fase 3) ─────────────────────────
// Lee DEFAULT_CLIENTS_<wsId> filtrado por workspaceId === currentAgencia (S62.6.2 #3).
// Cards vacías sin objetivos muestran botón "+ Objetivo" (Fase 4 lo activa).

function renderTareasCli() {
  const container = document.getElementById('tareas-cli-body');
  if (!container) return;
  const wsId = currentAgencia || 'optimizads';
  // S67 hotfix: incluir clientes dinámicos (cliente rápido + wizard largo).
  // getDefaultClients solo retorna DEFAULT_CLIENTS_* hardcoded; clientes
  // persistidos en clients[] vía saveClients() no aparecían en el grid.
  // Defaults primero (orden hardcoded preservado), dinámicos al final.
  // Otros 11 consumers de getDefaultClients (Plan Semanal, Junior matching,
  // etc.) NO se tocan — bug análogo, sprints separados.
  const _defaults = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const _defaultIds = new Set(_defaults.map(function(c) { return c.id; }));
  const _dynamic = (typeof clients !== 'undefined' && Array.isArray(clients))
    ? clients.filter(function(c) {
        return c.workspaceId === wsId && !_defaultIds.has(c.id);
      })
    : [];
  const catalog = _defaults.concat(_dynamic);

  if (catalog.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:60px 40px;color:var(--text3);">No hay clientes activos en este workspace.</div>';
    return;
  }

  // Init Firestore para cada cliente del catálogo (idempotente, no resubscribe).
  catalog.forEach(function(c) {
    if (!_tareasCliUnsubs[c.id]) {
      tareasCliInitFromFirestore(c.id);
    }
  });

  const cards = catalog.map(function(c) {
    // S67 Bloque C: cliente rápido puede traer campo `color` propio; fallback a paleta keyed by id.
    const color = c.color || TAREAS_CLIENTE_COLORS[c.id] || TAREAS_CLIENTE_COLORS._fallback;
    const cached = _tareasCliMemCache[c.id] || tareasCliLoadCache(c.id);
    const objetivos = (cached && Array.isArray(cached.objetivos)) ? cached.objetivos : [];
    return tareasCliRenderCard(c, color, objetivos);
  }).join('');

  // Inbox v1 (S75): layout 3-zone — calendar horizontal arriba, inbox a la
  // izquierda, cards a la derecha. Inbox container vacío aquí; inbox.js lo
  // llena via renderInbox() después de innerHTML reset.
  container.innerHTML = ''
    + '<div style="display:flex;flex-direction:column;gap:14px;">'
    +   '<div>' + renderTareasCliCalendar({ orientation: 'horizontal' }) + '</div>'
    +   '<div style="display:grid;grid-template-columns:280px 1fr;gap:20px;align-items:start;">'
    +     '<div id="inbox-container" style="min-height:200px;"></div>'
    +     '<div class="tareas-cli-cards-zone" data-droppable-type="cards-zone" '
    +       'ondragover="tareasCliDragOver(event)" ondrop="tareasCliDrop(event)" '
    +       'style="min-height:200px;">'
    +       '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;align-items:start;">'
    +         cards
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';

  // Re-poblar inbox tras DOM reset (no-op si inbox.js no cargó o usuario sin auth).
  if (typeof window.renderInbox === 'function') {
    try { window.renderInbox(); } catch (e) {}
  }

  // Banner atrasadas (Fase 6) — refresca cada render.
  if (typeof tareasCliRenderAtrasadasBanner === 'function') tareasCliRenderAtrasadasBanner();
}

function tareasCliRenderCard(client, color, objetivos) {
  const totalTareas = objetivos.reduce(function(s, o) { return s + ((o.tareas || []).length); }, 0);
  const totalDone = objetivos.reduce(function(s, o) { return s + ((o.tareas || []).filter(function(t) { return t.completado; }).length); }, 0);
  // Soft limit visual: >3 objetivos = falta de foco (Fase 7).
  const overLimit = objetivos.length > 3;
  const subtitleBase = totalTareas === 0
    ? (objetivos.length === 0 ? 'Sin objetivos · agrega el primero' : objetivos.length + ' objetivo' + (objetivos.length === 1 ? '' : 's') + ' · sin tareas')
    : objetivos.length + ' objetivo' + (objetivos.length === 1 ? '' : 's') + ' · ' + totalDone + '/' + totalTareas + ' completadas';
  const subtitle = overLimit
    ? subtitleBase + ' · ⚠️ >3 obj, considera consolidar'
    : subtitleBase;
  const nicho = client.nicho ? escapeHtml(String(client.nicho)) : '';
  const cid = escapeHtml(client.id);

  // feat/delete-client-v1: botón trash visible solo si user puede borrar
  // (rol direccion/owner) y el cliente NO es fundacional (startsWith 'client-').
  const canDelete = _canDeleteClient(client.id);
  const deleteBtn = canDelete
    ? '<button class="tareas-cli-delete-btn" onclick="tareasCliShowDeleteClientModal(\'' + cid + '\')" '
        + 'title="Borrar cliente" aria-label="Borrar cliente">&times;</button>'
    : '';
  return ''
    + '<div class="tareas-cli-card" data-client-id="' + cid + '" '
    +   'data-droppable-type="cliente" '
    +   'ondragover="tareasCliDragOver(event)" ondrop="tareasCliDrop(event)" '
    +   'style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;border-top:3px solid ' + color + ';">'
    +   '<div style="padding:14px 16px;border-bottom:1px solid var(--border);">'
    +     '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">'
    +       '<div style="display:flex;align-items:center;gap:10px;min-width:0;">'
    +         '<div style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>'
    +         '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:14px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(client.nombre || client.id) + '</div>'
    +       '</div>'
    +       '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
    +         (nicho ? '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;text-align:right;">' + nicho + '</div>' : '')
    +         deleteBtn
    +       '</div>'
    +     '</div>'
    +     '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:' + (overLimit ? 'var(--yellow)' : 'var(--text3)') + ';margin-top:6px;">' + subtitle + '</div>'
    +   '</div>'
    +   '<div style="padding:12px 16px;">'
    +     tareasCliRenderObjetivosList(client, objetivos)
    +   '</div>'
    +   '<div style="padding:0 16px 14px;">'
    +     '<button onclick="tareasCliShowAddObjetivoInput(\'' + cid + '\')" '
    +       'style="width:100%;background:transparent;border:1px dashed var(--border2);color:var(--text2);padding:8px 12px;border-radius:8px;font-family:\'DM Sans\',sans-serif;font-size:12px;cursor:pointer;transition:all 0.15s;" '
    +       'onmouseover="this.style.borderColor=\'var(--accent)\';this.style.color=\'var(--accent)\';" '
    +       'onmouseout="this.style.borderColor=\'var(--border2)\';this.style.color=\'var(--text2)\';">'
    +       '＋ Objetivo'
    +     '</button>'
    +     '<div id="tareas-cli-add-obj-container-' + cid + '"></div>'
    +   '</div>'
    + '</div>';
}

function tareasCliRenderObjetivosList(client, objetivos) {
  if (!objetivos || objetivos.length === 0) {
    return '<div style="padding:14px 0;color:var(--text3);font-size:12px;text-align:center;font-family:\'DM Mono\',monospace;">Sin objetivos creados</div>';
  }
  const cid = escapeHtml(client.id);
  const clientIdRaw = client.id;
  return objetivos.map(function(o) {
    const oid = escapeHtml(o.id);
    const allTareas = Array.isArray(o.tareas) ? o.tareas : [];
    const done = allTareas.filter(function(t) { return t.completado; }).length;
    const objNombreSafe = escapeHtml(o.nombre || '');
    // S67 1.2: schema flat — separar top-level de subtasks (parent_task_id no null).
    const topLevel = allTareas.filter(function(t) { return !t.parent_task_id; });
    const subtasksByParent = {};
    allTareas.forEach(function(t) {
      if (t.parent_task_id) {
        if (!subtasksByParent[t.parent_task_id]) subtasksByParent[t.parent_task_id] = [];
        subtasksByParent[t.parent_task_id].push(t);
      }
    });

    function _renderTareaRow(t, isSubtask, childCount, collapsed) {
      const tid = escapeHtml(t.id);
      const completed = !!t.completado;
      const textoSafe = escapeHtml(t.texto || '');
      const fechaChip = t.fechaLimite
        ? '<span title="Fecha límite ' + escapeHtml(t.fechaLimite) + '" style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);background:var(--surface);border:1px solid var(--border);padding:1px 5px;border-radius:3px;flex-shrink:0;line-height:1.4;">' + (typeof tareasFormatFecha === 'function' ? tareasFormatFecha(t.fechaLimite) : escapeHtml(t.fechaLimite)) + '</span>'
        : '';
      // Chevron solo para top-level con 1+ hijas. Spacer para alinear las que no tienen.
      const chevron = (!isSubtask && childCount > 0)
        ? '<span onclick="tareasCliToggleSubtaskCollapse(\'' + cid + '\', \'' + tid + '\')" '
            + 'title="' + (collapsed ? 'Expandir' : 'Colapsar') + ' subtasks (' + childCount + ')" '
            + 'style="cursor:pointer;font-size:10px;color:var(--text3);flex-shrink:0;user-select:none;width:12px;text-align:center;line-height:1;">'
            + (collapsed ? '▸' : '▾')
            + '</span>'
        : '<span style="width:12px;flex-shrink:0;"></span>';
      const indentStyle = isSubtask ? 'margin-left:18px;' : '';
      return ''
        + '<div class="tareas-cli-tarea-row' + (isSubtask ? ' tareas-cli-subtask-row' : '') + '" '
        +   'draggable="true" '
        +   'ondragstart="tareasCliDragStart(event, \'' + cid + '\', \'' + oid + '\', \'' + tid + '\')" '
        +   'ondragend="tareasCliDragEnd(event)" '
        +   'data-droppable-type="tarea" '
        +   'data-client-id="' + cid + '" data-obj-id="' + oid + '" data-tarea-id="' + tid + '" '
        +   (isSubtask ? 'data-parent-task-id="' + escapeHtml(t.parent_task_id || '') + '" ' : '')
        +   'ondragover="tareasCliDragOver(event)" ondrop="tareasCliDrop(event)" '
        +   'style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;' + indentStyle + 'color:'
        +   (completed ? 'var(--text3)' : 'var(--text)') + ';cursor:grab;">'
        +   chevron
        +   '<span onclick="tareasCliToggleTarea(\'' + cid + '\', \'' + oid + '\', \'' + tid + '\')" '
        +     'title="Marcar completada" style="cursor:pointer;flex-shrink:0;user-select:none;font-size:14px;line-height:1;">'
        +     (completed ? '☑' : '☐')
        +   '</span>'
        +   '<span class="tareas-cli-tarea-text" '
        +     'style="flex:1;overflow:hidden;text-overflow:ellipsis;cursor:text;' + (completed ? 'text-decoration:line-through;' : '') + '" '
        +     'onclick="tareasCliEditTareaTextoInline(event, \'' + cid + '\', \'' + oid + '\', \'' + tid + '\')">'
        +     textoSafe
        +   '</span>'
        +   fechaChip
        +   (isSubtask
              ? ''
              : '<button onclick="tareasCliShowAddSubtaskInput(\'' + cid + '\', \'' + oid + '\', \'' + tid + '\')" '
                  + 'class="tareas-cli-add-subtask-btn" '
                  + 'title="Agregar subtask" '
                  + 'style="background:transparent;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:10px;flex-shrink:0;line-height:1;font-family:\'DM Sans\',sans-serif;" '
                  + 'onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'">'
                  + '＋ Sub'
                  + '</button>')
        +   '<button onclick="tareasCliConfirmDeleteTarea(\'' + cid + '\', \'' + oid + '\', \'' + tid + '\')" '
        +     'title="Eliminar tarea" '
        +     'style="background:transparent;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:11px;flex-shrink:0;line-height:1;" '
        +     'onmouseover="this.style.color=\'var(--red)\'" onmouseout="this.style.color=\'var(--text3)\'">'
        +     '✕'
        +   '</button>'
        + '</div>';
    }

    const tareasHtml = topLevel.map(function(t) {
      const subs = subtasksByParent[t.id] || [];
      const childCount = subs.length;
      const collapsed = childCount > 0 && tareasCliGetSubtaskCollapsed(clientIdRaw, t.id);
      const parentRow = _renderTareaRow(t, false, childCount, collapsed);
      const subtaskInputContainer = '<div id="tareas-cli-add-subtask-container-' + cid + '-' + escapeHtml(t.id) + '"></div>';
      if (childCount === 0 || collapsed) return parentRow + subtaskInputContainer;
      const subsHtml = subs.map(function(s) { return _renderTareaRow(s, true, 0, false); }).join('');
      return parentRow + subsHtml + subtaskInputContainer;
    }).join('');
    return ''
      + '<div data-obj-id="' + oid + '" '
      +   'data-droppable-type="objetivo" '
      +   'data-client-id="' + cid + '" '
      +   'ondragover="tareasCliDragOver(event)" ondrop="tareasCliDrop(event)" '
      +   'style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:var(--surface2);">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">'
      +     '<span class="tareas-cli-obj-nombre" '
      +       'style="font-family:\'DM Sans\',sans-serif;font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;cursor:text;" '
      +       'onclick="tareasCliEditObjNameInline(event, \'' + cid + '\', \'' + oid + '\')">'
      +       objNombreSafe
      +     '</span>'
      +     '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);flex-shrink:0;">' + done + '/' + allTareas.length + '</span>'
      +     '<button onclick="tareasCliConfirmDeleteObjetivo(\'' + cid + '\', \'' + oid + '\')" '
      +       'title="Eliminar objetivo" '
      +       'style="background:transparent;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:11px;flex-shrink:0;line-height:1;" '
      +       'onmouseover="this.style.color=\'var(--red)\'" onmouseout="this.style.color=\'var(--text3)\'">'
      +       '✕'
      +     '</button>'
      +   '</div>'
      +   (allTareas.length === 0
          ? '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);margin-top:6px;">Sin tareas</div>'
          : tareasHtml)
      +   '<button onclick="tareasCliShowAddTareaInput(\'' + cid + '\', \'' + oid + '\')" '
      +     'style="background:transparent;border:none;color:var(--text3);font-size:11px;padding:6px 0 0;cursor:pointer;font-family:\'DM Sans\',sans-serif;" '
      +     'onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'">'
      +     '＋ Tarea'
      +   '</button>'
      +   '<div id="tareas-cli-add-tarea-container-' + cid + '-' + oid + '"></div>'
      + '</div>';
  }).join('');
}

// S67 1.2: estado colapsado de subtasks por (clientId, parentTaskId) en localStorage.
function tareasCliSubtaskCollapsedKey(clientId, taskId) {
  return 'oa-subtask-collapsed-' + clientId + '-' + taskId;
}
function tareasCliGetSubtaskCollapsed(clientId, taskId) {
  try { return localStorage.getItem(tareasCliSubtaskCollapsedKey(clientId, taskId)) === '1'; }
  catch (e) { return false; }
}
function tareasCliToggleSubtaskCollapse(clientId, taskId) {
  try {
    const key = tareasCliSubtaskCollapsedKey(clientId, taskId);
    const cur = localStorage.getItem(key) === '1';
    if (cur) localStorage.removeItem(key);
    else localStorage.setItem(key, '1');
  } catch (e) {}
  renderTareasCli();
}

// ── Mini-calendario sidebar (Fase 5) ──────────────────────
let _tareasCliCalSemanaOffset = 0;

function tareasCliGetSemana(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diffToMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - diffToMonday + (offset * 7));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dx = new Date(d);
    dx.setDate(d.getDate() + i);
    days.push(dx);
  }
  return days;
}

function tareasCliFmtFecha(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + m + '-' + day;
}

function tareasCliCountTareasByFecha(fechaStr) {
  let count = 0;
  Object.keys(_tareasCliMemCache).forEach(function(cid) {
    const d = _tareasCliMemCache[cid];
    if (!d || !Array.isArray(d.objetivos)) return;
    d.objetivos.forEach(function(o) {
      (o.tareas || []).forEach(function(t) {
        if (t.fechaLimite === fechaStr && !t.completado) count++;
      });
    });
  });
  return count;
}

function renderTareasCliCalendar(opts) {
  const orientation = (opts && opts.orientation) || 'vertical';
  const isHoriz = orientation === 'horizontal';
  const days = tareasCliGetSemana(_tareasCliCalSemanaOffset);
  const today = tareasCliFmtFecha(new Date());
  const monthNames = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const dayLabels = ['L','M','M','J','V','S','D'];
  const weekTitle = days[0].getDate() + ' ' + monthNames[days[0].getMonth()] + ' – ' + days[6].getDate() + ' ' + monthNames[days[6].getMonth()];

  const daysHtml = days.map(function(d, i) {
    const fechaStr = tareasCliFmtFecha(d);
    const isToday = fechaStr === today;
    const isPast = fechaStr < today;
    const count = tareasCliCountTareasByFecha(fechaStr);
    const borderColor = isToday ? 'var(--accent)' : 'var(--border)';
    const bg = isToday ? 'rgba(0,229,160,0.08)' : (isPast ? 'transparent' : 'var(--surface2)');
    const dateColor = isToday ? 'var(--accent)' : (isPast ? 'var(--text3)' : 'var(--text)');
    const badge = count > 0
      ? '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--accent);background:rgba(0,229,160,0.12);padding:2px 6px;border-radius:4px;">' + count + '</span>'
      : '';
    if (isHoriz) {
      // Horizontal variant: cada día apilado vertical compacto, ancho flex:1.
      return ''
        + '<div data-droppable-type="dia" data-fecha="' + fechaStr + '" '
        +   'ondragover="tareasCliDragOver(event)" ondrop="tareasCliDrop(event)" '
        +   'style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;border-radius:6px;border:1px solid ' + borderColor + ';background:' + bg + ';min-width:0;">'
        +   '<span style="font-family:\'DM Mono\',monospace;font-weight:700;color:var(--text3);font-size:9px;letter-spacing:0.05em;">' + dayLabels[i] + '</span>'
        +   '<span style="font-family:\'DM Sans\',sans-serif;font-weight:700;color:' + dateColor + ';font-size:13px;line-height:1;">' + d.getDate() + '</span>'
        +   (count > 0 ? '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--accent);background:rgba(0,229,160,0.12);padding:1px 5px;border-radius:3px;line-height:1.2;">' + count + '</span>' : '<span style="font-size:9px;line-height:1.2;opacity:0;">·</span>')
        + '</div>';
    }
    return ''
      + '<div data-droppable-type="dia" data-fecha="' + fechaStr + '" '
      +   'ondragover="tareasCliDragOver(event)" ondrop="tareasCliDrop(event)" '
      +   'style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:6px;border:1px solid ' + borderColor + ';background:' + bg + ';font-size:11px;">'
      +   '<div style="display:flex;align-items:center;gap:8px;">'
      +     '<span style="font-family:\'DM Mono\',monospace;font-weight:700;color:var(--text3);width:12px;">' + dayLabels[i] + '</span>'
      +     '<span style="font-family:\'DM Sans\',sans-serif;font-weight:600;color:' + dateColor + ';">' + d.getDate() + '</span>'
      +   '</div>'
      +   badge
      + '</div>';
  }).join('');

  if (isHoriz) {
    // Layout horizontal compacto: nav + days en una sola fila, ~80px alto total.
    return ''
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:10px;">'
      +   '<div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;flex-shrink:0;min-width:130px;">'
      +     '<div style="display:flex;align-items:center;gap:4px;">'
      +       '<button onclick="tareasCliCalPrevWeek()" title="Semana anterior" style="background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:0 4px;line-height:1;">‹</button>'
      +       '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text);">' + weekTitle + '</div>'
      +       '<button onclick="tareasCliCalNextWeek()" title="Próxima semana" style="background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:0 4px;line-height:1;">›</button>'
      +     '</div>'
      +     (_tareasCliCalSemanaOffset !== 0
          ? '<button onclick="tareasCliCalToday()" style="background:var(--surface2);border:1px solid var(--border);color:var(--text2);font-size:9px;padding:2px 8px;border-radius:4px;cursor:pointer;font-family:\'DM Mono\',monospace;">↺ hoy</button>'
          : '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--text3);line-height:1.2;">arrastra → día</div>')
      +   '</div>'
      +   '<div style="flex:1;display:flex;gap:6px;min-width:0;">' + daysHtml + '</div>'
      + '</div>';
  }

  return ''
    + '<div style="position:sticky;top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    +     '<button onclick="tareasCliCalPrevWeek()" title="Semana anterior" style="background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:16px;padding:2px 8px;line-height:1;">‹</button>'
    +     '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text);text-align:center;">' + weekTitle + '</div>'
    +     '<button onclick="tareasCliCalNextWeek()" title="Próxima semana" style="background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:16px;padding:2px 8px;line-height:1;">›</button>'
    +   '</div>'
    +   (_tareasCliCalSemanaOffset !== 0
        ? '<button onclick="tareasCliCalToday()" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text2);font-size:10px;padding:5px;border-radius:6px;cursor:pointer;margin-bottom:8px;font-family:\'DM Mono\',monospace;">↺ Volver a hoy</button>'
        : '')
    +   '<div style="display:flex;flex-direction:column;gap:4px;">' + daysHtml + '</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);margin-top:10px;line-height:1.4;text-align:center;">Arrastra tarea → día para asignar fecha</div>'
    + '</div>';
}

function tareasCliCalPrevWeek() { _tareasCliCalSemanaOffset--; renderTareasCli(); }
function tareasCliCalNextWeek() { _tareasCliCalSemanaOffset++; renderTareasCli(); }
function tareasCliCalToday() { _tareasCliCalSemanaOffset = 0; renderTareasCli(); }

// ── Drag handlers (Fase 5) ────────────────────────────────
// Branching por dataset.droppableType (corrección S62.6.2 #5):
//   tarea       → reorder dentro de objetivo o move entre objetivos
//   objetivo    → mover tarea al final del objetivo destino
//   dia         → asignar/reasignar fechaLimite
//   cards-zone  → quitar fechaLimite (si tenía)
//   cliente     → cross-cliente: ignorar (no crash, S62.6.3.B)

let _tareasCliDrag = null;

function tareasCliClearDragOutlines() {
  document.querySelectorAll('[data-droppable-type]').forEach(function(el) {
    el.style.outline = '';
    el.style.outlineOffset = '';
  });
}

function tareasCliDragStart(e, clientId, objId, tareaId) {
  const cached = _tareasCliMemCache[clientId];
  if (!cached) { e.preventDefault(); return; }
  const o = (cached.objetivos || []).find(function(x) { return x.id === objId; });
  if (!o) { e.preventDefault(); return; }
  const t = (o.tareas || []).find(function(x) { return x.id === tareaId; });
  if (!t) { e.preventDefault(); return; }

  _tareasCliDrag = {
    clientId: clientId,
    fromObjId: objId,
    tareaId: tareaId,
    currentFecha: t.fechaLimite || null
  };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', tareaId); } catch (err) {}
  }
  setTimeout(function() {
    if (e.target && e.target.style) e.target.style.opacity = '0.4';
  }, 0);
}

function tareasCliDragOver(e) {
  if (!_tareasCliDrag) return;
  const target = e.target.closest && e.target.closest('[data-droppable-type]');
  if (!target) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  e.stopPropagation();
  tareasCliClearDragOutlines();
  target.style.outline = '2px dashed var(--accent)';
  target.style.outlineOffset = '-2px';
}

function tareasCliDragEnd(e) {
  if (e && e.target && e.target.style) e.target.style.opacity = '';
  tareasCliClearDragOutlines();
  _tareasCliDrag = null;
}

async function tareasCliDrop(e) {
  if (!_tareasCliDrag) return;
  const target = e.target.closest && e.target.closest('[data-droppable-type]');
  if (!target) { tareasCliDragEnd(e); return; }
  e.preventDefault();
  e.stopPropagation();

  const type = target.dataset.droppableType;
  const drag = _tareasCliDrag;
  tareasCliClearDragOutlines();

  try {
    if (type === 'tarea') {
      const targetTareaId = target.dataset.tareaId;
      const targetObjId = target.dataset.objId;
      const targetClientId = target.dataset.clientId;
      if (targetClientId !== drag.clientId) return; // cross-cliente: ignorar
      if (targetObjId === drag.fromObjId && targetTareaId === drag.tareaId) return; // self
      // Heurística Trello/Notion: drop arriba de la mitad → before, abajo de la mitad → after.
      const rect = target.getBoundingClientRect();
      const position = (e.clientY < rect.top + rect.height / 2) ? 'before' : 'after';
      await tareasCliReorderOrMoveTarea(drag.clientId, drag.fromObjId, drag.tareaId, targetObjId, targetTareaId, position);
    } else if (type === 'objetivo') {
      const targetObjId = target.dataset.objId;
      const targetClientId = target.dataset.clientId;
      if (targetClientId !== drag.clientId) return; // cross-cliente: ignorar
      if (targetObjId === drag.fromObjId) return;
      // Drop sobre wrapper de objetivo (no sobre tarea específica) → al final.
      await tareasCliReorderOrMoveTarea(drag.clientId, drag.fromObjId, drag.tareaId, targetObjId, null, null);
    } else if (type === 'dia') {
      const fecha = target.dataset.fecha;
      await tareasCliSetFechaLimite(drag.clientId, drag.fromObjId, drag.tareaId, fecha);
    } else if (type === 'cards-zone') {
      if (drag.currentFecha) {
        await tareasCliSetFechaLimite(drag.clientId, drag.fromObjId, drag.tareaId, null);
      }
    } else if (type === 'cliente') {
      // ignorar (S62.6.2 #5: cross-cliente NO permitido en v4.0)
      return;
    }
  } finally {
    tareasCliDragEnd(e);
  }
}

// ── Mutators (Fase 5) ──────────────────────────────────────
// Reorder/move tarea con anclaje explícito.
// anchorTareaId + position son opcionales; si ambos null → push al final del objetivo destino.
// position: 'before' | 'after' (relativo al estado ORIGINAL del array, antes del splice).
// Diseñado para ser robusto a same-objetivo y cross-objetivo (mismo cliente).
async function tareasCliReorderOrMoveTarea(clientId, fromObjId, tareaId, toObjId, anchorTareaId, position) {
  await tareasCliSave(clientId, function(d) {
    const fromObj = (d.objetivos || []).find(function(x) { return x.id === fromObjId; });
    if (!fromObj || !Array.isArray(fromObj.tareas)) return d;
    const fromIdx = fromObj.tareas.findIndex(function(x) { return x.id === tareaId; });
    if (fromIdx === -1) return d;

    const toObj = (d.objetivos || []).find(function(x) { return x.id === toObjId; });
    if (!toObj) return d; // destino inexistente: no-op
    if (!Array.isArray(toObj.tareas)) toObj.tareas = [];

    // Captura el anchor index ANTES del splice (más predecible para razonar).
    let anchorIdxOriginal = -1;
    if (anchorTareaId) {
      anchorIdxOriginal = toObj.tareas.findIndex(function(x) { return x.id === anchorTareaId; });
    }

    // Remover de origen.
    const tarea = fromObj.tareas.splice(fromIdx, 1)[0];

    // Computar insertIdx en el array destino DESPUÉS del splice.
    let insertIdx;
    if (!anchorTareaId || anchorIdxOriginal === -1) {
      // Sin ancla o ancla no encontrada → push al final.
      insertIdx = toObj.tareas.length;
    } else {
      // Ajuste por splice: si same-obj y removimos antes del anchor, anchor bajó 1.
      const sameObj = (fromObj === toObj);
      let adjustedAnchor = anchorIdxOriginal;
      if (sameObj && fromIdx < anchorIdxOriginal) adjustedAnchor--;
      insertIdx = (position === 'after') ? adjustedAnchor + 1 : adjustedAnchor;
      // Clamp por seguridad.
      if (insertIdx < 0) insertIdx = 0;
      if (insertIdx > toObj.tareas.length) insertIdx = toObj.tareas.length;
    }

    toObj.tareas.splice(insertIdx, 0, tarea);

    toObj.tareas.forEach(function(t, i) { t.orden = i; });
    if (fromObj !== toObj) fromObj.tareas.forEach(function(t, i) { t.orden = i; });
    return d;
  });
  renderTareasCli();
}

// Test runner inline — ejecuta los 3 escenarios reportados + edge cases.
// Uso desde consola: await window.tareasCli._test('enpagos').
// Crea un objetivo de prueba, corre los tests, lo elimina al final.
async function _tareasCliRunReorderTests(clientId) {
  if (!clientId) clientId = 'enpagos';
  const log = function(msg, ok) { console.log('%c' + (ok ? '✓ ' : '✗ ') + msg, ok ? 'color:#10b981' : 'color:#ef4444;font-weight:bold'); };
  const eq = function(a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  let passed = 0, failed = 0;

  // Setup: crear objetivo con 3 tareas T1, T2, T3
  const objNombre = '__test_reorder_' + Date.now();
  await tareasCliAddObjetivo(clientId, objNombre);
  let cache = _tareasCliMemCache[clientId];
  let testObj = cache.objetivos.find(function(o) { return o.nombre === objNombre; });
  if (!testObj) { console.error('Setup falló: objetivo no creado'); return; }
  await tareasCliAddTarea(clientId, testObj.id, 'T1');
  await tareasCliAddTarea(clientId, testObj.id, 'T2');
  await tareasCliAddTarea(clientId, testObj.id, 'T3');
  cache = _tareasCliMemCache[clientId];
  testObj = cache.objetivos.find(function(o) { return o.id === testObj.id; });
  const ids = testObj.tareas.map(function(t) { return t.id; });
  const [T1, T2, T3] = ids;
  const objId = testObj.id;

  function getOrder() {
    const o = _tareasCliMemCache[clientId].objetivos.find(function(x) { return x.id === objId; });
    return o.tareas.map(function(t) { return t.texto; });
  }

  // Test 1: idx 2 → before idx 0 → [T3, T1, T2]
  await tareasCliReorderOrMoveTarea(clientId, objId, T3, objId, T1, 'before');
  if (eq(getOrder(), ['T3','T1','T2'])) { log('idx 2 → before idx 0 = [T3,T1,T2]', true); passed++; }
  else { log('idx 2 → before idx 0: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Test 2: estado [T3,T1,T2], mover T2 (idx 2) → after T3 (idx 0) → [T3, T2, T1]
  await tareasCliReorderOrMoveTarea(clientId, objId, T2, objId, T3, 'after');
  if (eq(getOrder(), ['T3','T2','T1'])) { log('idx 2 → after idx 0 = [T3,T2,T1]', true); passed++; }
  else { log('idx 2 → after idx 0: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Test 3: estado [T3,T2,T1], mover T3 (idx 0) → after T1 (idx 2) → [T2, T1, T3]
  await tareasCliReorderOrMoveTarea(clientId, objId, T3, objId, T1, 'after');
  if (eq(getOrder(), ['T2','T1','T3'])) { log('idx 0 → after idx 2 = [T2,T1,T3]', true); passed++; }
  else { log('idx 0 → after idx 2: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Test 4: no-op — mover T1 (idx 1) → after T2 (idx 0). Same posición resultante.
  await tareasCliReorderOrMoveTarea(clientId, objId, T1, objId, T2, 'after');
  if (eq(getOrder(), ['T2','T1','T3'])) { log('mismo lugar (after T2) = no-op', true); passed++; }
  else { log('no-op test: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Test 5: mover T1 → before T1 (self) — debería no-op natural
  await tareasCliReorderOrMoveTarea(clientId, objId, T1, objId, T1, 'before');
  if (eq(getOrder(), ['T2','T1','T3'])) { log('self-anchor before = no-op', true); passed++; }
  else { log('self-anchor: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Test 6: ancla null → push al final. Estado [T2,T1,T3], mover T2 → null = [T1, T3, T2]
  await tareasCliReorderOrMoveTarea(clientId, objId, T2, objId, null, null);
  if (eq(getOrder(), ['T1','T3','T2'])) { log('anchor null = push al final = [T1,T3,T2]', true); passed++; }
  else { log('anchor null: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Test 7: idx 0 → idx N (último). Estado [T1,T3,T2], mover T1 → after T2 = [T3,T2,T1]
  await tareasCliReorderOrMoveTarea(clientId, objId, T1, objId, T2, 'after');
  if (eq(getOrder(), ['T3','T2','T1'])) { log('idx 0 → after último idx = [T3,T2,T1]', true); passed++; }
  else { log('idx 0 → after último: got ' + JSON.stringify(getOrder()), false); failed++; }

  // Cleanup
  await tareasCliDeleteObjetivo(clientId, objId);
  console.log('%c' + passed + ' passed, ' + failed + ' failed', failed === 0 ? 'color:#10b981;font-weight:bold' : 'color:#ef4444;font-weight:bold');
  return { passed: passed, failed: failed };
}

async function tareasCliSetFechaLimite(clientId, objId, tareaId, fechaStr) {
  const nowIso = new Date().toISOString();
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    const t = (o.tareas || []).find(function(x) { return x.id === tareaId; });
    if (t) {
      t.fechaLimite = fechaStr || null;
      t.updatedAt = nowIso;
    }
    return d;
  });
  renderTareasCli();
}

// ── Onboarding tooltip per-uid + ritual (Fase 7) ───────────
// localStorage key: tareasCli-onboarding-shown-{uid} (S62.6.2 #8)

function tareasCliMaybeShowOnboarding() {
  const uid = (window.currentUser && window.currentUser.uid) || null;
  if (!uid) return;
  const key = 'tareasCli-onboarding-shown-' + uid;
  let shown = false;
  try { shown = localStorage.getItem(key) === '1'; } catch (e) {}
  if (shown) return;
  if (document.getElementById('tareasCli-onboarding-modal')) return;

  const id = 'tareasCli-onboarding-modal';
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99997;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px 32px;width:540px;max-width:92vw;box-shadow:0 16px 48px rgba(0,0,0,0.6);">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:800;font-size:22px;color:var(--text);margin-bottom:6px;">👋 Bienvenido a vista Clientes</div>'
    +   '<div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:20px;">Una nueva forma de organizar tareas — por cliente, no por área interna.</div>'
    +   '<div style="display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--text2);line-height:1.5;">'
    +     '<div style="display:flex;gap:12px;align-items:flex-start;"><div style="font-size:20px;flex-shrink:0;">🃏</div><div><strong style="color:var(--text);">Crea objetivos por cliente.</strong> Bajo cada objetivo agrega tareas concretas accionables.</div></div>'
    +     '<div style="display:flex;gap:12px;align-items:flex-start;"><div style="font-size:20px;flex-shrink:0;">📅</div><div><strong style="color:var(--text);">Drag tareas al calendario.</strong> Asigna fecha límite arrastrando una tarea a un día. Drag fuera del calendario para quitarla.</div></div>'
    +     '<div style="display:flex;gap:12px;align-items:flex-start;"><div style="font-size:20px;flex-shrink:0;">🔄</div><div><strong style="color:var(--text);">Reordena con drag.</strong> Mueve tareas dentro o entre objetivos del MISMO cliente. Para mover entre clientes: eliminar y recrear.</div></div>'
    +     '<div style="display:flex;gap:12px;align-items:flex-start;"><div style="font-size:20px;flex-shrink:0;">🚨</div><div><strong style="color:var(--text);">Banner rojo arriba.</strong> Lista TODAS las tareas atrasadas, agrupadas por antigüedad — útil para el ritual del primer lunes.</div></div>'
    +     '<div style="display:flex;gap:12px;align-items:flex-start;"><div style="font-size:20px;flex-shrink:0;">⚠️</div><div><strong style="color:var(--text);">Soft limit:</strong> 3 objetivos por cliente recomendado. Más es señal de falta de foco.</div></div>'
    +   '</div>'
    +   '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:24px;">'
    +     '<button id="tareasCli-onboarding-show-ritual" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver ritual primer lunes</button>'
    +     '<button id="tareasCli-onboarding-ok" style="background:var(--accent);border:none;color:#000;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Entendido</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);

  function dismiss() {
    try { localStorage.setItem(key, '1'); } catch (e) {}
    el.remove();
  }
  document.getElementById('tareasCli-onboarding-ok').onclick = dismiss;
  document.getElementById('tareasCli-onboarding-show-ritual').onclick = function() {
    dismiss();
    tareasCliShowRitualModal();
  };
}

function tareasCliShowRitualModal() {
  const id = 'tareasCli-ritual-modal';
  let el = document.getElementById(id);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99997;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 28px;width:560px;max-width:92vw;max-height:80vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,0.5);">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
    +     '<div style="font-family:\'Syne\',sans-serif;font-weight:800;font-size:18px;color:var(--text);">📋 Ritual del primer lunes</div>'
    +     '<button onclick="document.getElementById(\'' + id + '\').remove()" style="background:transparent;border:none;color:var(--text3);font-size:18px;cursor:pointer;line-height:1;padding:4px 8px;">×</button>'
    +   '</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);margin-bottom:16px;">Repaso semanal de Tareas → Clientes (15-20 min)</div>'
    +   '<ol style="margin:0;padding-left:22px;color:var(--text2);font-size:13px;line-height:1.7;display:flex;flex-direction:column;gap:10px;">'
    +     '<li><strong style="color:var(--text);">Abre el banner rojo</strong> de tareas atrasadas. Por cada una: completar ahora, mover fecha al día correcto, o eliminar si ya no aplica.</li>'
    +     '<li><strong style="color:var(--text);">Limpia objetivos vacíos</strong> o ya cumplidos. Click ✕ en el objetivo. Si tiene tareas viejas que dejaron de importar, eliminar también.</li>'
    +     '<li><strong style="color:var(--text);">Verifica el límite blando de 3 objetivos por cliente.</strong> Si ves más, decide consolidar o pausar — más de 3 objetivos a la vez = falta de foco.</li>'
    +     '<li><strong style="color:var(--text);">Define la próxima semana.</strong> Por cada cliente activo: 1-3 tareas concretas con fechaLimite. Drag al calendario para asignar día.</li>'
    +     '<li><strong style="color:var(--text);">Comparte el board</strong> con quien colabore (Mario, etc.). Las tareas persisten en Firestore — los demás verán los cambios en tiempo real vía onSnapshot.</li>'
    +   '</ol>'
    +   '<div style="margin-top:18px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text2);line-height:1.5;">'
    +     '<strong style="color:var(--text);">💡 Tip:</strong> El ritual es housekeeping operacional, NO ajuste de plan estratégico. El plan trimestral va en otro lado (canvas Slack o spec).'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);
  el.onclick = function(ev) { if (ev.target === el) el.remove(); };
}

// ── Junior matching dual + Sem pasada (Fase 6) ─────────────
// SPEC corrección S62.6.3.C: NO deduplicar entre módulos. Ambos se renderean
// con chip visual de origen para que el Junior vea sus duplicados y limpie.

function tareasCliFindClientByNombre(clienteNombre) {
  if (!clienteNombre) return null;
  const wsId = currentAgencia || 'optimizads';
  const catalog = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const needle = String(clienteNombre).toLowerCase().trim();
  // Match exacto por nombre o id, fallback a substring (compat).
  return catalog.find(function(c) { return (c.nombre || '').toLowerCase() === needle || (c.id || '').toLowerCase() === needle; })
    || catalog.find(function(c) { return (c.nombre || '').toLowerCase().includes(needle) && needle.length >= 3; })
    || null;
}

// Devuelve tareas-clientes pendientes para hoy (incluye atrasadas no completadas).
// Acepta clientId directo o un nombre que se busca en el catálogo (compatibilidad
// con loadJrChecklist que pasa clienteNombre, ej. "EnPagos").
function tareasCliGetPendientesHoy(clientIdOrNombre) {
  if (!clientIdOrNombre) return [];
  let clientId = clientIdOrNombre;
  // Si no hay cache para ese id, intentar resolver vía catálogo.
  if (!_tareasCliMemCache[clientId]) {
    const fromCatalog = tareasCliFindClientByNombre(clientIdOrNombre);
    if (fromCatalog) clientId = fromCatalog.id;
  }
  const cached = _tareasCliMemCache[clientId] || tareasCliLoadCache(clientId);
  if (!cached || !Array.isArray(cached.objetivos)) return [];
  const hoy = (typeof tareasGetHoy === 'function') ? tareasGetHoy() : new Date().toISOString().slice(0, 10);
  const matches = [];
  cached.objetivos.forEach(function(o) {
    (o.tareas || []).forEach(function(t) {
      if (t.completado) return;
      const fl = t.fechaLimite;
      const fi = t.fechaIdeal;
      if (fl === hoy || fi === hoy || (fl && fl < hoy)) {
        matches.push({ clientId: clientId, objId: o.id, objNombre: o.nombre || '', tarea: t });
      }
    });
  });
  return matches;
}

// Inicializa Firestore listeners para todos los clientes del workspace —
// necesario para que el Junior vea tareas-cli aún cuando NO está en vista Clientes.
function tareasCliEnsureAllInitialized() {
  const wsId = currentAgencia || 'optimizads';
  const catalog = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  catalog.forEach(function(c) {
    if (!_tareasCliUnsubs[c.id]) {
      try { tareasCliInitFromFirestore(c.id); } catch (e) {}
    }
  });
}

function renderJrTareaPendienteCli(m) {
  const tarea = m.tarea;
  const clientId = m.clientId;
  const objId = m.objId;
  const fl = tarea.fechaLimite;
  const hoy = (typeof tareasGetHoy === 'function') ? tareasGetHoy() : new Date().toISOString().slice(0, 10);
  const venc = fl && fl < hoy;
  const fmtFecha = (typeof tareasFormatFecha === 'function') ? tareasFormatFecha : function(s) { return s; };
  const fechaChip = fl
    ? '<span style="font-size:10px;font-family:\'DM Mono\',monospace;background:' + (venc ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.14)') + ';color:' + (venc ? 'var(--red)' : 'var(--yellow)') + ';padding:2px 7px;border-radius:4px;flex-shrink:0;">' + (venc ? '🔴' : '⚠️') + ' ' + fmtFecha(fl) + '</span>'
    : '';
  const origenChip = '<span style="font-size:10px;font-family:\'DM Mono\',monospace;background:rgba(124,58,237,0.14);color:#a78bfa;padding:2px 7px;border-radius:4px;flex-shrink:0;">👤 Cliente</span>';
  return ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px;cursor:pointer;transition:all 0.15s;" '
    +   'onclick="tareasCliToggleTarea(\'' + escapeHtml(clientId) + '\', \'' + escapeHtml(objId) + '\', \'' + escapeHtml(tarea.id) + '\'); setTimeout(function(){ if (window._jrSelectedClient) loadJrChecklist(window._jrSelectedClient); }, 600);" '
    +   'onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
    +   '<div style="width:18px;height:18px;border:2px solid ' + (tarea.completado ? 'var(--green)' : 'var(--border2)') + ';border-radius:5px;background:' + (tarea.completado ? 'var(--green)' : 'transparent') + ';flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-top:1px;">'
    +     (tarea.completado ? '<svg width="10" height="8" viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/></svg>' : '')
    +   '</div>'
    +   '<div style="flex:1;min-width:0;">'
    +     '<div style="font-size:13px;color:' + (tarea.completado ? 'var(--text3)' : 'var(--text1)') + ';text-decoration:' + (tarea.completado ? 'line-through' : 'none') + ';line-height:1.4;">' + escapeHtml(tarea.texto || '') + '</div>'
    +     (m.objNombre ? '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + escapeHtml(m.objNombre) + '</div>' : '')
    +   '</div>'
    +   fechaChip
    +   origenChip
    + '</div>';
}

// Banner sem pasada (S62.6.2 #6: TODAS las atrasadas, sin importar antigüedad) ─
function tareasCliCountAtrasadas() {
  const hoy = (typeof tareasGetHoy === 'function') ? tareasGetHoy() : new Date().toISOString().slice(0, 10);
  let count = 0;
  Object.keys(_tareasCliMemCache).forEach(function(cid) {
    const d = _tareasCliMemCache[cid];
    if (!d || !Array.isArray(d.objetivos)) return;
    d.objetivos.forEach(function(o) {
      (o.tareas || []).forEach(function(t) {
        if (t.completado) return;
        if (t.fechaLimite && t.fechaLimite < hoy) count++;
      });
    });
  });
  return count;
}

function tareasCliGetAtrasadasGrouped() {
  const hoy = (typeof tareasGetHoy === 'function') ? tareasGetHoy() : new Date().toISOString().slice(0, 10);
  const days = tareasCliGetSemana(0);
  const lunesActual = tareasCliFmtFecha(days[0]);
  const lunesPrev = new Date(days[0]);
  lunesPrev.setDate(days[0].getDate() - 7);
  const lunesPrevStr = tareasCliFmtFecha(lunesPrev);
  const groups = { estaSemana: [], semanaPasada: [], masAntiguas: [] };

  Object.keys(_tareasCliMemCache).forEach(function(cid) {
    const d = _tareasCliMemCache[cid];
    if (!d || !Array.isArray(d.objetivos)) return;
    d.objetivos.forEach(function(o) {
      (o.tareas || []).forEach(function(t) {
        if (t.completado) return;
        if (!t.fechaLimite || t.fechaLimite >= hoy) return;
        const m = { clientId: cid, objId: o.id, objNombre: o.nombre || '', tarea: t };
        if (t.fechaLimite >= lunesActual) groups.estaSemana.push(m);
        else if (t.fechaLimite >= lunesPrevStr) groups.semanaPasada.push(m);
        else groups.masAntiguas.push(m);
      });
    });
  });
  return groups;
}

function tareasCliRenderAtrasadasBanner() {
  const banner = document.getElementById('tareas-cli-atrasadas-banner');
  if (!banner) return;
  const count = tareasCliCountAtrasadas();
  if (count === 0) { banner.style.display = 'none'; return; }
  banner.style.display = '';
  banner.innerHTML = ''
    + '<button onclick="tareasCliShowAtrasadasModal()" '
    +   'style="width:100%;background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.35);color:var(--red);font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px;cursor:pointer;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;" '
    +   'onmouseover="this.style.background=\'rgba(239,68,68,0.16)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.10)\'">'
    +   '<span>📅 ' + count + ' tarea' + (count === 1 ? '' : 's') + ' atrasada' + (count === 1 ? '' : 's') + '</span>'
    +   '<span style="font-family:\'DM Mono\',monospace;font-size:11px;opacity:0.8;">Revisar →</span>'
    + '</button>';
}

function tareasCliShowAtrasadasModal() {
  const groups = tareasCliGetAtrasadasGrouped();
  const wsId = currentAgencia || 'optimizads';
  const catalog = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : []);
  const clientName = function(cid) {
    const c = catalog.find(function(x) { return x.id === cid; });
    return c ? (c.nombre || cid) : cid;
  };
  const fmtFecha = (typeof tareasFormatFecha === 'function') ? tareasFormatFecha : function(s) { return s; };

  const renderItem = function(m) {
    const t = m.tarea;
    // S67 Bloque C: lookup en `clients` para honrar c.color del cliente rápido.
    const _cli = (typeof clients !== 'undefined') ? clients.find(function(x) { return x.id === m.clientId; }) : null;
    const color = (_cli && _cli.color) || TAREAS_CLIENTE_COLORS[m.clientId] || TAREAS_CLIENTE_COLORS._fallback;
    return ''
      + '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;border-left:3px solid ' + color + ';">'
      +   '<span onclick="tareasCliToggleTarea(\'' + escapeHtml(m.clientId) + '\', \'' + escapeHtml(m.objId) + '\', \'' + escapeHtml(t.id) + '\'); tareasCliShowAtrasadasModal();" '
      +     'style="cursor:pointer;font-size:14px;flex-shrink:0;user-select:none;" title="Marcar completada">'
      +     (t.completado ? '☑' : '☐')
      +   '</span>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.texto || '') + '</div>'
      +     '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);margin-top:2px;">' + escapeHtml(clientName(m.clientId)) + (m.objNombre ? ' · ' + escapeHtml(m.objNombre) : '') + '</div>'
      +   '</div>'
      +   '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--red);background:rgba(239,68,68,0.12);padding:2px 7px;border-radius:4px;flex-shrink:0;">🔴 ' + fmtFecha(t.fechaLimite) + '</span>'
      + '</div>';
  };

  const section = function(title, items) {
    if (!items.length) return '';
    return ''
      + '<div style="margin-top:14px;">'
      +   '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">' + title + ' · ' + items.length + '</div>'
      +   items.map(renderItem).join('')
      + '</div>';
  };

  const id = 'tareasCli-atrasadas-modal';
  let el = document.getElementById(id);
  if (el) el.remove();
  const total = groups.estaSemana.length + groups.semanaPasada.length + groups.masAntiguas.length;
  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px;width:560px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
    +     '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;color:var(--text);">📅 Tareas atrasadas</div>'
    +     '<button onclick="document.getElementById(\'' + id + '\').remove()" style="background:transparent;border:none;color:var(--text3);font-size:18px;cursor:pointer;line-height:1;padding:4px 8px;">×</button>'
    +   '</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);margin-bottom:6px;">' + total + ' sin completar · click ☐ para marcar hecha</div>'
    +   (total === 0 ? '<div style="text-align:center;padding:40px 0;color:var(--text3);font-size:13px;">Sin tareas atrasadas. ✨</div>' : '')
    +   section('Esta semana', groups.estaSemana)
    +   section('Semana pasada', groups.semanaPasada)
    +   section('Hace 2+ semanas', groups.masAntiguas)
    + '</div>';
  document.body.appendChild(el);
  el.onclick = function(ev) { if (ev.target === el) el.remove(); };
}

// ── Actions CRUD (Fase 4) ──────────────────────────────────
export async function tareasCliAddObjetivo(clientId, nombre) {
  const t = String(nombre || '').trim();
  if (!t) return null;
  const newId = 'obj-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  await tareasCliSave(clientId, function(d) {
    if (!Array.isArray(d.objetivos)) d.objetivos = [];
    d.objetivos.push({
      id: newId,
      nombre: t,
      collapsed: false,
      orden: d.objetivos.length,
      tareas: []
    });
    return d;
  });
  renderTareasCli();
  return newId;
}

async function tareasCliEditObjetivoNombre(clientId, objId, nombre) {
  const t = String(nombre || '').trim();
  if (!t) return;
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (o) o.nombre = t;
    return d;
  });
  renderTareasCli();
}

async function tareasCliDeleteObjetivo(clientId, objId) {
  await tareasCliSave(clientId, function(d) {
    d.objetivos = (d.objetivos || []).filter(function(x) { return x.id !== objId; });
    return d;
  });
  renderTareasCli();
}

export async function tareasCliAddTarea(clientId, objId, texto) {
  const t = String(texto || '').trim();
  if (!t) return;
  const nowIso = new Date().toISOString();
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    if (!Array.isArray(o.tareas)) o.tareas = [];
    o.tareas.push({
      id: 'tarea-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      texto: t,
      completado: false,
      fechaIdeal: null,
      fechaLimite: null,
      notas: '',
      responsibleUsers: [],
      orden: o.tareas.length,
      createdAt: nowIso,
      updatedAt: nowIso
    });
    return d;
  });
  renderTareasCli();
}

// S67 Bloque A-subtasks 1.1 — schema flat con parent_task_id (S62.5).
// Peer del padre en o.tareas[], distinguido por parent_task_id !== null. Flat 1 nivel.
async function tareasCliAddSubtask(clientId, objId, parentTaskId, texto) {
  const t = String(texto || '').trim();
  if (!t || !parentTaskId) return null;
  const newId = 'tarea-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const nowIso = new Date().toISOString();
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    if (!Array.isArray(o.tareas)) o.tareas = [];
    o.tareas.push({
      id: newId,
      texto: t,
      completado: false,
      fechaIdeal: null,
      fechaLimite: null,
      notas: '',
      responsibleUsers: [],
      orden: o.tareas.length,
      parent_task_id: parentTaskId,
      createdAt: nowIso,
      updatedAt: nowIso
    });
    return d;
  });
  renderTareasCli();
  return newId;
}

async function tareasCliEditTareaTexto(clientId, objId, tareaId, texto) {
  const t = String(texto || '').trim();
  if (!t) return;
  const nowIso = new Date().toISOString();
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    const ta = (o.tareas || []).find(function(x) { return x.id === tareaId; });
    if (ta) { ta.texto = t; ta.updatedAt = nowIso; }
    return d;
  });
  renderTareasCli();
}

// S67 B-modal 1.3: persiste notas de una tarea (Tareas v4.0). Llamado desde modal Edit
// de Plan Semanal cuando bloque.tarea_id != null (schema dual D1). Acepta string vacío.
async function tareasCliEditTareaNotas(clientId, objId, tareaId, notas) {
  const t = String(notas == null ? '' : notas);
  const nowIso = new Date().toISOString();
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    const ta = (o.tareas || []).find(function(x) { return x.id === tareaId; });
    if (ta) { ta.notas = t; ta.updatedAt = nowIso; }
    return d;
  });
  renderTareasCli();
}

async function tareasCliDeleteTarea(clientId, objId, tareaId) {
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    const tareas = Array.isArray(o.tareas) ? o.tareas : [];
    const target = tareas.find(function(x) { return x.id === tareaId; });
    // S67 1.4: schema flat — si la tarea borrada es top-level y tiene hijas, promover
    // (parent_task_id → null) en lugar de borrarlas. Orden recalculado al final del objetivo (D8).
    if (target && !target.parent_task_id) {
      const children = tareas.filter(function(x) { return x.parent_task_id === tareaId; });
      if (children.length > 0) {
        const topLevelMaxOrden = tareas
          .filter(function(x) { return !x.parent_task_id && x.id !== tareaId; })
          .reduce(function(m, x) { return Math.max(m, Number(x.orden) || 0); }, -1);
        children.forEach(function(child, i) {
          child.parent_task_id = null;
          child.orden = topLevelMaxOrden + 1 + i;
        });
      }
    }
    o.tareas = tareas.filter(function(x) { return x.id !== tareaId; });
    return d;
  });
  renderTareasCli();
  // S67 1.4 / D3: cascade NULLIFY (no delete) — preserva bloques Plan Semanal con
  // cliente_id/objetivo_id/objetivo_titulo, solo tarea_id → null. Renombrado desde
  // _msCascadeDeleteByTareaId; sin alias backward-compat (sin callers externos).
  if (typeof _msCascadeNullifyByTareaId === 'function') {
    try { await _msCascadeNullifyByTareaId(tareaId); } catch (e) {}
  }
}

async function tareasCliToggleTarea(clientId, objId, tareaId) {
  const nowIso = new Date().toISOString();
  await tareasCliSave(clientId, function(d) {
    const o = (d.objetivos || []).find(function(x) { return x.id === objId; });
    if (!o) return d;
    const ta = (o.tareas || []).find(function(x) { return x.id === tareaId; });
    if (ta) {
      ta.completado = !ta.completado;
      ta.completadoAt = ta.completado ? nowIso : null;
      ta.updatedAt = nowIso;
    }
    return d;
  });
  renderTareasCli();
}

// ── Inputs inline para crear (no usar prompt() nativo) ───
function tareasCliShowAddObjetivoInput(clientId) {
  const cont = document.getElementById('tareas-cli-add-obj-container-' + clientId);
  if (!cont) return;
  if (cont.dataset.open === '1') { cont.innerHTML = ''; cont.dataset.open = '0'; return; }
  cont.dataset.open = '1';
  cont.innerHTML = ''
    + '<div style="display:flex;gap:6px;margin-top:8px;">'
    +   '<input id="tareas-cli-new-obj-' + clientId + '" type="text" placeholder="Nombre del objetivo y Enter..." '
    +     'style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:12px;padding:8px 10px;border-radius:6px;outline:none;" '
    +     'onkeydown="tareasCliHandleObjInputKey(event, \'' + clientId + '\')" '
    +     'onblur="tareasCliBlurObjInput(\'' + clientId + '\')">'
    + '</div>';
  setTimeout(function() {
    const inp = document.getElementById('tareas-cli-new-obj-' + clientId);
    if (inp) inp.focus();
  }, 50);
}

function tareasCliHandleObjInputKey(e, clientId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const inp = document.getElementById('tareas-cli-new-obj-' + clientId);
    const t = inp ? inp.value.trim() : '';
    if (inp) inp.onblur = null;
    if (t) tareasCliAddObjetivo(clientId, t);
    const cont = document.getElementById('tareas-cli-add-obj-container-' + clientId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  } else if (e.key === 'Escape') {
    const cont = document.getElementById('tareas-cli-add-obj-container-' + clientId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  }
}

function tareasCliBlurObjInput(clientId) {
  setTimeout(function() {
    const cont = document.getElementById('tareas-cli-add-obj-container-' + clientId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  }, 100);
}

function tareasCliShowAddTareaInput(clientId, objId) {
  const cont = document.getElementById('tareas-cli-add-tarea-container-' + clientId + '-' + objId);
  if (!cont) return;
  if (cont.dataset.open === '1') { cont.innerHTML = ''; cont.dataset.open = '0'; return; }
  cont.dataset.open = '1';
  cont.innerHTML = ''
    + '<div style="display:flex;gap:6px;margin-top:6px;">'
    +   '<input id="tareas-cli-new-tarea-' + clientId + '-' + objId + '" type="text" placeholder="Nueva tarea y Enter..." '
    +     'style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:12px;padding:6px 8px;border-radius:6px;outline:none;" '
    +     'onkeydown="tareasCliHandleTareaInputKey(event, \'' + clientId + '\', \'' + objId + '\')" '
    +     'onblur="tareasCliBlurTareaInput(\'' + clientId + '\', \'' + objId + '\')">'
    + '</div>';
  setTimeout(function() {
    const inp = document.getElementById('tareas-cli-new-tarea-' + clientId + '-' + objId);
    if (inp) inp.focus();
  }, 50);
}

function tareasCliHandleTareaInputKey(e, clientId, objId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const inp = document.getElementById('tareas-cli-new-tarea-' + clientId + '-' + objId);
    const t = inp ? inp.value.trim() : '';
    if (inp) inp.onblur = null;
    if (t) tareasCliAddTarea(clientId, objId, t);
    const cont = document.getElementById('tareas-cli-add-tarea-container-' + clientId + '-' + objId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  } else if (e.key === 'Escape') {
    const cont = document.getElementById('tareas-cli-add-tarea-container-' + clientId + '-' + objId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  }
}

function tareasCliBlurTareaInput(clientId, objId) {
  setTimeout(function() {
    const cont = document.getElementById('tareas-cli-add-tarea-container-' + clientId + '-' + objId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  }, 100);
}

// S67 1.3: input inline para crear subtask bajo un padre top-level. Patrón espejo de AddTarea.
function tareasCliShowAddSubtaskInput(clientId, objId, parentTaskId) {
  const cont = document.getElementById('tareas-cli-add-subtask-container-' + clientId + '-' + parentTaskId);
  if (!cont) return;
  if (cont.dataset.open === '1') { cont.innerHTML = ''; cont.dataset.open = '0'; return; }
  cont.dataset.open = '1';
  cont.innerHTML = ''
    + '<div style="display:flex;gap:6px;margin-top:6px;margin-left:18px;">'
    +   '<input id="tareas-cli-new-subtask-' + clientId + '-' + parentTaskId + '" type="text" placeholder="Nueva subtask y Enter…" '
    +     'style="flex:1;background:var(--surface);border:1px solid var(--accent);color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:12px;padding:6px 8px;border-radius:6px;outline:none;" '
    +     'onkeydown="tareasCliHandleSubtaskInputKey(event, \'' + clientId + '\', \'' + objId + '\', \'' + parentTaskId + '\')" '
    +     'onblur="tareasCliBlurSubtaskInput(\'' + clientId + '\', \'' + parentTaskId + '\')">'
    + '</div>';
  setTimeout(function() {
    const inp = document.getElementById('tareas-cli-new-subtask-' + clientId + '-' + parentTaskId);
    if (inp) inp.focus();
  }, 50);
}

function tareasCliHandleSubtaskInputKey(e, clientId, objId, parentTaskId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const inp = document.getElementById('tareas-cli-new-subtask-' + clientId + '-' + parentTaskId);
    const t = inp ? inp.value.trim() : '';
    if (inp) inp.onblur = null;
    if (t) tareasCliAddSubtask(clientId, objId, parentTaskId, t);
    const cont = document.getElementById('tareas-cli-add-subtask-container-' + clientId + '-' + parentTaskId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  } else if (e.key === 'Escape') {
    const cont = document.getElementById('tareas-cli-add-subtask-container-' + clientId + '-' + parentTaskId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  }
}

function tareasCliBlurSubtaskInput(clientId, parentTaskId) {
  setTimeout(function() {
    const cont = document.getElementById('tareas-cli-add-subtask-container-' + clientId + '-' + parentTaskId);
    if (cont) { cont.innerHTML = ''; cont.dataset.open = '0'; }
  }, 100);
}

// Edit inline para nombres existentes
function tareasCliEditObjNameInline(e, clientId, objId) {
  e.stopPropagation();
  const span = e.currentTarget;
  const currentNombre = span.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentNombre;
  input.style.cssText = 'flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:\'DM Sans\',sans-serif;font-weight:600;font-size:12px;padding:4px 6px;border-radius:4px;outline:none;min-width:0;';
  span.replaceWith(input);
  input.focus();
  input.select();
  let saved = false;
  function commit() {
    if (saved) return; saved = true;
    const v = input.value.trim();
    if (v && v !== currentNombre) tareasCliEditObjetivoNombre(clientId, objId, v);
    else renderTareasCli();
  }
  input.onblur = commit;
  input.onkeydown = function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { saved = true; renderTareasCli(); }
  };
}

function tareasCliEditTareaTextoInline(e, clientId, objId, tareaId) {
  e.stopPropagation();
  const span = e.currentTarget;
  const currentTexto = span.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTexto;
  input.style.cssText = 'flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:\'DM Sans\',sans-serif;font-size:12px;padding:2px 6px;border-radius:4px;outline:none;min-width:0;';
  span.replaceWith(input);
  input.focus();
  input.select();
  let saved = false;
  function commit() {
    if (saved) return; saved = true;
    const v = input.value.trim();
    if (v && v !== currentTexto) tareasCliEditTareaTexto(clientId, objId, tareaId, v);
    else renderTareasCli();
  }
  input.onblur = commit;
  input.onkeydown = function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { saved = true; renderTareasCli(); }
  };
}

// Modal de confirmación CSS — reutilizable, sin confirm() nativo (corrección S62.6.3.G)
function tareasCliShowConfirmModal(message, onConfirm) {
  const id = 'tareasCli-confirm-modal';
  let el = document.getElementById(id);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:320px;max-width:420px;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:15px;color:var(--text);margin-bottom:8px;">¿Estás seguro?</div>'
    +   '<div id="tareasCli-confirm-msg" style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:18px;"></div>'
    +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +     '<button id="tareasCli-confirm-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Cancelar</button>'
    +     '<button id="tareasCli-confirm-ok" style="background:var(--red);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Eliminar</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);
  document.getElementById('tareasCli-confirm-msg').textContent = message;
  function close() { try { el.remove(); } catch(e) {} }
  document.getElementById('tareasCli-confirm-cancel').onclick = close;
  document.getElementById('tareasCli-confirm-ok').onclick = function() {
    close();
    try { onConfirm(); } catch(e) { console.error(e); }
  };
  el.onclick = function(ev) { if (ev.target === el) close(); };
  document.addEventListener('keydown', function escHandler(ev) {
    if (ev.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      close();
    }
  });
}

function tareasCliConfirmDeleteObjetivo(clientId, objId) {
  const cached = _tareasCliMemCache[clientId] || tareasCliLoadCache(clientId);
  const o = ((cached && cached.objetivos) || []).find(function(x) { return x.id === objId; });
  if (!o) return;
  const tareaCount = (o.tareas || []).length;
  const msg = tareaCount > 0
    ? 'Vas a eliminar el objetivo "' + o.nombre + '" con ' + tareaCount + ' tarea' + (tareaCount === 1 ? '' : 's') + '. Esta acción no se puede deshacer.'
    : 'Vas a eliminar el objetivo "' + o.nombre + '". Esta acción no se puede deshacer.';
  tareasCliShowConfirmModal(msg, function() { tareasCliDeleteObjetivo(clientId, objId); });
}

function tareasCliConfirmDeleteTarea(clientId, objId, tareaId) {
  const cached = _tareasCliMemCache[clientId] || tareasCliLoadCache(clientId);
  const o = ((cached && cached.objetivos) || []).find(function(x) { return x.id === objId; });
  if (!o) return;
  const ta = (o.tareas || []).find(function(x) { return x.id === tareaId; });
  if (!ta) return;
  tareasCliShowConfirmModal('Vas a eliminar la tarea "' + ta.texto + '". Esta acción no se puede deshacer.', function() { tareasCliDeleteTarea(clientId, objId, tareaId); });
}

// ════════════════════════════════════════════════════════════════
// DELETE CLIENT v1 (feat/delete-client-v1) — modal con text-gate + flow.
// Core logic vive en modules/core.js (window._fbDeleteClient). Aquí solo
// orquestación de UI: unsub listener → mutación optimista → await delete →
// rollback con re-sub si falla.
// ════════════════════════════════════════════════════════════════

// Unsub el listener tareas-clientes de un solo cliente. Retorna info para
// re-subscribir en caso de rollback (la re-sub la hace tareasCliInitFromFirestore).
function tareasCliUnsubOne(clientId) {
  const fn = _tareasCliUnsubs[clientId];
  if (typeof fn === 'function') {
    try { fn(); } catch(e) {}
    delete _tareasCliUnsubs[clientId];
    return true;
  }
  return false;
}

// Check de rol — direccion o owner pueden borrar.
function _canDeleteClient(clientId) {
  if (!clientId || !clientId.startsWith('client-')) return false;
  const profile = (typeof window !== 'undefined') ? window.currentUserProfile : null;
  if (!profile) return false;
  // 'all' es el rol super-admin real en producción (Anwar). 'direccion'
  // es estratégico. 'owner' incluido por consistencia aunque en este
  // workspace puede existir solo como calendar_role.
  const allowedRoles = ['all', 'direccion', 'owner'];
  const isCalendarOwner = profile.calendar_role === 'owner';
  return allowedRoles.indexOf(profile.rol) !== -1 || isCalendarOwner;
}

// Modal custom con text-input que debe matchear el nombre exacto.
function tareasCliShowDeleteClientModal(clientId) {
  const target = (typeof clients !== 'undefined' ? clients : []).find(function(c) { return c.id === clientId; });
  if (!target) { showToast('Cliente no encontrado', '⚠️'); return; }
  if (!_canDeleteClient(clientId)) { showToast('No tienes permiso para borrar clientes', '⚠️'); return; }

  // Contar objetivos + tareas desde el cache
  const cached = _tareasCliMemCache[clientId] || tareasCliLoadCache(clientId) || tareasCliEmptyDoc(clientId);
  const objetivos = Array.isArray(cached.objetivos) ? cached.objetivos : [];
  const objCount = objetivos.length;
  let tareaCount = 0;
  objetivos.forEach(function(o) { tareaCount += (Array.isArray(o.tareas) ? o.tareas.length : 0); });

  const modalId = 'tareasCli-delete-client-modal';
  let el = document.getElementById(modalId);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = modalId;
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  const nombreSafe = escapeHtml(target.nombre || target.id);
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:380px;max-width:460px;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;color:var(--text);margin-bottom:10px;">Borrar cliente</div>'
    +   '<div style="font-size:13px;color:var(--text2);line-height:1.55;margin-bottom:8px;">Vas a borrar <strong style="color:var(--text);">' + nombreSafe + '</strong> permanentemente.</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);line-height:1.55;margin-bottom:16px;">Esto borrará ' + objCount + ' objetivo' + (objCount === 1 ? '' : 's') + ', ' + tareaCount + ' tarea' + (tareaCount === 1 ? '' : 's') + ', y limpiará referencias en Mi Semana. No se puede deshacer.</div>'
    +   '<div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Escribe <strong style="color:var(--text);">' + nombreSafe + '</strong> para confirmar:</div>'
    +   '<input id="tareasCli-del-input" type="text" autocomplete="off" style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px 10px;font-size:13px;font-family:\'DM Mono\',monospace;margin-bottom:14px;">'
    +   '<div id="tareasCli-del-error" style="display:none;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:var(--red);padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;"></div>'
    +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +     '<button id="tareasCli-del-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Cancelar</button>'
    +     '<button id="tareasCli-del-confirm" disabled style="background:var(--red);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:not-allowed;opacity:0.4;">Borrar definitivamente</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);

  const input = document.getElementById('tareasCli-del-input');
  const confirmBtn = document.getElementById('tareasCli-del-confirm');
  const cancelBtn = document.getElementById('tareasCli-del-cancel');
  const errEl = document.getElementById('tareasCli-del-error');

  function close() { try { el.remove(); } catch(e) {} }
  function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  function clearErr() { errEl.style.display = 'none'; }

  input.addEventListener('input', function() {
    const match = input.value === (target.nombre || target.id);
    confirmBtn.disabled = !match;
    confirmBtn.style.opacity = match ? '1' : '0.4';
    confirmBtn.style.cursor = match ? 'pointer' : 'not-allowed';
  });

  cancelBtn.onclick = close;
  el.onclick = function(ev) { if (ev.target === el) close(); };
  document.addEventListener('keydown', function escHandler(ev) {
    if (ev.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      close();
    }
  });

  confirmBtn.onclick = async function() {
    if (confirmBtn.disabled) return;
    clearErr();
    const origText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.6';
    confirmBtn.style.cursor = 'wait';
    confirmBtn.textContent = 'Borrando...';
    cancelBtn.disabled = true;

    // Snapshot para rollback array + listener
    const backupClients = clients.slice();
    const hadListener = tareasCliUnsubOne(clientId);

    // Mutación optimista del array global
    const filtered = clients.filter(function(c) { return c.id !== clientId; });
    clients.length = 0;
    filtered.forEach(function(c) { clients.push(c); });

    try {
      if (!window._fbDeleteClient) throw new Error('Módulo core no listo — recarga la página');
      await window._fbDeleteClient(clientId, filtered);

      // Success: cleanup local + UI
      try { localStorage.setItem('oa-clients', JSON.stringify(filtered)); } catch(e){}
      delete _tareasCliMemCache[clientId];
      close();
      showToast("'" + (target.nombre || target.id) + "' borrado", '✅');
      if (typeof renderTareasCli === 'function') {
        try { renderTareasCli(); } catch(e) {}
      }
    } catch (err) {
      console.error('[delete-client-v1] fbDeleteClient falló:', err);
      // Rollback array + localStorage + re-suscribir listener
      clients.length = 0;
      backupClients.forEach(function(c) { clients.push(c); });
      try { localStorage.setItem('oa-clients', JSON.stringify(backupClients)); } catch(e){}
      if (hadListener) {
        try { tareasCliInitFromFirestore(clientId); } catch(e) {}
      }
      showErr((err && err.message) || 'Error al borrar cliente. Intenta de nuevo.');
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.style.cursor = 'pointer';
      confirmBtn.textContent = origText;
      cancelBtn.disabled = false;
    }
  };

  setTimeout(function() { input.focus(); }, 50);
}

// API expuesta para test manual desde consola del browser
window.tareasCli = {
  ref: tareasCliFirestoreRef,
  loadCache: tareasCliLoadCache,
  saveCache: tareasCliSaveCache,
  init: tareasCliInitFromFirestore,
  save: tareasCliSave,
  unsubAll: tareasCliUnsubAll,
  unsubOne: tareasCliUnsubOne,
  emptyDoc: tareasCliEmptyDoc,
  applyVista: tareasApplyVista,
  setVista: tareasSetVista,
  getVista: tareasGetVistaActiva,
  render: renderTareasCli,
  reorderOrMove: tareasCliReorderOrMoveTarea,
  setFechaLimite: tareasCliSetFechaLimite,
  showDeleteModal: tareasCliShowDeleteClientModal,
  canDelete: _canDeleteClient,
  _test: _tareasCliRunReorderTests,
  cache: _tareasCliMemCache,
  COLORS: TAREAS_CLIENTE_COLORS
};


// ════════════════════════════════════════════════════════════════
// INIT — window-compat para HTML inline handlers + Mi Semana + bootstrap
// ════════════════════════════════════════════════════════════════

function initTareas() {
  if (typeof window !== 'undefined' && window.__tareasInitialized) {
    return;
  }

  // ── v2.0 Áreas internas: HTML inline + call sites externos ──
  window.renderTareas = renderTareas;
  window.tareasUpdateBadge = tareasUpdateBadge;
  window.tareasLoad = tareasLoad;
  window.tareasSave = tareasSave;
  window.tareasGetHoy = tareasGetHoy;
  window.tareasFormatFecha = tareasFormatFecha;
  window.tareasGetPendientesHoy = tareasGetPendientesHoy;
  window.renderJrTareaPendiente = renderJrTareaPendiente;
  window.tareasAddArea = tareasAddArea;
  window.tareasToggleArea = tareasToggleArea;
  window.tareasDeleteArea = tareasDeleteArea;
  window.tareasToggleProyecto = tareasToggleProyecto;
  window.tareasAddProyecto = tareasAddProyecto;
  window.tareasDeleteProyecto = tareasDeleteProyecto;
  window.tareasToggle = tareasToggle;
  window.tareasShowInput = tareasShowInput;
  window.tareasHandleInputKey = tareasHandleInputKey;
  window.tareasMaybeBlurInput = tareasMaybeBlurInput;
  window.tareasToggleFechaInputs = tareasToggleFechaInputs;
  window.tareasAddTarea = tareasAddTarea;
  window.tareasToggleNotaInline = tareasToggleNotaInline;
  window.tareasSaveNota = tareasSaveNota;
  window.tareasDragStart = tareasDragStart;
  window.tareasDragOver = tareasDragOver;
  window.tareasDragLeave = tareasDragLeave;
  window.tareasDrop = tareasDrop;
  window.tareasDragEnd = tareasDragEnd;
  window.tareasAreaDragStart = tareasAreaDragStart;
  window.tareasAreaDragOver = tareasAreaDragOver;
  window.tareasAreaDragLeave = tareasAreaDragLeave;
  window.tareasAreaDrop = tareasAreaDrop;
  window.tareasAreaDragEnd = tareasAreaDragEnd;
  window.tareasDeleteTarea = tareasDeleteTarea;
  window.seniorToggleTareasPanel = seniorToggleTareasPanel;
  window.renderSeniorTareasPanel = renderSeniorTareasPanel;
  window.tareasInitializeFromFirestore = tareasInitializeFromFirestore;

  // ── v4.0 Vista Clientes: HTML inline + call sites externos + Mi Semana ──
  window.tareasGetVistaActiva = tareasGetVistaActiva;
  window.tareasSetVista = tareasSetVista;
  window.tareasApplyVista = tareasApplyVista;
  window.renderTareasCli = renderTareasCli;
  window.tareasCliEnsureAllInitialized = tareasCliEnsureAllInitialized;
  window.tareasCliGetPendientesHoy = tareasCliGetPendientesHoy;
  window.renderJrTareaPendienteCli = renderJrTareaPendienteCli;
  window.tareasCliShowRitualModal = tareasCliShowRitualModal;
  window.tareasCliShowAtrasadasModal = tareasCliShowAtrasadasModal;
  window.tareasCliAddObjetivo = tareasCliAddObjetivo;
  window.tareasCliEditObjetivoNombre = tareasCliEditObjetivoNombre;
  window.tareasCliDeleteObjetivo = tareasCliDeleteObjetivo;
  window.tareasCliAddTarea = tareasCliAddTarea;
  window.tareasCliAddSubtask = tareasCliAddSubtask;
  window.tareasCliEditTareaTexto = tareasCliEditTareaTexto;
  window.tareasCliEditTareaNotas = tareasCliEditTareaNotas;
  window.tareasCliDeleteTarea = tareasCliDeleteTarea;
  window.tareasCliToggleTarea = tareasCliToggleTarea;
  window.tareasCliSetFechaLimite = tareasCliSetFechaLimite;
  window.tareasCliShowAddObjetivoInput = tareasCliShowAddObjetivoInput;
  window.tareasCliHandleObjInputKey = tareasCliHandleObjInputKey;
  window.tareasCliBlurObjInput = tareasCliBlurObjInput;
  window.tareasCliShowAddTareaInput = tareasCliShowAddTareaInput;
  window.tareasCliHandleTareaInputKey = tareasCliHandleTareaInputKey;
  window.tareasCliBlurTareaInput = tareasCliBlurTareaInput;
  window.tareasCliShowAddSubtaskInput = tareasCliShowAddSubtaskInput;
  window.tareasCliHandleSubtaskInputKey = tareasCliHandleSubtaskInputKey;
  window.tareasCliBlurSubtaskInput = tareasCliBlurSubtaskInput;
  window.tareasCliEditObjNameInline = tareasCliEditObjNameInline;
  window.tareasCliEditTareaTextoInline = tareasCliEditTareaTextoInline;
  window.tareasCliConfirmDeleteObjetivo = tareasCliConfirmDeleteObjetivo;
  window.tareasCliConfirmDeleteTarea = tareasCliConfirmDeleteTarea;
  window.tareasCliShowDeleteClientModal = tareasCliShowDeleteClientModal;
  window.tareasCliToggleSubtaskCollapse = tareasCliToggleSubtaskCollapse;
  window.tareasCliCalPrevWeek = tareasCliCalPrevWeek;
  window.tareasCliCalNextWeek = tareasCliCalNextWeek;
  window.tareasCliCalToday = tareasCliCalToday;
  window.tareasCliDragStart = tareasCliDragStart;
  window.tareasCliDragOver = tareasCliDragOver;
  window.tareasCliDragEnd = tareasCliDragEnd;
  window.tareasCliDrop = tareasCliDrop;
  window.tareasCliMaybeShowOnboarding = tareasCliMaybeShowOnboarding;
  window.tareasCliRenderAtrasadasBanner = tareasCliRenderAtrasadasBanner;

  // ── Estado interno expuesto a Mi Semana ──
  // _tareasCliMemCache leído 6x desde Mi Semana (lines 11242, 11271, 11537,
  // 11551, 11683, 11826 en index.html). Asignación por referencia: el cache
  // del módulo y window.* apuntan al mismo objeto.
  window._tareasCliMemCache = _tareasCliMemCache;

  // ── Quick Client: HTML inline ──
  window.openQuickClientModal = openQuickClientModal;
  window.createQuickClient = createQuickClient;
  window._qcSelectColor = _qcSelectColor;
  // BUG #15 PARTE B helpers (HTML inline en modal-quick-client).
  window._qcOnTipoChange = _qcOnTipoChange;
  window._qcUpdateCreateBtn = _qcUpdateCreateBtn;

  // ── Diagnostic hooks (smoke test) ──
  window.__tareasInitialized = true;
  console.log('[tareas.js] init complete');
}

if (typeof window !== 'undefined') {
  window.initTareas = initTareas;
}
