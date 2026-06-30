// ════════════════════════════════════════════════════════════════
// OPTIX — Inbox Mario v1 (S75)
//
// Bandeja de captura rápida en vista Tareas v4.0. Reemplaza el sheet
// paralelo de Mario. SPEC F0B6E7BH17W (D1-D14).
//
// Patrón ESM: imports explícitos (no window reads desde el módulo).
// initInbox() idempotente con auth state guard (D-Auth).
// Reverse coupling: tareas.js renderTareasCli() llama window.renderInbox()
// tras innerHTML reset — exposición vía init().
//
// Atomicidad rutear (D-H.1): id generation FUERA del mutator + early-return
// idempotente dentro del mutator (tareasCliSave hace 3 retries con backoff).
// D-H.2: error state honesto si segundo write (status='routed') falla.
//
// Persistencia:
//   - Firestore: workspaces/{wsId}/inbox/{itemId} con compound index
//     (owner_uid ASC, status ASC, created_at DESC).
//   - localStorage sticky: inbox_route_last_{uid} con {client_id,type,objetivo_id}.
// ════════════════════════════════════════════════════════════════

import {
  doc, setDoc, updateDoc, deleteDoc, collection,
  onSnapshot, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { auth, db, WORKSPACE } from './core.js';
import { tareasCliAddObjetivo, tareasCliAddTarea, tareasCliSave, tareasCliOwnerVisible, tareasCliIsManager, tareasCliNewOwnerFields, tareasCliAdoptPayload } from './tareas.js';
import { escapeHtml } from './utils.js';

// ─────────────────────────────────────────
// MODULE STATE (privado)
// ─────────────────────────────────────────

let __inboxInitialized = false;
let _inboxUnsub = null;        // onSnapshot unsub fn — items propios (owner_uid==uid)
let _inboxRoleUnsub = null;    // S91 handoff: onSnapshot items dirigidos al rol manager (to_role)
let _inboxItemsOwn = [];       // snapshot listener 1 (propios)
let _inboxItemsRole = [];      // snapshot listener 2 (to_role:'manager', solo si soy manager)
let _inboxItems = [];          // merge deduplicado de ambos, ordenado por created_at desc
let _modalOpen = null;         // itemId del modal abierto, null si cerrado
const _LS_KEY_PREFIX = 'inbox_route_last_';
const _MAX_TEXT = 500;

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function _genShortId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.floor(Math.random() * 1e9).toString(36);
}

function _genInboxId() { return 'inbox-' + Date.now() + '-' + _genShortId(); }
function _genObjId()   { return 'obj-' + Date.now() + '-' + _genShortId(); }
function _genTareaId() { return 'tarea-' + Date.now() + '-' + _genShortId(); }

function _inboxColRef() {
  return collection(db, 'workspaces', WORKSPACE.id, 'inbox');
}
function _inboxDocRef(itemId) {
  return doc(db, 'workspaces', WORKSPACE.id, 'inbox', itemId);
}

function _clampText(t) {
  return String(t || '').slice(0, _MAX_TEXT);
}

// ─────────────────────────────────────────
// STICKY DEFAULTS (I-1)
// ─────────────────────────────────────────

function _stickyKey() {
  const uid = auth && auth.currentUser && auth.currentUser.uid;
  return uid ? (_LS_KEY_PREFIX + uid) : null;
}

function _stickyLoad() {
  try {
    const k = _stickyKey();
    if (!k) return null;
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validar que client_id sigue existiendo (I-1)
    if (parsed && parsed.client_id) {
      const exists = (typeof window !== 'undefined' && Array.isArray(window.clients))
        ? window.clients.some(function(c) { return c.id === parsed.client_id; })
        : false;
      if (!exists) return null; // reset si cliente borrado
    }
    return parsed;
  } catch (e) { return null; }
}

function _stickySave(payload) {
  try {
    const k = _stickyKey();
    if (!k) return;
    localStorage.setItem(k, JSON.stringify(payload));
  } catch (e) {}
}

// ─────────────────────────────────────────
// CRUD operaciones (Firestore)
// ─────────────────────────────────────────

async function inboxAdd(text) {
  const t = _clampText(text).trim();
  if (!t) return null; // D14: vacíos no se guardan
  const user = auth && auth.currentUser;
  if (!user || !user.uid) throw new Error('No auth');
  const id = _genInboxId();
  await setDoc(_inboxDocRef(id), {
    id: id,
    text: t,
    owner_uid: user.uid,
    status: 'pending',
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    routed_at: null,
    routed_to: null
  });
  return id;
}

