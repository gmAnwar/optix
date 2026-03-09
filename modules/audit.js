/**
 * OPTIX — Audit Log Module
 * 
 * Registra TODAS las operaciones de escritura en Firestore:
 * - Quién hizo el cambio (userId/rol)
 * - Qué cambió (documento afectado + delta)
 * - Cuándo (timestamp)
 * - En qué workspace
 * 
 * El audit log es inmutable: solo se agrega, nunca se edita ni borra.
 * Es un feature premium — se puede mostrar en el panel de Dirección.
 */

import { db, WORKSPACE, State } from './core.js';
import {
  collection, addDoc, serverTimestamp,
  query, orderBy, limit, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────
// TIPOS DE ACCIÓN — Catálogo de eventos auditables
// ─────────────────────────────────────────
export const AuditActions = {
  // Clientes
  CLIENT_CREATED:     'client.created',
  CLIENT_UPDATED:     'client.updated',
  CLIENT_DELETED:     'client.deleted',
  
  // Expediente
  EXPEDIENTE_SAVED:   'expediente.saved',
  EXPEDIENTE_SECTION: 'expediente.section_saved',
  
  // Semáforo
  SEMAFORO_CHANGED:   'semaforo.changed',
  SEMAFORO_CLOSED:    'semaforo.week_closed',
  
  // Vault (fase futura)
  VAULT_AD_ADDED:     'vault.ad_added',
  VAULT_COPY_ADDED:   'vault.copy_added',
  
  // Estado interno
  STATE_CHANGE:       'state.change',
  
  // Sesión
  SESSION_START:      'session.start',
  SESSION_ROL_ENTER:  'session.rol_entered',
};

// ─────────────────────────────────────────
// LOG — Registrar un evento en Firestore
// ─────────────────────────────────────────
export async function log(event) {
  // Si el audit log no está habilitado para este workspace, silencioso
  if (!window._OptixCore?.WORKSPACE?.features?.auditLog) {
    // Igual lo guardamos en consola para debugging
    console.debug('[Audit]', event.action, event);
    return;
  }
  
  try {
    const entry = {
      workspaceId: WORKSPACE.id,
      userId: State.currentRol || 'unknown',    // En SaaS: Firebase Auth UID
      action: event.action,
      entity: event.entity || null,             // Ej: 'client', 'expediente'
      entityId: event.entityId || null,         // Ej: 'enpagos'
      section: event.section || null,           // Ej: 'adn', 'objetivos'
      prev: event.prev || null,                 // Valor anterior (si aplica)
      next: event.next || null,                 // Valor nuevo (si aplica)
      meta: event.meta || null,                 // Datos extra opcionales
      timestamp: serverTimestamp(),
      clientTimestamp: new Date().toISOString(),
    };
    
    await addDoc(
      collection(db, "workspaces", WORKSPACE.id, "auditLog"),
      entry
    );
  } catch(e) {
    // Nunca romper la app por un error de audit log
    console.warn('[Audit] Log failed (non-critical):', e.message);
  }
}

// ─────────────────────────────────────────
// LOG HELPERS — Atajos para los eventos más comunes
// ─────────────────────────────────────────
export const Audit = {
  clientCreated: (clientId, clientData) => log({
    action: AuditActions.CLIENT_CREATED,
    entity: 'client',
    entityId: clientId,
    next: clientData,
  }),
  
  clientUpdated: (clientId, prev, next) => log({
    action: AuditActions.CLIENT_UPDATED,
    entity: 'client',
    entityId: clientId,
    prev,
    next,
  }),
  
  expedienteSaved: (clientId, section, data) => log({
    action: AuditActions.EXPEDIENTE_SECTION,
    entity: 'expediente',
    entityId: clientId,
    section,
    next: data,
  }),
  
  semaforoChanged: (clientId, prev, next) => log({
    action: AuditActions.SEMAFORO_CHANGED,
    entity: 'client',
    entityId: clientId,
    prev: { semaforo: prev },
    next: { semaforo: next },
  }),
  
  sessionStart: (rol) => log({
    action: AuditActions.SESSION_ROL_ENTER,
    meta: { rol },
  }),
};

// ─────────────────────────────────────────
// QUERY — Leer el audit log (para vista de Dirección)
// ─────────────────────────────────────────

/** Obtener los últimos N eventos del workspace */
export async function getRecentLogs(limitCount = 50) {
  try {
    const q = query(
      collection(db, "workspaces", WORKSPACE.id, "auditLog"),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error('[Audit] Error reading logs:', e);
    return [];
  }
}

/** Obtener logs de un cliente específico */
export async function getClientLogs(clientId, limitCount = 20) {
  try {
    const q = query(
      collection(db, "workspaces", WORKSPACE.id, "auditLog"),
      where("entityId", "==", clientId),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error('[Audit] Error reading client logs:', e);
    return [];
  }
}

// ─────────────────────────────────────────
// EXPOSICIÓN GLOBAL
// ─────────────────────────────────────────
window.OptixAudit = { log, Audit, getRecentLogs, getClientLogs, AuditActions };

console.log('[Optix Audit] Module initialized');
