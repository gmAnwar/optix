/**
 * OPTIX — Import CSV de objetivos semanales · Vista Tareas → Clientes
 * [OPTIX-TAREAS-CSV-IMPORT]
 *
 * Mario genera objetivos semanales por cliente en una herramienta externa y los
 * sube de un jalón, en vez de capturarlos uno por uno.
 *
 * ── Contrato del CSV (5 columnas, header obligatorio) ──────────────────────
 *   cliente, objetivo, tipo, subtarea, fecha
 *   · cliente  — id o nombre del catálogo (getDefaultClients + clients[]). Obligatorio.
 *   · objetivo — título del objetivo. Obligatorio.
 *   · tipo     — operativo | estrategico | recurrente | compartido. Opcional.
 *   · subtarea — título de la tarea dentro del objetivo. Opcional (fila = objetivo suelto).
 *   · fecha    — YYYY-MM-DD. Opcional. Con fecha se agenda un bloque en Mi Semana.
 *
 * UNA FILA = UNA FECHA. No hay recurrencia: `bloque.recurrencia` está hardcodeado
 * a null y filtrado en mi-semana.js (:1073, :501) — campo muerto, no se toca.
 * Si algo se repite 4 semanas, son 4 filas.
 *
 * ── Mapeo al schema REAL de PROD (verificado contra el código, no asumido) ──
 *   CSV.cliente  → doc id de workspaces/{ws}/tareas-clientes/{clientId}
 *   CSV.objetivo → d.objetivos[].nombre          (el array es `objetivos`)
 *   CSV.tipo     → d.objetivos[].scope           (¡el campo se llama `scope`!)
 *   CSV.subtarea → d.objetivos[].tareas[].texto  (NO existe `subtareas`; el array
 *                  es `tareas` y el campo es `texto`. Las sub-subtareas son peers
 *                  flat del mismo array con parent_task_id — el CSV no las usa.)
 *   CSV.fecha    → calendar-bloques.inicio_ts, con tarea_id = id de la tarea.
 *
 * ── Invariantes ────────────────────────────────────────────────────────────
 *   1. NUNCA tx.set del CSV. Todo pasa por tareasCliSave(clientId, mutator), el
 *      mismo read-modify-write versionado que usa la UI al editar a mano
 *      (tareas.js:1458). Pisar el doc borraría lo que ya había.
 *   2. El plan que se muestra en el preview es una FOTO. La autoridad es el
 *      mutator: re-evalúa duplicados contra el draft fresco de la transacción.
 *   3. Un save por cliente, no uno por fila (evita N bumps de versión y la
 *      tormenta de retries del backoff).
 *   4. Cero cambios al worker y a nada compartido con AurisIQ: Firestore directo
 *      desde la SPA, igual que el resto de Tareas v4.0.
 */

import { escapeHtml } from './utils.js';

// ════════════════════════════════════════════════════════════════════════════
// NÚCLEO PURO — sin window, sin firebase, sin red. Testeable en node.
// ════════════════════════════════════════════════════════════════════════════

// Espejo de TAREAS_CLI_SCOPES (tareas.js:1174). NO se importa para que el
// harness de node pueda cargar este módulo sin ejecutar el top-level de
// tareas.js (que toca window sin guard en :3529). tests/tareas-import.harness.mjs
// lee tareas.js como TEXTO y falla si las dos listas se desincronizan.
export const IMPORT_SCOPES = ['operativo', 'estrategico', 'recurrente', 'compartido'];

export const CSV_COLUMNS = ['cliente', 'objetivo', 'tipo', 'subtarea', 'fecha'];

// Hora default del bloque importado: 9:00 local. El grid de Mi Semana va de
// 8am a 7pm (MS_HORA_INICIO/MS_HORA_FIN, mi-semana.js:327) → 9:00 cae dentro y
// no se pega al borde superior.
export const IMPORT_BLOQUE_HORA = 9;
export const IMPORT_BLOQUE_DURACION_MIN = 60;

