// ════════════════════════════════════════════════════════════════
// OPTIX — Mi Semana (Plan Semanal F1–F3 + S67)
//
// Extraído de index.html L8210-L9453 en refactor F2a. Sin cambios de
// comportamiento. Funciones expuestas a window vía init() para preservar:
//  - HTML inline onclick (miSemanaPrev/Next/Today, _msTogglePanelCollapsed,
//    _msOnSlotClick, _msOnBloqueClick).
//  - Reverse coupling tareas.js:2417 → _msCascadeNullifyByTareaId.
//  - API consola window.calendarSemana.
//
// Bare identifiers que se leen del global scope:
//  - clients, currentAgencia, currentRol (var en index.html).
//  - getDefaultClients, showToast, closeModal, firebase (function decl / namespace).
//  - tareasCliEnsureAllInitialized, tareasCliAddObjetivo, _tareasCliMemCache
//    (expuestos por modules/tareas.js initTareas).
//
// F2b (S74): TAREAS_CLIENTE_COLORS importada vía named import desde tareas.js
// (shim previo en index.html <head> eliminado). Watch Firestore duplicado #32
// (_msEnsureTareasCliWatch) sigue pendiente, fuera del scope F2b.
// ════════════════════════════════════════════════════════════════

import { escapeHtml } from './utils.js';
import { TAREAS_CLIENTE_COLORS, tareasCliScopeMatch, tareasCliGetFilter, tareasCliSetFilter } from './tareas.js';

// ══════════════════════════════════════════════════════════════
// MÓDULO PLAN SEMANAL — F1 (esqueleto + render bloques estáticos)
// SPEC: canvas Slack F0B1YL88K1B
// Schema Firestore (D4-D9, sec 5.3):
//   collection: workspaces/{wsId}/calendar-bloques/{bloqueId}
//   doc: {
//     assigned_to: uid,
//     created_by: uid,
//     cliente_id: 'enpagos' | 'agency' | etc,
//     objetivo_id: string | null,
//     tarea_id: string | null,
//     inicio_ts: Timestamp | null,        // UTC; null si recurrente puro
//     duracion_minutos: int,
//     recurrencia: null | { tipo, dias, hora_inicio, ... },  // null en F1
//     completado: bool,
//     completado_at: Timestamp | null,
//     completado_por_fecha: { 'YYYY-MM-DD': Timestamp },     // recurrentes (F3)
//     titulo: string,
//     created_at: Timestamp,
//     updated_at: Timestamp
//   }
// F1 renderea SOLO bloques one-off (recurrencia==null) del usuario logueado.
// Permisos: client-side (consistente con resto de Optix). Hardening = deuda técnica.
// ══════════════════════════════════════════════════════════════

// Paleta cliente: reusa TAREAS_CLIENTE_COLORS de S64 (incluye 'agency' explícito
// para evitar gris idéntico al _fallback).
// F2b (S74): import directo desde tareas.js. ESM garantiza que el binding ya
// esté resuelto al evaluarse este top-level (shim del head ya no existe).
const CALENDAR_CLIENT_COLORS = Object.assign({}, TAREAS_CLIENTE_COLORS, {
  'agency': '#64748b'
});

const _calendarSemanaMemCache = {};   // { uid: { bloqueId: doc, ... } }
const _calendarSemanaUnsubs = {};     // { uid: unsubFn }
let _calendarSemanaWeekOffset = 0;
let _calendarSemanaResizeBound = false;
// PR1 Cambio 1: vista semana|diario per user (localStorage oa-ms-view-<uid>).
let _calendarSemanaView = 'semana';
let _calendarSemanaDayOffset = 0;   // días desde hoy en modo diario; reset a 0 al toggle

function _msViewPrefKey(uid) { return 'oa-ms-view-' + (uid || '_anon'); }
function _msLoadViewPref(uid) {
  try {
    const v = localStorage.getItem(_msViewPrefKey(uid));
    if (v === 'semana' || v === 'diario') _calendarSemanaView = v;
  } catch (e) {}
}
function _msSaveViewPref(uid) {
  try { localStorage.setItem(_msViewPrefKey(uid), _calendarSemanaView); } catch (e) {}
}
function miSemanaToggleView(newView) {
  if (newView !== 'semana' && newView !== 'diario') return;
  if (_calendarSemanaView === newView) return;
  _calendarSemanaView = newView;
  _calendarSemanaDayOffset = 0;  // reset al toggle (siempre arranca en hoy)
  const uid = (window.currentUser && window.currentUser.uid) || '';
  _msSaveViewPref(uid);
  renderMiSemana();
}
function _msPrevStep() {
  if (_calendarSemanaView === 'diario') _calendarSemanaDayOffset--;
  else _calendarSemanaWeekOffset--;
  renderMiSemana();
}
function _msNextStep() {
  if (_calendarSemanaView === 'diario') _calendarSemanaDayOffset++;
  else _calendarSemanaWeekOffset++;
  renderMiSemana();
}
function _msTodayStep() {
  if (_calendarSemanaView === 'diario') _calendarSemanaDayOffset = 0;
  else _calendarSemanaWeekOffset = 0;
  renderMiSemana();
}

function calendarSemanaCacheKey(uid) {
  const wsId = currentAgencia || 'optimizads';
  return 'calendarSemana_v1_' + wsId + '_' + uid;
}

function calendarSemanaFirestoreCol() {
  if (!window.firebaseDb) return null;
  const wsId = currentAgencia || 'optimizads';
  return window.firebaseDb.collection('workspaces').doc(wsId).collection('calendar-bloques');
}

function calendarSemanaFirestoreRef(bloqueId) {
  const col = calendarSemanaFirestoreCol();
  if (!col || !bloqueId) return null;
  return col.doc(bloqueId);
}

function calendarSemanaLoadCache(uid) {
  try {
    const raw = localStorage.getItem(calendarSemanaCacheKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    _calendarSemanaMemCache[uid] = parsed || {};
    return _calendarSemanaMemCache[uid];
  } catch (e) {
    console.warn('[calendarSemana] loadCache failed', uid, e);
    return {};
  }
}

function calendarSemanaSaveCache(uid, data) {
  try {
    localStorage.setItem(calendarSemanaCacheKey(uid), JSON.stringify(data || {}));
    _calendarSemanaMemCache[uid] = data || {};
  } catch (e) {
    console.warn('[calendarSemana] saveCache failed', uid, e);
  }
}

// Toast de conflicto — modal CSS, NO alert() nativo
function calendarSemanaShowConflictToast(bloqueId) {
  const id = 'calendarSemana-conflict-toast';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:var(--surface);border:1px solid var(--red);border-radius:10px;padding:14px 18px;font-family:\'DM Sans\',sans-serif;font-size:13px;color:var(--text);box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:340px;';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="font-weight:600;color:var(--red);margin-bottom:4px;">Conflicto de versión</div>'
    + '<div style="color:var(--text2);line-height:1.5;">Otro usuario editó el bloque <strong>' + escapeHtml(bloqueId || '?') + '</strong>. Refrescando datos. Tu cambio se descartó — vuelve a aplicarlo.</div>';
  el.style.display = 'block';
  setTimeout(function() { if (el) el.style.display = 'none'; }, 6000);
}

// F2 fix bug: el panel lateral lee de _tareasCliMemCache (módulo Tareas v4.0).
// Cuando entras a /mi-semana en frío, ese cache aún no está hidratado y el
// primer render del panel sale vacío. Suscribimos un onSnapshot de
// collection-level a tareas-clientes para disparar re-render de Mi semana
// cuando llega data — patrón consistente con el onSnapshot de calendar-bloques.
let _msTareasCliWatchUnsub = null;
let _msTareasCliWatchInitial = true;

function _msEnsureTareasCliWatch() {
  if (_msTareasCliWatchUnsub) return;
  if (!window.firebaseDb) return;
  const wsId = currentAgencia || 'optimizads';
  const tcCol = window.firebaseDb.collection('workspaces').doc(wsId).collection('tareas-clientes');
  _msTareasCliWatchInitial = true;
  _msTareasCliWatchUnsub = tcCol.onSnapshot(function() {
    // El primer disparo es la carga inicial — útil precisamente porque
    // hidrata cuando enterAs llegó antes que los listeners individuales.
    _msTareasCliWatchInitial = false;
    const screen = document.getElementById('screen-mi-semana');
    if (screen && screen.classList.contains('active') && typeof renderMiSemana === 'function') {
      try { renderMiSemana(); } catch (e) { console.warn('[calendarSemana] re-render after tareasCli snapshot failed', e); }
    }
  }, function(err) { console.warn('[calendarSemana] tareasCli watch error', err); });
}

async function calendarSemanaInit(uid) {
  if (!uid) return null;
  const col = calendarSemanaFirestoreCol();
  if (!col) return calendarSemanaLoadCache(uid);

  if (_calendarSemanaUnsubs[uid]) {
    try { _calendarSemanaUnsubs[uid](); } catch (e) {}
    delete _calendarSemanaUnsubs[uid];
  }

  // F2 fix: arrancar listeners de tareas-clientes para poblar _tareasCliMemCache
  // (necesario para el panel lateral) + watcher dedicado para trigger de re-render.
  if (typeof tareasCliEnsureAllInitialized === 'function') {
    try { tareasCliEnsureAllInitialized(); } catch (e) {}
  }
  _msEnsureTareasCliWatch();

  try {
    const snap = await col.where('assigned_to', '==', uid).get();
    const docs = {};
    snap.forEach(function(d) { docs[d.id] = Object.assign({ id: d.id }, d.data()); });
    calendarSemanaSaveCache(uid, docs);

    _calendarSemanaUnsubs[uid] = col.where('assigned_to', '==', uid).onSnapshot(function(snap2) {
      const next = {};
      snap2.forEach(function(d) { next[d.id] = Object.assign({ id: d.id }, d.data()); });
      calendarSemanaSaveCache(uid, next);
      const screen = document.getElementById('screen-mi-semana');
      if (screen && screen.classList.contains('active') && typeof renderMiSemana === 'function') {
        renderMiSemana();
      }
    }, function(err) { console.warn('[calendarSemana] onSnapshot error', uid, err); });

    return docs;
  } catch (e) {
    console.warn('[calendarSemana] init failed, fallback cache', uid, e);
    return calendarSemanaLoadCache(uid);
  }
}

function calendarSemanaUnsubAll() {
  Object.keys(_calendarSemanaUnsubs).forEach(function(k) {
    try { _calendarSemanaUnsubs[k](); } catch (e) {}
    delete _calendarSemanaUnsubs[k];
  });
  if (_msTareasCliWatchUnsub) {
    try { _msTareasCliWatchUnsub(); } catch (e) {}
    _msTareasCliWatchUnsub = null;
  }
}

// Save con versionado optimista — 3 retries con backoff 200/400/600ms.
// mutator: (baseDoc) => newDoc. Usa 'updated_at' como contador de versión optimista.
async function calendarSemanaSave(bloqueId, mutator) {
  const ref = calendarSemanaFirestoreRef(bloqueId);
  if (!ref) {
    console.warn('[calendarSemana] save: no ref (offline o unauth)', bloqueId);
    return null;
  }
  const delays = [200, 400, 600];

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const result = await window.firebaseDb.runTransaction(async function(tx) {
        const snap = await tx.get(ref);
        const baseDoc = snap.exists
          ? Object.assign({ id: bloqueId }, snap.data())
          : { id: bloqueId };
        const draft = mutator(JSON.parse(JSON.stringify(baseDoc)));
        if (!draft) throw new Error('MUTATOR_RETURNED_NULL');
        draft.id = bloqueId;
        draft.updated_at = firebase.firestore.FieldValue.serverTimestamp();
        if (!draft.created_at && !snap.exists) draft.created_at = firebase.firestore.FieldValue.serverTimestamp();
        tx.set(ref, draft);
        return draft;
      });
      const uid = result.assigned_to;
      if (uid) {
        const cache = _calendarSemanaMemCache[uid] || calendarSemanaLoadCache(uid);
        cache[bloqueId] = Object.assign({}, result, { updated_at: Date.now() });
        calendarSemanaSaveCache(uid, cache);
      }
      return result;
    } catch (e) {
      if (attempt < 3) {
        await new Promise(function(r) { setTimeout(r, delays[attempt]); });
        continue;
      }
      console.warn('[calendarSemana] save failed after 3 retries', bloqueId, e);
      calendarSemanaShowConflictToast(bloqueId);
      return null;
    }
  }
  return null;
}

