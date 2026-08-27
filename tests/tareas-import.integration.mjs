// ═══════════════════════════════════════════════════════════════════════════
// INTEGRACIÓN node — Import CSV contra el save REAL [OPTIX-TAREAS-CSV-IMPORT]
//
// El harness hermano (tareas-import.harness.mjs) prueba funciones puras. Este
// prueba lo que de verdad da miedo: que el import escriba a través del
// read-modify-write de PRODUCCIÓN sin pisar lo que ya había.
//
// Lo único falso aquí es Firestore. Todo lo demás es el código real:
//   · tareasCliSave        (modules/tareas.js)      — transacción + versionado
//   · _msCreateBloque      (modules/mi-semana.js)   — alta en calendar-bloques
//   · aplicarImport        (modules/tareas-import.js)
// Se cargan los módulos de verdad sobre un stub mínimo de window/document.
//
// Correr:  node tests/tareas-import.integration.mjs
// Exit 0 = todos PASS · exit 1 = algún FAIL.
// ═══════════════════════════════════════════════════════════════════════════

let pass = 0;
let fail = 0;
const resultados = [];
function caso(nombre, cond, detalle) {
  if (cond) { pass += 1; resultados.push(`PASS ${nombre}`); }
  else { fail += 1; resultados.push(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

// ── Firestore falso: docs en memoria + runTransaction con semántica real ──
const STORE = new Map();              // 'path/to/doc' → data
let writeCount = 0;

function makeRef(path) {
  return {
    _path: path,
    async get() {
      const has = STORE.has(path);
      return { exists: has, data: () => (has ? JSON.parse(JSON.stringify(STORE.get(path))) : undefined) };
    },
  };
}
function makeCol(path) {
  return {
    _path: path,
    doc: (id) => makeDoc(`${path}/${id}`),
    where(field, _op, value) {
      return {
        async get() {
          const docs = [];
          for (const [k, v] of STORE) {
            if (!k.startsWith(path + '/')) continue;
            if (k.slice(path.length + 1).includes('/')) continue;
            if (v[field] !== value) continue;
            docs.push({ id: k.split('/').pop(), data: () => v });
          }
          return { forEach: (fn) => docs.forEach(fn), size: docs.length };
        },
      };
    },
  };
}
function makeDoc(path) {
  return Object.assign(makeRef(path), { collection: (name) => makeCol(`${path}/${name}`) });
}

const fakeDb = {
  collection: (name) => makeCol(name),
  async runTransaction(fn) {
    const tx = {
      async get(ref) {
        const has = STORE.has(ref._path);
        return { exists: has, data: () => (has ? JSON.parse(JSON.stringify(STORE.get(ref._path))) : undefined) };
      },
      set(ref, data) { STORE.set(ref._path, JSON.parse(JSON.stringify(data))); writeCount += 1; },
    };
    return fn(tx);
  },
};

// ── Stubs mínimos de browser ─────────────────────────────────────────────
const _ls = new Map();
const win = {
  addEventListener() {},
  localStorage: {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
  },
  innerWidth: 1440,
  currentUser: { uid: 'uid-mario' },
  currentUserProfile: { rol: 'junior', nombre: 'Mario' },
  currentAgencia: 'optimizads',
  firebaseDb: fakeDb,
};
win.window = win;

globalThis.window = win;
globalThis.localStorage = win.localStorage;
globalThis.currentUser = win.currentUser;
globalThis.currentAgencia = 'optimizads';
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, setAttribute() {} }),
  addEventListener() {},
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.firebase = {
  firestore: {
    FieldValue: { serverTimestamp: () => ({ __server: true }) },
    Timestamp: {
      fromDate: (d) => ({ __ts: true, seconds: Math.floor(d.getTime() / 1000), toDate: () => d }),
    },
  },
};
globalThis.firebase.firestore.Timestamp.prototype = {};

// Catálogo de clientes (mismo shape que DEFAULT_CLIENTS_OPTIMIZADS).
const CLIENTES = [
  { id: 'enpagos', workspaceId: 'optimizads', nombre: 'EnPagos' },
  { id: 'inmobili', workspaceId: 'optimizads', nombre: 'Inmobili' },
];
win.getDefaultClients = () => CLIENTES;
win.clients = CLIENTES;
globalThis.getDefaultClients = win.getDefaultClients;
globalThis.clients = CLIENTES;

// ── Cargar los módulos REALES ────────────────────────────────────────────
// Mismo orden que el bootstrap de index.html: initTareas() → __initMiSemana().
await import('../modules/tareas.js');
win.initTareas();
const miSemana = await import('../modules/mi-semana.js');
miSemana.init();
const { aplicarImport, simularImport } = await import('../modules/tareas-import.js');

caso('setup · tareasCliSave real disponible', typeof win.tareasCliSave === 'function');
caso('setup · tareasCliNewOwnerFields real disponible', typeof win.tareasCliNewOwnerFields === 'function');
caso('setup · calendarSemana.createBloque real disponible', typeof win.calendarSemana?.createBloque === 'function');

const DOC = 'workspaces/optimizados/tareas-clientes/enpagos'.replace('optimizados', 'optimizads');
const BLOQUES = 'workspaces/optimizads/calendar-bloques';

// ── Estado previo: lo que Anwar YA tenía capturado a mano ────────────────
STORE.set(DOC, {
  clientId: 'enpagos', orden: 0, collapsed: false, version: 12,
  updatedAt: null, updatedBy: 'uid-anwar',
  objetivos: [{
    id: 'obj-preexistente', nombre: 'Auditoría JULIO26', collapsed: false, orden: 0,
    scope: 'estrategico', owner_uid: 'uid-anwar', owner_label: 'A', shared: true,
    tareas: [
      { id: 'tarea-preexistente', texto: 'Cerrar gate 60/60', completado: true, orden: 0, notas: 'no me toques' },
    ],
  }],
});
const ANTES = JSON.parse(JSON.stringify(STORE.get(DOC)));

const CSV = [
  'cliente,objetivo,tipo,subtarea,fecha',
  'EnPagos,"Reactivar preautorizados, cohorte julio",operativo,Listar estancados,2026-09-01',
  'EnPagos,"Reactivar preautorizados, cohorte julio",operativo,Llamar al top 20,2026-09-02',
  'EnPagos,Auditoría JULIO26,estrategico,Cerrar gate 60/60,',          // objetivo Y subtarea ya existen
  'EnPagos,Auditoría JULIO26,estrategico,Revisar autofilter,2026-09-03', // objetivo existe, subtarea nueva
  'Inmobili,Cierre de mes Monterrey,estrategico,Revisar CAC por plaza,2026-09-01',
  'acme,Objetivo huérfano,operativo,x,2026-09-01',                      // cliente inexistente
].join('\n');

// ── DRY-RUN: no debe escribir NADA ───────────────────────────────────────
{
  const writesAntes = writeCount;
  const sim = await simularImport(CSV);
  caso('dry-run · ok', sim.ok === true, JSON.stringify(sim.error));
  caso('dry-run · CERO escrituras', writeCount === writesAntes, `writes=${writeCount - writesAntes}`);
  caso('dry-run · doc intacto byte a byte', JSON.stringify(STORE.get(DOC)) === JSON.stringify(ANTES));
  caso('dry-run · predice 2 objetivos nuevos', sim.resumen.objetivosNuevos === 2, JSON.stringify(sim.resumen));
  caso('dry-run · predice 4 subtareas nuevas', sim.resumen.subtareasNuevas === 4, JSON.stringify(sim.resumen));
  caso('dry-run · predice 1 duplicada', sim.resumen.subtareasDuplicadas === 1);
  caso('dry-run · predice 4 bloques', sim.resumen.bloquesNuevos === 4, JSON.stringify(sim.resumen));
  caso('dry-run · reporta el cliente inválido', sim.resumen.errores === 1 && sim.errores[0].motivo.includes('acme'));
}

// ── APLICAR ──────────────────────────────────────────────────────────────
const res1 = await aplicarImport(CSV);
{
  caso('aplicar · ok', res1.ok === true);
  const d = STORE.get(DOC);

  // EL invariante: nada de lo previo se perdió.
  const viejo = d.objetivos.find((o) => o.id === 'obj-preexistente');
  caso('aplicar · objetivo preexistente sigue vivo', !!viejo);
  caso('aplicar · su scope NO fue reclasificado', viejo && viejo.scope === 'estrategico');
  caso('aplicar · su owner NO fue reasignado', viejo && viejo.owner_uid === 'uid-anwar');
  const tareaVieja = viejo && viejo.tareas.find((t) => t.id === 'tarea-preexistente');
  caso('aplicar · tarea preexistente intacta',
    !!tareaVieja && tareaVieja.completado === true && tareaVieja.notas === 'no me toques');

  // Lo nuevo llegó.
  const nuevo = d.objetivos.find((o) => o.nombre === 'Reactivar preautorizados, cohorte julio');
  caso('aplicar · objetivo nuevo creado (coma del CSV preservada)', !!nuevo);
  caso('aplicar · objetivo nuevo con scope del CSV', nuevo && nuevo.scope === 'operativo');
  caso('aplicar · objetivo nuevo con owner del importador', nuevo && nuevo.owner_uid === 'uid-mario');
  caso('aplicar · 2 subtareas en el objetivo nuevo', nuevo && nuevo.tareas.length === 2);
  caso('aplicar · subtarea nueva en el objetivo VIEJO', viejo && viejo.tareas.length === 2);
  caso('aplicar · no duplicó "Cerrar gate 60/60"',
    viejo && viejo.tareas.filter((t) => t.texto === 'Cerrar gate 60/60').length === 1);
  caso('aplicar · total 2 objetivos en enpagos', d.objetivos.length === 2, `${d.objetivos.length}`);

  // Versionado: tareasCliSave lo maneja, un solo bump por cliente.
  caso('aplicar · version bumpeada UNA vez (1 save por cliente)', d.version === 13, `version=${d.version}`);
  caso('aplicar · updatedBy = importador', d.updatedBy === 'uid-mario');

  // Inmobili en su propio doc.
  const inmo = STORE.get('workspaces/optimizads/tareas-clientes/inmobili');
  caso('aplicar · inmobili escrito en SU doc', !!inmo && inmo.objetivos.length === 1);
  caso('aplicar · inmobili arrancó en version 1', inmo && inmo.version === 1);

  // Bloques.
  const bloques = [...STORE.entries()].filter(([k]) => k.startsWith(BLOQUES + '/')).map(([, v]) => v);
  caso('aplicar · 4 bloques creados', bloques.length === 4, `${bloques.length}`);
  caso('aplicar · todos apuntan a una SUBTAREA', bloques.every((b) => !!b.tarea_id));
  caso('aplicar · ninguno quedó sin objetivo_id', bloques.every((b) => !!b.objetivo_id));
  caso('aplicar · assigned_to = importador', bloques.every((b) => b.assigned_to === 'uid-mario'));
  caso('aplicar · recurrencia null (campo muerto, no se usa)', bloques.every((b) => b.recurrencia === null));
  caso('aplicar · duracion 60', bloques.every((b) => b.duracion_minutos === 60));
  caso('aplicar · titulo = texto de la subtarea',
    bloques.some((b) => b.titulo === 'Listar estancados') && bloques.some((b) => b.titulo === 'Revisar CAC por plaza'));
  const cal = bloques.map((b) => new Date(b.inicio_ts.seconds * 1000));
  caso('aplicar · inicio_ts a las 9:00 local', cal.every((d2) => d2.getHours() === 9 && d2.getMinutes() === 0));
  caso('aplicar · fechas correctas', cal.map((d2) => d2.getDate()).sort().join(',') === '1,1,2,3');
  const bloqueGate = bloques.find((b) => b.titulo === 'Cerrar gate 60/60');
  caso('aplicar · fila sin fecha NO generó bloque', !bloqueGate);
  // El bloque de "Revisar autofilter" debe colgar de la subtarea recién creada,
  // no de la preexistente: ids reales, no los del preview.
  const revisar = viejo && viejo.tareas.find((t) => t.texto === 'Revisar autofilter');
  caso('aplicar · bloque ligado al id REAL de la subtarea nueva',
    !!revisar && bloques.some((b) => b.tarea_id === revisar.id));

  caso('aplicar · resumen coincide con lo escrito',
    res1.resumen.objetivosNuevos === 2 && res1.resumen.subtareasNuevas === 4
    && res1.resumen.subtareasDuplicadas === 1 && res1.resumen.bloquesNuevos === 4,
    JSON.stringify(res1.resumen));
}

// ── IDEMPOTENCIA: subir el MISMO CSV otra vez no debe crear nada ─────────
{
  const snapshotAntes = JSON.stringify(STORE.get(DOC).objetivos);
  const bloquesAntes = [...STORE.keys()].filter((k) => k.startsWith(BLOQUES + '/')).length;

  const res2 = await aplicarImport(CSV);
  caso('re-subida · ok', res2.ok === true);
  caso('re-subida · 0 objetivos nuevos', res2.resumen.objetivosNuevos === 0, JSON.stringify(res2.resumen));
  caso('re-subida · 0 subtareas nuevas', res2.resumen.subtareasNuevas === 0, JSON.stringify(res2.resumen));
  caso('re-subida · las 5 subtareas saltadas por duplicado', res2.resumen.subtareasDuplicadas === 5, JSON.stringify(res2.resumen));
  caso('re-subida · 0 bloques nuevos', res2.resumen.bloquesNuevos === 0, JSON.stringify(res2.resumen));
  caso('re-subida · 4 bloques reportados como ya agendados (la 5ª fila no trae fecha)', res2.resumen.bloquesDuplicados === 4, JSON.stringify(res2.resumen));
  caso('re-subida · objetivos idénticos', JSON.stringify(STORE.get(DOC).objetivos) === snapshotAntes);
  caso('re-subida · misma cantidad de bloques',
    [...STORE.keys()].filter((k) => k.startsWith(BLOQUES + '/')).length === bloquesAntes);
}

// ── Mismo objetivo, semana siguiente: sí debe agendar de nuevo ───────────
{
  const CSV2 = [
    'cliente,objetivo,tipo,subtarea,fecha',
    'EnPagos,"Reactivar preautorizados, cohorte julio",operativo,Listar estancados,2026-09-08',
  ].join('\n');
  const res3 = await aplicarImport(CSV2);
  caso('semana siguiente · 0 subtareas nuevas (ya existía)', res3.resumen.subtareasNuevas === 0);
  caso('semana siguiente · 1 bloque nuevo (otra fecha)', res3.resumen.bloquesNuevos === 1, JSON.stringify(res3.resumen));
  const bloques = [...STORE.entries()].filter(([k]) => k.startsWith(BLOQUES + '/')).map(([, v]) => v);
  caso('semana siguiente · total 5 bloques', bloques.length === 5, `${bloques.length}`);
}

console.log(resultados.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