/** trim + lowercase + sin acentos. Base de todos los matches por título. */
export function normKey(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parser CSV estilo RFC4180: comillas dobles, comas y saltos de línea dentro
 * de campos citados, "" como comilla escapada, CRLF/LF/CR, BOM.
 * Devuelve array de arrays de strings. Filas totalmente vacías se descartan.
 */
export function parseCsv(text) {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  function endField() { row.push(field); field = ''; }
  function endRow() {
    endField();
    if (row.some(function(c) { return String(c).trim() !== ''; })) rows.push(row);
    row = [];
  }

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  endRow();
  return rows;
}

/**
 * Mapea el header a índices de columna. Tolera acentos, mayúsculas, orden
 * arbitrario y columnas extra (se ignoran). `cliente` y `objetivo` obligatorias.
 * → { ok:true, map:{cliente:0,...} } | { ok:false, error:'...' }
 */
export function mapHeader(headerRow) {
  const aliases = {
    cliente: 'cliente', clientes: 'cliente', client: 'cliente', cliente_id: 'cliente', clientid: 'cliente',
    objetivo: 'objetivo', objetivos: 'objetivo', meta: 'objetivo',
    tipo: 'tipo', scope: 'tipo', etiqueta: 'tipo',
    subtarea: 'subtarea', subtareas: 'subtarea', tarea: 'subtarea', tareas: 'subtarea',
    fecha: 'fecha', dia: 'fecha', date: 'fecha'
  };
  const map = {};
  (headerRow || []).forEach(function(raw, idx) {
    const canon = aliases[normKey(raw)];
    if (canon && map[canon] === undefined) map[canon] = idx;
  });
  if (map.cliente === undefined || map.objetivo === undefined) {
    return {
      ok: false,
      error: 'El header debe traer al menos las columnas `cliente` y `objetivo`. '
        + 'Formato esperado: ' + CSV_COLUMNS.join(', ') + '.'
    };
  }
  return { ok: true, map: map };
}

/** 'Estratégico' → 'estrategico'. Vacío → null (hereda default por rol). Inválido → undefined. */
export function normalizeScope(raw) {
  const k = normKey(raw);
  if (!k) return null;
  if (IMPORT_SCOPES.indexOf(k) !== -1) return k;
  return undefined;
}

/** Valida YYYY-MM-DD y que la fecha exista de verdad (2026-02-30 → null). */
export function parseFechaIso(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const Y = Number(m[1]), M = Number(m[2]), D = Number(m[3]);
  if (M < 1 || M > 12 || D < 1 || D > 31) return undefined;
  const d = new Date(Y, M - 1, D);
  if (d.getFullYear() !== Y || d.getMonth() !== M - 1 || d.getDate() !== D) return undefined;
  return s;
}

/**
 * Resuelve la columna `cliente` contra el catálogo real. Acepta id exacto o
 * nombre (sin acentos/case). NO inventa clientes: lo que no matchea es error de
 * fila. `catalog` = [{id, nombre}, ...].
 */
export function resolveCliente(raw, catalog) {
  const k = normKey(raw);
  if (!k) return null;
  const list = catalog || [];
  let hit = list.find(function(c) { return normKey(c.id) === k; });
  if (hit) return hit.id;
  hit = list.find(function(c) { return normKey(c.nombre) === k; });
  return hit ? hit.id : null;
}

/**
 * Valida y normaliza las filas del CSV. Separa filas buenas de errores; NUNCA
 * aborta todo por una fila mala (Mario ve qué línea corregir y el resto sube).
 * → { filas:[{linea, clientId, objetivo, scope, subtarea, fechaIso}], errores:[{linea, motivo}] }
 */
export function normalizeRows(rows, headerMap, catalog) {
  const filas = [];
  const errores = [];
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    const linea = r + 1; // 1-indexed con header incluido, como lo ve Mario en su editor
    const get = function(col) {
      const idx = headerMap[col];
      return idx === undefined ? '' : String(raw[idx] == null ? '' : raw[idx]).trim();
    };

    const clientId = resolveCliente(get('cliente'), catalog);
    if (!clientId) {
      errores.push({ linea: linea, motivo: 'Cliente no reconocido: "' + get('cliente') + '"' });
      continue;
    }
    const objetivo = get('objetivo');
    if (!objetivo) {
      errores.push({ linea: linea, motivo: 'Falta el objetivo' });
      continue;
    }
    const scope = normalizeScope(get('tipo'));
    if (scope === undefined) {
      errores.push({ linea: linea, motivo: 'Tipo inválido: "' + get('tipo') + '" (válidos: ' + IMPORT_SCOPES.join(', ') + ')' });
      continue;
    }
    const fechaIso = parseFechaIso(get('fecha'));
    if (fechaIso === undefined) {
      errores.push({ linea: linea, motivo: 'Fecha inválida: "' + get('fecha') + '" (formato YYYY-MM-DD)' });
      continue;
    }
    filas.push({
      linea: linea,
      clientId: clientId,
      objetivo: objetivo,
      scope: scope,
      subtarea: get('subtarea'),
      fechaIso: fechaIso
    });
  }
  return { filas: filas, errores: errores };
}

/**
 * ══ CORAZÓN DEL IMPORT ══
 * Aplica las filas de UN cliente sobre su draft. Mutador puro: recibe el doc
 * (ya clonado por tareasCliSave) y lo devuelve modificado + el detalle de lo
 * que hizo. Se ejecuta DENTRO de la transacción, así que re-evalúa duplicados
 * contra la versión fresca — el preview nunca es la autoridad.
 *
 * @param d           draft del doc tareas-clientes/{clientId}
 * @param filas       filas normalizadas de ESE cliente
 * @param opts.mkId   () => string, inyectable para tests deterministas
 * @param opts.owner  {owner_uid, owner_label, shared} de tareasCliNewOwnerFields
 * @param opts.nowIso timestamp ISO para createdAt/updatedAt
 */