// Helper rol del calendar (D40, B=opción 2). users.calendar_role: 'owner' | 'member'.
// Default 'member'. Anwar manual a 'owner' en Firebase Console post-deploy.
function getUserCalendarRole(uid) {
  const profile = window.currentUserProfile;
  if (profile && (uid == null || uid === (window.currentUser && window.currentUser.uid))) {
    return profile.calendar_role === 'owner' ? 'owner' : 'member';
  }
  return 'member';
}

// ── Helpers fecha (semana en TZ browser) ─────────────────────
function _msGetMondayOfWeek(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diffToMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - diffToMonday + (offset * 7));
  return d;
}
function _msGetSaturdayOfWeek(offset) {
  const m = _msGetMondayOfWeek(offset);
  m.setDate(m.getDate() + 5);
  return m;
}
function _msFmtDateShort(date) {
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return date.getDate() + ' ' + meses[date.getMonth()];
}

// PR1 Cambio 3b: inicio del día CST (UTC-6) — usado para filtrar bloques
// completados HOY (sin contar madrugadas previas ni días pasados).
function _msStartOfTodayCST() {
  const now = new Date();
  const cstNow = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  cstNow.setUTCHours(0, 0, 0, 0);
  return new Date(cstNow.getTime() + 6 * 60 * 60 * 1000);
}

// Convierte Firestore Timestamp | Date | number | ISO string a Date local.
function _msToDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts === 'string') return new Date(ts);
  if (typeof ts.toDate === 'function') return ts.toDate(); // Firestore Timestamp
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

// Constantes layout
const MS_HORA_INICIO = 8;       // 8am
const MS_HORA_FIN = 19;         // 7pm — slot final inicia 19:00
const MS_SLOTS = (MS_HORA_FIN - MS_HORA_INICIO) * 2 + 1; // 23 slots de 30min
const MS_SLOT_HEIGHT = 24;       // px por slot

function miSemanaPrevWeek() { _calendarSemanaWeekOffset--; renderMiSemana(); }
function miSemanaNextWeek() { _calendarSemanaWeekOffset++; renderMiSemana(); }
function miSemanaToday() { _calendarSemanaWeekOffset = 0; renderMiSemana(); }

// ── Render orchestrator ───────────────────────────────────
function renderMiSemana() {
  const screen = document.getElementById('screen-mi-semana');
  if (!screen) return;

  const headerEl = document.getElementById('ms-page-header');
  const gridEl = document.getElementById('ms-grid-container');
  const viewportMsg = document.getElementById('ms-viewport-msg');
  if (!headerEl || !gridEl || !viewportMsg) return;

  // Resize listener (idempotente)
  if (!_calendarSemanaResizeBound) {
    window.addEventListener('resize', function() {
      const sc = document.getElementById('screen-mi-semana');
      if (sc && sc.classList.contains('active')) renderMiSemana();
    });
    _calendarSemanaResizeBound = true;
  }

  // Viewport check (D30)
  if (window.innerWidth < 1280) {
    headerEl.style.display = 'none';
    gridEl.style.display = 'none';
    viewportMsg.style.display = '';
    return;
  }
  headerEl.style.display = '';
  gridEl.style.display = '';
  viewportMsg.style.display = 'none';

  const uid = (window.currentUser && window.currentUser.uid) || null;
  if (!uid) {
    headerEl.innerHTML = '<div style="color:var(--text3);font-size:13px;">Inicia sesión para ver tu plan.</div>';
    gridEl.innerHTML = '';
    return;
  }

  // Lazy init Firestore listener (idempotente, no resubscribe).
  if (!_calendarSemanaUnsubs[uid]) {
    try { calendarSemanaInit(uid); } catch (e) {}
  }

  headerEl.innerHTML = _msRenderPageHeader();
  gridEl.innerHTML = _msRenderGrid(uid);
}

function _msRenderPageHeader() {
  // PR1 Cambio 1: label nav según vista activa.
  const isWeek = _calendarSemanaView === 'semana';
  let rangeLabel, isAtToday;
  if (isWeek) {
    const monday = _msGetMondayOfWeek(_calendarSemanaWeekOffset);
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
    rangeLabel = _msFmtDateShort(monday) + ' – ' + _msFmtDateShort(friday);
    isAtToday = _calendarSemanaWeekOffset === 0;
  } else {
    const day = new Date(); day.setHours(0,0,0,0); day.setDate(day.getDate() + _calendarSemanaDayOffset);
    const dayLabels = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
    const monthNames = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    rangeLabel = dayLabels[day.getDay()] + ' ' + day.getDate() + ' ' + monthNames[day.getMonth()];
    isAtToday = _calendarSemanaDayOffset === 0;
  }

  // Switcher placeholder (deshabilitado — Fase 3)
  const profile = window.currentUserProfile || {};
  const photo = profile.photoURL
    ? '<img src="' + escapeHtml(profile.photoURL) + '" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid var(--border);" referrerpolicy="no-referrer">'
    : '<div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:#000;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">' + escapeHtml(((profile.nombre || profile.email || '?')[0] || '?').toUpperCase()) + '</div>';
  const nombre = escapeHtml(profile.nombre || (profile.email || '').split('@')[0] || '—');

  // Pill toggle SEMANA | DIARIO (PR1 Cambio 1)
  const pillBtn = function(view, label) {
    const active = _calendarSemanaView === view;
    const bg = active ? 'var(--accent)' : 'transparent';
    const color = active ? 'var(--bg)' : 'var(--text2)';
    const border = active ? '1px solid var(--accent)' : '1px solid var(--border)';
    return '<button onclick="miSemanaToggleView(\'' + view + '\')" '
      + 'style="background:' + bg + ';color:' + color + ';border:' + border + ';font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;letter-spacing:0.05em;padding:4px 10px;border-radius:6px;cursor:pointer;">' + label + '</button>';
  };

  return ''
    + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">'
    +   '<div>'
    +     '<div style="font-family:\'Syne\',sans-serif;font-weight:800;font-size:22px;color:var(--text);letter-spacing:-0.3px;">📅 Mi semana</div>'
    +     '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);margin-top:4px;">Plan hora-por-hora · 8am-7pm · ' + (isWeek ? 'lun-vie' : 'día único') + '</div>'
    +   '</div>'
    +   '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    // S67 B-vistas-quick 1.2: nav cross-vista — separado visualmente del switcher contextual.
    +     '<button onclick="enterAs(\'tareas\')" class="btn btn-ghost" style="font-size:12px;flex-shrink:0;" title="Ir a Tareas v4.0">→ Tareas</button>'
    // PR1 Cambio 1: pill toggle SEMANA|DIARIO.
    +     '<div style="display:flex;gap:4px;">' + pillBtn('semana', 'SEMANA') + pillBtn('diario', 'DIARIO') + '</div>'
    +     '<div style="display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:4px 6px;">'
    +       '<button onclick="_msPrevStep()" title="' + (isWeek ? 'Semana' : 'Día') + ' anterior" style="background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:2px 8px;line-height:1;border-radius:4px;">‹</button>'
    +       '<span style="font-family:\'DM Mono\',monospace;font-size:11px;color:' + (isAtToday ? 'var(--accent)' : 'var(--text)') + ';min-width:96px;text-align:center;">' + (isAtToday ? '● ' : '') + rangeLabel + '</span>'
    +       '<button onclick="_msNextStep()" title="Próximo ' + (isWeek ? 'semana' : 'día') + '" style="background:transparent;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:2px 8px;line-height:1;border-radius:4px;">›</button>'
    +     '</div>'
    +     (!isAtToday ? '<button onclick="_msTodayStep()" style="background:transparent;border:1px solid var(--border);color:var(--text3);font-size:10px;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:\'DM Mono\',monospace;">↺ Hoy</button>' : '')
    +     '<div title="Próximamente — Fase 3" style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:4px 10px 4px 4px;cursor:not-allowed;opacity:0.7;">'
    +       photo
    +       '<span style="font-size:12px;color:var(--text2);font-weight:600;font-family:\'DM Sans\',sans-serif;">' + nombre + '</span>'
    +       '<span style="font-size:9px;color:var(--text3);">▾</span>'
    +     '</div>'
    +   '</div>'
    + '</div>';
}

