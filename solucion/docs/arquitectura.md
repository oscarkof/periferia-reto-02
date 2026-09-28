# Arquitectura del agente — Reto 02 «Registro de Contratos Vigentes»

> Periferia IT Group · Equipo Perxia 2.0
> **Estado:** diseño cerrado en F0 (setup) e implementado en F1–F5. Si algún detalle cambia al
> implementarlo, se corrige aquí en el mismo commit. Lo que describe este documento es lo que se
> construye, no una idea suelta.

Este documento responde a la pregunta «¿cómo está armado y por qué así?». El
[`README`](../../README.md) cuenta *qué es y cómo se usa*; [`SOLUCION.md`](../../SOLUCION.md) cuenta *cómo
se pensó*, con la cobertura y los riesgos (las 11 secciones del PRD §9.1). El estado de cada fase está en
la §0 del README.

---

## 0. Qué resuelve, en una frase

Un **buzón único de contratos** entra por correo; el agente lo **interpreta, clasifica y archiva**,
mantiene el **maestro de contratos vigentes** (que hoy está congelado desde el 2026-05-30),
**detiene lo dudoso para revisión humana** y produce **alertas de vencimiento y de pólizas**.

El punto fino: el agente **conversa y decide**, pero **los valores del maestro salen de código
determinista** y nada se registra sin que se cumplan las reglas. El modelo no es la fuente de verdad.

---

## 1. Vista general

```
┌───────────────────────────────┐
│ Front de chat · web/          │  historial de la conversación · cada llamada a
│ HTML + CSS + módulos ES       │  herramienta visible · banda de confirmación
└───────────┬───────────────────┘
            │  POST /api/chat (SSE)   ·   GET /api/sessions/:id   ·   GET /api/health
┌───────────▼───────────────────────────────────────────────────────────────────────┐
│ src/server.ts + src/server/        API HTTP · stream de eventos · front estático   │
├───────────────────────────────────────────────────────────────────────────────────┤
│ src/agent/      EL CICLO                                                          │
│   loop.ts         modelo → herramienta → modelo, con topes (CA1)                  │
│   paso.ts         valida con zod, ejecuta y audita lo que devuelve el modelo      │
│   confirmacion.ts exige un «sí» explícito en el turno anterior (CA3 · RN5)        │
│   sesion.ts       historial, tokens y acción pendiente → out/sessions/<id>.json    │
│   eventos.ts      inicio · llamada · resultado · texto · aviso · error · fin       │
│   prompt.ts       compone agent/prompt.md + src/knowledge/registro-contratos.md    │
├───────────────────────────────────────────────────────────────────────────────────┤
│ src/llm/        UNA INTERFAZ, TRES PROVEEDORES                                    │
│   adapter.ts  enviar(mensajes, herramientas) → respuesta    (PRD §6.1)            │
│   ollama.ts · openai.ts · mock.ts · fabrica.ts                                    │
├───────────────────────────────────────────────────────────────────────────────────┤
│ src/tools/contratos.ts     LAS CINCO HERRAMIENTAS                                 │
│   son la ÚNICA superficie que el modelo puede llamar y la ÚNICA fuente de valores │
├───────────────────────────────────────────────────────────────────────────────────┤
│ src/core/       MOTOR DETERMINISTA (no hay lenguaje natural aquí)                 │
│   buzon · extraccion · clausulas · normalizacion · identificadores · comerciales  │
│   clasificacion · maestro · csv · archivado · alertas · historial · entorno       │
│   log · rutas · io · tipos · escritor                                             │
└───────────┬────────────────────────────────────────┬──────────────────────────────┘
            │ LECTURA (RN6: jamás se escribe ahí)    │ ESCRITURA (confinada a out/)
            ▼                                        ▼
  fixtures/reto-02/                          out/
    buzon/msg-001..006/{correo.json,….txt}     sharepoint/maestro-contratos.csv  ← copia
    maestro-contratos.csv                      sharepoint/Contratos/<año>/<slug>/<id>.<ext>
    comerciales.json                           sharepoint/historial.jsonl
                                               procesados.json · alertas.md · log.jsonl
                                               sessions/<id>.json
```

---

## 2. Capas: qué hace cada una y por qué está separada

| Capa | Carpeta | Responsabilidad | Por qué separada |
|---|---|---|---|
| Front | `web/` | Chat: historial, campo de entrada, «pensando», **cada tool-call visible** y el estado de confirmación resaltado (PRD §6.1) | El PRD exige *ver* las herramientas; eso es presentación, no lógica. Sin build: HTML/JS plano |
| API | `src/server.ts` + `src/server/` | `POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health` (§6.4), stream SSE y estáticos | El ciclo del agente **no habla HTTP**: emite eventos y el servidor decide cómo transmitirlos |
| Ciclo | `src/agent/` | Bucle, topes, sesiones, confirmación humana, composición del prompt | Es el único sitio que conoce el orden de las cosas; se prueba con un proveedor falso |
| Adaptador LLM | `src/llm/` | `enviar(mensajes, herramientas) → respuesta`, una implementación por proveedor | PRD §6.1: cambiar de proveedor no debe tocar el ciclo. La clave se lee solo aquí |
| Herramientas | `src/tools/` | El contrato del PRD §6.2: `description` + `args` (zod) + `execute` | Es la frontera entre «lo que el modelo puede pedir» y «lo que el sistema hace»; `demo.ts` las importa sin el servidor (§6.6) |
| Motor determinista | `src/core/` | Extracción, normalización, confianza, clasificación, maestro, archivo, alertas | Es lo que hace que el agente no pueda inventar: **cada valor tiene una regla trazable** |
| Comportamiento | `agent/prompt.md` | Cómo conversa el agente, qué hace primero, cuándo pregunta | PRD §6.5: comportamiento fuera del código. Cambiar reglas de trato no toca el servidor |
| Conocimiento | `src/knowledge/registro-contratos.md` | El proceso: buzón, escalamiento, glosario, qué es un otrosí, umbral de revisión | PRD §6.5: conocimiento fuera del código. El agente lo consulta como contexto |
| Salida | `out/` | Maestro copiado, archivos, historial, procesados, alertas, log y sesiones | El `.zip` de entrega no lleva `out/` (§9.5): es todo regenerable con `npm run demo` |