// S91 Frente 1 (handoff): crea un item de Inbox dirigido al ROL manager (no a un uid).
// owner_uid:null + to_role:'manager' → solo lo ve un usuario cuyo rol resuelto sea manager
// (ver _ensureRoleSubscription). Lleva el payload de la tarea + subtareas y el origen.
// Lo invoca tareas.js vía window.__inboxCreateHandoff (reverse coupling, sin import circular).
export async function inboxCreateHandoff(opts) {
  opts = opts || {};
  const sender = auth && auth.currentUser;
  if (!sender || !sender.uid) throw new Error('No auth');
  const id = _genInboxId();
  await setDoc(_inboxDocRef(id), {
    id: id,
    text: _clampText(opts.text || '(tarea)'),
    owner_uid: null,             // NO dirigido a una persona
    to_role: 'manager',          // dirigido al rol manager
    status: 'pending',
    payload: opts.payload || null,
    passed_by_uid: opts.passed_by_uid || null,
    passed_by_label: opts.passed_by_label || 'M',
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    routed_at: null,
    routed_to: null
  });
  return id;
}

async function inboxEditText(itemId, newText) {
  const t = _clampText(newText).trim();
  if (!t) return;
  await updateDoc(_inboxDocRef(itemId), {
    text: t,
    updated_at: serverTimestamp()
  });
}

async function inboxDelete(itemId) {
  await deleteDoc(_inboxDocRef(itemId));
}

// Soft delete: marca status='routed', NO borra el doc (D1: análisis retroactivo).
async function _inboxMarkRouted(itemId, routedTo) {
  await updateDoc(_inboxDocRef(itemId), {
    status: 'routed',
    routed_at: serverTimestamp(),
    routed_to: routedTo
  });
}

// ─────────────────────────────────────────
// ROUTING — secuencial con id generation idempotente (D-H.1)
// ─────────────────────────────────────────