export function applyRowsToDraft(d, filas, opts) {
  opts = opts || {};
  const mkId = opts.mkId || function() { return 'id-' + Math.random().toString(36).slice(2); };
  const owner = opts.owner || { owner_uid: null, owner_label: '', shared: true };
  const nowIso = opts.nowIso || new Date().toISOString();

  if (!Array.isArray(d.objetivos)) d.objetivos = [];

  const detalle = [];
  filas.forEach(function(f) {
    const item = { linea: f.linea, clientId: f.clientId, objetivo: f.objetivo, subtarea: f.subtarea, fechaIso: f.fechaIso };

    // ── Objetivo: match por título normalizado dentro del cliente ──
    const objKey = normKey(f.objetivo);
    let o = d.objetivos.find(function(x) { return normKey(x.nombre) === objKey; });
    if (!o) {
      o = {
        id: mkId('obj'),
        nombre: f.objetivo,
        collapsed: false,
        orden: d.objetivos.length,
        // scope null (columna vacía) → 'compartido', el mismo fallback defensivo
        // de tareasCliAddObjetivo cuando el valor no es válido.
        scope: f.scope || 'compartido',
        owner_uid: owner.owner_uid,
        owner_label: owner.owner_label,
        shared: owner.shared,
        tareas: []
      };
      d.objetivos.push(o);
      item.objetivo_estado = 'nuevo';
    } else {
      item.objetivo_estado = 'existente';
      // El import NO reclasifica objetivos vivos: cambiar el scope movería el
      // objetivo entre los chips de la UI sin que nadie lo pidiera. Se reporta.
      if (f.scope && (o.scope || 'compartido') !== f.scope) {
        item.aviso = 'El objetivo ya existía con tipo "' + (o.scope || 'compartido') + '"; el CSV decía "' + f.scope + '". Se conservó el existente.';
      }
    }
    item.objetivoId = o.id;

    // ── Subtarea: match por texto normalizado dentro del objetivo ──
    if (!f.subtarea) {
      item.subtarea_estado = 'sin_subtarea';
      detalle.push(item);
      return;
    }
    if (!Array.isArray(o.tareas)) o.tareas = [];
    const subKey = normKey(f.subtarea);
    // Compara contra TODAS las entradas de o.tareas[], con y sin parent_task_id:
    // un mismo texto colgando de otro padre sigue siendo un duplicado para Mario.
    let t = o.tareas.find(function(x) { return normKey(x.texto) === subKey; });
    if (!t) {
      t = {
        id: mkId('tarea'),
        texto: f.subtarea,
        completado: false,
        fechaIdeal: null,
        fechaLimite: null,
        notas: '',
        responsibleUsers: [],
        orden: o.tareas.length,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      o.tareas.push(t);
      item.subtarea_estado = 'nueva';
    } else {
      item.subtarea_estado = 'duplicada';
    }
    item.tareaId = t.id;
    detalle.push(item);
  });

  return { doc: d, detalle: detalle };
}

/** 'YYYY-MM-DD' local de un inicio_ts (Timestamp de Firestore, Date o millis). */
export function bloqueFechaKey(inicio_ts) {
  if (!inicio_ts) return null;
  let dt = null;
  if (typeof inicio_ts.toDate === 'function') dt = inicio_ts.toDate();
  else if (inicio_ts instanceof Date) dt = inicio_ts;
  else if (typeof inicio_ts.seconds === 'number') dt = new Date(inicio_ts.seconds * 1000);
  else if (typeof inicio_ts === 'number') dt = new Date(inicio_ts);
  if (!dt || isNaN(dt.getTime())) return null;
  return dt.getFullYear() + '-'
    + String(dt.getMonth() + 1).padStart(2, '0') + '-'
    + String(dt.getDate()).padStart(2, '0');
}

/** Llave de deduplicación de bloque: una subtarea + un día = un bloque. */
export function bloqueKey(tareaId, fechaIso) { return String(tareaId) + '|' + String(fechaIso); }

/**
 * Decide qué bloques faltan, a partir del detalle de applyRowsToDraft y de las
 * llaves ya existentes en calendar-bloques.
 * → { crear:[{linea, clientId, objetivoId, tareaId, titulo, fechaIso}], detalle mutado }
 */
export function planBloques(detalle, existentes) {
  const yaVistos = new Set();
  const crear = [];
  (detalle || []).forEach(function(item) {
    if (!item.fechaIso) { item.bloque_estado = 'sin_fecha'; return; }
    if (!item.tareaId) {
      // Fila con fecha pero sin subtarea: bloque.tarea_id apunta a una tarea, no
      // a un objetivo. Sin subtarea no hay a qué colgar el bloque.
      item.bloque_estado = 'sin_subtarea';
      return;
    }
    const k = bloqueKey(item.tareaId, item.fechaIso);
    if ((existentes && existentes.has(k)) || yaVistos.has(k)) {
      item.bloque_estado = 'duplicado';
      return;
    }
    yaVistos.add(k);
    item.bloque_estado = 'nuevo';
    crear.push({
      linea: item.linea,
      clientId: item.clientId,
      objetivoId: item.objetivoId,
      objetivo: item.objetivo,
      tareaId: item.tareaId,
      titulo: item.subtarea,
      fechaIso: item.fechaIso
    });
  });
  return { crear: crear, detalle: detalle };
}

/** Cuenta el resumen que ve Mario al terminar. */
export function resumirDetalle(detalle, errores) {
  const r = {
    objetivosNuevos: 0, objetivosExistentes: 0,
    subtareasNuevas: 0, subtareasDuplicadas: 0, filasSinSubtarea: 0,
    bloquesNuevos: 0, bloquesDuplicados: 0, bloquesSinSubtarea: 0,
    avisos: 0, errores: (errores || []).length
  };
  const objNuevosVistos = new Set();
  (detalle || []).forEach(function(it) {
    if (it.objetivo_estado === 'nuevo' && !objNuevosVistos.has(it.objetivoId)) {
      objNuevosVistos.add(it.objetivoId);
      r.objetivosNuevos++;
    } else if (it.objetivo_estado === 'existente') {
      r.objetivosExistentes++;
    }
    if (it.subtarea_estado === 'nueva') r.subtareasNuevas++;
    else if (it.subtarea_estado === 'duplicada') r.subtareasDuplicadas++;
    else if (it.subtarea_estado === 'sin_subtarea') r.filasSinSubtarea++;
    if (it.bloque_estado === 'nuevo') r.bloquesNuevos++;
    else if (it.bloque_estado === 'duplicado') r.bloquesDuplicados++;
    else if (it.bloque_estado === 'sin_subtarea') r.bloquesSinSubtarea++;
    if (it.aviso) r.avisos++;
  });
  return r;
}

/** Agrupa filas normalizadas por clientId, preservando el orden del CSV. */
export function agruparPorCliente(filas) {
  const out = new Map();
  (filas || []).forEach(function(f) {
    if (!out.has(f.clientId)) out.set(f.clientId, []);
    out.get(f.clientId).push(f);
  });
  return out;
}

/** CSV de ejemplo que se ofrece como plantilla descargable en el modal. */
export function plantillaCsv() {
  return CSV_COLUMNS.join(',') + '\n'
    + 'enpagos,Reactivar preautorizados de julio,operativo,"Listar preaut+ estancados >14 días",2026-08-31\n'
    + 'enpagos,Reactivar preautorizados de julio,operativo,Llamar al top 20 del listado,2026-09-01\n'
    + 'inmobili,Cierre de mes Monterrey,estrategico,Revisar CAC por plaza,2026-09-02\n'
    + 'inmobili,Cierre de mes Monterrey,estrategico,Junta de resultados con la plaza,\n'
    + 'inmobili,Rutina semanal de captaciones,recurrente,Barrido de adsets sin doc,2026-09-01\n';
}

// ════════════════════════════════════════════════════════════════════════════
// CAPA FIRESTORE — read-modify-write vía tareasCliSave. Nada de tx.set directo.
// ════════════════════════════════════════════════════════════════════════════

/** Catálogo real de clientes del workspace: defaults + dinámicos (mismo criterio que renderTareasCli). */
function _catalogoClientes() {
  const wsId = (typeof window !== 'undefined' && window.currentAgencia) || 'optimizads';
  const _defaults = (typeof window.getDefaultClients === 'function' ? window.getDefaultClients(wsId) : [])
    .filter(function(c) { return c.workspaceId === wsId; });
  const _ids = new Set(_defaults.map(function(c) { return c.id; }));
  const _dynamic = (Array.isArray(window.clients) ? window.clients : [])
    .filter(function(c) { return c.workspaceId === wsId && !_ids.has(c.id); });
  return _defaults.concat(_dynamic).map(function(c) { return { id: c.id, nombre: c.nombre || c.id }; });
}

/**
 * Campos de dueño para los objetivos nuevos — MISMA fábrica que usa la UI al
 * crear a mano (tareas.js:tareasCliNewOwnerFields, expuesta en initTareas).
 * Falla RUIDOSO en vez de degradar: un objetivo con owner_uid null se ve legacy,
 * desaparece del filtro 'mios' y nadie se entera hasta que Mario lo busca.
 */
function _ownerFields() {
  if (typeof window.tareasCliNewOwnerFields !== 'function') {
    throw new Error('tareasCliNewOwnerFields no disponible — ¿initTareas() no corrió? '
      + 'El import se aborta: crear objetivos sin dueño rompería el filtro por dueño (S90).');
  }
  return window.tareasCliNewOwnerFields(undefined);
}

function _mkIdFactory() {
  let n = 0;
  return function(prefix) {
    n++;
    return (prefix === 'obj' ? 'obj-' : 'tarea-') + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + n;
  };
}

/**
 * Lee las llaves tarea_id|fecha de los bloques YA existentes del usuario.
 * Lectura fresca de Firestore (no del cache) — el cache de Mi Semana puede no
 * estar hidratado si nunca se abrió la pantalla en esta sesión.
 */
async function _leerBloquesExistentes() {
  const out = new Set();
  const uid = (window.currentUser && window.currentUser.uid) || null;
  if (!uid || !window.calendarSemana || typeof window.calendarSemana.col !== 'function') return out;
  const col = window.calendarSemana.col();
  if (!col) return out;
  const snap = await col.where('assigned_to', '==', uid).get();
  snap.forEach(function(doc) {
    const b = doc.data() || {};
    if (!b.tarea_id) return;
    const fk = bloqueFechaKey(b.inicio_ts);
    if (fk) out.add(bloqueKey(b.tarea_id, fk));
  });
  return out;
}

/** Lee el draft actual de un cliente, fresco desde Firestore. */
async function _leerDraft(clientId) {
  const ref = window.tareasCli && typeof window.tareasCli.ref === 'function'
    ? window.tareasCli.ref(clientId) : null;
  if (!ref) return null;
  const snap = await ref.get();
  return snap.exists ? snap.data() : (window.tareasCli.emptyDoc ? window.tareasCli.emptyDoc(clientId) : { clientId: clientId, objetivos: [] });
}

/**
 * DRY-RUN. Simula el import sobre copias de los drafts reales, sin escribir
 * nada. Es lo que alimenta el preview del modal.
 */
export async function simularImport(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { ok: false, error: 'El CSV está vacío.' };
  const h = mapHeader(rows[0]);
  if (!h.ok) return { ok: false, error: h.error };

  const catalog = _catalogoClientes();
  const norm = normalizeRows(rows, h.map, catalog);
  const porCliente = agruparPorCliente(norm.filas);

  const owner = _ownerFields();

  let detalle = [];
  for (const [clientId, filas] of porCliente) {
    const draft = await _leerDraft(clientId);
    if (!draft) {
      norm.errores.push({ linea: filas[0].linea, motivo: 'No se pudo leer tareas-clientes/' + clientId + ' (¿sesión caducada?)' });
      continue;
    }
    // Copia profunda: el dry-run no toca el objeto leído.
    const res = applyRowsToDraft(JSON.parse(JSON.stringify(draft)), filas, {
      mkId: _mkIdFactory(), owner: owner
    });
    detalle = detalle.concat(res.detalle);
  }

  const existentes = await _leerBloquesExistentes();
  planBloques(detalle, existentes);
  detalle.sort(function(a, b) { return a.linea - b.linea; });

  return {
    ok: true,
    csvText: csvText,
    detalle: detalle,
    errores: norm.errores,
    resumen: resumirDetalle(detalle, norm.errores),
    clientes: Array.from(porCliente.keys())
  };
}

/**
 * APLICA. Un tareasCliSave por cliente (read-modify-write versionado), y luego
 * los bloques con los ids REALES que devolvió cada transacción.
 */
export async function aplicarImport(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { ok: false, error: 'El CSV está vacío.' };
  const h = mapHeader(rows[0]);
  if (!h.ok) return { ok: false, error: h.error };

  const catalog = _catalogoClientes();
  const norm = normalizeRows(rows, h.map, catalog);
  const porCliente = agruparPorCliente(norm.filas);
  const errores = norm.errores.slice();

  const owner = _ownerFields();

  let detalle = [];
  for (const [clientId, filas] of porCliente) {
    let capturado = null;
    // El mutator recibe el draft FRESCO de la transacción y vuelve a decidir
    // duplicados ahí dentro: si alguien creó el mismo objetivo entre el preview
    // y el submit, no se duplica.
    const saved = await window.tareasCliSave(clientId, function(d) {
      const res = applyRowsToDraft(d, filas, { mkId: _mkIdFactory(), owner: owner });
      capturado = res.detalle;
      return res.doc;
    });
    if (!saved) {
      errores.push({ linea: filas[0].linea, motivo: 'No se pudo guardar ' + clientId + ' (conflicto de versión tras 3 reintentos). Ninguna de sus ' + filas.length + ' fila(s) se aplicó.' });
      continue;
    }
    if (capturado) detalle = detalle.concat(capturado);
  }

  // Bloques: después del save, con los ids reales ya persistidos.
  const existentes = await _leerBloquesExistentes();
  const plan = planBloques(detalle, existentes);
  for (const b of plan.crear) {
    try {
      await window.calendarSemana.createBloque({
        cliente_id: b.clientId,
        objetivo_id: b.objetivoId,
        objetivo_titulo: b.objetivo,
        tarea_id: b.tareaId,
        titulo: b.titulo,
        inicio_ts: _buildInicioTs(b.fechaIso),
        duracion_minutos: IMPORT_BLOQUE_DURACION_MIN
      });
    } catch (e) {
      const it = detalle.find(function(x) { return x.linea === b.linea; });
      if (it) it.bloque_estado = 'error';
      errores.push({ linea: b.linea, motivo: 'No se pudo crear el bloque: ' + (e && e.message ? e.message : e) });
    }
  }

  detalle.sort(function(a, b2) { return a.linea - b2.linea; });
  if (typeof window.renderTareasCli === 'function') { try { window.renderTareasCli(); } catch (e) {} }

  return { ok: true, detalle: detalle, errores: errores, resumen: resumirDetalle(detalle, errores) };
}

/** Timestamp local a IMPORT_BLOQUE_HORA del día indicado. */
function _buildInicioTs(fechaIso) {
  const p = fechaIso.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2], IMPORT_BLOQUE_HORA, 0, 0, 0);
  return firebase.firestore.Timestamp.fromDate(d);
}