---

## 3. El contrato de herramientas

Cinco herramientas en **un solo archivo** (`src/tools/contratos.ts`), porque comparten el mismo
contexto y el nombre que ve el modelo es `<archivo>_<export>` (PRD §6.2).

| Herramienta | Entrada | Salida (`data`) | Prioridad |
|---|---|---|---|
| `contratos_leer_buzon` | `{}` | `{ mensajes[] }` con `{ id, de, asunto, fecha, adjuntos[], tiene_contrato }`, sin los ya procesados | P0 |
| `contratos_extraer` | `{ mensaje_id }` | `Contrato` del PRD §7.2 con `confianza` por campo | P0 |
| `contratos_validar` | `{ mensaje_id, contrato }` | `{ clasificacion, id_contrato_existente?, requiere_revision[], diferencias? }` | P0 |
| `contratos_registrar` | `{ mensaje_id, contrato, confirmado? }` | `{ id_contrato, accion, ruta_archivo }` o `{ ok: false, error: "requiere revisión: …" }` | P0 |
| `contratos_alertas` | `{ hoy: "YYYY-MM-DD" }` | `{ ruta, vencen[], polizas_pendientes[], registrados_desde_corte[] }` | P0 |
| `contratos_leer_pdf` | `{ ruta }` | `{ texto }` | P1 opcional (los fixtures traen `.txt`) |

**Forma de una herramienta** (la del PRD §6.2, sin inventar API nueva):

```ts
export const leer_buzon = {
  description: "…una frase: es lo único que el modelo lee para decidir cuándo llamarla",
  args: {}, // esquemas zod, con .describe() en cada campo
  async execute(_args, ctx: { directory: string; sessionId: string }) {
    return JSON.stringify({ ok: true, data: { /* … */ } }) // string JSON
  },
}
```

Tres reglas que sostienen todo lo demás:

1. **`execute` devuelve siempre `string` JSON** con `{ ok: true, data }` o `{ ok: false, error }`.
2. **`execute` nunca lanza**: un texto raro o un archivo ilegible es un `ok: false` legible, no una
   traza (PRD §5 HU-6 y §8 Robustez). El agente sigue con el siguiente mensaje.
3. **`ctx.directory` es la raíz del proyecto**: las rutas se resuelven desde ahí y se confinan a
   `fixtures/` (solo lectura) y `out/` (escritura). El modelo puede pedir un `mensaje_id`, **nunca una ruta**.

Los `args` se validan **antes** de ejecutar; si no cumplen, el error vuelve al modelo como
`ok: false` para que corrija su llamada. Los esquemas se publican al modelo como JSON Schema.

---

## 4. Un turno, paso a paso

Con el prompt de ejemplo del PRD §11 («Procesa el buzón… con fecha de hoy 2026-09-03…»):

| # | Qué pasa | Dónde vive |
|---|---|---|
| 1 | El front manda `POST /api/chat { sessionId, message }` y abre el stream | `web/app.js` · `src/server/chat.ts` |
| 2 | El servidor arma el contexto: `agent/prompt.md` + `src/knowledge/registro-contratos.md` + historial | `src/agent/prompt.ts` |
| 3 | Pide al proveedor con las cinco herramientas declaradas | `src/llm/fabrica.ts` → `ollama.ts` |
| 4 | El modelo responde con `tool_calls` (o texto) | — |
| 5 | Cada llamada se valida con zod, se audita y se ejecuta; el resultado vuelve al modelo. La tarjeta viaja al front y la línea a `out/log.jsonl` (RN7 · CA4) | `src/agent/paso.ts` |
| 6 | Se repite 4–5 hasta que el modelo responde sin herramientas o se topa con **25 iteraciones** / **200 000 tokens** (CA1) | `src/agent/loop.ts` |
| 7 | Si algo quedó `requiere_revision`, el turno **termina en pregunta** y el front resalta la banda (CA3) | `src/agent/confirmacion.ts` · `web/` |
| 8 | Historial y acción pendiente quedan en `out/sessions/<id>.json`: recargar no pierde estado | `src/agent/sesion.ts` |
| 9 | El usuario responde «confirmo…»: solo entonces `paso.ts` deja pasar `confirmado: true` y `contratos_registrar` escribe | `src/agent/confirmacion.ts` |

`GET /api/health` responde `{ ok: true, provider, model }` y **jamás** una clave (PRD §8).

---

## 5. Los seis mensajes del buzón: resultado esperado

Esta tabla es el **criterio de aceptación de F2** y el guion de `demo.ts`. Sale de leer los fixtures
del PRD §7.4; en F2 se convierte en los casos dorados de las pruebas.

