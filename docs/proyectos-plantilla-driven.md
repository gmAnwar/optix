# SPEC Optix v4.0 — Proyectos plantilla-driven

> **Status:** SPEC. Implementar DESPUÉS de Tareas v4.0 base productivo.
> **Origen:** Sesión S63.5 (2026-05-07) construyendo PLAYBOOK Landing Cliente.
> **Owner:** Anwar (OptimizAds).
> **Versión:** 1.0 (2026-05-07).

---

## 1. Resumen ejecutivo

Capa de **Proyectos plantilla-driven** sobre Tareas v4.0. Permite a Anwar y Mario:

1. Aplicar una plantilla pre-definida (ej: `landing-cliente`) a un cliente
2. Optix genera N tareas estructuradas con tiempos, dependencias y dueños
3. Definir fecha de arranque
4. Calendar muestra **UNA entrada por día por proyecto**, NO atomiza sub-tareas
5. Click en entrada → checklist completo donde Anwar y Mario palomean en tiempo real
6. Tiempo real entre Anwar y Mario, cada uno con sus tareas asignadas

**Decisión arquitectónica clave:** "Proyecto" = "Objetivo" del v4.0 con metadata extra (plantilla aplicable + checklist + dependencias + Gantt). NO es módulo nuevo, es extensión de Tareas v4.0.

---

## 2. Caso de uso completo

**Contexto:** Anwar acaba de cerrar onboarding con cliente nuevo (ej: Spa Body Wellness Mérida). Va a aplicar plantilla `landing-cliente` para construir landing en 2-5 días.

**Flujo:**

1. Anwar entra a Optix → **Vista Clientes** → tarjeta del cliente → click → **vista expandida cliente**
2. En la vista expandida aparece sección **"Proyectos"** además de las secciones existentes (Tareas sueltas, Objetivos sueltos)
3. Click **"Crear proyecto"** → modal con:
    - Selector de plantilla (`landing-cliente`, `cliente-onboarding`, etc — vacíos hasta tener más)
    - Nombre del proyecto (auto-llenado: "Landing Body Wellness" si plantilla es `landing-cliente` y cliente es Body Wellness, editable)
    - Fecha de arranque (date picker)
    - Botón **"Crear"**
4. Optix al click "Crear" ejecuta:
    1. Lee JSON de plantilla del repo (`templates/landing-cliente.json`)
    2. Crea registro Firestore: 1 Objetivo padre + N Tareas hijas con `parent_objective_id`
    3. Calcula fecha estimada de cada tarea desde fecha de arranque + dependencias + `tiempo_min`
    4. Asigna `responsible_users` según `dueño_default` (Anwar/Mario/AI/Cliente). AI y Cliente quedan como string sin `user_id` real
    5. Marca proyecto como activo
5. **Calendar lateral** muestra entrada **"Landing Body Wellness — paso del día"** cada día que tenga al menos 1 tarea sin completar
6. Click en entrada Calendar → modal full-screen con checklist de N tareas:
    - Agrupadas por fase (Fase 0, 0.5, 1, ..., 7)
    - Cada tarea muestra: ícono dueño (🤖🤝👤🏢), título, tiempo estimado, marcador 🔴 bloqueante, status (pendiente/en progreso/completada)
    - Anwar puede palomear cualquier tarea
    - Mario solo ve y puede palomear las suyas (filtro por `responsible_users`)
    - Tiempo real vía Firestore listener — si Mario palomea, Anwar lo ve sin reload
7. Cuando todas las tareas no-opcionales (`bloqueante: true`) están completadas → proyecto se marca **"completado"** automáticamente, Calendar deja de mostrar entrada

---

## 3. Schema JSON plantilla

### 3.1 Ubicación

Las plantillas viven en `gmAnwar/optix/templates/`. Una por archivo. Naming: `{plantilla_id}.json`.

Inicial: `templates/landing-cliente.json` (commiteado tras S63.5).