// ════════════════════════════════════════════════════════════════════════════
// UI — modal de 2 pasos: pegar/subir CSV → preview (dry-run) → confirmar.
// ════════════════════════════════════════════════════════════════════════════

const MODAL_ID = 'tareas-import-modal';
let _ultimaSimulacion = null;

function _cerrarModal() {
  const el = document.getElementById(MODAL_ID);
  if (el) el.remove();
  _ultimaSimulacion = null;
}

const _BADGES = {
  nuevo:         { bg: 'rgba(34,197,94,0.16)',  fg: '#22c55e', txt: 'NUEVO' },
  nueva:         { bg: 'rgba(34,197,94,0.16)',  fg: '#22c55e', txt: 'NUEVA' },
  existente:     { bg: 'rgba(148,163,184,0.16)', fg: 'var(--text3)', txt: 'YA EXISTÍA' },
  duplicada:     { bg: 'rgba(234,179,8,0.16)',  fg: '#eab308', txt: 'DUPLICADA · SE SALTA' },
  duplicado:     { bg: 'rgba(234,179,8,0.16)',  fg: '#eab308', txt: 'YA AGENDADO' },
  sin_subtarea:  { bg: 'rgba(234,179,8,0.16)',  fg: '#eab308', txt: 'SIN SUBTAREA → SIN BLOQUE' },
  sin_fecha:     { bg: 'rgba(148,163,184,0.12)', fg: 'var(--text3)', txt: 'SIN FECHA' },
  error:         { bg: 'rgba(239,68,68,0.16)',  fg: '#ef4444', txt: 'ERROR' }
};