async function inboxRoute(itemId, params) {
  // params: { client_id, type: 'objetivo'|'tarea', objetivo_id|null, objetivo_name_new|null }
  const item = _inboxItems.find(function(x) { return x.id === itemId; });
  if (!item) throw new Error('Item inbox no encontrado');

  const clientId = params.client_id;
  const type = params.type;
  if (!clientId) throw new Error('Cliente requerido');
  if (type !== 'objetivo' && type !== 'tarea') throw new Error('Tipo inválido');

  let finalObjetivoId = null;
  let finalObjetivoNameNew = null;

  if (type === 'objetivo') {
    // El texto del inbox ES el nombre del objetivo nuevo.
    // tareasCliAddObjetivo retorna newId; ya tiene id-generation interno
    // (no podemos hacerlo idempotente desde afuera). En la práctica solo
    // crearíamos duplicado si la red falla entre create y status flip,
    // riesgo aceptable (objetivo en card es eliminable por user).
    finalObjetivoId = await tareasCliAddObjetivo(clientId, item.text);
    finalObjetivoNameNew = item.text;
  } else {
    // type === 'tarea'
    // S91 handoff: si el item trae payload (tarea + subtareas empaquetadas), se adopta
    // deserializando con ids nuevos (tareasCliAdoptPayload). Si no, comportamiento histórico
    // (item de texto → una tarea raíz). El payload es opcional → cero regresión en texto.
    const _hasPayload = !!(item.payload && Array.isArray(item.payload.tareas) && item.payload.tareas.length);
    if (params.objetivo_id) {
      // Objetivo existente.
      if (_hasPayload) {
        await tareasCliAdoptPayload(clientId, params.objetivo_id, item.payload);
      } else {
        await tareasCliAddTarea(clientId, params.objetivo_id, item.text);
      }
      finalObjetivoId = params.objetivo_id;
    } else if (params.objetivo_name_new) {
      // D4 + D-H.1: crear objetivo (idempotente). IDs generados FUERA del mutator.
      const objId = _genObjId();
      const tareaId = _genTareaId();
      const nowIso = new Date().toISOString();
      const nuevoNombre = params.objetivo_name_new;
      const tareaTexto = item.text;
      // S90: estampa dueño aquí también (no pasa por tareasCliAddObjetivo). Manager → privado.
      const _owner = tareasCliNewOwnerFields(undefined);
      await tareasCliSave(clientId, function(d) {
        if (!Array.isArray(d.objetivos)) d.objetivos = [];
        if (d.objetivos.find(function(o) { return o.id === objId; })) return d; // idempotente
        const nuevoObj = {
          id: objId,
          nombre: nuevoNombre,
          collapsed: false,
          orden: d.objetivos.length,
          owner_uid: _owner.owner_uid,
          owner_label: _owner.owner_label,
          shared: _owner.shared,
          tareas: []
        };
        // S91 (Opción 1): si el handoff trae scope de origen, el objetivo NUEVO nace con él
        // (la tarea adoptada se ve con su etiqueta al instante). Ausente → sin scope (default
        // 'compartido' vía readers). Scope sigue siendo propiedad del objetivo, no de la tarea.
        if (_hasPayload && item.payload.scope) {
          nuevoObj.scope = item.payload.scope;
        }
        // Con payload, el objetivo nace vacío y se llena vía tareasCliAdoptPayload abajo
        // (preserva árbol padre-subtareas). Sin payload, una tarea de texto inline.
        if (!_hasPayload) {
          nuevoObj.tareas.push({
            id: tareaId,
            texto: tareaTexto,
            completado: false,
            fechaIdeal: null,
            fechaLimite: null,
            notas: '',
            responsibleUsers: [],
            orden: 0,
            createdAt: nowIso,
            updatedAt: nowIso
          });
        }
        d.objetivos.push(nuevoObj);
        return d;
      });
      if (_hasPayload) {
        await tareasCliAdoptPayload(clientId, objId, item.payload);
      }
      finalObjetivoId = objId;
      finalObjetivoNameNew = nuevoNombre;
    } else {
      throw new Error('Tarea sin objetivo (ni existente ni nuevo)');
    }
  }

  // Segundo write — D-H.2: si falla, el caller verá warning explícito.
  // El objetivo/tarea YA quedó creado en card del cliente; inbox row queda pending.
  try {
    await _inboxMarkRouted(itemId, {
      client_id: clientId,
      type: type,
      objetivo_id: finalObjetivoId || null,
      objetivo_name_new: finalObjetivoNameNew || null
    });
  } catch (err) {
    const partial = new Error('inbox-partial-routed');
    partial.partial = true;
    partial.originalError = err;
    throw partial;
  }

  // Sticky default (D7)
  _stickySave({
    client_id: clientId,
    type: type,
    objetivo_id: (type === 'tarea' && params.objetivo_id) ? params.objetivo_id : null
  });
}

// ─────────────────────────────────────────
// LISTENER FIRESTORE — guard al nivel del unsub (lección S74 J47)
// ─────────────────────────────────────────

// Merge deduplicado de los dos listeners (propios + rol), orden created_at desc.
// Los items de handoff tienen owner_uid:null → nunca aparecen en el listener propio;
// los de texto no tienen to_role → nunca en el de rol. El dedupe por id es defensivo.
function _recombineInbox() {
  const byId = {};
  _inboxItemsOwn.forEach(function(i) { if (i && i.id) byId[i.id] = i; });
  _inboxItemsRole.forEach(function(i) { if (i && i.id) byId[i.id] = i; });
  _inboxItems = Object.keys(byId).map(function(k) { return byId[k]; }).sort(function(a, b) {
    const sa = (a.created_at && a.created_at.seconds) || 0;
    const sb = (b.created_at && b.created_at.seconds) || 0;
    return sb - sa;
  });
}

// INVARIANTE CRÍTICO de privacidad: solo un usuario cuyo rol resuelto sea manager
// (tareasCliIsManager — derivado de currentUserProfile.rol, asignado por email en login)
// crea el listener de to_role:'manager'. Un no-manager (Mario) NUNCA lo consulta, así que
// nunca ve items de handoff — ni siquiera los que él mismo originó (van con owner_uid:null,
// que tampoco matchea su listener propio). Idempotente: se llama desde _subscribe y
// renderInbox para enganchar aunque el perfil cargue después del init.
function _ensureRoleSubscription() {
  if (_inboxRoleUnsub) return;
  if (!tareasCliIsManager()) return;
  const qRole = query(
    _inboxColRef(),
    where('to_role', '==', 'manager'),
    where('status', '==', 'pending'),
    orderBy('created_at', 'desc')
  );
  _inboxRoleUnsub = onSnapshot(qRole, function(snap) {
    _inboxItemsRole = snap.docs.map(function(d) { return d.data(); });
    _recombineInbox();
    renderInbox();
  }, function(err) {
    console.error('[inbox.js] onSnapshot(role) error:', err);
  });
}