| Mensaje | Adjunto | Remitente | Qué trae el documento | Clasificación | Acción |
|---|---|---|---|---|---|
| `msg-001` | `contrato.txt` | `lgomez@` → Laura Gómez | `CT-2026-015` · Industrias Delta S.A.S. · NIT 890.900.111-4 · COP 265.000.000 · 2026-08-01 → 2027-07-31 · **póliza de cumplimiento 20 %** | `nuevo` | Insertar; archivar en `Contratos/2026/industrias-delta/`; `estado_poliza = pendiente` |
| `msg-002` | `contrato.txt` | `cruiz@` → Carlos Ruiz | `CT-2026-016` · Corporación Andina (RUC 1790012345001 → **país EC**) · USD 120.000 · 2026-08-15 → 2027-08-14 · **sin cláusula de garantías** | `nuevo` | Insertar; `requiere_poliza = false`, `estado_poliza = no_aplica` |
| `msg-003` | `otrosi.txt` | `cruiz@` → Carlos Ruiz | **Otrosí No. 1 al `CT-2026-011`**: extiende el plazo a 2027-11-01 y sube el valor a PEN 520.000 | `actualizacion` | Modificar la fila existente y anotar el cambio en `historial.jsonl` |
| `msg-004` | `contrato.txt` | `lgomez@` → Laura Gómez | Reenvío del `CT-2026-012` (Clínica San Rafael) con valor, inicio y fin **idénticos** a la fila del maestro | `duplicado` | **No escribir nada** (RN1); reportar y marcar como procesado |
| `msg-005` | `cotizacion.txt` | `amolina@` → Andrés Molina | `COT-2026-088`: una **cotización**, sin contrato | `rechazado` | Reportar con motivo «sin adjunto de contrato» (RN4) |
| `msg-006` | `contrato.txt` | `jperez@` → **desconocido** | Contrato marco `CM-2026-03` · Distribuidora Caribe (NIT 800.222.333-9 → CO) · **valor indeterminado** · plazo «12 meses desde la firma» | `nuevo` **con revisión** | **No registrar** en la primera pasada (RN5). Tras «confirmo el valor 0 y la fecha fin 2027-08-31» → registrar |
| | | | | | `requiere_revision` de `msg-006`: `valor` (indeterminado → 0), `fecha_fin` (derivada), `comercial` (remitente fuera de `comerciales.json`: **se reporta, no bloquea**) |

Tres detalles que salen de mirar los datos y que el diseño tiene que sostener:

- **`msg-002` es el mismo cliente que `CT-2026-007`** (Corporación Andina, mismo RUC) pero **otro
  contrato**: no es duplicado ni actualización. Manda el `id_contrato`; el índice por `nit_cliente`
  solo sirve para *sospechar* actualización cuando además el objeto se parece ≥ 0.9.
- **`msg-006` no trae valor numérico**, así que su confianza baja por diseño: es el caso que demuestra
  que el sistema prefiere **preguntar** antes que registrar mal (RN5).
- **El maestro trae contratos ya vencidos** (`CT-2025-018` venció el 2026-06-30 y `CT-2026-002` el
  2026-07-09): el reporte de alertas no debe asumir que todo lo listado está vigente. Queda como
  supuesto en `SOLUCION.md`.

---

## 6. Extracción y confianza: dónde entra el modelo y dónde no

**La extracción es determinista** (`src/core/extraccion.ts` + `normalizacion.ts`): reglas sobre el
texto del contrato, con el diccionario de numerales en español de `INTL` + tabla propia para los
numerales con ordinal («primero (1) de agosto de 2026»). El modelo **no produce los valores que se
registran**: puede proponer, resumir y conversar, y su propuesta se audita contra la extracción.

El flujo por campo es siempre el mismo:

```
texto del contrato → extracción determinista → { valor, confianza, evidencia }
                                                        │
        lo que propuso el modelo ────────────────────►  validación: ¿coincide?
                                                        │
                             coincide → sigue   ·   no coincide → requiere_revision
```

Ejemplos reales de los fixtures, con la confianza que se asigna:

| Campo | Texto en el fixture | Resultado | Confianza |
|---|---|---|---|
| `id_contrato` | `CONTRATO DE PRESTACIÓN DE SERVICIOS No. CT-2026-015` | `CT-2026-015` | 0.99 (patrón exacto en el encabezado) |
| `nit_cliente` | `NIT 890.900.111-4` | `890900111` (sin puntos ni dígito de verificación) | 0.99 |
| `pais` | `NIT` + `Bogotá D.C.` | `CO` | 0.95 (identificador + domicilio coinciden) |
| `valor` | `DOSCIENTOS SESENTA Y CINCO MILLONES DE PESOS M/CTE (COP $265.000.000)` | `265000000` | **0.99** (letras y dígitos coinciden) |
| `valor` | `CIENTO VEINTE MIL DÓLARES … (USD 120,000.00)` | `120000` | 0.95 (solo dígitos, con formato inglés) |
| `valor` | `no tiene un valor determinado` (`CM-2026-03`) | `0` + `valor_indeterminado = true` | **0.5 → revisión** |
| `moneda` | `PESOS` / `SOLES` / `DÓLARES` o el código ISO | `COP` / `PEN` / `USD` | 0.9 (por el numeral) · 0.99 si viene el ISO |
| `fecha_inicio` | `desde el primero (1) de agosto de 2026` | `2026-08-01` | 0.99 (ordinal y dígito coinciden) |
| `fecha_fin` | `hasta el treinta y uno (31) de julio de 2027` | `2027-07-31` | 0.99 |
| `fecha_fin` | `duración de doce (12) meses … desde la fecha de su firma` (`CM-2026-03`) | `2027-08-31` | **0.7 → revisión** (derivada, no escrita) |
| `requiere_poliza` | `constituirá … una póliza de cumplimiento por el veinte por ciento (20 %)` | `true` | 0.95 |
| `requiere_poliza` | documento sin sección de garantías (`CT-2026-016`) | `false` | 0.85 (una ausencia se detecta con menos certeza que una presencia; si la sección existe pero no menciona póliza, baja a 0.6) |
| `tipo_poliza` | `póliza de cumplimiento` · `garantías de cumplimiento y responsabilidad civil` | `cumplimiento` · `cumplimiento;responsabilidad_civil` | 0.9 |
| `objeto` | `PRIMERA. OBJETO. …` | recorte a 200 caracteres | 0.9 |
| `comercial` | `jperez@periferia-ficticia.com` **no está** en `comerciales.json` | `null` | **0.0 → revisión** (se reporta, no bloquea el registro) |

