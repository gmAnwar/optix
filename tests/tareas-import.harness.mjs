// ═══════════════════════════════════════════════════════════════════════════
// HARNESS node determinista — Import CSV de objetivos [OPTIX-TAREAS-CSV-IMPORT]
//
// Prueba el NÚCLEO PURO de modules/tareas-import.js (parser CSV, normalización,
// dedupe objetivo/subtarea sobre el draft, plan de bloques, resumen). Sin
// browser, sin red, sin Firebase: fixtures que espejan el shape real del doc
// tareas-clientes/{clientId} y de calendar-bloques.
//
// Incluye un GATE ANTI-DRIFT: lee modules/tareas.js como texto y falla si
// TAREAS_CLI_SCOPES dejó de coincidir con IMPORT_SCOPES, o si las funciones de
// las que copiamos el shape (tareasCliAddObjetivo / tareasCliAddTarea) dejaron
// de escribir los campos que este import replica.
//
// Correr:  node tests/tareas-import.harness.mjs
// Exit 0 = todos PASS · exit 1 = algún FAIL (imprime cuál).
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseCsv, mapHeader, normKey, normalizeScope, parseFechaIso, resolveCliente,
  normalizeRows, applyRowsToDraft, planBloques, resumirDetalle, agruparPorCliente,
  bloqueFechaKey, bloqueKey, plantillaCsv, IMPORT_SCOPES, CSV_COLUMNS,
} from '../modules/tareas-import.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const TAREAS_JS = readFileSync(join(__dir, '..', 'modules', 'tareas.js'), 'utf8');

let pass = 0;
let fail = 0;
const resultados = [];

