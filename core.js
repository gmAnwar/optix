/**
 * OPTIX — Core Module
 * Maneja: Firebase, WorkspaceId, estado global, utilidades base
 * 
 * ARQUITECTURA MODULAR — No modificar dependencias directas del DOM aquí.
 * Este módulo es la única fuente de verdad para el estado de la app.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, setDoc, onSnapshot,
  collection, addDoc, serverTimestamp, query, orderBy, limit
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

/** Guardar lista de clientes en Firestore */
export async function fbSaveClients(clientsData) {
  try {
    await setDoc(doc(db, "workspaces", WORKSPACE.id, "data", "clients"), {
      workspaceId: WORKSPACE.id,
      data: clientsData,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch(e) {
    console.error("[Core] Firebase save clients error:", e);
    return false;
  }
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
window._OptixCore = { State, setState, WORKSPACE, isFeatureEnabled, generateId };
window._fbReady = true;
window.dispatchEvent(new Event('firebase-ready'));

console.log('[Optix Core] Initialized — workspace:', WORKSPACE.id);