// S67 B-vistas-quick 1.1: estado colapsado del panel "Pendientes sin bloque" por user.
function _msPanelCollapsedKey(uid) {
  return 'oa-ms-panel-collapsed-' + (uid || '_anon');
}
function _msGetPanelCollapsed(uid) {
  try { return localStorage.getItem(_msPanelCollapsedKey(uid)) === '1'; }
  catch (e) { return false; }
}
function _msTogglePanelCollapsed(uid) {
  try {
    const key = _msPanelCollapsedKey(uid);
    const cur = localStorage.getItem(key) === '1';
    if (cur) localStorage.removeItem(key);
    else localStorage.setItem(key, '1');
  } catch (e) {}
  if (typeof renderMiSemana === 'function') renderMiSemana();
}

function _msRenderGrid(uid) {
  // PR1 Cambio 1: en modo diario, el grid es 1 col del día activo (hoy + dayOffset).
  const isWeek = _calendarSemanaView === 'semana';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const numCols = isWeek ? 5 : 1;
  const weekDayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
  const fullDayLabels = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  // Origen del loop: lunes (modo semana) o hoy+offset (modo diario).
  const origen = isWeek ? _msGetMondayOfWeek(_calendarSemanaWeekOffset)
                        : (function() { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + _calendarSemanaDayOffset); return d; })();
  const cache = _calendarSemanaMemCache[uid] || calendarSemanaLoadCache(uid);
  const bloques = Object.values(cache || {});

  // Cabezera de horas (label vertical)
  const horasCol = (function() {
    let html = '<div style="border-right:1px solid var(--border);">';
    html += '<div style="height:48px;border-bottom:1px solid var(--border);background:var(--surface2);"></div>';
    for (let i = 0; i < MS_SLOTS; i++) {
      const hh = MS_HORA_INICIO + Math.floor(i / 2);
      const mm = (i % 2) * 30;
      const isFullHour = mm === 0;
      const label = isFullHour ? (hh === 12 ? '12pm' : (hh > 12 ? (hh - 12) + 'pm' : hh + 'am')) : '';
      html += '<div style="height:' + MS_SLOT_HEIGHT + 'px;display:flex;align-items:flex-start;justify-content:flex-end;padding:0 8px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);' + (!isFullHour ? 'opacity:0.5;' : '') + '">' + label + '</div>';
    }
    html += '</div>';
    return html;
  })();

  // PR1 Cambio 1: numCols = 5 (semana) o 1 (diario). En diario, único día = origen (hoy+offset).
  let diasCols = '';
  for (let di = 0; di < numCols; di++) {
    const fecha = new Date(origen); fecha.setDate(origen.getDate() + di);
    const fechaIso = fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0') + '-' + String(fecha.getDate()).padStart(2, '0');
    const isToday = fecha.toDateString() === today.toDateString();
    const dayLabel = isWeek ? weekDayLabels[di] : fullDayLabels[fecha.getDay()];

    // Bloques del día (filtrar one-off + dentro del rango horario visible)
    // PR4: revert PR1 Cambio 3a — bloques completados quedan VISIBLES en grid con
    // styling tachado pre-existente (opacity:0.5 + line-through L591-592) Y aparecen
    // en sección "Completadas hoy" del panel (dual display).
    const bloquesDia = bloques.filter(function(b) {
      if (!b || b.recurrencia) return false;
      const ts = _msToDate(b.inicio_ts);
      if (!ts) return false;
      const ymd = ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0') + '-' + String(ts.getDate()).padStart(2, '0');
      return ymd === fechaIso;
    });

    // Asignar columnas para overlap visual (D16) — algoritmo greedy primer-col-libre.
    const overlapCols = _msComputeOverlapCols(bloquesDia);

    // PR1 Cambio 1: en diario col toma ancho completo; en semana flex:1 normal.
    const colStyle = isWeek
      ? 'flex:1;min-width:140px;border-right:1px solid var(--border);background:' + (isToday ? 'rgba(0,229,160,0.04)' : 'transparent') + ';'
      : 'flex:1;border-right:1px solid var(--border);background:' + (isToday ? 'rgba(0,229,160,0.04)' : 'transparent') + ';';
    let col = '<div data-fecha-iso="' + fechaIso + '" style="' + colStyle + '">';
    // Header día (también drop target — drop al final del día = primer slot)
    col += '<div style="height:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-bottom:1px solid var(--border);background:' + (isToday ? 'rgba(0,229,160,0.10)' : 'var(--surface2)') + ';">'
        + '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:' + (isToday ? 'var(--accent)' : 'var(--text3)') + ';font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">' + dayLabel + '</span>'
        + '<span style="font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:700;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + ';">' + fecha.getDate() + '</span>'
        + '</div>';
    // Container de slots con drag-over global (resuelve target via Y offset).
    col += '<div class="ms-day-col" data-fecha-iso="' + fechaIso + '" '
        +   'ondragover="_msColDragOver(event)" ondragleave="_msColDragLeave(event)" ondrop="_msColDrop(event)" '
        +   'style="position:relative;height:' + (MS_SLOTS * MS_SLOT_HEIGHT) + 'px;">';
    // Slots clickeables (onclick → modal crear)
    for (let s = 0; s < MS_SLOTS; s++) {
      const isFullHour = s % 2 === 0;
      const slotMin = s * 30;
      col += '<div class="ms-slot" data-fecha-iso="' + fechaIso + '" data-slot-min="' + slotMin + '" '
          +   'onclick="_msOnSlotClick(\'' + fechaIso + '\', ' + slotMin + ')" '
          +   'style="position:absolute;top:' + (s * MS_SLOT_HEIGHT) + 'px;left:0;right:0;height:' + MS_SLOT_HEIGHT + 'px;border-top:1px ' + (isFullHour ? 'solid' : 'dashed') + ' var(--border);opacity:' + (isFullHour ? '0.6' : '0.25') + ';cursor:pointer;"></div>';
    }
    // Bloques posicionados absoluto, con overlap cols
    bloquesDia.forEach(function(b) {
      const oc = overlapCols[b.id] || { col: 0, cols: 1 };
      col += _msRenderBloque(b, oc.col, oc.cols);
    });
    col += '</div></div>';
    diasCols += col;
  }

  // S67 B-vistas-quick 1.1: layout 2 columnas con panel colapsable.
  // Expandido: calendar + panel 320px. Colapsado: calendar + strip 30px (flecha ← recovery).
  const collapsed = _msGetPanelCollapsed(uid);
  const sideColPx = collapsed ? 30 : 320;
  const sideColContent = collapsed
    ? '<div onclick="_msTogglePanelCollapsed(\'' + escapeHtml(uid) + '\')" '
        + 'title="Mostrar panel de tareas pendientes" '
        + 'style="position:sticky;top:16px;height:calc(100vh - 200px);background:var(--surface);border:1px solid var(--border);border-left:2px solid var(--border2);border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text3);transition:color 0.15s,border-color 0.15s;" '
        + 'onmouseover="this.style.color=\'var(--accent)\';this.style.borderLeftColor=\'var(--accent)\';" '
        + 'onmouseout="this.style.color=\'var(--text3)\';this.style.borderLeftColor=\'var(--border2)\';">'
        + '<span style="font-size:16px;line-height:1;">←</span>'
        + '</div>'
    : '<div style="position:sticky;top:16px;">' + _msRenderPanelTareas(uid) + '</div>';
  return ''
    + '<div style="display:grid;grid-template-columns:1fr ' + sideColPx + 'px;gap:16px;align-items:start;">'
    +   '<div style="display:flex;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">'
    +     '<div style="width:54px;flex-shrink:0;">' + horasCol + '</div>'
    +     '<div style="display:flex;flex:1;min-width:0;overflow-x:auto;">' + diasCols + '</div>'
    +   '</div>'
    +   sideColContent
    + '</div>';
}