function _subscribe() {
  const user = auth && auth.currentUser;
  if (!user || !user.uid) return;
  // Listener 1: items propios (todos los usuarios) — comportamiento histórico intacto.
  if (!_inboxUnsub) {
    const qOwn = query(
      _inboxColRef(),
      where('owner_uid', '==', user.uid),
      where('status', '==', 'pending'),
      orderBy('created_at', 'desc')
    );
    _inboxUnsub = onSnapshot(qOwn, function(snap) {
      _inboxItemsOwn = snap.docs.map(function(d) { return d.data(); });
      _recombineInbox();
      renderInbox();
    }, function(err) {
      console.error('[inbox.js] onSnapshot error:', err);
    });
  }
  // Listener 2: items del rol manager — SOLO si soy manager.
  _ensureRoleSubscription();
}

// ─────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────

function renderInbox() {
  const container = document.getElementById('inbox-container');
  if (!container) return; // No DOM target (user fuera de vista Tareas)
  const user = auth && auth.currentUser;
  if (!user || !user.uid) {
    container.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:12px;">Sesión no iniciada.</div>';
    return;
  }
  // S91: engancha el listener de rol manager si el perfil ya cargó (idempotente).
  _ensureRoleSubscription();

  const itemsHtml = _inboxItems.length === 0
    ? '<div style="padding:18px 14px;text-align:center;color:var(--text3);font-size:11px;font-family:\'DM Mono\',monospace;line-height:1.4;">Sin pendientes.<br>Captura algo arriba ↑</div>'
    : _inboxItems.map(function(item) {
        const idSafe = escapeHtml(item.id);
        const textSafe = escapeHtml(item.text || '');
        // S91 handoff: badge de origen "📤 M" + nº de subtareas si vino empaquetada.
        const _subCount = (item.payload && Array.isArray(item.payload.tareas)) ? (item.payload.tareas.length - 1) : 0;
        const _passedBadge = item.passed_by_label
          ? '<span title="Pasada por ' + escapeHtml(item.passed_by_label) + '" style="font-family:\'DM Mono\',monospace;font-size:9px;background:rgba(0,229,160,0.15);color:var(--accent);border-radius:4px;padding:1px 6px;flex-shrink:0;">📤 ' + escapeHtml(item.passed_by_label) + (_subCount > 0 ? ' · +' + _subCount + ' sub' : '') + '</span>'
          : '';
        return ''
          + '<div data-inbox-id="' + idSafe + '" '
          +   'style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:8px;">'
          +   (_passedBadge ? '<div style="display:flex;">' + _passedBadge + '</div>' : '')
          +   '<div style="font-size:13px;color:var(--text);line-height:1.4;word-wrap:break-word;white-space:pre-wrap;">' + textSafe + '</div>'
          +   '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
          +     '<button onclick="window.__inboxOpenRouteModal(\'' + idSafe + '\')" '
          +       'style="background:var(--accent);border:none;color:#000;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Asignar</button>'
          +     '<button onclick="window.__inboxEditPrompt(\'' + idSafe + '\')" '
          +       'title="Editar texto" '
          +       'style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">✎</button>'
          +     '<button onclick="window.__inboxConfirmDelete(\'' + idSafe + '\')" '
          +       'title="Borrar fila" '
          +       'style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">×</button>'
          +   '</div>'
          + '</div>';
      }).join('');

  container.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;">'
    +   '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">'
    +     '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:14px;color:var(--text);">📥 Inbox</div>'
    +     '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);">' + _inboxItems.length + ' pendiente' + (_inboxItems.length === 1 ? '' : 's') + '</div>'
    +   '</div>'
    +   '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">'
    +     '<textarea id="inbox-new-input" placeholder="Captura algo… (Enter para guardar)" maxlength="' + _MAX_TEXT + '" rows="2" '
    +       'style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px 10px;font-size:12px;font-family:\'DM Sans\',sans-serif;resize:vertical;" '
    +       'onkeydown="window.__inboxInputKey(event)" '
    +       'onblur="window.__inboxInputBlur()"></textarea>'
    +   '</div>'
    +   '<div id="inbox-list">' + itemsHtml + '</div>'
    + '</div>';
}

