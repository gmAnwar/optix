/**
 * OPTIX — Integraciones Module
 * 
 * Capa de integración con sistemas externos.
 * Maneja:
 *   - Webhooks de SALIDA (Optix notifica eventos a sistemas externos)
 *   - API KEY por workspace (para que sistemas externos lean/escriban en Optix)
 *   - Conectores específicos: Meta, Google Ads, sistemas de socios
 * 
 * FASE A (actual): Estructura base + webhooks de salida simples
 * FASE B (futura): API pública documentada + conectores configurables desde UI
 * 
 * Para conectar el sistema de Gera u otros socios:
 * 1. Registrar un conector en CONNECTORS con la URL del webhook de destino
 * 2. Suscribir el conector a los eventos que le interesan en CONNECTOR_SUBSCRIPTIONS
 * 3. Optix enviará los eventos automáticamente cuando ocurran
 */

import { db, WORKSPACE, generateId, formatDate } from './core.js';
import {
  collection, addDoc, setDoc, doc, getDoc, getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────
// CATÁLOGO DE EVENTOS — Eventos que Optix puede emitir
// Los conectores externos se suscriben a estos eventos.
// ─────────────────────────────────────────
export const OptixEvents = {
  CLIENT_CREATED:       'optix.client.created',
  CLIENT_UPDATED:       'optix.client.updated',
  SEMAFORO_CHANGED:     'optix.semaforo.changed',
  SEMAFORO_RED:         'optix.semaforo.red',        // Alerta especial — semáforo en rojo
  EXPEDIENTE_UPDATED:   'optix.expediente.updated',
  BRIEF_SENT:           'optix.brief.sent',
  WEEK_CLOSED:          'optix.week.closed',
  // Meta
  META_CAMPAIGN_LINKED: 'optix.meta.campaign_linked',
  // Google Ads
  GADS_CAMPAIGN_LINKED: 'optix.gads.campaign_linked',
};

// ─────────────────────────────────────────
// CONECTORES — Sistemas externos registrados
// En fase SaaS: se configuran desde la UI por workspace.
// Por ahora: configuración manual aquí.
// ─────────────────────────────────────────

// Ejemplo de estructura de un conector:
// {
//   id: 'slack-notifications',
//   name: 'Slack Alertas',
//   type: 'webhook',
//   url: 'https://hooks.slack.com/...',
//   active: true,
//   events: ['optix.semaforo.red', 'optix.week.closed'],
//   workspaceId: 'optimizads',
// }

// Conectores activos del workspace (se cargan desde Firestore)
let registeredConnectors = [];

/** Cargar conectores del workspace desde Firestore */
export async function loadConnectors() {
  try {
    const snap = await getDocs(
      collection(db, "workspaces", WORKSPACE.id, "connectors")
    );
    registeredConnectors = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.active === true);
    console.log(`[Integraciones] ${registeredConnectors.length} conectores cargados`);
  } catch(e) {
    console.warn('[Integraciones] Error cargando conectores:', e.message);
  }
  return registeredConnectors;
}

/** Registrar un nuevo conector externo */
export async function registerConnector(connectorConfig) {
  const connector = {
    workspaceId: WORKSPACE.id,
    id: generateId('connector_'),
    active: true,
    createdAt: serverTimestamp(),
    ...connectorConfig,
  };
  
  try {
    await setDoc(
      doc(db, "workspaces", WORKSPACE.id, "connectors", connector.id),
      connector
    );
    registeredConnectors.push(connector);
    console.log('[Integraciones] Conector registrado:', connector.id);
    return connector;
  } catch(e) {
    console.error('[Integraciones] Error registrando conector:', e);
    return null;
  }
}