function _badge(estado) {
  const b = _BADGES[estado];
  if (!b) return '';
  return '<span style="display:inline-block;background:' + b.bg + ';color:' + b.fg
    + ';font-family:\'DM Mono\',monospace;font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;letter-spacing:0.04em;white-space:nowrap;">'
    + b.txt + '</span>';
}

function _resumenHtml(r, titulo) {
  const chip = function(n, label, color) {
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;min-width:96px;">'
      + '<div style="font-family:\'Syne\',sans-serif;font-weight:800;font-size:20px;color:' + color + ';line-height:1;">' + n + '</div>'
      + '<div style="font-size:10px;color:var(--text3);margin-top:3px;line-height:1.3;">' + label + '</div>'
      + '</div>';
  };
  return '<div style="margin-bottom:14px;">'
    + '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">' + titulo + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + chip(r.objetivosNuevos, 'objetivos nuevos', '#22c55e')
    + chip(r.subtareasNuevas, 'subtareas nuevas', '#22c55e')
    + chip(r.subtareasDuplicadas, 'saltadas por duplicado', '#eab308')
    + chip(r.bloquesNuevos, 'bloques en calendario', '#3b82f6')
    + chip(r.bloquesDuplicados, 'bloques ya agendados', '#eab308')
    + chip(r.errores, 'filas con error', r.errores ? '#ef4444' : 'var(--text3)')
    + '</div></div>';
}