function _msRenderBloque(b, col, cols) {
  const ts = _msToDate(b.inicio_ts);
  if (!ts) return '';
  const startMin = (ts.getHours() - MS_HORA_INICIO) * 60 + ts.getMinutes();
  if (startMin < 0 || startMin >= MS_SLOTS * 30) return '';
  const dur = Number(b.duracion_minutos) || 30;
  const top = (startMin / 30) * MS_SLOT_HEIGHT;
  const height = Math.max((dur / 30) * MS_SLOT_HEIGHT - 2, 18);

  // S67 Bloque C: lookup en `clients` para honrar c.color del cliente rápido (bloques calendar).
  const _cli = (typeof clients !== 'undefined') ? clients.find(function(x) { return x.id === b.cliente_id; }) : null;
  const color = (_cli && _cli.color) || CALENDAR_CLIENT_COLORS[b.cliente_id] || CALENDAR_CLIENT_COLORS._fallback || '#64748b';
  const completado = !!b.completado;
  const now = new Date();
  const overdue = !completado && ts < now;

  const durLabel = dur >= 60
    ? (dur % 60 === 0 ? (dur / 60) + 'hr' : (Math.floor(dur / 60) + 'h ' + (dur % 60) + 'min'))
    : dur + 'min';
  const titulo = b.titulo || 'Bloque sin título';
  // S67 1.4: layout adaptativo según duración + presencia de objetivo (denormalizado en bloque).
  const objetivoTitulo = b.objetivo_titulo || '';
  const showObjetivoLine = !!objetivoTitulo && dur >= 60;
  const objetivoInline = (!!objetivoTitulo && dur < 60) ? ' (' + escapeHtml(objetivoTitulo) + ')' : '';
  const objetivoLineHtml = showObjetivoLine
    ? '<div style="font-size:10px;color:var(--text2);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;">' + escapeHtml(objetivoTitulo) + '</div>'
    : '';
  const opacity = completado ? '0.5' : '1';
  const textDeco = completado ? 'text-decoration:line-through;' : '';
  const borderColor = overdue ? 'rgba(239,68,68,0.55)' : color;

  // Overlap: si cols > 1, dividir el ancho disponible. Mantengo gutter de 3px en cada lado.
  cols = Math.max(1, cols || 1);
  col = Math.max(0, col || 0);
  const widthPct = 100 / cols;
  const leftPct = col * widthPct;
  const positionStyle = cols === 1
    ? 'left:3px;right:3px;'
    : 'left:calc(' + leftPct + '% + 2px);width:calc(' + widthPct + '% - 4px);';

  const bid = escapeHtml(b.id || '');
  return ''
    + '<div data-bloque-id="' + bid + '" '
    +   'draggable="true" '
    +   'ondragstart="_msBloqueDragStart(event, \'' + bid + '\')" '
    +   'ondragend="_msBloqueDragEnd(event)" '
    +   'onclick="_msOnBloqueClick(event, \'' + bid + '\')" '
    +   'title="' + escapeHtml(titulo) + ' · click para editar" '
    +   'style="position:absolute;top:' + top + 'px;' + positionStyle + 'height:' + height + 'px;'
    +   'background:' + color + '22;border:1px solid ' + borderColor + ';border-left:3px solid ' + color + ';'
    +   'border-radius:0 6px 6px 0;padding:3px 7px;overflow:hidden;cursor:grab;'
    +   'opacity:' + opacity + ';' + textDeco + 'transition:opacity 0.15s,border-color 0.15s;z-index:2;">'
    +   '<div style="font-size:11px;font-weight:700;color:' + color + ';line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;">' + escapeHtml(titulo) + '</div>'
    +   objetivoLineHtml
    +   '<div style="font-size:9px;color:var(--text3);font-family:\'DM Mono\',monospace;line-height:1.3;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + durLabel + objetivoInline + (cols > 1 ? ' · col ' + (col + 1) + '/' + cols : '') + '</div>'
    +   '<div class="ms-resize-handle" onmousedown="_msResizeStart(event, \'' + bid + '\')" '
    +     'style="position:absolute;left:0;right:0;bottom:0;height:6px;cursor:ns-resize;background:transparent;"></div>'
    + '</div>';
}

// ── F2: overlap cols (D16) — greedy primer-col-libre ──
function _msComputeOverlapCols(bloques) {
  const sorted = bloques.slice().sort(function(a, b) {
    const ta = _msToDate(a.inicio_ts), tb = _msToDate(b.inicio_ts);
    return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
  });
  const colEnds = []; // colEnds[i] = endTime del último bloque en col i
  const result = {};
  // Detectar grupos con overlap transitivo para asignar cols al mismo "ancho"
  // Simplificación v1: asignar col por overlap directo con bloques previos.
  sorted.forEach(function(b) {
    const ts = _msToDate(b.inicio_ts);
    if (!ts) { result[b.id] = { col: 0, cols: 1 }; return; }
    const start = ts.getTime();
    const end = start + (Number(b.duracion_minutos) || 30) * 60000;
    let assigned = -1;
    for (let i = 0; i < colEnds.length; i++) {
      if (colEnds[i] <= start) { colEnds[i] = end; assigned = i; break; }
    }
    if (assigned === -1) { colEnds.push(end); assigned = colEnds.length - 1; }
    result[b.id] = { col: assigned, cols: 0 }; // cols se llena al final
  });
  // Pasada 2: para cada bloque, "cols" = max(numCols entre bloques con los que se traslapa).
  // Aproximación: usar colEnds.length total del día (todos los bloques visibles).
  // Esto puede sobre-asignar ancho cuando NO hay overlap real, pero D16 acepta esa simplificación.
  // Mejora futura: graph de overlap transitivo.
  const totalCols = Math.max(1, colEnds.length);
  Object.keys(result).forEach(function(id) { result[id].cols = totalCols; });
  return result;
}

// ── F2: Panel lateral 320px (D11) ──
// Lee tareas-clientes (window.tareasCli.cache) NO completadas que NO tienen
// bloque asociado. Drag-source para crear bloques en el calendar.
function _msRenderPanelTareas(uid) {
  if (typeof _tareasCliMemCache === 'undefined' || !_tareasCliMemCache) {
    return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text3);font-size:12px;">Tareas no disponibles aún (cache vacío).</div>';
  }
  // Asegurar listeners de tareas-clientes activos (lee del cache S64).
  if (typeof tareasCliEnsureAllInitialized === 'function') {
    try { tareasCliEnsureAllInitialized(); } catch (e) {}
  }

  // Set de tarea_ids ya con bloque del usuario (en cualquier semana, simplificación).
  const calCache = _calendarSemanaMemCache[uid] || {};
  const conBloque = new Set();
  Object.values(calCache).forEach(function(b) {
    if (b && b.tarea_id) conBloque.add(b.tarea_id);
  });

  const wsId = currentAgencia || 'optimizads';
  // S67 1.1: incluir clientes dinámicos (cliente rápido + wizard largo) además de defaults.
  const _defaults = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const _defaultIds = new Set(_defaults.map(function(c) { return c.id; }));
  const _dynamic = (typeof clients !== 'undefined' && Array.isArray(clients))
    ? clients.filter(function(c) {
        return c.workspaceId === wsId && !_defaultIds.has(c.id);
      })
    : [];
  const catalog = _defaults.concat(_dynamic);

  // PR4: filtro 3-chips (todos|estrategicos|operativos) + flag can_see_estrategicos.
  const _curRol = (window.currentUserProfile && window.currentUserProfile.rol) || 'junior';
  const _canSeeEstrategicos = !!(window.currentUserProfile && window.currentUserProfile.can_see_estrategicos);
  const _curUid = (window.currentUser && window.currentUser.uid) || '_anon';
  const _filter = tareasCliGetFilter(_curUid);

  // PR4 hotfix #2: mapa tarea_id → scope del objetivo padre. Single source of truth
  // para filtrar tareas individuales y bloques (que tampoco tienen scope directo).
  // Resuelve bug donde el filter por objetivo no se propagaba a las tareas
  // mostradas en el panel.
  const scopeByTaskId = {};
  Object.values(window._tareasCliMemCache || {}).forEach(function(doc) {
    ((doc && doc.objetivos) || []).forEach(function(o) {
      const scope = o.scope || 'compartido';
      (o.tareas || []).forEach(function(t) {
        if (t && t.id) scopeByTaskId[t.id] = scope;
      });
    });
  });

  let totalPendientes = 0;
  const seccionesHtml = catalog.map(function(c) {
    const cdoc = _tareasCliMemCache[c.id];
    if (!cdoc || !Array.isArray(cdoc.objetivos) || !cdoc.objetivos.length) return '';
    const items = [];
    cdoc.objetivos.forEach(function(o) {
      (o.tareas || []).forEach(function(t) {
        if (t.completado) return;
        if (conBloque.has(t.id)) return;
        // PR4 hotfix #2: filter por scope mapped (tarea hereda del objetivo padre).
        const taskScope = scopeByTaskId[t.id] || (o.scope || 'compartido');
        if (!tareasCliScopeMatch({ scope: taskScope }, { userRol: _curRol, canSeeEstrategicos: _canSeeEstrategicos, filter: _filter })) return;
        items.push({ tarea: t, objetivoNombre: o.nombre || '', objetivoId: o.id });
      });
    });
    if (!items.length) return '';
    totalPendientes += items.length;
    // S67 Bloque C: cliente rápido puede traer campo `color` propio.
    const color = c.color || CALENDAR_CLIENT_COLORS[c.id] || CALENDAR_CLIENT_COLORS._fallback || '#64748b';
    const itemsHtml = items.map(function(it) {
      const t = it.tarea;
      const dataset = encodeURIComponent(JSON.stringify({
        clienteId: c.id, objetivoId: it.objetivoId, tareaId: t.id,
        titulo: t.texto || 'Tarea', clienteNombre: c.nombre || c.id
      }));
      return ''
        + '<div draggable="true" '
        +   'ondragstart="_msTareaDragStart(event, \'' + dataset + '\')" '
        +   'ondragend="_msBloqueDragEnd(event)" '
        +   'style="display:flex;align-items:flex-start;gap:6px;padding:6px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;margin-bottom:4px;cursor:grab;font-size:11px;color:var(--text);">'
        +   '<span style="color:' + color + ';flex-shrink:0;line-height:1.3;">▸</span>'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.texto || '') + '</div>'
        +     '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);margin-top:1px;">' + escapeHtml(it.objetivoNombre) + '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
    return ''
      + '<div style="margin-bottom:14px;">'
      +   '<div style="display:flex;align-items:center;gap:6px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">'
      +     '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';"></span>'
      +     '<span>' + escapeHtml(c.nombre || c.id) + ' · ' + items.length + '</span>'
      +   '</div>'
      +   itemsHtml
      + '</div>';
  }).filter(Boolean).join('');

  // PR4: pill 3-chips (TODOS · OPERATIVOS · ESTRATÉGICOS) en header del panel.
  // Visible si senior O canSeeEstrategicos=true. Junior puro NO renderiza.
  // Cross-view sync con vista Tareas via tareasCliSetFilter (window.* expose init).
  const _isSenior = _curRol === 'all' || _curRol === 'direccion' || _curRol === 'owner';
  const _showFilterMs = _isSenior || _canSeeEstrategicos;
  const onlyMineToggleMs = _showFilterMs ? (function() {
    const stylePill = function(active) {
      const bg = active ? 'var(--accent)' : 'transparent';
      const color = active ? 'var(--bg)' : 'var(--text2)';
      const border = active ? '1px solid var(--accent)' : '1px solid var(--border)';
      return 'background:' + bg + ';color:' + color + ';border:' + border + ';font-family:\'DM Mono\',monospace;font-size:9px;font-weight:700;letter-spacing:0.05em;padding:4px 9px;border-radius:5px;cursor:pointer;';
    };
    return ''
      + '<div style="display:flex;gap:4px;margin-bottom:6px;">'
      +   '<button onclick="tareasCliSetFilter(\'todos\')" style="' + stylePill(_filter === 'todos') + '">TODOS</button>'
      +   '<button onclick="tareasCliSetFilter(\'operativos\')" style="' + stylePill(_filter === 'operativos') + '">OPERATIVOS</button>'
      +   '<button onclick="tareasCliSetFilter(\'estrategicos\')" style="' + stylePill(_filter === 'estrategicos') + '">ESTRATÉGICOS</button>'
      + '</div>';
  })() : '';

  return ''
    + '<div data-droppable-type="panel-pendientes" '
    +   'ondragover="_msPanelDragOver(event)" ondrop="_msPanelDrop(event)" '
    +   'style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;max-height:calc(100vh - 200px);overflow-y:auto;transition:border-color 0.12s;">'
    +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;">'
    +     '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:14px;color:var(--text);">📋 Pendientes sin bloque</div>'
    // S67 B-vistas-quick 1.1: botón → colapsar panel (recovery vía strip).
    +     '<button onclick="_msTogglePanelCollapsed(\'' + escapeHtml(uid) + '\')" '
    +       'title="Esconder panel" '
    +       'style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0 4px;line-height:1;flex-shrink:0;" '
    +       'onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--text3)\'">'
    +       '→'
    +     '</button>'
    +   '</div>'
    +   onlyMineToggleMs
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);margin-bottom:12px;">' + totalPendientes + ' tareas · arrastra al calendario</div>'
    +   (totalPendientes === 0
        ? '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);text-align:center;padding:20px 0;">Sin pendientes — todo agendado.</div>'
        : seccionesHtml)
    +   _msRenderCompletadasHoy(uid)
    + '</div>';
}