function caso(nombre, cond, detalle) {
  if (cond) { pass += 1; resultados.push(`PASS ${nombre}`); }
  else { fail += 1; resultados.push(`FAIL ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
}

const CATALOGO = [
  { id: 'enpagos', nombre: 'EnPagos' },
  { id: 'inmobili', nombre: 'Inmobili' },
  { id: 'tuyo-health', nombre: 'Tuyo Health' },
];

// mkId determinista: sin Date.now ni Math.random, para poder afirmar ids exactos.
function mkIdSeq() {
  let n = 0;
  return (prefix) => `${prefix === 'obj' ? 'obj' : 'tarea'}-T${++n}`;
}
const OWNER = { owner_uid: 'uid-mario', owner_label: 'M', shared: true };
const NOW = '2026-08-27T12:00:00.000Z';

// Draft con el shape REAL de tareas-clientes/{clientId} (tareas.js:1364).
function draft(objetivos = []) {
  return {
    clientId: 'enpagos', orden: 0, collapsed: false, version: 7,
    objetivos, updatedAt: null, updatedBy: 'uid-anwar',
  };
}

// ── GATE ANTI-DRIFT contra el schema real ─────────────────────────────────
{
  const m = /TAREAS_CLI_SCOPES\s*=\s*\[([^\]]+)\]/.exec(TAREAS_JS);
  const real = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [];
  caso('drift · TAREAS_CLI_SCOPES == IMPORT_SCOPES',
    JSON.stringify(real) === JSON.stringify(IMPORT_SCOPES),
    `tareas.js=${JSON.stringify(real)} vs import=${JSON.stringify(IMPORT_SCOPES)}`);

  // El objetivo sigue siendo {nombre, scope, tareas[]} y NO {titulo, tipo, subtareas[]}.
  const addObj = TAREAS_JS.slice(TAREAS_JS.indexOf('export async function tareasCliAddObjetivo'));
  const bodyObj = addObj.slice(0, addObj.indexOf('\n}'));
  caso('drift · objetivo usa `nombre`', /\bnombre:\s*t\b/.test(bodyObj));
  caso('drift · objetivo usa `scope`', /\bscope:\s*finalScope\b/.test(bodyObj));
  caso('drift · objetivo usa `tareas: []`', /\btareas:\s*\[\]/.test(bodyObj));
  caso('drift · NO existe campo `subtareas` en tareas.js', !/\bsubtareas\s*:/.test(TAREAS_JS));

  // La tarea sigue siendo {texto, completado, orden, ...} y el array padre `tareas`.
  const addTar = TAREAS_JS.slice(TAREAS_JS.indexOf('export async function tareasCliAddTarea'));
  const bodyTar = addTar.slice(0, addTar.indexOf('\n}'));
  ['texto:', 'completado:', 'fechaIdeal:', 'fechaLimite:', 'notas:', 'responsibleUsers:', 'orden:', 'createdAt:', 'updatedAt:']
    .forEach((f) => caso(`drift · tarea escribe ${f}`, bodyTar.includes(f)));
  caso('drift · o.tareas.push sigue siendo el array destino', /o\.tareas\.push\(/.test(bodyTar));

  // El read-modify-write que reusamos sigue existiendo y exportado.
  caso('drift · tareasCliSave sigue exportado', /export async function tareasCliSave\(clientId, mutator\)/.test(TAREAS_JS));
  caso('drift · tareasCliNewOwnerFields sigue exportado', /export function tareasCliNewOwnerFields\(/.test(TAREAS_JS));
}

// ── parseCsv ──────────────────────────────────────────────────────────────
{
  const r = parseCsv('a,b,c\n1,2,3\n');
  caso('csv · filas básicas', r.length === 2 && r[1][2] === '3');

  const q = parseCsv('cliente,objetivo\nenpagos,"Reactivar, llamar y cerrar"\n');
  caso('csv · coma dentro de comillas', q[1][1] === 'Reactivar, llamar y cerrar', JSON.stringify(q[1]));

  const esc = parseCsv('a\n"dijo ""hola"""\n');
  caso('csv · comilla escapada ""', esc[1][0] === 'dijo "hola"', JSON.stringify(esc[1]));

  const nl = parseCsv('a,b\n"linea1\nlinea2",x\n');
  caso('csv · salto de línea dentro de comillas', nl.length === 2 && nl[1][0] === 'linea1\nlinea2');

  caso('csv · CRLF', parseCsv('a,b\r\n1,2\r\n').length === 2);
  caso('csv · BOM', parseCsv('﻿cliente,objetivo\nx,y\n')[0][0] === 'cliente');
  caso('csv · filas vacías descartadas', parseCsv('a,b\n\n\n1,2\n').length === 2);
  caso('csv · última línea sin \\n', parseCsv('a,b\n1,2')[1][1] === '2');
}

// ── mapHeader ─────────────────────────────────────────────────────────────
{
  const h = mapHeader(['cliente', 'objetivo', 'tipo', 'subtarea', 'fecha']);
  caso('header · canónico', h.ok && h.map.fecha === 4);

  const rev = mapHeader(['Fecha', 'SUBTAREA', 'Tipo', 'Objetivo', 'Cliente']);
  caso('header · orden arbitrario + mayúsculas', rev.ok && rev.map.cliente === 4 && rev.map.fecha === 0);

  const extra = mapHeader(['cliente', 'objetivo', 'notas_internas']);
  caso('header · columna extra ignorada', extra.ok && extra.map.tipo === undefined);

  caso('header · sin cliente → error', mapHeader(['objetivo', 'fecha']).ok === false);
  caso('header · sin objetivo → error', mapHeader(['cliente', 'fecha']).ok === false);
}

// ── normalizadores ────────────────────────────────────────────────────────
{
  caso('norm · acentos + case', normKey('  Estratégico  ') === 'estrategico');
  caso('norm · espacios colapsados', normKey('Cierre   de    mes') === 'cierre de mes');

  caso('scope · con acento', normalizeScope('Estratégico') === 'estrategico');
  caso('scope · vacío → null', normalizeScope('') === null);
  caso('scope · basura → undefined', normalizeScope('urgente') === undefined);
  IMPORT_SCOPES.forEach((s) => caso(`scope · ${s} válido`, normalizeScope(s) === s));

  caso('fecha · válida', parseFechaIso('2026-09-01') === '2026-09-01');
  caso('fecha · vacía → null', parseFechaIso('') === null);
  caso('fecha · formato malo → undefined', parseFechaIso('01/09/2026') === undefined);
  caso('fecha · 30-feb no existe → undefined', parseFechaIso('2026-02-30') === undefined);
  caso('fecha · mes 13 → undefined', parseFechaIso('2026-13-01') === undefined);
  caso('fecha · bisiesto real 2028-02-29', parseFechaIso('2028-02-29') === '2028-02-29');

  caso('cliente · por id', resolveCliente('enpagos', CATALOGO) === 'enpagos');
  caso('cliente · por nombre', resolveCliente('EnPagos', CATALOGO) === 'enpagos');
  caso('cliente · nombre con espacio', resolveCliente('Tuyo Health', CATALOGO) === 'tuyo-health');
  caso('cliente · desconocido → null', resolveCliente('acme', CATALOGO) === null);
  caso('cliente · NO inventa id a partir del texto', resolveCliente('Cliente Nuevo SA', CATALOGO) === null);
}

// ── normalizeRows: filas malas no tumban las buenas ───────────────────────
{
  const csv = [
    'cliente,objetivo,tipo,subtarea,fecha',
    'enpagos,Objetivo A,operativo,Sub 1,2026-09-01',
    'acme,Objetivo X,operativo,Sub,2026-09-01',        // cliente inválido
    'enpagos,,operativo,Sub,2026-09-01',                // sin objetivo
    'enpagos,Objetivo B,urgente,Sub,2026-09-01',        // tipo inválido
    'enpagos,Objetivo C,operativo,Sub,01-09-2026',      // fecha inválida
    'inmobili,Objetivo D,,Sub 2,',                      // tipo y fecha vacíos: válida
  ].join('\n');
  const rows = parseCsv(csv);
  const { filas, errores } = normalizeRows(rows, mapHeader(rows[0]).map, CATALOGO);
  caso('rows · 2 válidas', filas.length === 2, JSON.stringify(filas.map((f) => f.objetivo)));
  caso('rows · 4 erróneas', errores.length === 4, JSON.stringify(errores));
  caso('rows · línea reportada es la del editor', errores[0].linea === 3, JSON.stringify(errores[0]));
  caso('rows · scope vacío queda null', filas[1].scope === null);
  caso('rows · fecha vacía queda null', filas[1].fechaIso === null);
}

// ── applyRowsToDraft: el corazón ──────────────────────────────────────────
{
  // Objetivo nuevo + subtarea nueva sobre draft VACÍO.
  const d0 = draft();
  const f0 = [{ linea: 2, clientId: 'enpagos', objetivo: 'Reactivar julio', scope: 'operativo', subtarea: 'Listar preaut+', fechaIso: '2026-09-01' }];
  const r0 = applyRowsToDraft(d0, f0, { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · crea objetivo', r0.doc.objetivos.length === 1 && r0.doc.objetivos[0].nombre === 'Reactivar julio');
  caso('apply · objetivo con scope del CSV', r0.doc.objetivos[0].scope === 'operativo');
  caso('apply · objetivo con owner estampado', r0.doc.objetivos[0].owner_uid === 'uid-mario' && r0.doc.objetivos[0].shared === true);
  caso('apply · crea tarea con `texto`', r0.doc.objetivos[0].tareas[0].texto === 'Listar preaut+');
  caso('apply · tarea NO nace completada', r0.doc.objetivos[0].tareas[0].completado === false);
  caso('apply · tarea top-level (sin parent_task_id)', r0.doc.objetivos[0].tareas[0].parent_task_id === undefined);
  caso('apply · detalle marca nuevo/nueva', r0.detalle[0].objetivo_estado === 'nuevo' && r0.detalle[0].subtarea_estado === 'nueva');

  // NO PISA lo que ya había — el invariante que mata todo si falla.
  const previo = draft([{
    id: 'obj-viejo', nombre: 'Objetivo de Anwar', collapsed: false, orden: 0,
    scope: 'estrategico', owner_uid: 'uid-anwar', owner_label: 'A', shared: true,
    tareas: [{ id: 'tarea-vieja', texto: 'No me borres', completado: false, orden: 0 }],
  }]);
  const r1 = applyRowsToDraft(previo, f0, { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · conserva el objetivo preexistente', r1.doc.objetivos.some((o) => o.id === 'obj-viejo'));
  caso('apply · conserva la tarea preexistente',
    r1.doc.objetivos.find((o) => o.id === 'obj-viejo').tareas[0].texto === 'No me borres');
  caso('apply · agrega el nuevo sin quitar el viejo', r1.doc.objetivos.length === 2);
  caso('apply · conserva campos del doc fuera de objetivos', r1.doc.updatedBy === 'uid-anwar' && r1.doc.version === 7);

  // Objetivo YA EXISTE por título → no duplica, cuelga la subtarea ahí.
  const d2 = draft([{ id: 'obj-x', nombre: 'Reactivar julio', scope: 'operativo', orden: 0, tareas: [] }]);
  const r2 = applyRowsToDraft(d2, f0, { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · objetivo existente NO se duplica', r2.doc.objetivos.length === 1);
  caso('apply · subtarea cae en el objetivo existente', r2.doc.objetivos[0].tareas.length === 1);
  caso('apply · detalle marca objetivo existente', r2.detalle[0].objetivo_estado === 'existente');

  // Match por título es case/acento-insensible.
  const d3 = draft([{ id: 'obj-y', nombre: 'Captación de Torreón', scope: 'operativo', orden: 0, tareas: [] }]);
  const r3 = applyRowsToDraft(d3, [{ linea: 2, clientId: 'enpagos', objetivo: 'CAPTACION DE TORREON', scope: 'operativo', subtarea: 'x', fechaIso: null }], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · match de objetivo ignora acentos y case', r3.doc.objetivos.length === 1);

  // Subtarea duplicada → se salta.
  const d4 = draft([{ id: 'obj-z', nombre: 'Obj', scope: 'operativo', orden: 0, tareas: [{ id: 'tarea-vieja', texto: 'Listar preaut+', completado: false, orden: 0 }] }]);
  const r4 = applyRowsToDraft(d4, [{ linea: 2, clientId: 'enpagos', objetivo: 'Obj', scope: 'operativo', subtarea: 'listar PREAUT+', fechaIso: null }], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · subtarea duplicada no se agrega', r4.doc.objetivos[0].tareas.length === 1);
  caso('apply · duplicada reporta el id existente', r4.detalle[0].tareaId === 'tarea-vieja');
  caso('apply · duplicada marcada como tal', r4.detalle[0].subtarea_estado === 'duplicada');

  // Duplicado contra una SUBtarea con parent_task_id (peer flat) también cuenta.
  const d4b = draft([{ id: 'obj-z', nombre: 'Obj', scope: 'operativo', orden: 0, tareas: [
    { id: 'tarea-padre', texto: 'Padre', completado: false, orden: 0 },
    { id: 'tarea-hija', texto: 'Revisar CAC', completado: false, orden: 1, parent_task_id: 'tarea-padre' },
  ] }]);
  const r4b = applyRowsToDraft(d4b, [{ linea: 2, clientId: 'enpagos', objetivo: 'Obj', scope: 'operativo', subtarea: 'Revisar CAC', fechaIso: null }], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · dedupe también contra subtareas con parent_task_id', r4b.doc.objetivos[0].tareas.length === 2);

  // Varias filas del mismo objetivo nuevo → un solo objetivo, N subtareas.
  const d5 = draft();
  const r5 = applyRowsToDraft(d5, [
    { linea: 2, clientId: 'enpagos', objetivo: 'Uno', scope: 'operativo', subtarea: 'A', fechaIso: null },
    { linea: 3, clientId: 'enpagos', objetivo: 'Uno', scope: 'operativo', subtarea: 'B', fechaIso: null },
    { linea: 4, clientId: 'enpagos', objetivo: 'Uno', scope: 'operativo', subtarea: 'C', fechaIso: null },
  ], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · 3 filas mismo objetivo → 1 objetivo', r5.doc.objetivos.length === 1);
  caso('apply · 3 filas mismo objetivo → 3 subtareas', r5.doc.objetivos[0].tareas.length === 3);
  caso('apply · orden incremental correcto', r5.doc.objetivos[0].tareas.map((t) => t.orden).join(',') === '0,1,2');

  // Fila sin subtarea = objetivo suelto.
  const d6 = draft();
  const r6 = applyRowsToDraft(d6, [{ linea: 2, clientId: 'enpagos', objetivo: 'Solo objetivo', scope: 'recurrente', subtarea: '', fechaIso: null }], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · objetivo suelto sin tareas', r6.doc.objetivos[0].tareas.length === 0);
  caso('apply · detalle marca sin_subtarea', r6.detalle[0].subtarea_estado === 'sin_subtarea');

  // scope vacío en el CSV → fallback 'compartido' (mismo defensivo que la UI).
  const d7 = draft();
  const r7 = applyRowsToDraft(d7, [{ linea: 2, clientId: 'enpagos', objetivo: 'Sin tipo', scope: null, subtarea: '', fechaIso: null }], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · scope null → compartido', r7.doc.objetivos[0].scope === 'compartido');

  // El import NO reclasifica un objetivo vivo; lo avisa.
  const d8 = draft([{ id: 'obj-w', nombre: 'Obj', scope: 'estrategico', orden: 0, tareas: [] }]);
  const r8 = applyRowsToDraft(d8, [{ linea: 2, clientId: 'enpagos', objetivo: 'Obj', scope: 'operativo', subtarea: '', fechaIso: null }], { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · NO pisa el scope existente', d8.objetivos[0].scope === 'estrategico');
  caso('apply · avisa del mismatch de tipo', typeof r8.detalle[0].aviso === 'string' && r8.detalle[0].aviso.includes('estrategico'));

  // Draft legacy sin array objetivos.
  const r9 = applyRowsToDraft({ clientId: 'enpagos' }, f0, { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('apply · draft sin `objetivos` se inicializa', Array.isArray(r9.doc.objetivos) && r9.doc.objetivos.length === 1);
}

// ── planBloques ───────────────────────────────────────────────────────────
{
  const base = () => ([
    { linea: 2, clientId: 'enpagos', objetivo: 'O', subtarea: 'A', tareaId: 'tarea-1', objetivoId: 'obj-1', fechaIso: '2026-09-01' },
    { linea: 3, clientId: 'enpagos', objetivo: 'O', subtarea: 'B', tareaId: 'tarea-2', objetivoId: 'obj-1', fechaIso: null },
    { linea: 4, clientId: 'enpagos', objetivo: 'O', subtarea: '', objetivoId: 'obj-1', fechaIso: '2026-09-02' },
  ]);

  const p1 = planBloques(base(), new Set());
  caso('bloques · crea solo el que tiene fecha + subtarea', p1.crear.length === 1 && p1.crear[0].tareaId === 'tarea-1');
  caso('bloques · sin fecha marcado', p1.detalle[1].bloque_estado === 'sin_fecha');
  caso('bloques · con fecha pero sin subtarea marcado', p1.detalle[2].bloque_estado === 'sin_subtarea');

  const p2 = planBloques(base(), new Set([bloqueKey('tarea-1', '2026-09-01')]));
  caso('bloques · no duplica uno ya existente', p2.crear.length === 0 && p2.detalle[0].bloque_estado === 'duplicado');

  // Misma subtarea + misma fecha dos veces en el CSV → un solo bloque.
  const p3 = planBloques([
    { linea: 2, tareaId: 'tarea-1', objetivoId: 'obj-1', clientId: 'enpagos', objetivo: 'O', subtarea: 'A', fechaIso: '2026-09-01' },
    { linea: 3, tareaId: 'tarea-1', objetivoId: 'obj-1', clientId: 'enpagos', objetivo: 'O', subtarea: 'A', fechaIso: '2026-09-01' },
  ], new Set());
  caso('bloques · dedupe dentro del mismo CSV', p3.crear.length === 1);

  // Misma subtarea en DOS fechas → dos bloques (una fila = una fecha).
  const p4 = planBloques([
    { linea: 2, tareaId: 'tarea-1', objetivoId: 'obj-1', clientId: 'enpagos', objetivo: 'O', subtarea: 'A', fechaIso: '2026-09-01' },
    { linea: 3, tareaId: 'tarea-1', objetivoId: 'obj-1', clientId: 'enpagos', objetivo: 'O', subtarea: 'A', fechaIso: '2026-09-08' },
  ], new Set());
  caso('bloques · misma tarea en 2 fechas → 2 bloques', p4.crear.length === 2);
}

// ── bloqueFechaKey: los 3 shapes que puede traer inicio_ts ────────────────
{
  const d = new Date(2026, 8, 1, 9, 0, 0); // 1-sep-2026 09:00 local
  caso('fechaKey · Date', bloqueFechaKey(d) === '2026-09-01');
  caso('fechaKey · Timestamp Firestore', bloqueFechaKey({ toDate: () => d }) === '2026-09-01');
  caso('fechaKey · {seconds} serializado', bloqueFechaKey({ seconds: Math.floor(d.getTime() / 1000) }) === '2026-09-01');
  caso('fechaKey · millis', bloqueFechaKey(d.getTime()) === '2026-09-01');
  caso('fechaKey · null', bloqueFechaKey(null) === null);
  caso('fechaKey · basura', bloqueFechaKey({ seconds: NaN }) === null);
}

// ── agrupar + resumen ─────────────────────────────────────────────────────
{
  const g = agruparPorCliente([
    { clientId: 'enpagos', linea: 2 }, { clientId: 'inmobili', linea: 3 }, { clientId: 'enpagos', linea: 4 },
  ]);
  caso('agrupar · 2 clientes', g.size === 2);
  caso('agrupar · enpagos junta sus 2 filas', g.get('enpagos').length === 2);

  const r = resumirDetalle([
    { objetivoId: 'o1', objetivo_estado: 'nuevo', subtarea_estado: 'nueva', bloque_estado: 'nuevo' },
    { objetivoId: 'o1', objetivo_estado: 'nuevo', subtarea_estado: 'nueva', bloque_estado: 'duplicado' },
    { objetivoId: 'o2', objetivo_estado: 'existente', subtarea_estado: 'duplicada', bloque_estado: 'sin_fecha' },
    { objetivoId: 'o3', objetivo_estado: 'existente', subtarea_estado: 'sin_subtarea', bloque_estado: 'sin_subtarea', aviso: 'x' },
  ], [{ linea: 9, motivo: 'mala' }]);
  caso('resumen · objetivo nuevo se cuenta UNA vez aunque tenga 2 filas', r.objetivosNuevos === 1, JSON.stringify(r));
  caso('resumen · subtareas nuevas', r.subtareasNuevas === 2);
  caso('resumen · duplicadas', r.subtareasDuplicadas === 1);
  caso('resumen · bloques nuevos', r.bloquesNuevos === 1);
  caso('resumen · bloques duplicados', r.bloquesDuplicados === 1);
  caso('resumen · bloques sin subtarea', r.bloquesSinSubtarea === 1);
  caso('resumen · avisos', r.avisos === 1);
  caso('resumen · errores', r.errores === 1);
}

// ── La plantilla que descarga Mario tiene que ser válida contra su propio parser ──
{
  const rows = parseCsv(plantillaCsv());
  const h = mapHeader(rows[0]);
  caso('plantilla · header válido', h.ok);
  caso('plantilla · columnas exactas del contrato', rows[0].join(',') === CSV_COLUMNS.join(','));
  const { filas, errores } = normalizeRows(rows, h.map, CATALOGO);
  caso('plantilla · 0 errores', errores.length === 0, JSON.stringify(errores));
  caso('plantilla · 5 filas', filas.length === 5);
  const res = applyRowsToDraft(draft(), filas.filter((f) => f.clientId === 'enpagos'), { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  caso('plantilla · enpagos → 1 objetivo con 2 subtareas',
    res.doc.objetivos.length === 1 && res.doc.objetivos[0].tareas.length === 2);
}

// ── E2E del núcleo puro: CSV crudo → draft final ──────────────────────────
{
  const csv = [
    'cliente,objetivo,tipo,subtarea,fecha',
    'EnPagos,"Reactivar preautorizados, cohorte julio",operativo,Listar estancados,2026-09-01',
    'EnPagos,"Reactivar preautorizados, cohorte julio",operativo,Llamar al top 20,2026-09-02',
    'EnPagos,"Reactivar preautorizados, cohorte julio",operativo,Listar estancados,2026-09-03', // dup de subtarea
  ].join('\n');
  const rows = parseCsv(csv);
  const { filas, errores } = normalizeRows(rows, mapHeader(rows[0]).map, CATALOGO);
  caso('e2e · sin errores', errores.length === 0);
  const res = applyRowsToDraft(draft(), filas, { mkId: mkIdSeq(), owner: OWNER, nowIso: NOW });
  const plan = planBloques(res.detalle, new Set());
  const r = resumirDetalle(res.detalle, errores);
  caso('e2e · 1 objetivo (título con coma preservado)',
    res.doc.objetivos.length === 1 && res.doc.objetivos[0].nombre === 'Reactivar preautorizados, cohorte julio');
  caso('e2e · 2 subtareas, la 3ª saltada', res.doc.objetivos[0].tareas.length === 2);
  caso('e2e · resumen 1/2/1', r.objetivosNuevos === 1 && r.subtareasNuevas === 2 && r.subtareasDuplicadas === 1);
  // La fila 4 es duplicado de subtarea pero trae OTRA fecha: la subtarea ya existe,
  // así que el bloque se agenda contra la subtarea existente. 3 bloques, no 2.
  caso('e2e · 3 bloques (la dup agenda contra la subtarea existente)', plan.crear.length === 3, JSON.stringify(plan.crear.map((b) => b.fechaIso)));
}

console.log(resultados.join('\n'));
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