function _tablaHtml(detalle, errores) {
  const filas = (detalle || []).map(function(it) {
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);vertical-align:top;">' + it.linea + '</td>'
      + '<td style="padding:6px 8px;font-size:11px;color:var(--text2);vertical-align:top;white-space:nowrap;">' + escapeHtml(it.clientId) + '</td>'
      + '<td style="padding:6px 8px;font-size:11px;color:var(--text);vertical-align:top;">'
      +   escapeHtml(it.objetivo) + ' ' + _badge(it.objetivo_estado)
      +   (it.subtarea ? '<div style="color:var(--text2);margin-top:3px;padding-left:10px;border-left:2px solid var(--border);">▸ ' + escapeHtml(it.subtarea) + ' ' + _badge(it.subtarea_estado) + '</div>' : '')
      +   (it.aviso ? '<div style="color:#eab308;font-size:10px;margin-top:3px;">⚠ ' + escapeHtml(it.aviso) + '</div>' : '')
      + '</td>'
      + '<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text2);vertical-align:top;white-space:nowrap;">'
      +   (it.fechaIso ? escapeHtml(it.fechaIso) + '<br>' + _badge(it.bloque_estado) : _badge('sin_fecha'))
      + '</td>'
      + '</tr>';
  }).join('');

  const errHtml = (errores && errores.length)
    ? '<div style="margin-top:14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:10px 12px;">'
      + '<div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:6px;">' + errores.length + ' fila(s) con error — se omiten, el resto sí sube</div>'
      + errores.map(function(e) {
          return '<div style="font-size:11px;color:var(--text2);line-height:1.6;"><span style="font-family:\'DM Mono\',monospace;color:var(--text3);">línea ' + e.linea + '</span> · ' + escapeHtml(e.motivo) + '</div>';
        }).join('')
      + '</div>'
    : '';

  return (filas
      ? '<div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
        + '<table style="width:100%;border-collapse:collapse;">'
        + '<thead><tr style="position:sticky;top:0;background:var(--surface2);">'
        + ['#', 'Cliente', 'Objetivo · subtarea', 'Fecha'].map(function(t) {
            return '<th style="padding:7px 8px;text-align:left;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">' + t + '</th>';
          }).join('')
        + '</tr></thead><tbody>' + filas + '</tbody></table></div>'
      : '<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px;">Ninguna fila válida para aplicar.</div>')
    + errHtml;
}