`estado_poliza` no se extrae: se **deriva** (nuevo con póliza → `pendiente`; sin póliza → `no_aplica`;
una actualización conserva el estado existente salvo que el otrosí lo cambie).

### El umbral

`confianza < 0.8` ⇒ el campo entra en `requiere_revision` (RN5). El umbral vive en **una constante**,
no repartido por el código, para poder justificarlo: 0.8 deja fuera lo derivado (0.7) y lo indetectado
(0.0-0.5) y deja pasar lo que tiene evidencia doble. Con los seis mensajes del buzón el resultado es
exactamente el del PRD §7.4: **solo `msg-006` pide confirmación**.

### El detalle que protege contra la alucinación

`contratos_validar` **vuelve a extraer** el texto del adjunto en el servidor y compara campo por campo
con el contrato que le pasó el modelo. Si el modelo «redondeó» el valor, inventó una fecha o cambió el
NIT, la diferencia se marca como revisión en vez de registrarse (CA2 y el riesgo declarado en el PRD
§10). El modelo nunca es la fuente de un valor: la fuente es el texto del documento.

---

## 7. Clasificación: RN1–RN4 sobre el maestro

`src/core/clasificacion.ts` recibe el contrato extraído y el maestro cargado, y devuelve una de cuatro
etiquetas con su evidencia. El maestro se indexa **dos veces** en memoria al cargarlo:

| Índice | Clave | Para qué |
|---|---|---|
| Por contrato | `id_contrato` normalizado (mayúsculas, sin espacios) | Detectar duplicado y actualización por número (cubre el otrosí, que **referencia** el `CT-2026-011`) |
| Por cliente | `nit_cliente` (o RUC) + `objeto` normalizado | Sospechar actualización cuando el id cambió o falta, con similitud ≥ 0.9 (tokens de Jaccard, `normalizar.ts`) |

| Clasificación | Regla | Resultado |
|---|---|---|
| `duplicado` | RN1: mismo `id_contrato` **y** mismos `valor`, `fecha_inicio`, `fecha_fin` | No se escribe nada; se reporta y se marca procesado |
| `actualizacion` | RN2: mismo `id_contrato` con algún campo distinto, **o** el documento se identifica como otrosí | Se actualiza la fila y se anota el cambio en `historial.jsonl` |
| `nuevo` | RN3: no hay coincidencia | Se inserta (con `AUTO-<año>-<secuencia>` si el documento no trae número) |
| `rechazado` | RN4: sin adjunto de contrato, o texto sin partes ni objeto identificables | Se reporta con motivo; no se escribe |

Detalle de los dos casos que se prestan a confusión:

- **Duplicado ≠ mismo cliente.** `msg-002` (Corporación Andina) tiene el mismo NIT que `CT-2026-007` y
  aun así es `nuevo`, porque el `id_contrato` es distinto y el objeto no se parece. Sin el índice por
  contrato este caso se clasificaría mal y **corrompería el maestro** (el objetivo O2 del PRD).
- **Otrosí.** `msg-003` no es un contrato: es un documento que **modifica** el `CT-2026-011`. La
  extracción detecta el encabezado `OTROSÍ No. 1 AL CONTRATO … No. CT-2026-011`, toma el id
  referenciado y produce solo los **cambios** (`fecha_fin`, `valor`); los campos que el otrosí no toca
  se conservan de la fila existente, y `diferencias` los lista para que el chat los muestre.

---

## 8. Escritura: `out/` y sus cinco artefactos

| Ruta | Qué es | Regla |
|---|---|---|
| `out/sharepoint/maestro-contratos.csv` | **Copia** del maestro, que es el único que se escribe | RN6: el fixture es de solo lectura; la primera ejecución lo copia y desde ahí el maestro vive en `out/` |
| `out/sharepoint/Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>` | El documento archivado, como si fuera SharePoint | HU-4: `<cliente-slug>` se deriva de la razón social (minúsculas, sin tildes, guiones) |
| `out/sharepoint/historial.jsonl` | Una línea por cambio: `{ ts, id_contrato, accion, cambios, mensaje_id }` | HU-4 y O2: la actualización **conserva historia** |
| `out/procesados.json` | Ids de mensajes ya resueltos → hace el proceso **idempotente** | HU-1: `leer_buzon` excluye lo ya procesado; dos ejecuciones no duplican |
| `out/alertas.md` | El reporte de riesgos de HU-5 | Se regenera entero en cada llamada a `contratos_alertas` |
| `out/log.jsonl` | `{ ts, herramienta, mensaje_id, ok, resumen }` por cada ejecución de herramienta | RN7 · CA4: es la traza y lo que el front muestra como tarjetas |
| `out/sessions/<id>.json` | Historial, tokens y acción pendiente de cada sesión del chat | Que `GET /api/sessions/:id` devuelva el estado real y recargar no pierda nada |