// ─────────────────────────────────────────
// EMIT — Emitir un evento a todos los conectores suscritos
// Esta es la función principal: cuando algo pasa en Optix,
// llamar emit() y todos los conectores suscritos son notificados.
// ─────────────────────────────────────────
export async function emit(eventName, payload = {}) {
  const event = {
    event: eventName,
    workspaceId: WORKSPACE.id,
    timestamp: new Date().toISOString(),
    payload,
  };

  // Log del evento en Firestore (historial de eventos emitidos)
  try {
    await addDoc(
      collection(db, "workspaces", WORKSPACE.id, "eventLog"),
      { ...event, serverTimestamp: serverTimestamp() }
    );
  } catch(e) {
    console.warn('[Integraciones] Error logging event:', e.message);
  }

  // Notificar a cada conector suscrito a este evento
  const targets = registeredConnectors.filter(
    c => c.active && (c.events || []).includes(eventName)
  );
  
  if (targets.length === 0) {
    console.debug(`[Integraciones] No hay conectores suscritos a: ${eventName}`);
    return;
  }

  // Fire-and-forget: no bloquear la UI por webhooks externos
  targets.forEach(connector => {
    sendWebhook(connector, event).catch(e => {
      console.warn(`[Integraciones] Webhook fallido (${connector.id}):`, e.message);
    });
  });
  
  console.log(`[Integraciones] Evento emitido: ${eventName} → ${targets.length} conectores`);
}

/** Enviar un webhook a un conector específico */
async function sendWebhook(connector, event) {
  if (connector.type !== 'webhook') return;
  
  const response = await fetch(connector.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Optix-Workspace': WORKSPACE.id,
      'X-Optix-Event': event.event,
      // Autenticación básica: secret del conector en el header
      ...(connector.secret ? { 'X-Optix-Secret': connector.secret } : {}),
    },
    body: JSON.stringify(event),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return response;
}

// ─────────────────────────────────────────
// API INBOUND — Recibir datos de sistemas externos
// Fase B: Cloudflare Worker expone un endpoint /api/v1/
// que llama a estas funciones directamente.
// Por ahora: estructura lista para cuando se implemente.
// ─────────────────────────────────────────
export const InboundAPI = {
  /**
   * Crear un cliente desde un sistema externo
   * Endpoint futuro: POST /api/v1/clients
   */
  createClient: async (clientData, apiKey) => {
    if (!validateApiKey(apiKey)) return { error: 'Unauthorized', status: 401 };
    // TODO: Llamar a module-clientes.js createClient()
    return { success: true, message: 'Not yet implemented — Phase B' };
  },
  
  /**
   * Actualizar semáforo desde sistema externo (ej: sistema de Gera)
   * Endpoint futuro: PATCH /api/v1/clients/:id/semaforo
   */
  updateSemaforo: async (clientId, semaforoData, apiKey) => {
    if (!validateApiKey(apiKey)) return { error: 'Unauthorized', status: 401 };
    // TODO: Actualizar semáforo y emitir evento
    return { success: true, message: 'Not yet implemented — Phase B' };
  },
};

/** Validar API key (Fase B: claves por workspace en Firestore) */
async function validateApiKey(apiKey) {
  if (!apiKey) return false;
  // TODO: Verificar contra colección api_keys del workspace
  return false; // Por ahora siempre false hasta que se implemente
}

// ─────────────────────────────────────────
// CONECTORES ESPECÍFICOS — Wrappers de conveniencia
// ─────────────────────────────────────────

/** Notificar que el semáforo de un cliente cambió a rojo */
export function notifySemaforoRed(clientId, clientName) {
  return emit(OptixEvents.SEMAFORO_RED, { clientId, clientName });
}

/** Notificar cierre de semana */
export function notifyWeekClosed(summary) {
  return emit(OptixEvents.WEEK_CLOSED, summary);
}

// ─────────────────────────────────────────
// EXPOSICIÓN GLOBAL
// ─────────────────────────────────────────
window.OptixIntegraciones = {
  emit,
  OptixEvents,
  loadConnectors,
  registerConnector,
  notifySemaforoRed,
  notifyWeekClosed,
  InboundAPI,
};

console.log('[Optix Integraciones] Module initialized');