// PR1 Cambio 3b: sección "✓ Completadas hoy" al final del panel.
// Lista bloques con completado===true y completado_at >= inicio del día CST.
// Read-only excepto onclick → modal _msOnBloqueClick (para Desmarcar).
function _msRenderCompletadasHoy(uid) {
  const cache = _calendarSemanaMemCache[uid] || calendarSemanaLoadCache(uid) || {};
  const startToday = _msStartOfTodayCST();

  // PR4 hotfix #2: misma estrategia que _msRenderPanelTareas — mapa tarea_id →
  // scope del objetivo padre + filter por rol/chip. Bloques sin tarea_id NO se
  // filtran (heredados pre-PR3, no enlazados a objetivo).
  const _curRol = (window.currentUserProfile && window.currentUserProfile.rol) || 'junior';
  const _canSeeEstrategicos = !!(window.currentUserProfile && window.currentUserProfile.can_see_estrategicos);
  const _curUid = (window.currentUser && window.currentUser.uid) || '_anon';
  const _filter = tareasCliGetFilter(_curUid);
  const scopeByTaskId = {};
  Object.values(window._tareasCliMemCache || {}).forEach(function(doc) {
    ((doc && doc.objetivos) || []).forEach(function(o) {
      const scope = o.scope || 'compartido';
      (o.tareas || []).forEach(function(t) {
        if (t && t.id) scopeByTaskId[t.id] = scope;
      });
    });
  });

  const completados = [];
  Object.values(cache).forEach(function(b) {
    if (!b || b.completado !== true) return;
    // Defensive: completado_at puede ser null (legacy) o sentinel serverTimestamp
    // sin .toDate() (race window pre-roundtrip). Solo aceptar si toDate() existe.
    const at = (b.completado_at && typeof b.completado_at.toDate === 'function')
      ? b.completado_at.toDate() : null;
    if (!at) return;
    if (at < startToday) return;
    // PR4 hotfix #2: filter por scope del objetivo padre. Bloques sin tarea_id
    // (huérfanos o cliente_id manual) pasan siempre — no hay objetivo asociado.
    if (b.tarea_id) {
      const taskScope = scopeByTaskId[b.tarea_id] || 'compartido';
      if (!tareasCliScopeMatch({ scope: taskScope }, { userRol: _curRol, canSeeEstrategicos: _canSeeEstrategicos, filter: _filter })) return;
    }
    completados.push({ b: b, at: at });
  });
  if (!completados.length) return '';
  // Orden: más reciente arriba.
  completados.sort(function(x, y) { return y.at.getTime() - x.at.getTime(); });

  const itemsHtml = completados.map(function(o) {
    const b = o.b;
    const bid = escapeHtml(b.id);
    const _cli = (typeof clients !== 'undefined') ? clients.find(function(x) { return x.id === b.cliente_id; }) : null;
    const color = (_cli && _cli.color) || CALENDAR_CLIENT_COLORS[b.cliente_id] || CALENDAR_CLIENT_COLORS._fallback || '#64748b';
    const titulo = b.titulo || 'Bloque sin título';
    const hh = String(o.at.getHours()).padStart(2, '0');
    const mm = String(o.at.getMinutes()).padStart(2, '0');
    return ''
      + '<div onclick="_msOnBloqueClick(event, \'' + bid + '\')" '
      +   'title="' + escapeHtml(titulo) + ' · click para desmarcar" '
      +   'style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--surface2);border:1px solid var(--border);margin-top:6px;cursor:pointer;opacity:0.7;transition:opacity 0.12s;" '
      +   'onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.7\'">'
      +   '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>'
      +   '<span style="flex:1;font-size:11px;color:var(--text2);text-decoration:line-through;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(titulo) + '</span>'
      +   '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);flex-shrink:0;">' + hh + ':' + mm + '</span>'
      + '</div>';
  }).join('');

  // PR4 Cambio 9: separador 2px solid antes + container con bg var(--surface2) +
  // header 14px bold + subtítulo italic con instrucción explícita "Click + Desmarcar
  // para regresar al calendario". Resuelve confusión UX reportada por Mario hoy.
  // Si count===0 ya hicimos return '' en L798 — el separador no se renderiza huérfano.
  return ''
    + '<div style="border-top:2px solid var(--border);margin:24px 0 0 0;"></div>'
    + '<div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:8px;">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px;">'
    +     '<span style="color:var(--accent);">✓</span> Completadas hoy <span style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);font-weight:400;">(' + completados.length + ')</span>'
    +   '</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);font-style:italic;margin-bottom:10px;">Click + Desmarcar para regresar al calendario</div>'
    +   itemsHtml
    + '</div>';
}

// ── F2: Drag-and-drop handlers ──
let _msDragState = null; // { kind: 'tarea-from-panel' | 'bloque-existing', data, origBloqueId? }

function _msTareaDragStart(e, payloadEnc) {
  let data;
  try { data = JSON.parse(decodeURIComponent(payloadEnc)); } catch (err) { e.preventDefault(); return; }
  _msDragState = { kind: 'tarea-from-panel', data: data };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy';
    try { e.dataTransfer.setData('text/plain', data.titulo || ''); } catch (err) {}
  }
  if (e.target && e.target.style) e.target.style.opacity = '0.5';
}

function _msBloqueDragStart(e, bloqueId) {
  const cache = _calendarSemanaMemCache[(window.currentUser && window.currentUser.uid) || ''] || {};
  const b = cache[bloqueId];
  if (!b) { e.preventDefault(); return; }
  _msDragState = { kind: 'bloque-existing', bloqueId: bloqueId, b: b };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', bloqueId); } catch (err) {}
  }
  setTimeout(function() { if (e.target && e.target.style) e.target.style.opacity = '0.4'; }, 0);
}

function _msBloqueDragEnd(e) {
  if (e && e.target && e.target.style) e.target.style.opacity = '';
  document.querySelectorAll('.ms-day-col').forEach(function(el) {
    el.style.outline = ''; el.style.outlineOffset = '';
  });
  _msDragState = null;
}

function _msColDragOver(e) {
  if (!_msDragState) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = (_msDragState.kind === 'tarea-from-panel') ? 'copy' : 'move';
  const col = e.currentTarget;
  if (col && col.style) {
    col.style.outline = '2px dashed var(--accent)';
    col.style.outlineOffset = '-2px';
  }
}

function _msColDragLeave(e) {
  const col = e.currentTarget;
  if (col && col.style) { col.style.outline = ''; col.style.outlineOffset = ''; }
}

function _msColDrop(e) {
  if (!_msDragState) return;
  e.preventDefault(); e.stopPropagation();
  const col = e.currentTarget;
  if (!col || !col.dataset || !col.dataset.fechaIso) { _msBloqueDragEnd(e); return; }
  const fechaIso = col.dataset.fechaIso;
  const rect = col.getBoundingClientRect();
  const offsetY = e.clientY - rect.top;
  // Snap a 15min (= MS_SLOT_HEIGHT/2)
  const snapPx = MS_SLOT_HEIGHT / 2;
  const snappedY = Math.max(0, Math.round(offsetY / snapPx) * snapPx);
  const minFromStart = (snappedY / MS_SLOT_HEIGHT) * 30;
  const inicioTs = _msBuildTs(fechaIso, minFromStart);

  if (_msDragState.kind === 'tarea-from-panel') {
    const d = _msDragState.data;
    _msCreateBloque({
      cliente_id: d.clienteId,
      objetivo_id: d.objetivoId,
      tarea_id: d.tareaId,
      titulo: d.titulo,
      inicio_ts: inicioTs,
      duracion_minutos: 60
    });
  } else if (_msDragState.kind === 'bloque-existing') {
    // D15: NO tocar fechaLimite de la tarea — solo cambiar inicio_ts del bloque.
    _msUpdateBloque(_msDragState.bloqueId, function(b) {
      b.inicio_ts = inicioTs;
      return b;
    });
  }
  _msBloqueDragEnd(e);
}