Dos decisiones de implementación que se documentan porque son las que evitan corromper el maestro:

1. **Escritura atómica**: el CSV se escribe en `maestro-contratos.csv.tmp` y se renombra. Si el proceso
   muere a mitad, el maestro sigue siendo el anterior y no queda una fila a medias.
2. **CSV propio** (`src/core/csv.ts`, ~40 líneas con pruebas): el maestro tiene 16 columnas fijas y
   comillas dobles solo cuando el campo trae coma, comilla o salto. Una dependencia menos que justificar
   y control total del formato que espera SharePoint (la alternativa, `papaparse`/`csv-stringify`,
   queda descartada por tamaño del problema).

Todo acceso a disco pasa por `src/core/io.ts` (devuelve `Resultado<T>`, **nada lanza**) y todo camino
pasa por `rutas.ts`, que confina la lectura a `fixtures/` y la escritura a `out/`.

---

## 9. Alertas (HU-5): tres secciones y una fecha de referencia

`contratos_alertas { hoy }` recibe la fecha como **argumento**, no del reloj: así la demo y las pruebas
son deterministas (PRD §7.3 HU-5). Escribe `out/alertas.md` con tres secciones y devuelve sus datos:

| Sección | Regla | Con `hoy = 2026-09-03` (el del PRD §11) |
|---|---|---|
| **Vencen en ≤ 60 días** | `0 ≤ fecha_fin − hoy ≤ 60`, aún vigentes | `CT-2026-009` (2026-09-30, 27 días) · `CT-2026-004` (2026-10-15, 42 días) |
| **Pólizas pendientes** | `requiere_poliza = true` y `estado_poliza ≠ vigente` | `CT-2026-004` (`pendiente`) · `CT-2026-015` al registrarse (`pendiente`) |
| **Registrados desde el corte** | `fecha_registro ≥ 2026-05-30`, o una línea en `historial.jsonl` desde esa fecha | `CT-2026-015`, `CT-2026-016` y `CT-2026-011` (por el otrosí) → es la prueba del *gap* cubierto |

`CT-2026-012` (2026-11-14) queda **fuera** por 12 días: es el borde que las pruebas fijan para comprobar
que el filtro de 60 días no se corre. Y hay dos contratos ya vencidos en el maestro
(`CT-2025-018`, `CT-2026-002`): el reporte no los mete en «vencen» (ya vencieron) pero los declara en el
propio `alertas.md` como contexto, porque el proceso muerto dejó huecos que este reporte existe para
hacer visibles.

---

## 10. Sesiones, confirmación humana y topes

| Mecanismo | Cómo se implementa | Por qué así |
|---|---|---|
| Sesión | `out/sessions/<id>.json` con historial, tokens acumulados y `accion_pendiente` | Sobrevive a recargar la página y a reiniciar el proceso; `GET /api/sessions/:id` devuelve el estado real |
| Confirmación (CA3) | `contratos_extraer`/`validar` devuelven `requiere_revision`; el turno **termina en pregunta** y deja `accion_pendiente = { mensaje_id, campos[], propuesta }`. En el turno siguiente, solo si el usuario **confirma explícitamente**, `paso.ts` deja pasar `confirmado: true` | Es una regla del **código**, no del prompt: el modelo no puede saltársela aunque lo intenten convencer. Además `contratos_registrar` vuelve a negarse si `requiere_revision` no está vacío y no viene `confirmado` |
| La confirmación viaja al front | La respuesta del turno incluye `needsConfirmation` (§6.4) y el front resalta la banda | El PRD §6.1 pide que se **vea** cuándo el agente espera confirmación |
| Tope de iteraciones (CA1) | 25 vueltas herramienta → modelo por turno (`MAX_ITERACIONES`) | Pedido por el PRD §6.3; al alcanzarlo el agente responde con lo que tiene y lo que falta, en vez de girar |
| Tope de gasto | 200 000 tokens por sesión (`MAX_TOKENS_SESION`) | PRD §8: un usuario no puede gastar la clave sin límite |
| Timeout del proveedor | `LLM_TIMEOUT_MS` (3 min); al agotarse, el turno devuelve un error legible y la sesión sigue | PRD §8 Robustez + CA5: un fallo no mata la sesión |
| Errores de herramienta | Siempre `{ ok: false, error }` con texto claro; el ciclo lo devuelve al modelo y **no aborta el lote** | HU-6: si `msg-003` trae una fecha inválida, `msg-004` se sigue procesando |

El front tiene tres estados visibles, y el tercero es el que demuestra CA3:
`pensando` → `llamando a <herramienta>` (tarjeta por llamada) → **`esperando confirmación`** (banda
ámbar con los campos y el botón de confirmar).

---

## 11. Mapa de archivos planificado

Cada archivo con su fase: **F0** es lo que ya existe (setup), y el resto es el plan comprometido.