function _shell(inner, width) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;width:' + (width || 760) + 'px;max-width:94vw;box-shadow:0 12px 32px rgba(0,0,0,0.5);">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'
    +   '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;color:var(--text);">📥 Importar objetivos desde CSV</div>'
    +   '<button onclick="tareasImportClose()" style="background:transparent;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px 8px;">×</button>'
    + '</div>' + inner + '</div>';
}

/** Paso 1: pegar o subir el CSV. */
export function tareasImportShowModal() {
  _cerrarModal();
  const el = document.createElement('div');
  el.id = MODAL_ID;
  el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif;';
  el.innerHTML = _shell(''
    + '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--text3);margin-bottom:16px;line-height:1.6;">'
    +   'Columnas: <strong style="color:var(--text2);">' + CSV_COLUMNS.join(' · ') + '</strong><br>'
    +   '<span style="color:var(--text3);">tipo</span>: ' + IMPORT_SCOPES.join(' | ') + ' · <span style="color:var(--text3);">fecha</span>: YYYY-MM-DD (opcional; agenda el bloque en Mi Semana a las ' + IMPORT_BLOQUE_HORA + ':00)<br>'
    +   'Una fila = una fecha. Si algo se repite 4 semanas, son 4 filas.'
    + '</div>'
    + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">'
    +   '<input type="file" id="tareas-import-file" accept=".csv,text/csv" style="font-size:11px;color:var(--text2);flex:1;">'
    +   '<button onclick="tareasImportDescargarPlantilla()" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">⬇ Plantilla</button>'
    + '</div>'
    + '<textarea id="tareas-import-text" rows="10" placeholder="…o pega aquí el CSV (con su fila de encabezado)" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:8px;font-family:\'DM Mono\',monospace;font-size:11px;outline:none;resize:vertical;margin-bottom:8px;"></textarea>'
    + '<div id="tareas-import-msg" style="font-size:11px;color:#ef4444;min-height:16px;margin-bottom:10px;"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +   '<button onclick="tareasImportClose()" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;">Cancelar</button>'
    +   '<button id="tareas-import-analizar" onclick="tareasImportAnalizar()" style="background:var(--accent);border:none;color:#000;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Analizar →</button>'
    + '</div>');
  document.body.appendChild(el);
  el.onclick = function(ev) { if (ev.target === el) _cerrarModal(); };

  const file = document.getElementById('tareas-import-file');
  if (file) file.onchange = function() {
    const f = file.files && file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function() {
      const ta = document.getElementById('tareas-import-text');
      if (ta) ta.value = String(reader.result || '');
    };
    reader.readAsText(f);
  };
}

