/**
 * OPTIX — Core Module
 * Maneja: Firebase, WorkspaceId, estado global, utilidades base
 * 
 * ARQUITECTURA MODULAR — No modificar dependencias directas del DOM aquí.
 * Este módulo es la única fuente de verdad para el estado de la app.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, deleteDoc, onSnapshot,
  collection, addDoc, getDocs, serverTimestamp,
  query, where, orderBy, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────
// FIREBASE CONFIG
// ─────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDFz4p5Me5lZwzCT7aM992JSiWeVbWJb6w",
  authDomain: "optix-5fb36.firebaseapp.com",
  projectId: "optix-5fb36",
  storageBucket: "optix-5fb36.firebasestorage.app",
  messagingSenderId: "453087797268",
  appId: "1:453087797268:web:c78faee4f1dffd4574c701"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// P0 fix: inicializar modular Auth para que getFirestore comparta el token de
// auth con la sesión compat (firebase-auth-compat v9 cargado en index.html).
// Sin esto, todos los writes desde este módulo llegan SIN token y las rules
// "if request.auth != null" devuelven permission-denied silenciosamente.
// Como compat y modular comparten IndexedDB persistence, getAuth(app) toma
// el user actual sin requerir cambios en el login flow.
export const auth = getAuth(app);

// ─────────────────────────────────────────
// WORKSPACE — Multi-tenant desde el inicio
// Cada workspace es una agencia diferente.
// workspaceId se incluye en TODOS los docs de Firestore.
// ─────────────────────────────────────────
export const WORKSPACE = {
  id: 'optimizads',          // ID del workspace activo — cambiar en SaaS según auth
  name: 'OptimizAds',
  features: {                // Qué módulos están activos para este workspace
    expediente: true,
    semaforo: true,
    vault: false,            // Fase futura
    generador: false,        // Fase futura
    briefCreativos: false,   // Fase futura
    integraciones: false,    // Fase futura
  }
};

// ─────────────────────────────────────────
// ESTADO GLOBAL
// Fuente de verdad de la app.
// Nunca modificar directamente — usar los setters.
// ─────────────────────────────────────────
export const State = {
  clients: [],
  currentClientId: null,
  currentView: 'dashboard',
  currentRol: null,
  workspaceId: WORKSPACE.id,
};

// Setters con audit automático
export function setState(key, value, opts = {}) {
  const prev = State[key];
  State[key] = value;
  
  // Audit log automático en cambios de estado importantes
  if (opts.audit && window.OptixAudit) {
    window.OptixAudit.log({
      action: opts.audit,
      key,
      prev,
      next: value,
      workspaceId: State.workspaceId,
    });
  }
}

// ─────────────────────────────────────────
// FIREBASE — Operaciones base de clientes
// Todas las operaciones incluyen workspaceId
// ─────────────────────────────────────────

/** Guardar lista de clientes en Firestore. Throw on error — el caller debe
 *  manejar (ej. createQuickClient en modules/tareas.js tiene try/catch +
 *  rollback). El catch silencioso anterior ocultaba permission-denied al
 *  await caller, haciendo que el rollback de BUG #11 nunca se disparara. */
export async function fbSaveClients(clientsData) {
  await setDoc(doc(db, "workspaces", WORKSPACE.id, "data", "clients"), {
    workspaceId: WORKSPACE.id,
    data: clientsData,
    updatedAt: serverTimestamp(),
  });
}

/** Cargar lista de clientes desde Firestore */
export async function fbLoadClients() {
  try {
    // Intentar nueva estructura con workspaceId primero
    const snap = await getDoc(doc(db, "workspaces", WORKSPACE.id, "data", "clients"));
    if (snap.exists()) return snap.data().data;
    
    // Fallback: estructura legacy (optix/clients)
    const legacySnap = await getDoc(doc(db, "optix", "clients"));
    if (legacySnap.exists()) return legacySnap.data().data;
  } catch(e) {
    console.error("[Core] Firebase load clients error:", e);
  }
  return null;
}

/** Escuchar cambios en tiempo real */
export function fbOnClientsChange(callback) {
  return onSnapshot(
    doc(db, "workspaces", WORKSPACE.id, "data", "clients"),
    (snap) => {
      if (snap.exists()) callback(snap.data().data);
    }
  );
}