```
reto-02/                              raíz del repo y del entregable (.zip = esta carpeta)
├── PRD.md                            entregado por Periferia (no se toca)
├── README.md                         F0 · documento maestro
├── SOLUCION.md                       F5 ✅ · las 11 secciones del PRD §9.1 + regla de gobierno
├── docker-compose.yml                F5 ✅ · `docker compose up --build`
├── .dockerignore                     F5 ✅ · qué no entra en la imagen
├── .gitignore                        F0 · reglas de todo el árbol
├── fixtures/reto-02/                 entregado · 14 archivos (buzón, maestro, comerciales)
└── solucion/                         la aplicación
    ├── .env.example                  F0 · las 16 variables documentadas
    ├── .gitignore                    F0 · portabilidad de esta carpeta
    ├── docs/                         F0 · arquitectura.md y repo-setup.md
    ├── Dockerfile                    F5 ✅ · node:24-alpine, sin build, HEALTHCHECK y usuario `node`
    ├── package.json · tsconfig.json  F1 · stack y contrato de calidad
    ├── demo.ts                       F2 ✅ · los 6 mensajes sin modelo (PRD §6.6)
    ├── agent/prompt.md               F3 · comportamiento del agente
    ├── src/knowledge/registro-contratos.md   F3 · conocimiento del proceso
    ├── src/core/                     18 módulos deterministas (F1 ✅)
    ├── src/tools/                    F2 ✅ · el contrato de herramientas y las cinco `contratos_*`
    ├── src/demo/                     F2 ✅ · la lógica del recorrido sin modelo
    ├── src/agent/ · src/llm/         F3 · ciclo, sesiones y proveedores
    ├── src/server.ts + src/server/   F3 · API, SSE y estáticos
    ├── web/                          F4 · front de chat sin build
    ├── test/ · test-utils/           F1–F6 · pruebas por capa
    └── out/                          generado en ejecución (solo .gitkeep versionado)
```

### `src/core/`: el motor determinista (F1)

| Archivo | Qué hace |
|---|---|
| `rutas.ts` | Resuelve raíz, `fixtures/` y `out/` desde `ctx.directory`; valida ids (`^msg-\d{3}$`) y **confina** toda ruta (impide `../`) |
| `io.ts` | Lectura/escritura con `Resultado<T>`: ninguna función lanza |
| `tipos.ts` | `Contrato`, `Mensaje`, `FilaMaestro`, `Clasificacion`, `Confianza`, `Resultado<T>`: un solo vocabulario |
| `csv.ts` | Leer y escribir el maestro con comillas correctas; `escribirAtomico()` (`.tmp` + rename) |
| `maestro.ts` | Carga la copia de `out/`, construye los dos índices y resuelve filas por id y por cliente |
| `buzon.ts` | Descubre y valida `correo.json` de cada mensaje; decide `tiene_contrato` |
| `extraccion.ts` | El corazón de HU-2: saca los campos del texto con regex y estructura de cláusulas |
| `normalizacion.ts` | Numerales en español, fechas («primero (1) de agosto de 2026»), valores monetarios, NIT/RUC, slugs |
| `clausulas.ts` | Trocea el documento en cláusulas y separa el encabezado del cuerpo cuando van en la misma línea |
| `identificadores.ts` | NIT/RUC/RTN → país, sin dígito de verificación; slug de carpeta; similitud de objetos (Jaccard) |
| `comerciales.ts` | Carga `comerciales.json` y resuelve el remitente del correo |
| `entorno.ts` | Convierte `ctx.directory` en escritor confinado, rutas de datos y fecha de referencia |
| `clasificacion.ts` | RN1–RN4: duplicado, actualización (incluido el otrosí), nuevo, rechazado |
| `archivado.ts` | Ruta destino `Contratos/<año>/<slug>/<id>.<ext>` y copia del documento |
| `historial.ts` | `historial.jsonl` y `procesados.json`: cambios y idempotencia |
| `alertas.ts` | Las tres secciones de HU-5 y el `alertas.md` |
| `log.ts` | `out/log.jsonl`: una línea por ejecución de herramienta (RN7) |

### El resto

| Archivo | Fase | Qué hace |
|---|---|---|
| `src/tools/contratos.ts` | F2 ✅ | Las cinco herramientas `contratos_*`, con `args` en zod y `execute` que devuelve string |
| `src/tools/contexto.ts` | F2 ✅ | Lo común: construir el entorno desde `ctx`, cargar maestro y comerciales, leer el documento, registrar y **auditar** lo propuesto |
| `src/tools/contrato.ts` | F2 ✅ | La forma de una herramienta (PRD §6.2) y los ayudantes de respuesta (`exito`, `fallo`, `responder`) |
| `src/agent/loop.ts` · `paso.ts` · `confirmacion.ts` · `sesion.ts` · `eventos.ts` · `prompt.ts` | F3 ✅ | El ciclo, sus topes, la validación/auditoría, la confirmación humana (RN5) y la sesión |
| `src/llm/adapter.ts` · `ollama.ts` · `openai.ts` · `mock.ts` · `fabrica.ts` | F3 ✅ | La interfaz del PRD §6.1 y sus tres implementaciones; el `mock` sirve dos guiones: el secuencial de las pruebas y el **reactivo** (lee la conversación) que usa la aplicación servida |
| `src/server.ts` + `src/server/{aplicacion,chat,estaticos,front,identificadores,memoria}.ts` | F3 ✅ | Las rutas del PRD §6.4, el stream SSE, el servicio de `out/` y el front estático cuando exista |
| `agent/prompt.md` + `src/knowledge/registro-contratos.md` | F3 ✅ | Comportamiento y conocimiento del proceso, fuera del código (PRD §6.5) |
| `web/{index.html,estilos.css,app.js,sse.js}` | F4 ✅ | El chat: historial, tarjetas de herramienta, banda de confirmación, panel del buzón y enlaces a lo generado |
| `demo.ts` + `src/demo/recorrido.ts` | F2 ✅ | Los 6 mensajes llamando a las herramientas, sin modelo ni claves |
| `test/*` · `test-utils/*` | F1–F6 | Pruebas por capa; `test-utils` copia `out/` a un directorio temporal |