// ─────────────────────────────────────────
// HANDLERS (window-exposed)
// ─────────────────────────────────────────

async function _handleAddFromInput() {
  const el = document.getElementById('inbox-new-input');
  if (!el) return;
  const text = el.value;
  el.value = '';
  try {
    await inboxAdd(text);
  } catch (e) {
    console.error('[inbox.js] add error:', e);
    if (typeof showToast === 'function') showToast('Error al guardar fila', '⚠️');
  }
}

function _handleInputKey(ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    _handleAddFromInput();
  }
}

function _handleEditPrompt(itemId) {
  const item = _inboxItems.find(function(x) { return x.id === itemId; });
  if (!item) return;
  const next = window.prompt('Editar texto (' + _MAX_TEXT + ' max):', item.text || '');
  if (next === null) return; // cancel
  inboxEditText(itemId, next).catch(function(e) {
    console.error('[inbox.js] edit error:', e);
    if (typeof showToast === 'function') showToast('Error al editar', '⚠️');
  });
}

function _handleConfirmDelete(itemId) {
  const item = _inboxItems.find(function(x) { return x.id === itemId; });
  if (!item) return;
  if (!window.confirm('¿Borrar fila "' + (item.text || '').slice(0, 40) + '"?')) return;
  inboxDelete(itemId).catch(function(e) {
    console.error('[inbox.js] delete error:', e);
    if (typeof showToast === 'function') showToast('Error al borrar', '⚠️');
  });
}

// ─────────────────────────────────────────
// MODAL DE RUTEAR (3 pasos)
// ─────────────────────────────────────────