/** Guardar datos de un cliente específico (expediente) */
export async function fbSaveClientData(clientId, section, data) {
  try {
    await setDoc(
      doc(db, "workspaces", WORKSPACE.id, "clients", clientId, "sections", section),
      {
        workspaceId: WORKSPACE.id,
        clientId,
        section,
        data,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch(e) {
    console.error(`[Core] Error saving ${clientId}/${section}:`, e);
    return false;
  }
}

/** Cargar datos de un cliente específico (expediente) */
export async function fbLoadClientData(clientId, section) {
  try {
    const snap = await getDoc(
      doc(db, "workspaces", WORKSPACE.id, "clients", clientId, "sections", section)
    );
    if (snap.exists()) return snap.data().data;
  } catch(e) {
    console.error(`[Core] Error loading ${clientId}/${section}:`, e);
  }
  return null;
}

/**
 * Borrar cliente del workspace.
 * Throws on error con mensaje user-friendly — el caller debe try/catch
 * y manejar (UI rollback, re-subscribe listener, error inline).
 *
 * Orden de operaciones (decisión del SPEC delete-client-v1):
 *  1. Pre-flight: clientId.startsWith('client-') (no fundacionales)
 *  2. Pre-flight: no cobros asociados (CUALQUIER cobro bloquea — sin
 *     distinción entre activos vs pagados — v1 conservador)
 *  3. Update data/clients con array sin el cliente
 *  4. Delete doc tareas-clientes/{clientId}
 *  5. Nullify cliente_id en calendar-bloques que apunten al clientId
 *  6. Limpiar localStorage per-cliente (cache + collapse state)
 *
 * NO se borran (decisión consciente — ver audit Slack 25-may):
 *  - Subdocs clients/{id}/sections/{section} (no hay callers reales).
 *  - Audit log entries (historial inmutable).
 *  - jr_tasks/jr_var/jr_check (usan nombre, no id — colisión por homónimo).
 *
 * IMPORTANTE: el caller debe haber unsuscrito _tareasCliUnsubs[clientId]
 * ANTES de llamar — sino el onSnapshot listener pisa el cache cuando ve
 * el doc borrado y queda zombie en memoria.
 *
 * @param {string} clientId — id del cliente (debe ser 'client-*')
 * @param {Array} filteredClients — clients[] ya sin el target (caller hace mutación optimista)
 */
export async function fbDeleteClient(clientId, filteredClients) {
  if (!clientId || !clientId.startsWith('client-')) {
    throw new Error('Solo se pueden borrar clientes creados desde la app (no los fundacionales)');
  }

  // Pre-flight cobros — bloquear si hay CUALQUIER cobro asociado.
  // Cobros viven en workspaces/{ws}/cobranza/data como doc único con array.
  // Spanean varios workspaces (CBZ_WORKSPACES = ['optimizads','taco']) — chequear
  // contra WORKSPACE.id (el del modular env). Limitación conocida: si el cliente
  // está en taco pero WORKSPACE.id='optimizads', solo se valida optimizads. Para
  // v1 es suficiente — el cliente borrable casi siempre es del workspace activo.
  try {
    const cobranzaSnap = await getDoc(doc(db, "workspaces", WORKSPACE.id, "cobranza", "data"));
    if (cobranzaSnap.exists()) {
      const data = cobranzaSnap.data() || {};
      const cobros = Array.isArray(data.cobros) ? data.cobros : [];
      const asociados = cobros.filter(c => c && c.clienteId === clientId);
      if (asociados.length > 0) {
        throw new Error('Este cliente tiene ' + asociados.length + ' cobro' + (asociados.length === 1 ? '' : 's') + ' asociado' + (asociados.length === 1 ? '' : 's') + '. Archívalos o muévelos a otro cliente antes de borrar. v1 no permite borrar clientes con historial financiero.');
      }
    }
  } catch (err) {
    // Re-throw si es el error de bloqueo. Si es error de read (permission, network),
    // bloquear también para evitar borrar sin haber podido validar.
    if (err && err.message && err.message.indexOf('cobro') !== -1) throw err;
    throw new Error('No se pudo validar cobros asociados antes de borrar. Verifica conexión.');
  }

  // 1. Update data/clients (caller ya filtró)
  await fbSaveClients(filteredClients);

  // 2. Delete doc tareas-clientes/{clientId}
  await deleteDoc(doc(db, "workspaces", WORKSPACE.id, "tareas-clientes", clientId));

  // 3. Nullify cliente_id en calendar-bloques
  const bloquesSnap = await getDocs(query(
    collection(db, "workspaces", WORKSPACE.id, "calendar-bloques"),
    where("cliente_id", "==", clientId)
  ));
  if (!bloquesSnap.empty) {
    const batch = writeBatch(db);
    bloquesSnap.forEach(d => batch.update(d.ref, { cliente_id: null }));
    await batch.commit();
  }

  // 4. Limpiar localStorage per-cliente
  try { localStorage.removeItem('tareasCli_v1_' + WORKSPACE.id + '_' + clientId); } catch(e){}
  try {
    const prefix = 'oa-subtask-collapsed-' + clientId + '-';
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch(e){}
}

// ─────────────────────────────────────────
// FEATURE FLAGS — Verificar si un módulo está activo
// ─────────────────────────────────────────
export function isFeatureEnabled(featureName) {
  return WORKSPACE.features[featureName] === true;
}

// ─────────────────────────────────────────
// UTILIDADES BASE
// ─────────────────────────────────────────
export function generateId(prefix = '') {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

// ─────────────────────────────────────────
// EXPOSICIÓN AL SCOPE GLOBAL
// Para compatibilidad con el código legacy del HTML principal.
// En la refactorización completa estas referencias desaparecen.
// ─────────────────────────────────────────
window._fbSaveClients = fbSaveClients;
window._fbLoadClients = fbLoadClients;
window._fbOnClientsChange = fbOnClientsChange;
window._fbSaveClientData = fbSaveClientData;
window._fbLoadClientData = fbLoadClientData;
window._fbDeleteClient = fbDeleteClient;
window._OptixCore = { State, setState, WORKSPACE, isFeatureEnabled, generateId };
window._fbReady = true;
window.dispatchEvent(new Event('firebase-ready'));

console.log('[Optix Core] Initialized — workspace:', WORKSPACE.id);