---

## 12. Decisiones y trade-offs

Estas son las que hay que poder defender; alimentan directamente la §7 de `SOLUCION.md`.

| # | Decisión | Alternativa descartada | Costo que se asume |
|---|---|---|---|
| 1 | **La extracción es determinista**; el modelo conversa, propone y resume, pero el valor que se registra nace del texto por reglas, y `validar` audita lo que el modelo propuso | Dejar que el modelo extraiga y devuelva los campos (JSON mode / function calling) | Hay que mantener reglas cuando llegue una redacción nueva. Mitigación: lo que no se entiende queda en **revisión**, no en el maestro; y el patrón nuevo se agrega a la extracción con su prueba |
| 2 | **La confirmación humana es código**, con estado (`accion_pendiente`) y un turno explícito | Confiar en que el prompt pida confirmación | Más estado por sesión y pruebas del caso «usuario dice *sí* sin que hubiera nada pendiente» |
| 3 | **Los fixtures se usan en su sitio** (`FIXTURES_DIR`, por defecto `../fixtures/reto-02`), nunca se copian dentro de `solucion/` | Duplicar los fixtures dentro de la app para tener la estructura plana del PRD §6.5 | Una constante de rutas y que la imagen de Docker copie dos carpetas |
| 4 | **El maestro se trabaja sobre una copia en `out/`** (RN6), con escritura atómica y `procesados.json` para la idempotencia | Escribir sobre una «copia de trabajo» en `fixtures/` o llevar el maestro solo en memoria | Un paso de arranque (copiar si no existe) y hay que documentar que `out/` es borrable |
| 5 | **CSV propio** (~40 líneas con pruebas) en vez de una librería | `papaparse` / `csv-stringify` | Formato bajo control y una dependencia menos; el costo es el código propio |
| 6 | **Front sin bundler**: HTML + CSS + módulos ES, servido por el backend | React/Svelte/Vue con Vite | Sin componentes: la pantalla se arma con funciones y plantillas; la suite prueba `app.js` en un DOM mínimo en vez de con un navegador real |
| 7 | **`mock` de primera clase**, junto a `ollama` y `openai` | Depender siempre del modelo real | Un adaptador más que mantener y actualizar cuando cambien las herramientas; a cambio, la demo y las pruebas corren sin claves, sin red y sin descargar 5 GB |
| 8 | **`hoy` como argumento** de `contratos_alertas` (y `FECHA_EJECUCION` como valor por defecto) | Usar el reloj del sistema | Hay que pasar la fecha en la demo y las pruebas; a cambio, el resultado es reproducible (PRD §8 Determinismo) |

---

## 13. Plan de pruebas

Todo con `node:test`, sin modelo y sin red: el proveedor `mock` cubre el ciclo, y los fixtures cubren
los datos. Las pruebas escriben siempre en un `out/` temporal (`test-utils/`), nunca en el del repo.

| Suite | Qué fija | Fase |
|---|---|---|
| `csv.test.ts` | Comillas, comas y saltos dentro de un campo; la escritura atómica deja el archivo anterior intacto si falla | F1 ✅ |
| `normalizacion.test.ts` | Numerales en español («doscientos sesenta y cinco millones»), fechas ordinales («primero (1) de agosto de 2026»), importes locales e ingleses, monedas, NIT/RUC → país, slugs y similitud | F1 ✅ |
| `entrada.test.ts` | El buzón (seis mensajes; contrato vs otrosí vs cotización) y RN6: el fixture se copia a `out/` intacto | F1 ✅ |
| `extraccion.test.ts` | **Casos dorados**: los seis documentos del buzón, campo por campo, con su confianza y su evidencia | F1 ✅ |
| `clasificacion.test.ts` | RN1–RN5 sobre los seis mensajes **y** casos sintéticos: objeto idéntico con número nuevo, otrosí de contrato desconocido, número automático | F1 ✅ |
| `alertas.test.ts` | Los bordes de los 60 días con `hoy = 2026-09-03` (dentro: `CT-2026-004` y `CT-2026-009`; fuera por 12 días: `CT-2026-012`) | F1 ✅ |
| `herramientas.test.ts` | El contrato del PRD §6.2 (string JSON, `{ ok }` en ambos caminos, **no lanza**, ids raros rechazados), la **auditoría anti-alucinación (CA2)**, la negativa a registrar sin confirmación (RN5) y el log de cada ejecución (RN7) | F2 ✅ |
| `demo.test.ts` | El recorrido completo: la tabla del PRD §7.4, `msg-006` sin registrar, la segunda pasada con `confirmado: true`, la idempotencia y dos corridas idénticas sobre `out/` limpio | F2 ✅ |
| `bucle.test.ts` | Tope de 25 iteraciones y de tokens (CA1), confirmación solo con un «sí» del turno anterior (CA3 · RN5), anti-alucinación (CA2), duplicado que no escribe (RN1), proveedor que falla sin matar la sesión (CA5) y la detección de la confirmación con la puntuación real («sí, confirmo») | F3 ✅ |
| `api.test.ts` | `POST /api/chat` (SSE y `?json=1`), `GET /api/sessions/:id`, `GET /api/health`, `GET /api/files/*` sin escapes, el front servido en la raíz y que ninguna respuesta contenga la clave (con `inject()`, sin abrir puerto) | F3 ✅ |
| `front-navegador.test.ts` | `web/app.js` ejecutándose en un DOM mínimo contra el backend real: arranque, un turno completo con sus cinco tarjetas, la banda de confirmación, el botón «Sí, confirmo» que **registra en el maestro**, el envío por clic, el mensaje vacío y el fallo de red | F4 ✅ |
| `paridad-modulo.test.ts` | Que `modulo/agent.md`, `modulo/tools/contratos.ts` y `modulo/skill/registro-contratos/SKILL.md` sigan siendo **las mismas piezas** que usa la app (el bonus se evalúa así) | F6 |