// PR1 Cambio 2: panel "Pendientes sin bloque" como drop target.
// Drop bloque-existing → delete del calendario (la tarea ligada reaparece
// automáticamente porque conBloque.has(t.id) deja de ser true). Drop
// tarea-from-panel = no-op (no tiene sentido drop tarea al panel donde ya vive).
function _msPanelDragOver(e) {
  if (!_msDragState) return;
  if (_msDragState.kind !== 'bloque-existing') return; // solo aceptar bloques
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  // Highlight visual: border accent en el wrapper.
  const wrap = e.currentTarget;
  if (wrap && wrap.dataset && wrap.dataset.droppableType === 'panel-pendientes') {
    wrap.style.borderColor = 'var(--accent)';
  }
}

function _msPanelDrop(e) {
  if (!_msDragState) return;
  if (_msDragState.kind !== 'bloque-existing') { _msBloqueDragEnd(e); return; }
  e.preventDefault(); e.stopPropagation();
  const bloqueId = _msDragState.bloqueId;
  // Reset highlight.
  const wrap = e.currentTarget;
  if (wrap && wrap.style) wrap.style.borderColor = '';
  // Reuso _msDeleteBloque (L801) — async, hace cleanup _calendarSemanaMemCache + warn on err.
  if (bloqueId) {
    _msDeleteBloque(bloqueId);
  }
  _msBloqueDragEnd(e);
}

function _msBuildTs(fechaIso, minFromStart) {
  const [Y, M, D] = fechaIso.split('-').map(Number);
  const d = new Date(Y, M - 1, D, MS_HORA_INICIO, 0, 0, 0);
  d.setMinutes(d.getMinutes() + Number(minFromStart || 0));
  return firebase.firestore.Timestamp.fromDate(d);
}

// ── F2: Click slot vacío → modal crear ──
function _msOnSlotClick(fechaIso, slotMin) {
  if (_msDragState) return; // no abrir durante drag
  _msShowCrearBloqueModal(fechaIso, Number(slotMin) || 0);
}

// ── F2: Click bloque → modal edit ──
function _msOnBloqueClick(e, bloqueId) {
  if (e && e.target && e.target.classList && e.target.classList.contains('ms-resize-handle')) return;
  e.stopPropagation();
  _msShowEditBloqueModal(bloqueId);
}

// ── F2: Mutators (delegan a calendarSemanaSave para versionado optimista) ──
async function _msCreateBloque(data) {
  const uid = (window.currentUser && window.currentUser.uid) || null;
  if (!uid) return;
  const id = 'bloque-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  await calendarSemanaSave(id, function(b) {
    b.id = id;
    b.assigned_to = uid;
    b.created_by = uid;
    b.cliente_id = data.cliente_id || 'agency';
    b.objetivo_id = data.objetivo_id || null;
    b.objetivo_titulo = data.objetivo_titulo || null;
    b.tarea_id = data.tarea_id || null;
    b.titulo = (data.titulo || '').trim() || 'Bloque sin título';
    b.inicio_ts = data.inicio_ts || null;
    b.duracion_minutos = Number(data.duracion_minutos) || 60;
    b.recurrencia = null;
    b.completado = false;
    b.completado_at = null;
    return b;
  });
  renderMiSemana();
}

async function _msUpdateBloque(bloqueId, mutator) {
  await calendarSemanaSave(bloqueId, function(b) {
    return mutator(b) || b;
  });
  renderMiSemana();
}

async function _msDeleteBloque(bloqueId) {
  const ref = calendarSemanaFirestoreRef(bloqueId);
  if (!ref) return;
  try {
    await ref.delete();
    const uid = (window.currentUser && window.currentUser.uid) || null;
    if (uid && _calendarSemanaMemCache[uid]) {
      delete _calendarSemanaMemCache[uid][bloqueId];
      calendarSemanaSaveCache(uid, _calendarSemanaMemCache[uid]);
    }
    renderMiSemana();
  } catch (e) {
    console.warn('[calendarSemana] delete failed', bloqueId, e);
  }
}

// ── F2: Resize por borde inferior (D13) ──
let _msResizeState = null;

function _msResizeStart(e, bloqueId) {
  e.stopPropagation(); e.preventDefault();
  const cache = _calendarSemanaMemCache[(window.currentUser && window.currentUser.uid) || ''] || {};
  const b = cache[bloqueId];
  if (!b) return;
  const el = document.querySelector('[data-bloque-id="' + bloqueId + '"]');
  if (!el) return;
  _msResizeState = {
    bloqueId: bloqueId,
    startY: e.clientY,
    startHeight: el.offsetHeight,
    el: el,
    origDur: Number(b.duracion_minutos) || 30
  };
  document.addEventListener('mousemove', _msResizeMove);
  document.addEventListener('mouseup', _msResizeEnd);
  document.body.style.cursor = 'ns-resize';
}

function _msResizeMove(e) {
  if (!_msResizeState) return;
  const dy = e.clientY - _msResizeState.startY;
  // Snap 15min = MS_SLOT_HEIGHT/2 px
  const snapPx = MS_SLOT_HEIGHT / 2;
  const snappedDy = Math.round(dy / snapPx) * snapPx;
  const newHeight = Math.max(snapPx, _msResizeState.startHeight + snappedDy);
  _msResizeState.el.style.height = (newHeight - 2) + 'px';
}

async function _msResizeEnd(e) {
  document.removeEventListener('mousemove', _msResizeMove);
  document.removeEventListener('mouseup', _msResizeEnd);
  document.body.style.cursor = '';
  if (!_msResizeState) return;
  const finalHeight = _msResizeState.el.offsetHeight + 2; // compensar -2 del rendered
  // Convertir a minutos: cada MS_SLOT_HEIGHT = 30min → newDur = (height/MS_SLOT_HEIGHT)*30
  let newDur = Math.round((finalHeight / MS_SLOT_HEIGHT) * 30 / 15) * 15; // snap 15
  newDur = Math.max(15, newDur);
  const id = _msResizeState.bloqueId;
  _msResizeState = null;
  await _msUpdateBloque(id, function(b) {
    b.duracion_minutos = newDur;
    return b;
  });
}

// S67 B-modal 1.3: lookup tarea por bloque. Retorna { tarea, objId } | null.
// Null si bloque.tarea_id null, cache no hidratada, o tarea borrada (cascade nullify).
// Usado por modal Edit para decidir schema dual de notas (D1, D2).
function _msFindTareaByBloque(b) {
  if (!b || !b.tarea_id || !b.cliente_id) return null;
  const cdoc = (typeof _tareasCliMemCache !== 'undefined') ? (_tareasCliMemCache[b.cliente_id] || null) : null;
  if (!cdoc || !Array.isArray(cdoc.objetivos)) return null;
  for (let i = 0; i < cdoc.objetivos.length; i++) {
    const o = cdoc.objetivos[i];
    const t = (o.tareas || []).find(function(x) { return x.id === b.tarea_id; });
    if (t) return { tarea: t, objId: o.id };
  }
  return null;
}

// S67 B-modal 1.2: helper compartido — opciones del dropdown Objetivo filtradas por
// cliente (lee _tareasCliMemCache). Extraído del closure original del modal Crear
// para reuso en modal Edit y futuro drag-back (B-vistas).
function _msBuildObjetivoOptions(clienteId, selectedObjId) {
  const cdoc = (typeof _tareasCliMemCache !== 'undefined') ? (_tareasCliMemCache[clienteId] || null) : null;
  const objs = (cdoc && Array.isArray(cdoc.objetivos)) ? cdoc.objetivos : [];
  let html = '<option value="">(ninguno)</option>';
  objs.forEach(function(o) {
    const sel = (o.id === selectedObjId) ? ' selected' : '';
    html += '<option value="' + escapeHtml(o.id) + '"' + sel + '>' + escapeHtml(o.nombre || '') + '</option>';
  });
  html += '<option value="__new__">+ Nuevo objetivo…</option>';
  return html;
}