export function tareasImportDescargarPlantilla() {
  const blob = new Blob([plantillaCsv()], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'optix-objetivos-semanales.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/** Paso 2: dry-run + preview. No escribe nada. */
export async function tareasImportAnalizar() {
  const ta = document.getElementById('tareas-import-text');
  const msg = document.getElementById('tareas-import-msg');
  const btn = document.getElementById('tareas-import-analizar');
  const texto = ta ? ta.value : '';
  if (!String(texto).trim()) { if (msg) msg.textContent = 'Pega el CSV o elige un archivo.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  if (msg) msg.textContent = '';

  let sim;
  try {
    sim = await simularImport(texto);
  } catch (e) {
    if (msg) msg.textContent = 'Error leyendo Firestore: ' + (e && e.message ? e.message : e);
    if (btn) { btn.disabled = false; btn.textContent = 'Analizar →'; }
    return;
  }
  if (!sim.ok) {
    if (msg) msg.textContent = sim.error;
    if (btn) { btn.disabled = false; btn.textContent = 'Analizar →'; }
    return;
  }
  _ultimaSimulacion = sim;

  const hayQueAplicar = sim.resumen.objetivosNuevos || sim.resumen.subtareasNuevas || sim.resumen.bloquesNuevos;
  const el = document.getElementById(MODAL_ID);
  if (!el) return;
  el.innerHTML = _shell(''
    + '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--text3);margin-bottom:14px;">'
    +   'PREVIEW · nada escrito todavía · ' + sim.clientes.length + ' cliente(s)'
    + '</div>'
    + _resumenHtml(sim.resumen, 'Se va a aplicar')
    + _tablaHtml(sim.detalle, sim.errores)
    + '<div id="tareas-import-msg" style="font-size:11px;color:#ef4444;min-height:16px;margin-top:10px;"></div>'
    + '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:12px;">'
    +   '<button onclick="tareasImportShowModal()" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;">← Volver</button>'
    +   '<button id="tareas-import-confirmar" onclick="tareasImportConfirmar()" ' + (hayQueAplicar ? '' : 'disabled ')
    +     'style="background:' + (hayQueAplicar ? 'var(--accent)' : 'var(--surface2)') + ';border:none;color:' + (hayQueAplicar ? '#000' : 'var(--text3)') + ';padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:' + (hayQueAplicar ? 'pointer' : 'not-allowed') + ';">'
    +     (hayQueAplicar ? 'Subir a Optix' : 'Nada que subir') + '</button>'
    + '</div>');
}

/** Paso 3: aplicar de verdad + resumen de lo que pasó. */
export async function tareasImportConfirmar() {
  if (!_ultimaSimulacion) return;
  const csvText = _ultimaSimulacion.csvText;
  const btn = document.getElementById('tareas-import-confirmar');
  const msg = document.getElementById('tareas-import-msg');
  if (btn) { btn.disabled = true; btn.textContent = 'Subiendo…'; }

  let res;
  try {
    res = await aplicarImport(csvText);
  } catch (e) {
    if (msg) msg.textContent = 'Error al subir: ' + (e && e.message ? e.message : e);
    if (btn) { btn.disabled = false; btn.textContent = 'Subir a Optix'; }
    return;
  }
  if (!res.ok) {
    if (msg) msg.textContent = res.error;
    if (btn) { btn.disabled = false; btn.textContent = 'Subir a Optix'; }
    return;
  }

  const el = document.getElementById(MODAL_ID);
  if (!el) return;
  el.innerHTML = _shell(''
    + '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:#22c55e;margin-bottom:14px;">✓ SUBIDA COMPLETA</div>'
    + _resumenHtml(res.resumen, 'Resultado')
    + _tablaHtml(res.detalle, res.errores)
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">'
    +   '<button onclick="tareasImportShowModal()" style="background:transparent;border:1px solid var(--border);color:var(--text2);padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;">Subir otro CSV</button>'
    +   '<button onclick="tareasImportClose()" style="background:var(--accent);border:none;color:#000;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Listo</button>'
    + '</div>');
}

// ════════════════════════════════════════════════════════════════════════════
// INIT — window-compat para los onclick inline (mismo patrón que tareas.js).
// ════════════════════════════════════════════════════════════════════════════

let __importInitialized = false;

export function init() {
  if (__importInitialized) return;
  __importInitialized = true;
  window.tareasImportShowModal = tareasImportShowModal;
  window.tareasImportAnalizar = tareasImportAnalizar;
  window.tareasImportConfirmar = tareasImportConfirmar;
  window.tareasImportDescargarPlantilla = tareasImportDescargarPlantilla;
  window.tareasImportClose = _cerrarModal;
  // API de consola, para depurar sin pasar por el modal.
  window.tareasImport = {
    simular: simularImport,
    aplicar: aplicarImport,
    plantilla: plantillaCsv,
    parseCsv: parseCsv
  };
}