Meta: **~120 pruebas en verde** y `npm run typecheck` con 0 errores y **cero `any`** — el mismo listón
del reto 01, que es el que ya se sabe sostener.

---

## 14. Riesgos técnicos y cómo se mitigan

| Riesgo | Mitigación en el diseño |
|---|---|
| **Falso duplicado** por variaciones del nombre del cliente (PRD §10) | El dedupe va por `id_contrato` primero y por `nit_cliente` después; el nombre solo entra en la similitud de objeto con umbral 0.9 |
| El modelo «redondea» el valor o inventa una fecha (PRD §10) | El valor sale del texto por reglas y `validar` audita la propuesta del modelo; la discrepancia es revisión, no escritura |
| Numerales o formatos que la extracción no entiende | La confianza baja a 0 y el campo entra en revisión con la evidencia; el humano confirma y el patrón se agrega con su prueba |
| Un mensaje roto tumba el lote (HU-6) | Las herramientas nunca lanzan: devuelven `{ ok: false, error }` y el ciclo continúa con el siguiente mensaje |
| Escribir mal el maestro y dejarlo a medias | Copia en `out/` (nunca el fixture), escritura atómica y `procesados.json` para no reprocesar |
| El contexto del prompt no cabe (medido en **este** reto: **5 735 tokens** solo en prompt + esquemas) | `OLLAMA_NUM_CTX=8192` (con la ventana por defecto, 4 096, Ollama rechaza la petición); si el conocimiento crece mucho, el prompt lo resume y el resto se consulta por herramienta |
| PDFs escaneados (sin texto) | Fuera de alcance declarado (PRD §3.2): los fixtures traen `.txt`; `contratos_leer_pdf` es P1 y solo para PDF con texto |
| Fuga de la clave del modelo | Se lee solo de `process.env` en `llm/fabrica.ts`; no se registra ni se devuelve por la API; `.env` ignorado y checklist de seguridad en `docs/repo-setup.md` |
| Dos procesos escribiendo el maestro a la vez | Fuera de alcance (sin base de datos, un solo proceso); la escritura atómica evita el archivo corrupto. Queda como límite declarado |

---

## 15. Fases y criterio de salida

| Fase | Contenido | Criterio de salida |
|---|---|---|
| **F0** ✅ | Setup: repositorio, `.gitignore`, `out/.gitkeep`, `.env.example`, este documento y `repo-setup.md`, README maestro | Árbol limpio, `git status` limpio, ignores verificados con `git add -A --dry-run` |
| **F1** ✅ | `package.json`, `tsconfig.json` y `src/core/`: 18 módulos deterministas con 53 pruebas | **Cumplido:** `npm run typecheck` 0 errores y las seis suites de `core` en verde con los 6 mensajes del buzón y sus casos sintéticos |
| **F2** ✅ | `src/tools/contratos.ts`, `src/tools/contexto.ts` y `demo.ts` + `src/demo/` | **Cumplido:** `npm run demo` imprime `6/6` clasificados (3 registrados, 1 duplicado, 1 en revisión, 1 sin escribir), la segunda pasada con `--confirmar` registra `msg-006` y volver a correrlo no duplica ni una fila (PRD §6.6) |
| **F3** ✅ | `src/agent/`, `src/llm/`, `src/server*`, `agent/prompt.md`, `src/knowledge/` | **Cumplido:** el prompt del PRD §11 se ejecuta contra Ollama real (`granite4.1:8b`: `/api/health` responde con proveedor y modelo, y el modelo llama de verdad a `contratos_*` con la traza en `out/log.jsonl`) y contra `mock` (recorrido completo, determinista, en las pruebas); `bucle.test.ts` (13) y `api.test.ts` (7) en verde y `typecheck` sin errores. **Medido:** el turno completo del buzón contra el 8B local tardó **182,6 s en 12 llamadas** de herramienta (registró los dos contratos nuevos y el otrosí, reportó el duplicado y el rechazado y pidió confirmación por `msg-006`); por eso el prompt pide procesar mensaje a mensaje |
| **F4** ✅ | `web/` | **Cumplido:** el recorrido de 5 minutos del README se puede hacer con ratón —cada llamada a `contratos_*` aparece como tarjeta con su resumen, la banda de confirmación se resalta (RN5) y lo generado se descarga desde el panel— y `front-navegador.test.ts` ejecuta `web/app.js` de verdad en un DOM mínimo contra el backend con `inject()` (7 pruebas) |
| **F5** ✅ | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `SOLUCION.md` (11 secciones + regla de gobierno) y publicación del link | **Cumplido** el despliegue: `docker compose up --build` construye la imagen `reto-02-agente-contratos` (71 paquetes de producción), el contenedor queda **healthy** (HEALTHCHECK sobre `/api/health`), el front y la API responden desde el contenedor y `out/` se escribe en `solucion/out/` del host; `SOLUCION.md` completo, sin secciones vacías. **Pendiente:** publicar el link (túnel o plataforma, README §8) |
| **F6** | `modulo/` (bonus) + `test/paridad-modulo.test.ts` | El test de paridad falla si las tres piezas se separan de la app |