// ── F2: Modal crear bloque ──
function _msShowCrearBloqueModal(fechaIso, slotMin) {
  const id = 'ms-crear-modal';
  let el = document.getElementById(id); if (el) el.remove();
  const wsId = currentAgencia || 'optimizads';
  // S67 1.2: incluir clientes dinámicos (cliente rápido + wizard largo) además de defaults.
  const _defaults = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const _defaultIds = new Set(_defaults.map(function(c) { return c.id; }));
  const _dynamic = (typeof clients !== 'undefined' && Array.isArray(clients))
    ? clients.filter(function(c) {
        return c.workspaceId === wsId && !_defaultIds.has(c.id);
      })
    : [];
  const catalog = _defaults.concat(_dynamic);
  // S67 1.3: hidratar cache de tareas-clientes para que el dropdown Objetivo tenga datos.
  if (typeof tareasCliEnsureAllInitialized === 'function') {
    try { tareasCliEnsureAllInitialized(); } catch (e) {}
  }
  // "Interno" (agency) primera opción (D31).
  const sorted = catalog.slice().sort(function(a, b) {
    if (a.id === 'agency') return -1;
    if (b.id === 'agency') return 1;
    return (a.nombre || '').localeCompare(b.nombre || '');
  });
  const opciones = sorted.map(function(c) {
    return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.nombre || c.id) + '</option>';
  }).join('');

  const hh = MS_HORA_INICIO + Math.floor(slotMin / 60);
  const mm = slotMin % 60;
  const horaLabel = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  const [Y, M, D] = fechaIso.split('-').map(Number);
  const fechaLabel = D + '/' + M + '/' + Y;
  const initialClienteId = (sorted[0] && sorted[0].id) || 'agency';

  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;width:420px;max-width:92vw;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;color:var(--text);margin-bottom:6px;">📅 Nuevo bloque</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);margin-bottom:18px;">' + fechaLabel + ' · ' + horaLabel + '</div>'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Cliente</label>'
    +   '<select id="ms-crear-cliente" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px;">' + opciones + '</select>'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Objetivo (opcional)</label>'
    +   '<select id="ms-crear-objetivo" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:8px;">' + _msBuildObjetivoOptions(initialClienteId, null) + '</select>'
    +   '<div id="ms-crear-objetivo-nuevo" style="display:none;margin-bottom:12px;gap:6px;">'
    +     '<input id="ms-crear-objetivo-nuevo-input" type="text" placeholder="Nombre del nuevo objetivo…" style="width:100%;background:var(--surface2);border:1px solid var(--accent);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:6px;outline:none;">'
    +     '<div style="display:flex;gap:6px;justify-content:flex-end;">'
    +       '<button id="ms-crear-objetivo-nuevo-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Cancelar</button>'
    +       '<button id="ms-crear-objetivo-nuevo-ok" style="background:var(--accent);border:none;color:#000;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Crear objetivo</button>'
    +     '</div>'
    +   '</div>'
    +   '<div id="ms-crear-objetivo-spacer" style="margin-bottom:4px;"></div>'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Título</label>'
    +   '<input id="ms-crear-titulo" type="text" placeholder="Ej. Status diario, junta interna..." style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px;outline:none;">'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Duración (min)</label>'
    +   '<input id="ms-crear-dur" type="number" value="60" min="15" step="15" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:18px;outline:none;">'
    +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +     '<button id="ms-crear-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Cancelar</button>'
    +     '<button id="ms-crear-ok" style="background:var(--accent);border:none;color:#000;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Crear</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);
  setTimeout(function() { const i = document.getElementById('ms-crear-titulo'); if (i) i.focus(); }, 50);

  function close() { try { el.remove(); } catch (e) {} }

  // S67 1.3: al cambiar cliente, recargar dropdown de objetivos.
  document.getElementById('ms-crear-cliente').onchange = function() {
    const cid = this.value || 'agency';
    document.getElementById('ms-crear-objetivo').innerHTML = _msBuildObjetivoOptions(cid, null);
    document.getElementById('ms-crear-objetivo-nuevo').style.display = 'none';
  };

  // S67 1.3: "+ Nuevo objetivo" — toggle inline input.
  const _objSel = document.getElementById('ms-crear-objetivo');
  const _nuevoBox = document.getElementById('ms-crear-objetivo-nuevo');
  const _nuevoInput = document.getElementById('ms-crear-objetivo-nuevo-input');
  _objSel.onchange = function() {
    if (this.value === '__new__') {
      _nuevoBox.style.display = 'block';
      this.value = '';
      setTimeout(function() { _nuevoInput.focus(); }, 30);
    } else {
      _nuevoBox.style.display = 'none';
    }
  };
  document.getElementById('ms-crear-objetivo-nuevo-cancel').onclick = function() {
    _nuevoBox.style.display = 'none';
    _nuevoInput.value = '';
  };
  document.getElementById('ms-crear-objetivo-nuevo-ok').onclick = async function() {
    const nombre = _nuevoInput.value.trim();
    if (!nombre) { _nuevoInput.focus(); return; }
    const cid = document.getElementById('ms-crear-cliente').value || 'agency';
    this.disabled = true;
    try {
      const newId = await tareasCliAddObjetivo(cid, nombre);
      _objSel.innerHTML = _msBuildObjetivoOptions(cid, newId);
      _nuevoBox.style.display = 'none';
      _nuevoInput.value = '';
    } catch (e) {
      console.warn('[ms-crear] addObjetivo failed', e);
    } finally {
      this.disabled = false;
    }
  };
  _nuevoInput.onkeydown = function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('ms-crear-objetivo-nuevo-ok').click(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); document.getElementById('ms-crear-objetivo-nuevo-cancel').click(); }
  };

  document.getElementById('ms-crear-cancel').onclick = close;
  document.getElementById('ms-crear-ok').onclick = async function() {
    const cliente_id = document.getElementById('ms-crear-cliente').value || 'agency';
    const objetivo_id = document.getElementById('ms-crear-objetivo').value || null;
    // Denormalizar nombre del objetivo (evita N+1 fetch al renderizar bloques).
    let objetivo_titulo = null;
    if (objetivo_id) {
      const cdoc = (typeof _tareasCliMemCache !== 'undefined') ? (_tareasCliMemCache[cliente_id] || null) : null;
      const o = (cdoc && Array.isArray(cdoc.objetivos)) ? cdoc.objetivos.find(function(x) { return x.id === objetivo_id; }) : null;
      objetivo_titulo = (o && o.nombre) ? o.nombre : null;
    }
    const titulo = document.getElementById('ms-crear-titulo').value.trim() || (cliente_id === 'agency' ? 'Bloque interno' : 'Bloque sin título');
    const dur = Math.max(15, Number(document.getElementById('ms-crear-dur').value) || 60);
    close();
    await _msCreateBloque({
      cliente_id: cliente_id,
      objetivo_id: objetivo_id,
      objetivo_titulo: objetivo_titulo,
      titulo: titulo,
      inicio_ts: _msBuildTs(fechaIso, slotMin),
      duracion_minutos: dur
    });
  };
  el.onclick = function(ev) { if (ev.target === el) close(); };
  document.addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape') { document.removeEventListener('keydown', esc); close(); }
  });
}

// ── F2: Modal editar bloque (D22 — toggle completado, eliminar) ──
function _msShowEditBloqueModal(bloqueId) {
  const uid = (window.currentUser && window.currentUser.uid) || null;
  const cache = (uid && _calendarSemanaMemCache[uid]) || {};
  const b = cache[bloqueId];
  if (!b) return;

  const id = 'ms-edit-modal';
  let el = document.getElementById(id); if (el) el.remove();
  const wsId = currentAgencia || 'optimizads';
  // S67 B-modal 1.1: incluir clientes dinámicos (cliente rápido + wizard largo)
  // para que el lookup del nombre resuelva bloques de clientes no-default.
  const _defaults = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const _defaultIds = new Set(_defaults.map(function(c) { return c.id; }));
  const _dynamic = (typeof clients !== 'undefined' && Array.isArray(clients))
    ? clients.filter(function(c) {
        return c.workspaceId === wsId && !_defaultIds.has(c.id);
      })
    : [];
  const catalog = _defaults.concat(_dynamic);
  // S67 B-modal 1.2: hidratar cache de tareas-clientes para que el dropdown Objetivo tenga datos.
  if (typeof tareasCliEnsureAllInitialized === 'function') {
    try { tareasCliEnsureAllInitialized(); } catch (e) {}
  }
  const cliente = catalog.find(function(c) { return c.id === b.cliente_id; });
  const clienteLabel = cliente ? (cliente.nombre || cliente.id) : (b.cliente_id || '—');
  const ts = _msToDate(b.inicio_ts);
  const fechaLabel = ts ? (ts.getDate() + '/' + (ts.getMonth() + 1) + '/' + ts.getFullYear() + ' · ' + String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0')) : '—';
  // S67 B-modal 1.3 (D1+D2): schema dual notas. Si tarea ligada existe, lee tarea.notas;
  // sino lee bloque.notas. taskRef se calcula una vez al abrir; el save persiste al
  // destino correspondiente.
  const taskRef = _msFindTareaByBloque(b);
  const initialNotas = taskRef ? (taskRef.tarea.notas || '') : (b.notas || '');

  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;width:440px;max-width:92vw;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
    +     '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;color:var(--text);">Editar bloque</div>'
    +     '<button onclick="document.getElementById(\'' + id + '\').remove()" style="background:transparent;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px 8px;">×</button>'
    +   '</div>'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);margin-bottom:18px;">' + escapeHtml(clienteLabel) + ' · ' + fechaLabel + '</div>'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Título</label>'
    +   '<input id="ms-edit-titulo" type="text" value="' + escapeHtml(b.titulo || '') + '" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px;outline:none;">'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Objetivo (opcional)</label>'
    +   '<select id="ms-edit-objetivo" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:8px;">' + _msBuildObjetivoOptions(b.cliente_id, b.objetivo_id || null) + '</select>'
    +   '<div id="ms-edit-objetivo-nuevo" style="display:none;margin-bottom:12px;">'
    +     '<input id="ms-edit-objetivo-nuevo-input" type="text" placeholder="Nombre del nuevo objetivo…" style="width:100%;background:var(--surface2);border:1px solid var(--accent);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:6px;outline:none;">'
    +     '<div style="display:flex;gap:6px;justify-content:flex-end;">'
    +       '<button id="ms-edit-objetivo-nuevo-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Cancelar</button>'
    +       '<button id="ms-edit-objetivo-nuevo-ok" style="background:var(--accent);border:none;color:#000;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Crear objetivo</button>'
    +     '</div>'
    +   '</div>'
    +   '<div id="ms-edit-objetivo-spacer" style="margin-bottom:4px;"></div>'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Duración (min)</label>'
    +   '<input id="ms-edit-dur" type="number" value="' + (Number(b.duracion_minutos) || 60) + '" min="15" step="15" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px;outline:none;">'
    +   '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">Notas' + (taskRef ? ' <span style="color:var(--text3);font-weight:400;">· vinculadas a tarea</span>' : '') + '</label>'
    +   '<textarea id="ms-edit-notas" rows="3" placeholder="Notas…" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:18px;outline:none;font-family:\'DM Sans\',sans-serif;resize:vertical;">' + escapeHtml(initialNotas) + '</textarea>'
    +   '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;">'
    +     '<button id="ms-edit-delete" style="background:transparent;border:1px solid rgba(239,68,68,0.45);color:var(--red);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">🗑️ Eliminar</button>'
    +     '<div style="display:flex;gap:8px;">'
    +       '<button id="ms-edit-toggle" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">' + (b.completado ? 'Desmarcar' : '✓ Completar') + '</button>'
    +       '<button id="ms-edit-save" style="background:var(--accent);border:none;color:#000;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Guardar</button>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);
  setTimeout(function() { const i = document.getElementById('ms-edit-titulo'); if (i) i.focus(); }, 50);

  function close() { try { el.remove(); } catch (e) {} }

  // S67 B-modal 1.2: handler "+ Nuevo objetivo" inline en modal Edit (mismo patrón que Crear).
  const _objSelEdit = document.getElementById('ms-edit-objetivo');
  const _nuevoBoxEdit = document.getElementById('ms-edit-objetivo-nuevo');
  const _nuevoInputEdit = document.getElementById('ms-edit-objetivo-nuevo-input');
  _objSelEdit.onchange = function() {
    if (this.value === '__new__') {
      _nuevoBoxEdit.style.display = 'block';
      this.value = b.objetivo_id || '';
      setTimeout(function() { _nuevoInputEdit.focus(); }, 30);
    } else {
      _nuevoBoxEdit.style.display = 'none';
    }
  };
  document.getElementById('ms-edit-objetivo-nuevo-cancel').onclick = function() {
    _nuevoBoxEdit.style.display = 'none';
    _nuevoInputEdit.value = '';
  };
  document.getElementById('ms-edit-objetivo-nuevo-ok').onclick = async function() {
    const nombre = _nuevoInputEdit.value.trim();
    if (!nombre) { _nuevoInputEdit.focus(); return; }
    const cid = b.cliente_id || 'agency';
    this.disabled = true;
    try {
      const newId = await tareasCliAddObjetivo(cid, nombre);
      _objSelEdit.innerHTML = _msBuildObjetivoOptions(cid, newId);
      _nuevoBoxEdit.style.display = 'none';
      _nuevoInputEdit.value = '';
    } catch (e) {
      console.warn('[ms-edit] addObjetivo failed', e);
    } finally {
      this.disabled = false;
    }
  };
  _nuevoInputEdit.onkeydown = function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('ms-edit-objetivo-nuevo-ok').click(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); document.getElementById('ms-edit-objetivo-nuevo-cancel').click(); }
  };

  document.getElementById('ms-edit-save').onclick = async function() {
    const newTitulo = document.getElementById('ms-edit-titulo').value.trim() || 'Bloque sin título';
    const newDur = Math.max(15, Number(document.getElementById('ms-edit-dur').value) || 60);
    const newObjetivoId = document.getElementById('ms-edit-objetivo').value || null;
    const newNotas = document.getElementById('ms-edit-notas').value;
    // S67 B-modal 1.2 (D6 + R4): re-derive objetivo_titulo incondicionalmente desde cache live,
    // cubre rename del objetivo en otra tab incluso si el dropdown no se tocó.
    let newObjetivoTitulo = null;
    if (newObjetivoId) {
      const cdoc = (typeof _tareasCliMemCache !== 'undefined') ? (_tareasCliMemCache[b.cliente_id] || null) : null;
      const o = (cdoc && Array.isArray(cdoc.objetivos)) ? cdoc.objetivos.find(function(x) { return x.id === newObjetivoId; }) : null;
      newObjetivoTitulo = (o && o.nombre) ? o.nombre : null;
    }
    close();
    await _msUpdateBloque(bloqueId, function(d) {
      d.titulo = newTitulo;
      d.duracion_minutos = newDur;
      d.objetivo_id = newObjetivoId;
      d.objetivo_titulo = newObjetivoTitulo;
      // S67 B-modal 1.3 (D1): si NO hay tarea ligada, las notas viven en el bloque.
      // Si SÍ hay tarea ligada, persisten aparte vía tareasCliEditTareaNotas (abajo).
      if (!taskRef) d.notas = newNotas;
      return d;
    });
    if (taskRef) {
      try { await tareasCliEditTareaNotas(b.cliente_id, taskRef.objId, taskRef.tarea.id, newNotas); }
      catch (e) { console.warn('[ms-edit] editTareaNotas failed', e); }
    }
  };
  document.getElementById('ms-edit-toggle').onclick = async function() {
    close();
    await _msUpdateBloque(bloqueId, function(d) {
      d.completado = !d.completado;
      d.completado_at = d.completado ? firebase.firestore.FieldValue.serverTimestamp() : null;
      return d;
    });
  };
  document.getElementById('ms-edit-delete').onclick = function() {
    close();
    _msShowConfirmDeleteBloque(bloqueId, b.titulo || 'este bloque');
  };
  el.onclick = function(ev) { if (ev.target === el) close(); };
  document.addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape') { document.removeEventListener('keydown', esc); close(); }
  });
}

