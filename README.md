# Reto 02 · Agente conversacional «Registro de Contratos Vigentes»

> Periferia IT Group · Equipo Perxia 2.0
> TypeScript sobre Node 24 · front estático sin build · `granite4.1:8b` en Ollama local · Docker opcional
> El agente registra, archiva y alerta. **Lo que no está claro lo confirma una persona.**

Este README es el documento maestro del entregable: cómo levantarlo, **con qué está hecho y por qué**,
cómo se eligió el modelo, **qué hace cada archivo del repositorio**, cómo se corre `demo.ts` y una guía
para la sustentación. El detalle de diseño está en [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md)
y las decisiones de repositorio en [`solucion/docs/repo-setup.md`](solucion/docs/repo-setup.md).

| Quiero… | Sección |
|---|---|
| Levantarlo y verlo funcionando | [1. Arranque](#1-arranque-un-comando) |
| Saber el stack y por qué cada pieza | [2. Stack](#2-stack-con-qué-está-hecho-y-por-qué) |
| Entender la elección del modelo | [3. El modelo](#3-el-modelo-elección-mediciones-y-costo) |
| Saber qué hace cada archivo | [4. Estructura](#4-estructura-del-repositorio-archivo-por-archivo) |
| Correr la demo sin modelo | [5. `demo.ts`](#5-demots-las-herramientas-sin-modelo-f2) |
| Correr las pruebas | [6. Pruebas](#6-pruebas-automáticas-f1-en-adelante) |
| Configurar variables | [7. Variables de entorno](#7-variables-de-entorno) |
| Preparar la defensa | [9. Guía para la sustentación](#9-guía-para-la-sustentación) |
| Cómo está diseñado por dentro | [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) |

---

## 0. Estado del entregable

Este reto se construye por fases; el historial de commits las sigue una a una. Hoy el repositorio está
en **F1 (motor determinista)**: `src/core/` completo —extracción, confianza, clasificación, maestro,
archivo y alertas— con **53 pruebas en verde** y `typecheck` sin errores. **Todavía no hay herramientas,
agente ni front** (`src/tools/`, `web/`, `demo.ts`), y por eso los comandos de §1 se marcan según lo que
ya funciona.

| Fase | Feature | Rama | Qué entrega | Estado |
|---|---|---|---|---|
| **F0** | `setup` | `main` | Repositorio, `.gitignore`, `out/.gitkeep`, `.env.example`, arquitectura y README | ✅ **hecho** |
| **F1** | `core` | `main` | `package.json`, `tsconfig.json` y `src/core/`: 18 módulos deterministas con **53 pruebas** | ✅ **hecho** |
| **F2** | `tools` | `f02-tools` | Las cinco herramientas `contratos_*` + `demo.ts` (los 6 mensajes sin modelo) | ⏳ siguiente |
| **F3** | `agente-llm-api` | `f03-agente-llm` | Ciclo del agente, adaptadores de proveedor (ollama/openai/mock), API HTTP y system prompt | ⏳ |
| **F4** | `web` | `f04-web` | Front de chat: tool-calls visibles y banda de confirmación | ⏳ |
| **F5** | `deploy-solucion` | `f05-deploy` | Docker, `SOLUCION.md` (11 secciones + regla de gobierno) y link público | ⏳ |
| **F6** | `modulo` (bonus) | `f06-modulo` | Agente empaquetado reutilizable + test de paridad con la app | ⏳ |

Cada fase es **una feature con nombre propio**, y ese nombre es el mismo de la rama y del mensaje de
commit (`feat(core)`, `feat(tools)`, `feat(agent)`…). La convención completa, con los mensajes listos para
copiar, está en [`solucion/docs/repo-setup.md`](solucion/docs/repo-setup.md) §5.

---

## 1. Arranque (un comando)

```bash
cd reto-02/solucion
npm install
npm run dev          # front de chat + API en http://127.0.0.1:3000
```

Eso levanta las dos piezas (el backend sirve el front) y tarda menos de un minuto con las dependencias
ya descargadas.

### Qué funciona hoy (F0) y qué llega con cada fase

| Comando | Hoy | Llega en |
|---|---|---|
| `npm install` | ✅ funciona (75 paquetes, ~4 s) | — |
| `npm run typecheck` | ✅ **0 errores**, cero `any` | — |
| `npm test` | ✅ **53 pruebas**, sin modelo y sin red | F2→F6 (hasta ~120) |
| `npm run demo` | — | F2 (los 6 mensajes del buzón, sin modelo) |
| `npm run dev` | — | F3 (API + ciclo) y F4 (front) |
| `docker compose up --build` | — | F5 |
| Leer la arquitectura ya decidida | ✅ | [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) |
| Ver el diseño del esquema y las reglas | ✅ | [§7 del PRD](PRD.md) y §6-§8 de la arquitectura |

### Con Docker, sin instalar Node ni dependencias (F5)

```bash
cd reto-02
docker compose up --build     # lo mismo, en http://127.0.0.1:3000
```

### Para que el agente responda de verdad hace falta un modelo

```bash
ollama pull granite4.1:8b     # 5,3 GB · máquina con ~16 GB de RAM
ollama serve                  # normalmente ya corre como servicio
```

Si Ollama corre en tu máquina y usas **Docker**, no hay que tocar nada más: el contenedor apuntará a
`http://host.docker.internal:11434`. Si copias `.env.example` a un `.env`, deja ahí ese mismo valor (un
`localhost` dentro del contenedor sería el propio contenedor, no tu máquina).

**Sin modelo también arranca**, y es lo que recomiendo para una primera mirada:

```bash
cd reto-02/solucion && LLM_PROVIDER=mock npm run dev
```

`mock` no es un agente: es un guion fijo que permite recorrer la pantalla completa (tarjetas de
herramienta, confirmación y archivos) sin descargar nada y sin claves.

### Requisitos

| Requisito | Versión | Nota |
|---|---|---|
| Node | **≥ 22.18** (probado en 24.19) | Ejecuta TypeScript directamente, sin compilar |
| Ollama | opcional | Solo para el agente real; `granite4.1:8b` es el modelo del entregable |
| Docker | opcional | Probado con Docker 29.6.2 + Compose v5.3.1 (reto 01, mismo stack) |

---

## 2. Stack: con qué está hecho (y por qué)

Es el **mismo stack probado en el reto 01** (mismo runtime, mismo servidor, misma disciplina de tipos),
menos dos dependencias que aquí no hacen falta y una que se escribe a mano.

| Capa | Elección | Versión | Por qué esta y no otra |
|---|---|---|---|
| Runtime | **Node** | 24.19 (`engines ≥22.18`) | Ejecuta TypeScript **directamente** (borrado de tipos nativo): sin paso de compilación, sin `ts-node`, sin `dist/`. Menos piezas que mantener. `tsconfig` usa `erasableSyntaxOnly`, que prohíbe la sintaxis que Node no sabe borrar |
| Lenguaje | **TypeScript** | 7.0 | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; **cero `any`** en todo el proyecto |
| API HTTP | **Fastify** | 5.12 | Rápido, tipado y con `inject()`: las pruebas ejercitan las rutas sin abrir un puerto |
| Servir el front | **@fastify/static** | 10.1 | El mismo proceso sirve API, front y archivos generados: un comando, un puerto, cero CORS |
| Validación de argumentos | **zod** | 4.6 | Lo exige el PRD §6.2/§8. Los esquemas se publican al modelo como JSON Schema **y** validan antes de ejecutar: el modelo no puede pedir una ruta con `../` |
| CSV (maestro) | **propio** (`src/core/csv.ts`) | ~40 líneas | El maestro son 16 columnas fijas, con comillas dobles solo cuando el campo trae coma, comilla o salto. Una dependencia menos que justificar y control del formato que espera SharePoint |
| Similitud de textos | **propio** (`normalizar.ts`, tokens + Jaccard) | ~30 líneas | Solo se usa para sospechar actualización con umbral 0.9 (PRD §7.3 RN2); una librería de distancia sería más código del que ahorra |
| Fechas y numerales | **`Date` en UTC + `Intl` + tabla propia** | — | El dominio es `YYYY-MM-DD` sin zonas horarias; los ordinales en español («primero (1) de agosto de 2026») se resuelven con una tabla pequeña y explícita |
| Modelo | **Ollama + `granite4.1:8b`** | — | Local, sin claves, con *tool calling*. Detalle en §3 |
| Front | **HTML + CSS + módulos ES** | — | El PRD §0 lo admite y §8 pide un comando: sin bundler no hay build que se rompa. La pantalla tiene poco estado: historial, un turno y una banda de confirmación |
| Empaquetado | **Docker + Compose** | F5 | `docker compose up --build` levanta todo sin instalar Node |
| Pruebas | **`node:test`** | incluido en Node | Sin *test runner* externo: `node --test` corre también los `.ts` |

### Dependencias directas: tres para producir, dos para construir

| Dependencia | Tipo | Para qué |
|---|---|---|
| `fastify` | producción | El servidor HTTP |
| `@fastify/static` | producción | Servir el front y los archivos generados |
| `zod` | producción | Contrato y validación de las herramientas (obligatorio por el PRD) |
| `typescript` | desarrollo | Solo para `tsc --noEmit`: en ejecución **no** se usa |
| `@types/node` | desarrollo | Tipado de la plataforma |

**Lo que deliberadamente no se usó**, y por qué (útil si lo preguntan):

- **Nada de `exceljs` ni `pdfkit`**: el reto 01 los necesitaba porque su salida era un formulario `.xlsx`
  y un PDF. Aquí la salida es el **CSV** del maestro, un **Markdown** de alertas y **JSONL** de trazas.
- **Nada de librería de CSV** (`papaparse`, `csv-stringify`): resolverían un problema más grande que el
  nuestro; el formato es fijo y está cubierto con pruebas.
- **Nada de bundler de front** (Vite, Webpack): añadiría un paso de build obligatorio.
- **Nada de framework de front**: el estado de la pantalla es una sesión y un turno.
- **Nada de ORM ni base de datos**: el maestro *es* un CSV y las sesiones son archivos; el PRD §3.2 lo
  declara no-objetivo.
- **Nada de `dotenv`**: Node ya lee `.env` de forma nativa (`--env-file-if-exists`, ver §7).
- **Nada de *test runner* externo** (Jest, Vitest): `node:test` viene en Node y corre TypeScript.
- **Nada de OCR**: el PRD §3.2 lo excluye expresamente.
- **Nada de cola de trabajos**: seis mensajes en el buzón y un turno por conversación.

---

## 3. El modelo: elección, mediciones y costo

**`granite4.1:8b` servido por Ollama local**, detrás de la interfaz propia que pide el PRD §6.1
(`src/llm/adapter.ts` · `enviar(mensajes, herramientas)`): cambiar de modelo o de proveedor es cambiar
una variable de entorno, no tocar el ciclo del agente.

| Criterio | Por qué este modelo |
|---|---|
| Costo | 0 por caso: corre en la máquina, sin claves ni cuotas |
| Licencia | Apache 2.0 (IBM), sin restricciones de uso comercial |
| *Tool calling* | **Verificado** de extremo a extremo en el reto 01 con el mismo contrato de herramientas, **incluido el turno de confirmación** |
| Tamaño | 5,3 GB cuantizado: cabe en 16 GB de RAM junto al sistema y el KV cache |
| Dominio | Orientado a empresa (GRC, *compliance*) y con salida JSON estructurada, que es el formato del contrato |
| Español | Entiende contratos redactados en español y responde en español sin instrucciones exóticas |

Descartados, con la razón: `qwen3:4b-instruct` (2,5 GB) **no pasa** el turno de confirmación;
`qwen3:14b` y los modelos de 30B no caben o disparan la latencia; las APIs de pago quedaron **como
alternativa lista** (`openai.ts`), no como requisito.

### Mediciones

Mientras este reto no tenga su propio instrumento, se apoya en lo **medido** en el reto 01 con el mismo
proveedor y el mismo tipo de contrato (cinco herramientas con esquemas zod):

| Qué | Medición heredada del reto 01 |
|---|---|
| Prompt + esquemas de cinco herramientas | **4 179 tokens** → por eso la ventana por defecto de Ollama (4 096) no alcanza y se pide **8 192** (`OLLAMA_NUM_CTX`) |
| Un turno con modelo local | **26–70 s** según lo que haga el turno · **66 s** dentro de un contenedor apuntando al modelo del host |
| Tokens por turno | ≈ **14 500** |
| Coste con proveedor de pago (0,15/0,60 USD por millón de tokens) | ≈ **0,005 USD/caso** |
| Coste con el modelo local | **0 USD** (la energía de la máquina) |

**Lo que falta medir, y se mide en F3** cuando existan el prompt y el conocimiento de este reto: el
tamaño exacto de `agent/prompt.md` + `src/knowledge/registro-contratos.md` + los esquemas, y el tiempo
por turno procesando los seis mensajes del buzón. Esas cifras se **escriben cuando se midan**, no se
estiman: la tabla de §9.5 solo tendrá números reales.

### Cómo se cambia de modelo (sin tocar código)

```bash
LLM_PROVIDER=ollama OLLAMA_MODEL=granite4.1:8b npm run dev          # por defecto
LLM_PROVIDER=openai OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini npm run dev
LLM_PROVIDER=mock npm run dev                                      # guion fijo, sin modelo
```

`GET /api/health` declara en caliente qué está activo y **no expone ninguna clave**:

```bash
curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"provider":"ollama","model":"granite4.1:8b","herramientas":[…]}
```

---

## 4. Estructura del repositorio, archivo por archivo

Tres clases de contenido, para que no haya dudas de qué es fuente, qué es entregado y qué es salida:

| Clase | Qué es | Se versiona |
|---|---|---|
| **Fuente** | Código, front, documentación y configuración propias | Sí |
| **Entregado por Periferia** | `PRD.md` y `fixtures/reto-02/` (14 archivos) | Sí, **sin modificar** |
| **Generado en ejecución** | `solucion/out/` (maestro copiado, archivos, alertas, historial, log, sesiones) | No (`.gitignore`) |

La columna **Fase** dice cuándo existe cada archivo: **F0 ✅** ya está en el repositorio, el resto es el
plan comprometido de §0 y de [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) §11.

```
reto-02/                              ← raíz del repo y del entregable (.zip = esta carpeta)
├── PRD.md                            enunciado de Periferia
├── README.md                         este documento
├── SOLUCION.md                       planteamiento (§9.1): 11 secciones + regla de gobierno  [F5]
├── docker-compose.yml                `docker compose up --build`                            [F5]
├── .dockerignore                     qué NO entra en la imagen                                [F5]
├── .gitignore                        reglas de todo el árbol
├── fixtures/reto-02/                 buzón de 6 mensajes, maestro congelado y comerciales
└── solucion/                         la aplicación
    ├── .env.example                  las 16 variables documentadas, sin valores
    ├── .gitignore                    lo mínimo para reutilizar esta carpeta como base
    ├── docs/                         arquitectura.md y repo-setup.md
    ├── package.json                  dependencias, scripts y engines                        [F1 ✅]
    ├── package-lock.json             versiones exactas (sí se versiona)                      [F1 ✅]
    ├── tsconfig.json                 TypeScript estricto, sin emitir                          [F1 ✅]
    ├── demo.ts                       los 6 mensajes sin modelo (PRD §6.6)                    [F2]
    ├── agent/prompt.md               comportamiento del agente (system prompt)               [F3]
    ├── src/knowledge/                conocimiento del proceso que el agente consulta         [F3]
    ├── src/core/                     18 módulos deterministas (F1 ✅)
    ├── src/tools/                    las cinco herramientas `contratos_*`                     [F2]
    ├── src/agent/                    ciclo, sesiones y confirmación humana                    [F3]
    ├── src/llm/                      adaptadores de proveedor (ollama · openai · mock)        [F3]
    ├── src/server.ts + src/server/   API HTTP, stream SSE y front estático                    [F3]
    ├── web/                          front de chat (HTML, CSS, JS sin build)                  [F4]
    ├── test/                         pruebas automáticas (~120 previstas)                     [F1–F6]
    ├── test-utils/                   utilidades y dobles de prueba (no son pruebas)           [F1 ✅]
    └── out/                          salida generada (solo su .gitkeep se versiona)
```

### 4.1 Raíz del repositorio y documentación

| Archivo | Qué hace | Por qué existe | Fase |
|---|---|---|---|
| `PRD.md` | El enunciado del reto | Entregado por Periferia: es la referencia de los números de sección que se citan en todo el código y la documentación | ✔ |
| `README.md` | Este documento maestro | **Un comando** para levantarlo (PRD §9.2), el stack, el mapa de archivos y la guía de sustentación | F0 ✅ |
| `SOLUCION.md` | Planteamiento completo: las 11 secciones del PRD §9.1 + la regla de gobierno de §7.5 | Es lo que evalúa «cómo pensaste», no solo qué corriste | F5 |
| `docker-compose.yml` | Servicio con build, puerto, variables, volumen `out/` y `host.docker.internal` | Da el «un comando» del PRD §8 sin instalar Node | F5 |
| `.dockerignore` | Excluye `node_modules`, `out/`, `.env`, `.git`, zips y `.DS_Store` | Evita que la imagen arrastre dependencias del host y secretos | F5 |
| `.gitignore` | Secretos, dependencias, `out/*`, `*.jsonl`, cachés, basura de SO/IDE, tooling de agentes, `*.zip` | Que el repo sea entregable: el PRD §9.5 prohíbe `node_modules`, `out` y `.env` | F0 ✅ |
| `fixtures/reto-02/**` | El buzón de 6 mensajes, el maestro congelado al 2026-05-30 y los comerciales | Datos del cliente: **no se modifican** y no se copian dentro de la app (§12 de la arquitectura, decisión 3) | ✔ |

### 4.2 `solucion/`: configuración y documentación

| Archivo | Qué hace | Por qué existe | Fase |
|---|---|---|---|
| `.env.example` | Las 16 variables con su explicación y sus valores por defecto | Documentación ejecutable de la configuración; `.env` está ignorado | F0 ✅ |
| `.gitignore` | Lo mínimo para que esta carpeta se pueda reutilizar como base de otro reto | Portabilidad: no arrastra basura de este reto | F0 ✅ |
| `docs/arquitectura.md` | El diseño completo: capas, contrato de herramientas, flujo por mensaje, extracción y confianza, clasificación, `out/`, alertas, decisiones y plan de pruebas | Es el contrato de lo que se construye; evita decidir sobre la marcha | F0 ✅ |
| `docs/repo-setup.md` | Cómo está armado el repositorio: ignores con su porqué, los dos commits de F0, convención de commits, checklist de seguridad y plan del entregable | Que las decisiones de entrega estén escritas y no en la cabeza de nadie | F0 ✅ |
| `package.json` | Dependencias, 4 scripts (`test`, `typecheck`, `demo`, `dev`) y `engines: >=22.18` | Un comando (`npm run dev`) y un runner sin dependencias extra | F1 ✅ |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, sin emitir | Es el contrato de calidad: sin `any` y con la sintaxis que Node puede borrar | F1 ✅ |

### 4.3 `src/core/`: el motor determinista (sin modelo) · F1 ✅

Aquí **no hay lenguaje natural**: es el código que extrae los valores, decide la clasificación y escribe.
Es la razón de que el agente no pueda inventar un dato.

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `rutas.ts` | Resuelve raíz, `fixtures/` y `out/` desde `ctx.directory`; valida ids (`^msg-\d{3}$`) y **confina** cada ruta | El id lo propone el modelo: hay que impedir `../` antes de tocar el disco; y la app necesita saber dónde están los datos sin rutas absolutas |
| `io.ts` | Lectura y escritura con `Resultado<T>`: **ninguna función lanza** | Base de HU-6: un archivo raro produce un mensaje legible, no una traza |
| `tipos.ts` | `Contrato`, `Mensaje`, `FilaMaestro`, `Clasificacion`, `Confianza`, `Resultado<T>` | Un solo vocabulario para todas las capas; el compilador vigila el contrato |
| `csv.ts` | Lee y escribe el maestro con comillas correctas, y `escribirAtomico()` (`.tmp` + `rename`) | El maestro **no se puede corromper** (objetivo O2): si algo falla a mitad, queda el archivo anterior |
| `maestro.ts` | Carga la copia de `out/` y construye los dos índices (por `id_contrato` y por cliente) | Responde «¿existe ya este contrato?» sin recorrer el CSV por cada mensaje |
| `buzon.ts` | Descubre y valida los `correo.json` del buzón y decide `tiene_contrato` | HU-1: separa «leer el buzón» de «interpretar el contrato»; un correo sin contrato se rechaza temprano |
| `extraccion.ts` | Saca los campos del texto del contrato con la estructura de cláusulas y regex | Corazón de HU-2. Determinista, para que el resultado sea **auditable y reproducible** |
| `normalizacion.ts` | Numerales en español, fechas («primero (1) de agosto de 2026»), valores (`USD 120,000.00`), NIT/RUC → país, slugs de carpeta | Los contratos están escritos en palabras, no en ISO 8601; aquí se traducen sin adivinar |
| `clausulas.ts` | Trocea el contrato en cláusulas (`PRIMERA. OBJETO.`), separando el encabezado del cuerpo cuando vienen en la misma línea | Los contratos tienen estructura fija: sin ese troceado, buscar «valor» o «plazo» sería adivinar |
| `identificadores.ts` | NIT/RUC/RTN → país y sin dígito de verificación; slug de carpeta; similitud de objetos (Jaccard) | Es donde se resuelve «esto es de Ecuador y no de Colombia» y el umbral 0.9 de RN2 |
| `comerciales.ts` | Carga `comerciales.json` y resuelve el remitente del correo | Un remitente desconocido se reporta sin bloquear (HU-3), y para eso hace falta una lista contra la que comparar |
| `entorno.ts` | Construye el entorno de una ejecución desde `ctx.directory`: escritor confinado, rutas de datos y fecha de referencia | El contrato del PRD §6.2 pasa una raíz en cada llamada; aquí se convierte en rutas concretas, y en las pruebas en un `out/` temporal |
| `clasificacion.ts` | RN1–RN4: duplicado, actualización (incluido el otrosí), nuevo y rechazado | Es la regla que evita corromper el maestro, y la que más preguntas va a recibir en la defensa |
| `archivado.ts` | Calcula `Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>` y copia el documento | HU-4: el «SharePoint» simulado; que cualquiera encuentre el contrato donde espera |
| `historial.ts` | `historial.jsonl` (cambios) y `procesados.json` (idempotencia) | O2 y HU-4: una actualización deja rastro y dos ejecuciones no duplican ni reprocesan |
| `alertas.ts` | Las tres secciones de HU-5 y el `alertas.md` | Es el entregable para gerencia: vencimientos, pólizas y el *gap* cubierto |
| `log.ts` | Una línea por ejecución de herramienta en `out/log.jsonl` | RN7 · CA4: es la traza, y la misma información alimenta las tarjetas del chat |

### 4.4 `src/tools/`: el contrato de herramientas · F2

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `contratos.ts` | Las cinco herramientas `contratos_*` (`description` + `args` en zod + `execute`) | Es la superficie que el modelo puede llamar y la **única fuente de valores** que puede afirmar (CA2). `demo.ts` las importa sin el servidor, como pide el PRD §6.6 |
| `contexto.ts` | Lo común a todas: resolver `out/` y el maestro desde `ctx`, registrar la ejecución y **auditar** lo que propone el modelo | Evita cinco copias de las mismas comprobaciones y concentra la auditoría anti-alucinación |

### 4.5 `src/agent/`, `src/llm/` y `src/server*` · F3

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `agent/loop.ts` | El bucle modelo → herramientas → modelo, con tope de **25 iteraciones** y **200 000 tokens** por sesión | CA1 y el control de costo del PRD §8: el agente no puede girar sin fin ni gastar sin límite |
| `agent/paso.ts` | Ejecuta lo que pide el modelo: valida con zod, audita los valores y **fuerza `confirmado=false`** si no hubo confirmación | CA2 y RN5 como reglas del **código**, no del prompt: el modelo no puede saltárselas |
| `agent/confirmacion.ts` | Deja una acción pendiente y la consume solo si el usuario confirmó en el turno inmediatamente anterior | CA3: escribir en el maestro no depende de la buena voluntad del modelo |
| `agent/eventos.ts` | Define los eventos del turno (`inicio`, `llamada`, `resultado`, `texto`, `aviso`, `error`, `fin`) | El ciclo no habla HTTP: emite eventos y el servidor decide cómo transmitirlos |
| `agent/sesion.ts` | Historial, tokens y acción pendiente; persistencia en `out/sessions/<id>.json` | Que recargar la página no pierda nada y que `GET /api/sessions/:id` devuelva el estado real |
| `agent/prompt.ts` | Carga `agent/prompt.md` y `src/knowledge/registro-contratos.md` y los compone como contexto | Cumple la separación del PRD §6.5: comportamiento y conocimiento fuera del código |
| `llm/adapter.ts` | La interfaz `enviar(mensajes, herramientas) → respuesta` y `definirHerramienta` (zod → JSON Schema) | Es lo que permite cambiar de proveedor sin tocar el ciclo (PRD §6.1) |
| `llm/ollama.ts` | Adaptador de Ollama: pide `num_ctx`, manda `think` solo si se pide y **normaliza los argumentos** (objeto o string JSON) | Es el proveedor del entregable; los tres detalles salieron de medir en el reto 01, no de suponer |
| `llm/openai.ts` | Adaptador para cualquier API compatible con OpenAI | Demuestra la promesa del PRD: cambiar de proveedor es cambiar una variable |
| `llm/mock.ts` | Adaptador de guion fijo, sin red | Permite enseñar la app y correr las pruebas sin claves, sin red y sin descargar 5 GB |
| `llm/fabrica.ts` | Construye el adaptador según `LLM_PROVIDER` y **lee la clave del entorno** (nunca la registra) | Único punto donde se resuelve el proveedor: ahí vive la seguridad del PRD §8 |
| `server.ts` + `server/{api,chat,estaticos}.ts` | `POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health`, el stream SSE y el front estático | Un proceso, un puerto y cero CORS (PRD §6.4); las pruebas usan `inject()` para no abrir puerto |

### 4.6 `web/`, `demo.ts`, `test/` y `out/`

| Archivo | Qué hace | Por qué existe | Fase |
|---|---|---|---|
| `web/index.html`, `estilos.css`, `app.js`, `sse.js` | El chat: historial, campo de entrada, «pensando», **tarjeta por cada llamada a herramienta** y banda de confirmación resaltada | El PRD §6.1 obliga a **mostrar** las llamadas y el estado de confirmación: es parte de la evaluación, no decoración | F4 |
| `demo.ts` | Recorre los 6 mensajes llamando a las herramientas, sin modelo | PRD §6.6: demuestra el motor determinista en 30 s, sin claves ni descargas | F2 |
| `test/*.test.ts` | Las suites de §6 (motor, herramientas, ciclo, API, front y paridad del módulo) | Que lo que afirma este README esté comprobado, no prometido | F1–F6 |
| `test-utils/*` | `out/` en un directorio temporal, proveedor falso y DOM mínimo para ejecutar `app.js` | Las pruebas no tocan el `out/` del repo y el front se prueba **ejecutándose**, no mirando el HTML | F1–F4 |
| `out/.gitkeep` | Marcador de carpeta | Git no versiona carpetas vacías y `out/` debe existir (y estar vacía) desde el primer clon | F0 ✅ |
| `out/**` (generado) | Maestro copiado, `Contratos/`, `historial.jsonl`, `procesados.json`, `alertas.md`, `log.jsonl`, `sessions/` | Es la salida inspeccionable del agente: lo que el evaluador abre para ver que hizo algo real | — |

---

## 5. `demo.ts`: las herramientas sin modelo (F2)

```bash
cd reto-02/solucion
node demo.ts            # los 6 mensajes del buzón, en orden
node demo.ts --confirmar # además, la segunda pasada de msg-006 con confirmado: true
```

Es el recorrido que pide el PRD §6.6: procesa los seis mensajes llamando **directamente** a las
herramientas (sin modelo, sin claves, sin red) y por cada uno imprime la clasificación, los campos en
revisión y la acción tomada. Salida esperada:

```
msg-001  nuevo          registrado    CT-2026-015  Industrias Delta S.A.S.      bóveda: Contratos/2026/industrias-delta/
msg-002  nuevo          registrado    CT-2026-016  Corporación Andina de Servicios
msg-003  actualizacion  registrado    CT-2026-011  fecha_fin 2027-05-01 → 2027-11-01 · valor 350000 → 520000
msg-004  duplicado      sin escribir  CT-2026-012  coincide valor, inicio y fin
msg-005  rechazado      sin escribir  —            motivo: sin adjunto de contrato
msg-006  nuevo          EN REVISIÓN   CM-2026-03   valor (0 · indeterminado), fecha_fin (derivada), comercial (no registrado)

casos procesados: 6/6 · registrados: 3 · en revisión: 1 · sin escribir: 2
```

Con `--confirmar`, la segunda pasada de `msg-006` (ya con `confirmado: true`) lo registra y la demo lo
muestra: es la demostración de que **la confirmación humana es la que desbloquea la escritura** (RN5 y
CA3). El proceso es **idempotente**: una segunda ejecución no vuelve a registrar nada, porque
`out/procesados.json` ya lo sabe. Y limpia `out/` al empezar, así que dos corridas dan el mismo
resultado salvo marcas de tiempo (PRD §8 · Determinismo).

---

## 6. Pruebas automáticas (F1 en adelante)

```bash
cd reto-02/solucion
npm test            # ~120 pruebas previstas, 0 fallos (sin modelo y sin red)
npm run typecheck   # 0 errores
```

| Suite | Qué fija | Estado |
|---|---|---|
| `csv.test.ts` | Comillas, comas y saltos dentro de un campo; la escritura atómica no deja el archivo a medias | ✅ 11 |
| `normalizacion.test.ts` | Numerales en español, fechas ordinales, importes locales/ingleses, monedas, NIT/RUC → país, slugs y similitud | ✅ 13 |
| `entrada.test.ts` | El buzón (6 mensajes, contrato vs otrosí vs cotización) y RN6: el fixture se copia a `out/` intacto | ✅ 6 |
| `extraccion.test.ts` | **Casos dorados**: los seis documentos, campo por campo, con su confianza y su evidencia | ✅ 7 |
| `clasificacion.test.ts` | RN1–RN5 sobre los seis mensajes y casos sintéticos (objeto idéntico con número nuevo, otrosí de contrato desconocido, número automático) | ✅ 9 |
| `alertas.test.ts` | Los bordes de los 60 días con `hoy = 2026-09-03` y las tres secciones del reporte | ✅ 7 |
| `herramientas.test.ts` | El contrato del PRD §6.2: string JSON, `{ ok }` en ambos caminos, **no lanza**, args inválidos rechazados | F2 |
| `auditoria.test.ts` | **Anti-alucinación**: si el modelo propone un valor alterado, la respuesta es revisión y no se escribe (CA2) | F2 |
| `demo.test.ts` | El recorrido completo y la idempotencia de la segunda ejecución | F2 |
| `bucle.test.ts` | Topes (CA1), confirmación solo con un «sí» del turno anterior (CA3), proveedor que falla sin matar la sesión (CA5) | F3 |
| `api.test.ts` | Las tres rutas del PRD §6.4 y que ninguna respuesta contenga la clave | F3 |
| `front-navegador.test.ts` | `web/app.js` en un DOM mínimo: pintado, tarjetas y banda de confirmación | F4 |
| `paridad-modulo.test.ts` | Que `modulo/` siga siendo **las mismas piezas** que usa la app | F6 |

Estado: **53 pruebas en verde** (F1), `typecheck` con 0 errores y **cero `any`**. La meta al cerrar el
reto es ~120, el mismo listón que se sostuvo en el reto 01. Las pruebas escriben en un `out/` temporal,
nunca en el del repositorio.

---

## 7. Variables de entorno

Ninguna es obligatoria para arrancar: los valores por defecto funcionan sin `.env`. Están todas
documentadas, con su porqué, en [`solucion/.env.example`](solucion/.env.example) — ya escrito en F0.

```bash
cp solucion/.env.example solucion/.env   # para `npm run dev` (Node lo lee solo)
cp solucion/.env.example .env            # para `docker compose` (se lee desde reto-02/)
```

El `.env` es **opcional y nativo**: los scripts usan `--env-file-if-exists=.env`, así que si el archivo
existe se carga y si no, el arranque sigue igual (`Node ≥22.18`). No hay `dotenv` de por medio. Las
variables también se pueden pasar por delante del comando, que es lo más cómodo para probar:

```bash
LLM_PROVIDER=mock npm run dev
LLM_PROVIDER=openai OPENAI_API_KEY=... npm run dev
```

| Variable | Por defecto | Para qué | Fase |
|---|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` (local, sin claves) · `openai` (cualquier API compatible) · `mock` (guion fijo) | F3 |
| `OLLAMA_MODEL` | `granite4.1:8b` | Modelo del ciclo del agente | F3 |
| `OLLAMA_HOST` | `http://localhost:11434` | Con Docker: `http://host.docker.internal:11434` | F3 |
| `OLLAMA_NUM_CTX` | `8192` | El prompt más los esquemas pasan de 4 000 tokens; por debajo de 8192 Ollama rechaza la petición | F3 |
| `OLLAMA_THINK` | sin definir | Razonamiento previo de los modelos híbridos; solo si el modelo razona | F3 |
| `OPENAI_API_KEY` | — | Solo con `LLM_PROVIDER=openai`. **Nunca se versiona ni se devuelve por la API** | F3 |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo del proveedor compatible con OpenAI | F3 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Cambia el destino si usas otro proveedor compatible (Azure, Groq, vLLM…) | F3 |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Dentro de Docker, `HOST=0.0.0.0` | F3 |
| `FIXTURES_DIR` | `../fixtures/reto-02` | Buzón, maestro y comerciales. **El fixture nunca se escribe** (RN6) | F1 |
| `OUT_DIR` | `./out` | Salida del agente: maestro copiado, archivo, alertas, historial, log y sesiones | F1 |
| `FECHA_EJECUCION` | fecha del sistema | Fecha de referencia de alertas y vencimientos; en el chat es el argumento `hoy` de `contratos_alertas`, y esta variable es su valor por defecto | F1 |
| `MAX_ITERACIONES` | `25` | Vueltas herramienta → modelo por turno (CA1) | F3 |
| `MAX_TOKENS_SESION` | `200000` | Tope de gasto por sesión (PRD §8) | F3 |
| `LLM_TIMEOUT_MS` | `180000` | Timeout de la llamada al proveedor; al agotarse, error legible y la sesión sigue (CA5) | F3 |

---

## 8. Link de prueba

> **Pendiente de publicar (F5).** Se dejará activo durante la defensa. Mientras tanto, la aplicación se
> levanta en local con el comando de §1 (el PRD §9.3 admite esa modalidad con −10).

**Clave de acceso:** no aplica; el link será público y no expone ninguna clave de modelo.

---

## 9. Guía para la sustentación

### 9.1 El discurso de 60 segundos

> «Es un agente conversacional que se convierte en el **punto único de recepción de contratos**: lee el
> buzón, extrae los datos del contrato, detecta si es nuevo, una actualización o un duplicado, archiva
> el documento en una estructura tipo SharePoint y mantiene vivo el maestro —que hoy está congelado
> desde mayo— y además produce el reporte de vencimientos y pólizas pendientes. Lo importante de cómo
> está hecho: **el modelo conversa y pide herramientas, pero los valores del maestro y la clasificación
> salen de código determinista**, así que no puede inventar un valor ni corromper el maestro. Cuando un
> campo es dudoso, el sistema **no adivina: pregunta**, y solo escribe con la confirmación explícita del
> usuario. Corre con un modelo local, sin claves ni coste por caso, se levanta con un comando y tiene
> pruebas que incluyen ejecutar el front de verdad. Y como esto es tanto proceso como tecnología, el
> entregable trae además la **regla de gobierno**: qué debe enviar el comercial, a dónde y qué pasa si
> no lo hace.»

### 9.2 El recorrido de 5 minutos (en este orden)

| # | Qué hacer | Qué decir mientras |
|---|---|---|
| 1 | `cd reto-02/solucion && node demo.ts` | «Esto es el motor determinista, sin modelo ni claves. Seis mensajes: tres se registran, uno se actualiza, uno es duplicado, uno se rechaza y uno queda en revisión. Y es reproducible: limpia `out/` al empezar» |
| 2 | `node demo.ts --confirmar` | «Aquí está el punto: `msg-006` no se registró porque su valor es indeterminado y su fecha es derivada. Con la confirmación explícita, se registra. **El humano es el que autoriza la escritura**» |
| 3 | `LLM_PROVIDER=mock npm run dev` y abrir `http://127.0.0.1:3000` | «La app completa sin descargar nada: pego el prompt del PRD §11 y aparecen las tarjetas de cada herramienta y la banda de confirmación» |
| 4 | Con el modelo real | «Con `granite4.1:8b` el turno tarda decenas de segundos; por eso la respuesta llega por stream y el front muestra qué herramienta está llamando» |
| 5 | `npm test` | «Las pruebas, en verde, sin modelo y sin red —incluida la del front ejecutándose» |
| 6 | Abrir `out/sharepoint/` y `out/alertas.md` | «El maestro con la fila nueva y la actualizada, el contrato archivado en `Contratos/2026/…`, el `historial.jsonl` con el cambio del otrosí y el reporte de alertas» |
| 7 | `git log --oneline` | «El historial cuenta la historia por fases: baseline, setup, motor, herramientas, agente, front, despliegue» |

### 9.3 Las decisiones que debes poder defender

| Decisión | En una frase | Alternativa descartada |
|---|---|---|
| La extracción es determinista | Los valores salen del texto por reglas; el modelo propone y la herramienta **audita** lo propuesto | Dejar que el modelo extraiga los campos y los devuelva como JSON |
| La confirmación humana es código | Hay una acción pendiente por sesión y se consume con un «sí» explícito en el turno siguiente | Confiar en que el prompt pida confirmación |
| Dedupe por `id_contrato` antes que por nombre | Es lo que evita el falso duplicado y lo que hace que el maestro no se corrompa | Comparar por nombre de cliente o por similitud de texto a secas |
| El maestro se trabaja sobre una copia en `out/` | El fixture es de solo lectura; la copia se escribe de forma atómica | Escribir sobre el CSV del fixture o mantener el maestro solo en memoria |
| Los fixtures se usan en su sitio | No se copian: dos copias divergen sin que nadie lo note | Duplicarlos dentro de `solucion/` |
| Columnas propias + CSV propio | 16 columnas fijas y ~40 líneas con pruebas: una dependencia menos que justificar | `papaparse`, `csv-stringify` |
| Front estático sin build | El PRD pide un comando y la pantalla tiene poco estado | React o Svelte con bundler |
| `mock` de primera clase | Demo y pruebas sin claves, sin red y sin 5 GB | Depender siempre del modelo real |
| `hoy` como argumento | Las alertas son reproducibles y comparables entre corridas | Leer el reloj del sistema |

### 9.4 Preguntas probables, con la respuesta corta

| Pregunta | Respuesta |
|---|---|
| ¿Cómo evitas que el modelo invente un valor? | Los valores salen de `src/core/extraccion.ts` sobre el texto del documento; `contratos_validar` **re-extrae y compara** con lo que propuso el modelo, y la discrepancia se convierte en `requiere_revision` en vez de registrarse (CA2). El modelo no es la fuente: la fuente es el contrato |
| ¿Cómo evitas falsos duplicados? | El dedupe va por **`id_contrato`** primero; `nit_cliente` + similitud de objeto ≥ 0.9 solo *sospecha* actualización. El caso testigo es `msg-002`: mismo cliente y mismo RUC que `CT-2026-007`, pero otro contrato → `nuevo` |
| ¿Por qué el umbral de confianza es 0.8? | Deja pasar lo que tiene **evidencia doble** (0.95–0.99: el valor en letras y en dígitos) y detiene lo **derivado** (0.7: fecha calculada de un plazo) y lo **ausente** (0–0.5). Con 0.9, el `requiere_poliza = false` detectado por ausencia de cláusula (0.85) bloquearía `msg-002` sin motivo |
| ¿Cómo garantizas que no escribe sin permiso? | No depende del prompt: `paso.ts` fuerza `confirmado = false` y `contratos_registrar` se niega si hay `requiere_revision`. La confirmación solo vale **en el turno siguiente** y está atada a ese mensaje |
| ¿Cómo proteges el maestro? | Se escribe sobre la **copia** en `out/` (el fixture es de solo lectura, RN6), con **escritura atómica** (`.tmp` + rename) y `procesados.json` para que dos ejecuciones no dupliquen; un duplicado no escribe nada (RN1) |
| ¿Qué pasa si un mensaje viene mal? | Las herramientas **nunca lanzan**: devuelven `{ ok: false, error }` legible y el ciclo sigue con el siguiente mensaje (HU-6) |
| ¿Por qué no haces OCR? | El PRD §3.2 lo excluye y los fixtures traen el texto extraído. `contratos_leer_pdf` (PDF con texto) queda como P1 |
| ¿Qué haces con un remitente desconocido? | Se reporta como `comercial` sin resolver, **no bloquea** el registro (§5 HU-3) y queda en revisión para que administración lo asigne |
| ¿Y si el otrosí cambia solo dos campos? | Los campos que el otrosí no menciona se **conservan** de la fila existente; `historial.jsonl` guarda el cambio y `diferencias` lo lista para el chat |
| ¿Por qué hay contratos vencidos en el maestro? | Porque el proceso murió: son el hueco que este reporte hace visible. El agente no borra nada; el `alertas.md` los declara como contexto |
| ¿Cuánto cuesta por caso? | Local: **0**. Con proveedor de pago: ≈ **0,005 USD/caso** (medición heredada del reto 01; se re-mide en F3) |
| ¿Cómo evitas que alguien queme tu clave? | Topes por turno (25 iteraciones), por sesión (200 000 tokens) y timeout del proveedor de 3 minutos; la clave vive solo en el entorno y no se registra |
| ¿Funciona sin internet? | Sí: `LLM_PROVIDER=mock` recorre toda la app con un guion y las pruebas no tocan la red. El modelo local tampoco la necesita tras la descarga |
| ¿Qué es la regla de gobierno y por qué entra aquí? | Es el PRD §7.5: el problema es tanto de proceso como de técnica. Define **quién envía qué, a dónde, en qué plazo y con qué asunto**, el acuse automático, el escalamiento de excepciones, cómo se cierra el *gap* de junio–agosto y un indicador mensual (`% de contratos facturados que existen en el maestro`) |
| ¿Cómo sé que el front no está roto si no hay navegador? | Hay un DOM mínimo en `test-utils/` que **carga `app.js` y recorre un turno completo**. Lo que no cubre es CSS ni pintado real, y está declarado en §10 |

### 9.5 Números para saber de memoria

| Dato | Valor |
|---|---|
| Mensajes del buzón | **6** (3 registrados · 1 actualizado · 1 duplicado · 1 rechazado · 1 en revisión) |
| Herramientas del contrato | **5** (`leer_buzon`, `extraer`, `validar`, `registrar`, `alertas`) + 1 opcional P1 |
| Umbral de revisión | confianza **< 0.8** |
| Ventana de alertas | vencen en **≤ 60 días** · corte del maestro: **2026-05-30** |
| Topes | **25** iteraciones por turno · **200 000** tokens por sesión · timeout **180 s** |
| Contexto del prompt + esquemas | ≈ **4 179 tokens** (medido en el reto 01) → `num_ctx: 8192` |
| Tiempos medidos | 26–70 s por turno · 66 s en contenedor (reto 01) |
| Coste estimado | **0,005 USD/caso** con proveedor de pago · **0** en local |
| Modelo | `granite4.1:8b` (Ollama, 5,3 GB, Apache 2.0) |
| Pruebas | **53** en F1 (meta ~120 al cierre) · `typecheck` 0 errores · cero `any` |

### 9.6 Si te piden «enséñame el código»

| Quieren ver… | Abre… |
|---|---|
| La extracción y el cálculo de confianza | `src/core/extraccion.ts` · `test/extraccion.test.ts` · `test/normalizacion.test.ts` |
| La clasificación y el dedupe (RN1–RN4) | `src/core/clasificacion.ts` · `maestro.ts` · `test/clasificacion.test.ts` |
| El contrato de herramientas | `src/tools/contratos.ts` · `test/herramientas.test.ts` |
| La auditoría anti-alucinación | `src/tools/contexto.ts` · `test/auditoria.test.ts` |
| El ciclo y sus topes | `src/agent/loop.ts` · `test/bucle.test.ts` |
| Las reglas que el modelo no puede saltarse | `src/agent/paso.ts` · `confirmacion.ts` |
| El maestro y su escritura segura | `src/core/csv.ts` · `maestro.ts` · `historial.ts` |
| El stream que ve el front | `src/server/chat.ts` · `web/sse.js` |
| El front | `web/app.js` (y `test/front-navegador.test.ts` para cómo se prueba) |
| El empaquetado | `solucion/Dockerfile` · `docker-compose.yml` |

---

## 10. Qué queda fuera (limitaciones declaradas)

1. **El link público está pendiente de publicar** (§8): llega en F5. El PRD §9.3 acepta probarlo en
   local durante la defensa, con −10.
2. **Sin OCR y sin PDF escaneado**: el PRD §3.2 lo excluye. Los fixtures traen el texto del contrato ya
   en `.txt`; `contratos_leer_pdf` (PDF con texto) queda como P1 opcional.
3. **No hay conexión real a Exchange ni a SharePoint**: se simulan con carpetas locales, como autoriza el
   PRD §2.3. El buzón es `fixtures/reto-02/buzon/` y el «SharePoint» es `out/sharepoint/`.
4. **Sin base de datos y sin multiusuario**: el maestro es un CSV y las sesiones son archivos. Dos
   procesos escribiendo a la vez no están soportados (la escritura atómica evita el archivo corrupto,
   no la carrera).
5. **La extracción cubre las redacciones de los fixtures**: otro formato de contrato caerá, por diseño,
   en **revisión humana** en vez de registrarse mal. Es una decisión deliberada, pero también es
   cobertura limitada; el siguiente paso sería alimentar el patrón nuevo y añadir su prueba.
6. **La similitud de objeto es una heurística** (tokens + Jaccard ≥ 0.9): puede sospechar de un contrato
   legítimo o no ver una actualización reescrita. Por eso solo se usa cuando el `id_contrato` no resuelve
   el caso, y el resultado va a revisión.
7. **La constitución y renovación de pólizas está fuera de alcance**: el agente las detecta, las reporta
   y las deja marcadas; no habla con la aseguradora.
8. **La reconstrucción de junio–agosto de 2026 se documenta, no se ejecuta**: es parte de la regla de
   gobierno (una campaña de una vez), no del código.
9. **El front se prueba con un DOM mínimo, no con un navegador**: lo que dependa de CSS o del pintado
   real no lo detecta la suite; el siguiente nivel sería Playwright.
10. **No hay reintentos ni cola**: si el proveedor falla, el turno devuelve un error legible y la sesión
    sigue; para volumen alto haría falta cola y reintentos con *backoff*.