function _showRouteModal(itemId) {
  const item = _inboxItems.find(function(x) { return x.id === itemId; });
  if (!item) return;
  _modalOpen = itemId;

  const wsId = (typeof currentAgencia !== 'undefined' && currentAgencia) ? currentAgencia : WORKSPACE.id;
  // Clientes del workspace activo (merge defaults + dynamic, mismo patrón que renderTareasCli)
  const _defaults = (typeof getDefaultClients === 'function' ? getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const _defaultIds = new Set(_defaults.map(function(c) { return c.id; }));
  const _dynamic = (typeof clients !== 'undefined' && Array.isArray(clients))
    ? clients.filter(function(c) { return c.workspaceId === wsId && !_defaultIds.has(c.id); })
    : [];
  const catalog = _defaults.concat(_dynamic);

  const sticky = _stickyLoad();
  const initialClientId = (sticky && sticky.client_id) || (catalog[0] && catalog[0].id) || '';
  const initialType = (sticky && sticky.type) || 'tarea';

  const modalId = 'inbox-route-modal';
  let el = document.getElementById(modalId);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = modalId;
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';

  const clientOptions = catalog.map(function(c) {
    return '<option value="' + escapeHtml(c.id) + '"' + (c.id === initialClientId ? ' selected' : '') + '>' + escapeHtml(c.nombre || c.id) + '</option>';
  }).join('');

  el.innerHTML = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px;min-width:380px;max-width:480px;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:15px;color:var(--text);margin-bottom:6px;">Asignar al cliente</div>'
    +   '<div style="font-size:12px;color:var(--text2);background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:14px;line-height:1.4;font-style:italic;">' + escapeHtml(item.text || '') + '</div>'

    +   '<div style="margin-bottom:12px;">'
    +     '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">1. Cliente</label>'
    +     '<select id="inbox-route-client" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:7px 8px;border-radius:6px;font-size:12px;">' + clientOptions + '</select>'
    +     '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);margin-top:4px;">¿No encuentras el cliente? Créalo primero en vista Clientes con + Rápido.</div>'
    +   '</div>'

    +   '<div style="margin-bottom:12px;">'
    +     '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">2. Tipo</label>'
    +     '<div style="display:flex;gap:8px;">'
    +       '<label style="flex:1;display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;color:var(--text);">'
    +         '<input type="radio" name="inbox-route-type" value="objetivo"' + (initialType === 'objetivo' ? ' checked' : '') + ' onchange="window.__inboxRouteTypeChange()" style="margin:0;cursor:pointer;">'
    +         'Objetivo'
    +       '</label>'
    +       '<label style="flex:1;display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;color:var(--text);">'
    +         '<input type="radio" name="inbox-route-type" value="tarea"' + (initialType !== 'objetivo' ? ' checked' : '') + ' onchange="window.__inboxRouteTypeChange()" style="margin:0;cursor:pointer;">'
    +         'Tarea'
    +       '</label>'
    +     '</div>'
    +   '</div>'

    +   '<div id="inbox-route-step3" style="margin-bottom:14px;">'
    + /* dinámico, populated by _refreshStep3 */ ''
    +   '</div>'

    +   '<div id="inbox-route-error" style="display:none;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:var(--red);padding:8px 12px;border-radius:6px;font-size:11px;margin-bottom:12px;"></div>'

    +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +     '<button id="inbox-route-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Cancelar</button>'
    +     '<button id="inbox-route-confirm" style="background:var(--accent);border:none;color:#000;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Confirmar</button>'
    +   '</div>'
    + '</div>';

  document.body.appendChild(el);

  function close() {
    _modalOpen = null;
    try { el.remove(); } catch (e) {}
  }
  el.onclick = function(ev) { if (ev.target === el) close(); };
  document.addEventListener('keydown', function escHandler(ev) {
    if (ev.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      close();
    }
  });
  document.getElementById('inbox-route-cancel').onclick = close;

  // Cambio de cliente → refresca dropdown objetivos del step 3
  document.getElementById('inbox-route-client').onchange = _refreshStep3;
  // Initial render step 3
  _refreshStep3(undefined, initialClientId, initialType, sticky && sticky.objetivo_id);

  document.getElementById('inbox-route-confirm').onclick = function() {
    _submitRoute(itemId, close);
  };
}

function _refreshStep3(ev, initialClientId, initialType, stickyObjId) {
  const step3 = document.getElementById('inbox-route-step3');
  if (!step3) return;
  const clientSelect = document.getElementById('inbox-route-client');
  const clientId = clientSelect ? clientSelect.value : initialClientId;
  const typeEl = document.querySelector('input[name="inbox-route-type"]:checked');
  const type = typeEl ? typeEl.value : (initialType || 'tarea');

  if (type === 'objetivo') {
    // BACKLOG #48: ocultar contenedor completo cuando type='objetivo'.
    // El confirm logic ya ignora step3 en ese path; mostrarlo confundía.
    step3.style.display = 'none';
    step3.innerHTML = '';
    return;
  }

  // type === 'tarea' → restaurar visibilidad + dropdown de objetivos del cliente
  step3.style.display = '';
  const memCache = (typeof window !== 'undefined' && window._tareasCliMemCache) || {};
  const cached = memCache[clientId] || null;
  const objetivosRaw = (cached && Array.isArray(cached.objetivos)) ? cached.objetivos : [];
  // S90 (SPEC F0BC6QGA7L3): filtro por dueño (superficie 4/5 — el dropdown de rutear).
  // Sin esto Mario vería los privados de Anwar en la lista de objetivos a los que rutear.
  const _ownerUid = (typeof window !== 'undefined' && window.currentUser && window.currentUser.uid) || '_anon';
  const _ownerIsManager = tareasCliIsManager();
  const objetivos = objetivosRaw.filter(function(o) {
    return tareasCliOwnerVisible(o, { viewerUid: _ownerUid, isManager: _ownerIsManager });
  });

  const objOptions = objetivos.map(function(o) {
    const sel = (stickyObjId && o.id === stickyObjId) ? ' selected' : '';
    return '<option value="' + escapeHtml(o.id) + '"' + sel + '>' + escapeHtml(o.nombre || o.id) + '</option>';
  }).join('');
  const newSelected = (!stickyObjId || !objetivos.find(function(o) { return o.id === stickyObjId; })) ? ' selected' : '';

  step3.innerHTML = ''
    + '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:600;">3. Objetivo (para la tarea)</label>'
    + '<select id="inbox-route-objetivo" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:7px 8px;border-radius:6px;font-size:12px;margin-bottom:8px;" onchange="window.__inboxObjChange()">'
    +   objOptions
    +   '<option value="__new__"' + newSelected + '>+ Nuevo objetivo…</option>'
    + '</select>'
    + '<input id="inbox-route-objetivo-new" type="text" placeholder="Nombre del nuevo objetivo…" maxlength="120" '
    +   'style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:7px 8px;border-radius:6px;font-size:12px;display:' + (newSelected ? 'block' : 'none') + ';">';
}

function _handleObjChange() {
  const sel = document.getElementById('inbox-route-objetivo');
  const inp = document.getElementById('inbox-route-objetivo-new');
  if (!sel || !inp) return;
  inp.style.display = (sel.value === '__new__') ? 'block' : 'none';
  if (sel.value === '__new__') inp.focus();
}

function _handleTypeChange() {
  // Re-render step 3 según nuevo tipo
  _refreshStep3();
}

async function _submitRoute(itemId, closeFn) {
  const btn = document.getElementById('inbox-route-confirm');
  const errEl = document.getElementById('inbox-route-error');
  if (!btn) return;

  function showErr(msg) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }
  function clearErr() {
    if (errEl) errEl.style.display = 'none';
  }
  clearErr();

  const clientSelect = document.getElementById('inbox-route-client');
  const clientId = clientSelect && clientSelect.value;
  const typeEl = document.querySelector('input[name="inbox-route-type"]:checked');
  const type = typeEl && typeEl.value;

  if (!clientId) { showErr('Selecciona un cliente'); return; }
  if (!type) { showErr('Selecciona tipo'); return; }

  let objetivoId = null;
  let objetivoNameNew = null;

  if (type === 'tarea') {
    const objSel = document.getElementById('inbox-route-objetivo');
    const objNew = document.getElementById('inbox-route-objetivo-new');
    if (objSel && objSel.value === '__new__') {
      const nuevoNombre = (objNew && objNew.value || '').trim().slice(0, 120);
      if (!nuevoNombre) { showErr('Escribe el nombre del nuevo objetivo'); return; }
      objetivoNameNew = nuevoNombre;
    } else if (objSel && objSel.value) {
      objetivoId = objSel.value;
    } else {
      showErr('Selecciona o crea un objetivo'); return;
    }
  }

  const origText = btn.textContent;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.textContent = 'Asignando…';

  try {
    await inboxRoute(itemId, {
      client_id: clientId,
      type: type,
      objetivo_id: objetivoId,
      objetivo_name_new: objetivoNameNew
    });
    if (typeof showToast === 'function') showToast('Asignado ✓', '✅');
    if (typeof closeFn === 'function') closeFn();
    // Re-render vista Tareas para que aparezca en card cliente
    if (typeof window.renderTareasCli === 'function') {
      try { window.renderTareasCli(); } catch (e) {}
    }
  } catch (err) {
    if (err && err.partial) {
      // D-H.2: objetivo/tarea creado pero status='routed' falló.
      showErr('Tarea creada pero no se marcó como ruteada en el inbox. Refresca para reconciliar.');
      btn.textContent = origText;
      btn.disabled = false;
      btn.style.opacity = '1';
    } else {
      console.error('[inbox.js] route error:', err);
      showErr((err && err.message) || 'Error al asignar. Intenta de nuevo.');
      btn.textContent = origText;
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

// ─────────────────────────────────────────
// INIT — idempotente + auth state guard (D-Auth)
// ─────────────────────────────────────────

export function init() {
  if (__inboxInitialized) return;
  const user = auth && auth.currentUser;
  if (!user || !user.uid) {
    // Postponer hasta que auth resuelva (lección S74 #4 multi-init).
    onAuthStateChanged(auth, function(u) {
      if (u && u.uid && !__inboxInitialized) init();
    });
    return;
  }
  __inboxInitialized = true;

  // Exposición window para HTML inline (handlers en filas + modal) + reverse coupling
  // con tareas.js renderTareasCli (que llama window.renderInbox tras innerHTML reset).
  window.renderInbox = renderInbox;
  window.__inboxAdd = inboxAdd;
  // S91 handoff: tareas.js (botón "pasar a Anwar") crea el item vía esta función.
  window.__inboxCreateHandoff = inboxCreateHandoff;
  window.__inboxOpenRouteModal = _showRouteModal;
  window.__inboxEditPrompt = _handleEditPrompt;
  window.__inboxConfirmDelete = _handleConfirmDelete;
  window.__inboxInputKey = _handleInputKey;
  window.__inboxInputBlur = _handleAddFromInput;
  window.__inboxRouteTypeChange = _handleTypeChange;
  window.__inboxObjChange = _handleObjChange;

  // Suscribir listener Firestore + primer render.
  _subscribe();
  renderInbox();

  console.log('[inbox.js] init complete');
}