function _msShowConfirmDeleteBloque(bloqueId, titulo) {
  const id = 'ms-confirm-delete';
  let el = document.getElementById(id); if (el) el.remove();
  el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:340px;max-width:420px;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:15px;color:var(--text);margin-bottom:8px;">¿Eliminar bloque?</div>'
    +   '<div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:18px;">Vas a eliminar <strong>' + escapeHtml(titulo) + '</strong>. Esta acción no se puede deshacer.</div>'
    +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +     '<button id="ms-cd-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Cancelar</button>'
    +     '<button id="ms-cd-ok" style="background:var(--red);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Eliminar</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(el);
  function close() { try { el.remove(); } catch (e) {} }
  document.getElementById('ms-cd-cancel').onclick = close;
  document.getElementById('ms-cd-ok').onclick = async function() {
    close();
    await _msDeleteBloque(bloqueId);
  };
  el.onclick = function(ev) { if (ev.target === el) close(); };
}

// ── F2: Cascade NULLIFY (S67 1.4 / D3) — al eliminar tarea, los bloques sobreviven
// con cliente_id + objetivo_id + objetivo_titulo preservados; solo tarea_id → null.
// Renombrado desde _msCascadeDeleteByTareaId (D33 original) para reflejar el nuevo
// comportamiento. Razón: preservar planning visual + historial de qué se agendó.
async function _msCascadeNullifyByTareaId(tareaId) {
  if (!tareaId) return 0;
  const col = calendarSemanaFirestoreCol();
  if (!col) return 0;
  let count = 0;
  try {
    const snap = await col.where('tarea_id', '==', tareaId).get();
    if (snap.empty) return 0;
    const batch = window.firebaseDb.batch();
    snap.forEach(function(d) { batch.update(d.ref, { tarea_id: null }); count++; });
    if (count > 0) await batch.commit();
    if (count > 0 && typeof showToast === 'function') {
      showToast(count + ' bloque' + (count === 1 ? '' : 's') + ' desvinculado' + (count === 1 ? '' : 's') + ' de tarea', '🔗');
    }
  } catch (e) {
    console.warn('[calendarSemana] cascade nullify failed', tareaId, e);
  }
  return count;
}

// ════════════════════════════════════════════════════════════════
// INIT — exposición a window para HTML inline + tareas.js coupling.
// Idempotente. Llamado desde bootstrap (index.html) después de initTareas().
// ════════════════════════════════════════════════════════════════

let __miSemanaInitialized = false;

export function init() {
  if (__miSemanaInitialized) return;
  __miSemanaInitialized = true;

  // PR1 Cambio 1: cargar preferencia vista (semana|diario) per user.
  const _uidInit = (window.currentUser && window.currentUser.uid) || '';
  _msLoadViewPref(_uidInit);

  // API consola (originalmente top-level en index.html L9434-L9453).
  window.calendarSemana = {
    init: calendarSemanaInit,
    save: calendarSemanaSave,
    ref: calendarSemanaFirestoreRef,
    col: calendarSemanaFirestoreCol,
    loadCache: calendarSemanaLoadCache,
    saveCache: calendarSemanaSaveCache,
    unsubAll: calendarSemanaUnsubAll,
    render: renderMiSemana,
    getRol: getUserCalendarRole,
    createBloque: _msCreateBloque,
    updateBloque: _msUpdateBloque,
    deleteBloque: _msDeleteBloque,
    cascadeNullifyByTareaId: _msCascadeNullifyByTareaId,
    showCrear: _msShowCrearBloqueModal,
    showEdit: _msShowEditBloqueModal,
    cache: _calendarSemanaMemCache,
    COLORS: CALENDAR_CLIENT_COLORS
  };

  // Reverse coupling CRÍTICO: tareas.js:2417 lee del global.
  window._msCascadeNullifyByTareaId = _msCascadeNullifyByTareaId;

  // HTML inline onclick handlers (audit sección C).
  window.renderMiSemana = renderMiSemana;
  window.miSemanaPrevWeek = miSemanaPrevWeek;
  window.miSemanaNextWeek = miSemanaNextWeek;
  window.miSemanaToday = miSemanaToday;
  window.getUserCalendarRole = getUserCalendarRole;
  window._msTogglePanelCollapsed = _msTogglePanelCollapsed;
  window._msOnSlotClick = _msOnSlotClick;
  window._msOnBloqueClick = _msOnBloqueClick;

  // S77 fix Mi Semana drag-drop: el audit F2a (ef81dba) clasificó estos 6
  // handlers como "internos" porque sus call sites están en HTML inline DENTRO
  // de templates del mismo módulo. Pero HTML inline se evalúa en scope global
  // del browser cuando dispara el evento, no en module scope → necesitan
  // window.* o el drag&drop muere silenciosamente. Lección: HTML inline en
  // templates = call site externo, sin importar dónde viva el template.
  // Deuda B (BACKLOG): migrar inline → addEventListener fuera de scope F2a.
  Object.assign(window, {
    _msTareaDragStart: _msTareaDragStart,
    _msBloqueDragStart: _msBloqueDragStart,
    _msBloqueDragEnd: _msBloqueDragEnd,
    _msColDragOver: _msColDragOver,
    _msColDragLeave: _msColDragLeave,
    _msColDrop: _msColDrop,
    // PR1 Cambio 1: nav steps + toggle vista (despachan a Week|Day según view actual).
    miSemanaToggleView: miSemanaToggleView,
    _msPrevStep: _msPrevStep,
    _msNextStep: _msNextStep,
    _msTodayStep: _msTodayStep,
    // PR1 Cambio 2: panel pendientes como drop target (drop bloque → delete).
    _msPanelDragOver: _msPanelDragOver,
    _msPanelDrop: _msPanelDrop
  });

  console.log('[mi-semana.js] init complete');
}