### 3.2 Estructura

```json
{
  "plantilla_id": "landing-cliente",
  "version": "1.1",
  "nombre": "Landing Cliente OptimizAds",
  "descripcion": "Plantilla para construir, deployar e iterar landing page de pauta Meta Ads para cliente con dominio propio + email corporativo.",
  "skill_referencia": "landing-cliente-SKILL-v1.1.md",
  "tiempo_total_estimado_horas": "8-12",
  "tiempo_calendario_estimado_dias": "2-5",
  "owner_default": "anwar",
  "fases": [
    {
      "id": "fase-0",
      "nombre": "Pre-flight check",
      "tiempo_estimado_min": 30,
      "descripcion": "Validar viabilidad antes de prometer al cliente",
      "tareas": [
        {
          "id": "0.1",
          "titulo": "Confirmar dominio cliente",
          "tipo": "validacion",
          "duenio_default": "anwar",
          "tiempo_min": 5,
          "depende_de": [],
          "bloqueante": true,
          "automatizable_ai": false,
          "output_esperado": "Dominio confirmado en formato cliente.mx",
          "notas": "Si no tiene dominio, simplificar Fase 5 con subdominio OptimizAds"
        }
      ]
    }
  ]
}
```

### 3.3 Valores enum permitidos

**Campo `tipo`** — qué clase de tarea es (impacta UI y workflow):

| Valor | Significado | UI sugerida |
|---|---|---|
| `validacion` | Verificar info disponible | Checkbox simple |
| `decision` | Tomar decisión basada en info | Checkbox + campo nota |
| `ai_autonomo` | Claude lo ejecuta solo | Botón "Ejecutar" → Claude API |
| `ai_guiado` | Claude genera, humano aplica | Checkbox + link a output |
| `ai_semi` | AI con validación humana | Checkbox + screenshot upload |
| `input_humano` | Humano provee input | Checkbox + campo texto |
| `input_cliente` | Cliente provee input externo | Estado "esperando cliente" |
| `validacion_cliente` | Cliente valida algo | Estado "esperando cliente" |
| `monitoreo` | Tarea recurrente diaria | Checkbox por día durante N días |

**Campo `dueño_default`** — quién hace por default (overrideable por proyecto):

| Valor | Mapeo Firestore |
|---|---|
| `anwar` | user_id `U052K7CCA8J` |
| `mario` | user_id `U0717PR8TCL` |
| `ai` | string `"ai"` (sin user_id real, indicador visual) |
| `cliente` | string `"cliente"` + nombre cliente del proyecto |

---

## 4. Mapping conceptual SKILL ↔ JSON ↔ Optix UI

Crítico que el equipo de implementación entienda qué es qué:

| Capa | Para qué | Quién consume |
|---|---|---|
| **SKILL.md** (`landing-cliente-SKILL-v1.1.md`) | Lógica ejecutable AI con detalle: recetas ffmpeg, código JS UTM, decision trees DNS, anti-patterns | Claude cuando ejecuta una fase |
| **JSON** (`landing-cliente.json`) | Estructura mínima necesaria para renderear checklist: N tareas con id/título/tipo/dueño/tiempo/dependencias | Optix al cargar plantilla |
| **Optix UI** | Render del JSON con interacciones (palomear, ver tiempo real, asignar) + invocaciones a Claude para tareas `ai_autonomo` | Anwar y Mario |

**El JSON NO contiene la lógica de cómo ejecutar la tarea**, solo metadata estructural. La lógica vive en SKILL.md y la ejecuta Claude cuando se le invoca desde una tarea `ai_autonomo`.

---

## 5. Decisión V1 simple vs V2 inteligente — scheduling de fechas

### V1 simple (recomendado para MVP)

Algoritmo de fecha estimada por tarea:

1. **Topological sort** por dependencias (`depende_de`)
2. Cada tarea sin dependencias: fecha = fecha de arranque
3. Cada tarea con dependencias: fecha = `max(fecha de dependencias)` + tiempo de fase agrupada
4. Si la suma de tiempos en un día > 8h, la tarea se desplaza al día siguiente
5. Calendar muestra entrada para CADA día que tenga ≥1 tarea pendiente

### V2 inteligente (post-V1, no implementar todavía)

- Considerar carga real de Mario y Anwar (si Mario tiene 4h ya asignadas martes, no asignar más)
- Re-scheduling automático cuando una tarea bloqueante se atrasa
- Smart suggestions de cuándo hacer cada cosa basado en historial de proyectos previos

**Decisión:** V1 simple para MVP. Suficiente para empezar a usar. V2 después de validar el patrón con 2-3 plantillas en producción.

---

## 6. Edge cases y decisiones arquitectónicas

| # | Edge case | Decisión |
|---|---|---|
| 1 | Anwar edita la plantilla DESPUÉS de aplicarla a un proyecto | Plantilla y proyecto independientes después de aplicar. Cambios a plantilla NO se propagan a proyectos en marcha. Siguiente proyecto usa plantilla nueva. |
| 2 | Mario quiere agregar sub-tarea no contemplada en plantilla | Permitido. Tareas custom dentro del proyecto OK. Marcadas con flag `custom: true` para distinguir de las heredadas de plantilla. |
| 3 | Tarea bloqueante no se completa pero el día pasa | Calendar entrada del día siguiente sigue ahí. Banner "Tarea X atrasada — bloquea Y, Z" en el modal del checklist. |
| 4 | Día sin tareas activas (entre fases con espera de cliente) | Calendar muestra entrada "Landing Body Wellness — esperando cliente" si hay tareas `input_cliente`/`validacion_cliente` pendientes. Si no hay nada pendiente, NO muestra entrada ese día. |
| 5 | Quién puede crear plantillas nuevas | Solo Anwar. UI de admin futura. **V1 = commit JSON al repo manualmente.** |
| 6 | Cómo se versiona una plantilla | `plantilla_id` + `version` campos. Proyecto guarda referencia exacta a versión usada al momento de aplicar. Plantilla nueva = nuevo registro, no edición destructiva. |
| 7 | Cuándo proyecto se marca "completado" | Cuando todas las tareas con `bloqueante: true` están completadas. Tareas no-bloqueantes pueden quedar abiertas sin impedir completar. |
| 8 | Plantilla con bifurcaciones (con CRM vs sin CRM) | V1 NO soporta. Si una plantilla necesita bifurcación, se crean 2 plantillas separadas. V2 puede agregar `condicional` flag a tareas. |
| 9 | Tarea `ai_autonomo` cómo se invoca | Botón "Ejecutar con Claude" en la tarea. Optix manda prompt + contexto del proyecto a Claude API. Resultado se guarda como nota en la tarea + se marca completada si Claude reporta éxito. |
| 10 | Si proyecto se "cancela" antes de completar | Estado "cancelado", tareas se archivan (no se borran), Calendar deja de mostrar. Histórico queda para análisis. |

---

## 7. Plantillas iniciales planeadas

| Plantilla | Status | Tareas | Tiempo |
|---|---|---|---|
| `landing-cliente` v1.1 | ✅ JSON construido S63.5 | 38 | 2-5 días |
| `cliente-onboarding` | 🟡 Futuro, basado en SAE Luzyla | ~30 | 1-2 semanas |
| `capi-implementation` | 🟡 Futuro, basado en EnPagos+Bodygreen+Inmobili | ~25 | 1 semana |
| `loop-diario-mvp` | 🟡 Futuro | ~15 | 3-5 días |

---

## 8. Integración con Tareas v4.0 base

Tareas v4.0 base ya define jerarquía Cliente → Objetivo → Tarea. Esta sub-feature requiere agregar al schema de **Objetivo** 4 campos opcionales:

```typescript
interface Objetivo {
  // ...campos existentes Tareas v4.0...

  // Nuevos campos para Proyectos plantilla-driven (todos opcionales)
  template_id?: string;       // ej: "landing-cliente", null si tarea suelta
  template_version?: string;  // ej: "1.1", null si tarea suelta
  is_project: boolean;        // true si tiene template_id
  phases?: Phase[];           // estructura de fases si is_project=true
}
```

**🔴 CRITICAL:** El schema de Tareas v4.0 base debe contemplar estos 4 campos opcionales **DESDE DÍA 1**, aunque no se usen hasta implementar plantillas. Si no, hay que hacer migration después con datos productivos, lo cual es caro.

Ver SPEC Tareas v4.0 base en canvas Slack PENDIENTES (`F0AKSTMSKSS`) para asegurar que esto se contemple cuando se implemente el módulo base.

---

## 9. Estimado implementación

| Frente | Estimado |
|---|---|
| Schema Firestore: Objetivo + Tarea con campos `template_*` (V1 = aceptar opcionales en v4.0 base) | 0h (incluido en v4.0 base) |
| JSON loader + topological sort + fecha calc | 2-3h CC |
| UI vista cliente "Crear proyecto" + selector plantilla | 2-3h CC |
| UI checklist agrupado por fases con palomeo tiempo real | 3-4h CC |
| Calendar integration (UNA entrada por día por proyecto) | 2-3h CC |
| Invocación Claude desde tarea `ai_autonomo` | 2-3h CC (depende de Claude API setup en Optix) |
| Tests + edge cases | 2-3h CC |
| **Total** | **13-19h CC en 3-4 sesiones dedicadas** |

---

## 10. Pre-requisitos para arrancar implementación

- ✅ JSON `landing-cliente.json` listo (S63.5) — commit pendiente Anwar a `gmAnwar/optix/templates/`
- ⏳ Tareas v4.0 base productivo con schema flexible (4 campos `template_*` opcionales presentes)
- ⏳ Confirmación con Anwar de las decisiones de § 5 y § 6
- ⏳ Diseño visual del checklist modal (puede usar canvas Slack `F0B2QNZLLSD` como referencia visual)

---

## 11. Recursos referencia

- **JSON plantilla:** `gmAnwar/optix/templates/landing-cliente.json` (commit pendiente Anwar)
- **SKILL ejecutable AI:** `landing-cliente-SKILL-v1.1.md`
- **PLAYBOOK navegable:** Slack canvas `F0B251A41HR`
- **Canvas prototipo visual UI:** Slack canvas `F0B2QNZLLSD` (referencia diseño checklist)
- **Blueprint template:** `blueprint-cliente-template.md`
- **Brief CRO template:** `brief-landing-cliente-template.md`
- **Tareas v4.0 base SPEC:** bloque en Slack canvas PENDIENTES `F0AKSTMSKSS`
- **Sesión origen:** S63.5 (2026-05-07) en chat Claude.ai del proyecto Optix

---

## 12. Notas de implementación para CC

Cuando arranques sesión CC para implementar este feature:

1. **Lee primero el bloque "OPTIX TAREAS v4.0" en PENDIENTES `F0AKSTMSKSS`** para asegurar que Tareas v4.0 base ya está productivo.
2. **Lee el JSON `templates/landing-cliente.json`** para entender la forma real de los datos antes de diseñar UI.
3. **Lee `landing-cliente-SKILL-v1.1.md`** para entender el contexto del flujo que estás haciendo accionable.
4. **Confirma con Anwar las decisiones § 5 y § 6** antes de codear — pueden haber cambiado.
5. **Stress-test el plan antes de empezar.** Doctrina Anwar: nunca empezar implementación sin haber atacado los huecos.

---

## 13. Versionado

- v1.0 — 2026-05-07 — SPEC inicial construido en S63.5

Próxima actualización: cuando se implemente Tareas v4.0 base productivo, revisar este SPEC contra el schema real y ajustar antes de codear plantillas.
