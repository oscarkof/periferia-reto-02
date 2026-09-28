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
en **F5 (despliegue y `SOLUCION.md`)**: el motor determinista de `src/core/`, las cinco herramientas
`contratos_*`, el recorrido `demo.ts`, **el ciclo del agente** —tres proveedores intercambiables (`ollama`,
`openai`, `mock`), validación y auditoría de cada llamada, confirmación humana en el código—, la **API
HTTP** con stream de eventos, el **front** de chat y, encima, **`docker compose up --build`** validado
(contenedor *healthy*) y **`SOLUCION.md`** con las 11 secciones del PRD §9.1 y la regla de gobierno de
§7.5. **96 pruebas en verde y `typecheck` sin errores.** El link se prueba en local por **decisión**
(§8 · −10 asumido del PRD §9.3); solo falta el módulo reutilizable (F6). Los comandos de §1 se marcan según
lo que ya funciona.

| Fase | Feature | Rama | Qué entrega | Estado |
|---|---|---|---|---|
| **F0** | `setup` | `main` | Repositorio, `.gitignore`, `out/.gitkeep`, `.env.example`, arquitectura y README | ✅ **hecho** |
| **F1** | `core` | `main` | `package.json`, `tsconfig.json` y `src/core/`: 18 módulos deterministas con **53 pruebas** | ✅ **hecho** |
| **F2** | `tools` | `f02-tools` | Las cinco herramientas `contratos_*` + `demo.ts` (los 6 mensajes sin modelo) | ✅ **hecho** |
| **F3** | `agente-llm-api` | `f03-agente-llm-api` | Ciclo del agente, adaptadores de proveedor (ollama/openai/mock), API HTTP y system prompt | ✅ **hecho** |
| **F4** | `web` | `f04-web` | Front de chat: tool-calls visibles y banda de confirmación | ✅ **hecho** |
| **F5** | `deploy-solucion` | `f05-deploy` | Docker (`Dockerfile`, `docker-compose.yml`, `.dockerignore`), `SOLUCION.md` (11 secciones + regla de gobierno) y publicación del link | ✅ **hecho** (el link se prueba en local, por decisión: §8) |
| **F6** | `modulo` (bonus) | `f06-modulo` | Agente empaquetado reutilizable + test de paridad con la app | ⏳ |

Cada fase es **una feature con nombre propio**, y ese nombre es el mismo de la rama y del mensaje de
commit (`feat(core)`, `feat(tools)`, `feat(agent)`…). La convención completa, con los mensajes listos para
copiar, está en [`solucion/docs/repo-setup.md`](solucion/docs/repo-setup.md) §5.

---

## 1. Arranque (un comando)

**La vía rápida, sin instalar nada** (Docker; es la del PRD §8):

```bash
cd reto-02
docker compose up --build     # front + API en http://127.0.0.1:3000
```

**En local**, si prefieres Node:

```bash
cd reto-02/solucion
npm install
npm run dev          # front de chat + API en http://127.0.0.1:3000
```

Las dos levantan las dos piezas (el backend sirve el front) y tardan menos de un minuto con las
dependencias ya descargadas. El contenedor trae un `HEALTHCHECK` sobre `/api/health`, así que
`docker compose ps` dice si está *healthy* sin adivinar.

### Qué funciona hoy (F0) y qué llega con cada fase

| Comando | Hoy | Llega en |
|---|---|---|
| `npm install` | ✅ funciona (75 paquetes, ~4 s) | — |
| `npm run typecheck` | ✅ **0 errores**, cero `any` | — |
| `npm test` | ✅ **96 pruebas**, sin modelo y sin red | F6 (hasta ~120) |
| `npm run demo` | ✅ **`6/6` clasificados**: 3 registrados, 1 duplicado, 1 en revisión, 1 sin escribir | `--confirmar` para la segunda pasada |
| `npm run dev` | ✅ **front + API + ciclo del agente** en `http://127.0.0.1:3000` (`LLM_PROVIDER=mock` no necesita nada instalado) | — |
| `docker compose up --build` | ✅ **validado**: imagen `reto-02-agente-contratos`, contenedor *healthy*, front y API desde el contenedor, `out/` escribiéndose en el host | — |
| Leer la arquitectura ya decidida | ✅ | [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) |
| Ver el diseño del esquema y las reglas | ✅ | [§7 del PRD](PRD.md) y §6-§8 de la arquitectura |

### Con Docker, sin instalar Node ni dependencias (F5 ✅)

```bash
cd reto-02
docker compose up --build     # lo mismo, en http://127.0.0.1:3000
LLM_PROVIDER=mock docker compose up --build   # sin modelo, demo instantánea
```

La imagen es **`node:24-alpine` sin paso de build**: el front es estático y Node ejecuta TypeScript
directamente, así que solo se instalan dependencias de producción (`npm ci --omit=dev`, 71 paquetes) y se
copian `solucion/` y `fixtures/`. Corre como usuario `node`, escucha en `0.0.0.0` y `out/` está montado
sobre `solucion/out/` para que veas en tu carpeta el maestro, los contratos archivados y `log.jsonl`.

Para una demo desde cero (el `out/` del host recuerda la corrida anterior, y eso hace que el buzón
aparezca como ya procesado):

```bash
docker compose down
rm -rf solucion/out/sharepoint solucion/out/sessions solucion/out/procesados.json solucion/out/log.jsonl solucion/out/alertas.md
docker compose up --build
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
| *Tool calling* | **Verificado** en los dos retos con el mismo contrato de herramientas: en el reto 01, incluido el turno de confirmación; en este, con llamadas reales a `contratos_leer_buzon`, `contratos_extraer` y `contratos_validar` registradas en `out/log.jsonl` |
| Tamaño | 5,3 GB cuantizado: cabe en 16 GB de RAM junto al sistema y el KV cache |
| Dominio | Orientado a empresa (GRC, *compliance*) y con salida JSON estructurada, que es el formato del contrato |
| Español | Entiende contratos redactados en español y responde en español sin instrucciones exóticas |

Descartados, con la razón: `qwen3:4b-instruct` (2,5 GB) **no pasa** el turno de confirmación;
`qwen3:14b` y los modelos de 30B no caben o disparan la latencia; las APIs de pago quedaron **como
alternativa lista** (`openai.ts`), no como requisito.

### Mediciones

**Medido en este reto** (28-09-2026, Ollama local: `granite4.1:8b`, 6,6 GB, **100 % GPU**, contexto
8 192):

| Qué | Medición |
|---|---|
| Primera llamada del turno | **~32 s** con el modelo frío (incluye cargarlo y procesar el prompt del sistema con los cinco esquemas); con el modelo ya cargado, un turno de una sola llamada tardó **3,4 s** |
| Llamadas siguientes del mismo turno | **3–20 s** cada una |
| Turno completo del buzón (6 mensajes, modelo real) | **182,6 s · 12 llamadas** de herramienta: registró `CT-2026-015`, `CT-2026-016` y el otrosí (que actualiza `CT-2026-011`), reportó el duplicado y el rechazado y **pidió confirmación** por `msg-006` |
| Turno de confirmación («sí, confirmo») | **78,5 s** el primero (registra `msg-006`) y **28,4 s** un segundo «sí», que ya no escribe nada |
| El mismo recorrido con `mock` | **~20 ms**, sin red y determinista |
| Coste con el modelo local | **0 USD** (la energía de la máquina) |

**Heredado del reto 01** (mismo proveedor y mismo tipo de contrato: cinco herramientas con esquemas
zod):

| Qué | Medición heredada |
|---|---|
| Turno dentro de un contenedor apuntando al modelo del host | **66 s** |
| Coste con proveedor de pago (0,15/0,60 USD por millón de tokens) | ≈ **0,005 USD/caso** |

**El contexto que viaja en cada llamada**: `agent/prompt.md` + `src/knowledge/registro-contratos.md` +
los cinco esquemas JSON = **5 735 tokens medidos** en este reto. La medición es directa: un turno trivial
(«hola») que **no ejecuta ninguna herramienta** hace una sola llamada al modelo y deja `tokens: 5735` en
`out/sessions/<id>.json`. Es más que los 4 179 tokens del reto 01 (allí el conocimiento era más corto) y
sigue cabiendo en **8 192**, que es la ventana que se pide en `OLLAMA_NUM_CTX`: con la de por defecto
(4 096) Ollama rechaza la petición. Sumado al historial de un turno largo, explica los ≈14 500 tokens por
turno que se usan para estimar el coste.

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
    ├── demo.ts                       los 6 mensajes sin modelo (PRD §6.6)                    [F2 ✅]
    ├── agent/prompt.md               comportamiento del agente (system prompt)               [F3]
    ├── src/knowledge/                conocimiento del proceso que el agente consulta         [F3]
    ├── src/core/                     18 módulos deterministas (F1 ✅)
    ├── src/tools/                    las cinco herramientas `contratos_*`                     [F2 ✅]
    ├── src/demo/                     la lógica del recorrido sin modelo                       [F2 ✅]
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
| `SOLUCION.md` | Planteamiento completo: las 11 secciones del PRD §9.1 + la regla de gobierno de §7.5 | Es lo que evalúa «cómo pensaste», no solo qué corriste | F5 ✅ |
| `docker-compose.yml` | Servicio con build, puerto, variables, volumen `out/` y `host.docker.internal` | Da el «un comando» del PRD §8 sin instalar Node | F5 ✅ |
| `.dockerignore` | Excluye `node_modules`, `out/`, `.env`, `.git`, zips y `.DS_Store` | Evita que la imagen arrastre dependencias del host y secretos | F5 ✅ |
| `.gitignore` | Secretos, dependencias, `out/*`, `*.jsonl`, cachés, basura de SO/IDE, tooling de agentes, `*.zip` | Que el repo sea entregable: el PRD §9.5 prohíbe `node_modules`, `out` y `.env` | F0 ✅ |
| `fixtures/reto-02/**` | El buzón de 6 mensajes, el maestro congelado al 2026-05-30 y los comerciales | Datos del cliente: **no se modifican** y no se copian dentro de la app (§12 de la arquitectura, decisión 3) | ✔ |

### 4.2 `solucion/`: configuración y documentación

| Archivo | Qué hace | Por qué existe | Fase |
|---|---|---|---|
| `.env.example` | Las 16 variables con su explicación y sus valores por defecto | Documentación ejecutable de la configuración; `.env` está ignorado | F0 ✅ |
| `Dockerfile` | `node:24-alpine`, sin paso de build: `npm ci --omit=dev`, copia `solucion/` y `fixtures/`, usuario `node`, `HEALTHCHECK` y `CMD node src/server.ts` | El contexto es la raíz del reto porque la app lee los fixtures en `../fixtures/reto-02`; la imagen es autocontenida | F5 ✅ |
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

### 4.4 `src/tools/`: el contrato de herramientas · F2 ✅

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `contratos.ts` | Las cinco herramientas `contratos_*` (`description` + `args` en zod + `execute`) y los nombres visibles derivados de archivo y export | Es la superficie que el modelo puede llamar y la **única fuente de valores** que puede afirmar (CA2). `demo.ts` las importa sin el servidor, como pide el PRD §6.6 | F2 ✅ |
| `contexto.ts` | Lo común a todas: construir el entorno desde `ctx.directory`, cargar maestro y comerciales, leer el documento, registrar la ejecución y **auditar** el contrato propuesto | Evita cinco copias de las mismas comprobaciones y concentra la auditoría anti-alucinación (CA2) y el log (RN7) | F2 ✅ |
| `contrato.ts` | El contrato del PRD §6.2: `Herramienta<Esquema>` con `description` + `args` + `execute`, `exito`/`fallo`/`responder` y `ejecutarValidando` | Un solo sitio define cómo se declara una herramienta; es lo que en F3 usará el backend para ejecutarlas todas igual | F2 ✅ |

### 4.5 `src/agent/`, `src/llm/` y `src/server*` · F3 ✅

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
| `llm/mock.ts` | Adaptador de guion, sin red: una política fija que **lee la conversación** (`guionReactivo`) o una lista de pasos (`guionDemo`) | Permite enseñar la app y correr las pruebas sin claves, sin red y sin descargar 5 GB; el guion reactivo evita que la demo se desalinee al recargar o al confirmar dos veces |
| `llm/fabrica.ts` | Construye el adaptador según `LLM_PROVIDER` y **lee la clave del entorno** (nunca la registra) | Único punto donde se resuelve el proveedor: ahí vive la seguridad del PRD §8 |
| `server.ts` + `server/{aplicacion,chat,estaticos,front,identificadores,memoria}.ts` | `POST /api/chat` (SSE o JSON con `?json=1`), `GET /api/sessions/:id`, `GET /api/health`, `GET /api/files/*` y el front estático cuando exista | Un proceso, un puerto y cero CORS (PRD §6.4); las pruebas usan `inject()` para no abrir puerto |

### 4.6 `web/`, `demo.ts`, `test/` y `out/`

| Archivo | Qué hace | Por qué existe | Fase |
|---|---|---|---|
| `web/index.html`, `estilos.css`, `app.js`, `sse.js` | El chat: historial, campo de entrada, «pensando» con segundos, **tarjeta por cada llamada a herramienta** con su resumen, banda de confirmación resaltada, panel del buzón y **enlaces a lo generado** (`/api/files/…`) | El PRD §6.1 obliga a **mostrar** las llamadas y el estado de confirmación: es parte de la evaluación, no decoración | F4 ✅ |
| `demo.ts` | Recorre los 6 mensajes llamando a las herramientas, sin modelo | PRD §6.6: demuestra el motor determinista en 30 s, sin claves ni descargas | F2 ✅ |
| `src/demo/recorrido.ts` | La lógica del recorrido: `leer_buzon` → `validar` → (`extraer`) → `registrar`, con los estados de cada mensaje | `demo.ts` imprime; la lógica se prueba en aislamiento (5 pruebas) | F2 ✅ |
| `test/*.test.ts` | Las suites de §6 (motor, herramientas, ciclo, API, front y paridad del módulo) | Que lo que afirma este README esté comprobado, no prometido | F1–F6 |
| `test-utils/*` | `out/` en un directorio temporal, proveedor falso y DOM mínimo para ejecutar `app.js` | Las pruebas no tocan el `out/` del repo y el front se prueba **ejecutándose**, no mirando el HTML | F1–F4 |
| `out/.gitkeep` | Marcador de carpeta | Git no versiona carpetas vacías y `out/` debe existir (y estar vacía) desde el primer clon | F0 ✅ |
| `out/**` (generado) | Maestro copiado, `Contratos/`, `historial.jsonl`, `procesados.json`, `alertas.md`, `log.jsonl`, `sessions/` | Es la salida inspeccionable del agente: lo que el evaluador abre para ver que hizo algo real | — |

---

## 5. `demo.ts`: las herramientas sin modelo (F2 ✅)

```bash
cd reto-02/solucion
node demo.ts            # los 6 mensajes del buzón, en orden
node demo.ts --confirmar # además, la segunda pasada de msg-006 con confirmado: true
```

Es el recorrido que pide el PRD §6.6: procesa los seis mensajes llamando **directamente** a las
herramientas (sin modelo, sin claves, sin red) y por cada uno imprime la clasificación, los campos en
revisión y la acción tomada. La fecha de referencia por defecto es **2026-09-03** (la del prompt del PRD
§11), no la del reloj: así los números son comparables entre corridas; `FECHA_EJECUCION` la cambia.

Salida real de la primera pasada:

```
out/ limpiado al inicio (0 entradas eliminadas)
fecha de referencia: 2026-09-03

━━━ msg-001 · nuevo · ✔ insertado
  CT-2026-015 · INDUSTRIAS DELTA S.A.S. · 265000000 COP · 2026-08-01 → 2027-07-31
  archivo: Contratos/2026/industrias-delta/CT-2026-015.txt

━━━ msg-002 · nuevo · ✔ insertado
  CT-2026-016 · CORPORACIÓN ANDINA DE SERVICIOS S.A. · 120000 USD · 2026-08-15 → 2027-08-14
  archivo: Contratos/2026/corporacion-andina-de-servicios/CT-2026-016.txt

━━━ msg-003 · actualizacion · ✔ actualizado
  CT-2026-011 · MINERA LOS ANDES S.A.C. · 520000 PEN · ? → 2027-11-01
    · valor: 350000 → 520000
    · fecha_fin: 2027-05-01 → 2027-11-01

━━━ msg-004 · duplicado · ≈ duplicado: no se escribió
  aviso: CT-2026-012 ya está en el maestro con el mismo valor y el mismo plazo

━━━ msg-005 · rechazado · — sin escribir
  msg-005 no trae un adjunto de contrato: sin contrato no hay nada que extraer (RN4)

━━━ msg-006 · nuevo · ⏳ EN REVISIÓN (no se registró)
  requiere revisión antes de registrar: valor, fecha_fin
  aviso: el remitente jperez@periferia-ficticia.com no está en comerciales.json: se registra sin comercial asignado
  aviso: contrato por demanda: el valor se registra como 0 y conviene confirmarlo
  revisar: valor = 0 con confianza 0.50
  revisar: fecha_fin = 2027-08-31 con confianza 0.70

casos procesados: 6/6 · registrados: 3 · duplicados: 1 · en revisión: 1 · sin escribir: 1

(queda pendiente de confirmación: msg-006 · vuelve a correr con --confirmar)

alertas: 2 por vencer · 2 póliza(s) pendiente(s) · 3 registrado(s) desde el corte → out/alertas.md
resumen determinista: out/resumen.json
```

Con `--confirmar`, la segunda pasada —ya con `confirmado: true`— registra `msg-006` y la demo lo muestra:
es la demostración de que **la confirmación humana es la que desbloquea la escritura** (RN5 · CA3). El
proceso es **idempotente**: `out/procesados.json` guarda lo resuelto, así que volver a correrlo no
duplica ni una fila (solo reaparece la cotización rechazada, porque no había nada que registrar). Y como
limpia `out/` al empezar, dos corridas dan el mismo `out/resumen.json` — sin timestamps, para poder
compararlo (PRD §8 · Determinismo).

---

## 6. Pruebas automáticas (F1 en adelante)

```bash
cd reto-02/solucion
npm test            # 96 pruebas, 0 fallos (sin modelo y sin red, en menos de 1 s)
npm run typecheck   # 0 errores
```

| Suite | Qué fija | Estado |
|---|---|---|
| `csv.test.ts` | Comillas, comas y saltos dentro de un campo; la escritura atómica no deja el archivo a medias | ✅ 11 |
| `normalizacion.test.ts` | Numerales en español, fechas ordinales, importes locales/ingleses, monedas, NIT/RUC → país, slugs y similitud | ✅ 12 |
| `entrada.test.ts` | El buzón (6 mensajes, contrato vs otrosí vs cotización) y RN6: el fixture se copia a `out/` intacto | ✅ 6 |
| `extraccion.test.ts` | **Casos dorados**: los seis documentos, campo por campo, con su confianza y su evidencia | ✅ 7 |
| `clasificacion.test.ts` | RN1–RN5 sobre los seis mensajes y casos sintéticos (objeto idéntico con número nuevo, otrosí de contrato desconocido, número automático) | ✅ 10 |
| `alertas.test.ts` | Los bordes de los 60 días con `hoy = 2026-09-03` y las tres secciones del reporte | ✅ 7 |
| `herramientas.test.ts` | El contrato del PRD §6.2: string JSON en ambos caminos, **no lanza**, ids raros rechazados, **anti-alucinación (CA2)**, RN5 y RN7 | ✅ 11 |
| `demo.test.ts` | El recorrido completo, la tabla del PRD §7.4, la segunda pasada con confirmación y la **idempotencia** | ✅ 5 |
| `bucle.test.ts` | El recorrido del PRD §11 en dos turnos, topes (CA1), confirmación solo con un «sí» del turno anterior (CA3 · RN5), anti-alucinación (CA2), duplicado que no escribe (RN1), proveedor que falla sin matar la sesión (CA5) y la detección de la confirmación con la puntuación que escribe una persona (**incluidas las tres de regresión del `mock`**) | ✅ 13 |
| `api.test.ts` | Las cuatro rutas del PRD §6.4 con `inject()`: chat JSON y SSE, sesión que sobrevive entre peticiones, `out/` servido sin escapes, el front servido en la raíz y ninguna respuesta con la clave | ✅ 7 |
| `front-navegador.test.ts` | `web/app.js` ejecutándose en un DOM mínimo contra el backend real: arranque, un turno completo con sus cinco tarjetas, la banda de confirmación, el botón «Sí, confirmo» que **registra en el maestro**, el envío por clic, el mensaje vacío y el fallo de red | ✅ 7 |
| `paridad-modulo.test.ts` | Que `modulo/` siga siendo **las mismas piezas** que usa la app | F6 |

Estado: **96 pruebas en verde** (F1 + F2 + F3 + F4 + F5), `typecheck` con 0 errores y **cero `any`**; el
desglose de arriba suma 96. La meta al cerrar el reto es ~120, el mismo listón que se sostuvo en el reto 01.
Las pruebas escriben en un `out/` temporal o usan `OUT_DIR`, así que **nunca** tocan el del repositorio
(F5 solo añadió documentación y el `Dockerfile`, por eso no cambian las pruebas).

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

> **Decisión: se prueba en local durante la defensa.** El PRD §9.3 admite esa modalidad y asume el **−10**.
> Lo que sí está hecho y verificado es el despliegue: `docker compose up --build` construye la imagen y el
> contenedor arranca *healthy* (§1), así que lo único que falta para tener URL pública es el extremo, y
> abajo quedan las vías con sus comandos por si se decide activarlo (son tres minutos).

**Cómo se prueba entonces:** un comando de §1 y `http://127.0.0.1:3000`. Para enseñarlo rápido, con
`LLM_PROVIDER=mock` el turno responde en ~20 ms; con Ollama real el turno del buzón tarda ~3 minutos, y el
front va mostrando cada herramienta mientras ocurre.

| Vía, si se decide publicar | Cómo | A favor | En contra |
|---|---|---|---|
| **Túnel a esta máquina** (Cloudflare Tunnel o ngrok) | `docker compose up -d` y luego el túnel apuntando a `http://127.0.0.1:3000` | Es lo único que deja el **modelo local** funcionando por el link: el agente llama a Ollama en la máquina, no en el contenedor | El link vive mientras la máquina esté encendida y la URL gratuita cambia al reiniciar el túnel |
| **Render / Railway / Fly.io** | Desplegar la imagen del `Dockerfile` | Link permanente, sin depender del portátil | Sin GPU no hay modelo local: hay que poner `LLM_PROVIDER=openai` + clave, o enseñar el `mock` |
| **Azure** (Container Apps o App Service) | Igual, con la imagen en un *registry* | Es la nube que un cliente corporativo ya tiene contratada | Es la vía más lenta de montar para una demo de 5 minutos |
| **VPS con Ollama incluido** | `docker compose up` en el VPS | Modelo local y una sola máquina que mantener | La CPU de un VPS pequeño da más latencia que un portátil con GPU (y el turno ya tarda 3 minutos en local) |

**Cómo se activaría el túnel** (la vía que conserva el modelo real):

```bash
brew install cloudflared                     # no está instalado en esta máquina
cd reto-02 && docker compose up -d           # el agente, en http://127.0.0.1:3000
cloudflared tunnel --url http://127.0.0.1:3000
# imprime una URL https://…trycloudflare.com — esa sería la del entregable
```

Para que el link fuera **estable** (misma URL siempre) haría falta un túnel con nombre y un dominio en
Cloudflare; con la cuenta gratuita se puede, y el comando queda `cloudflared tunnel run reto-02`.

**Clave de acceso:** no aplica. El backend no expone ninguna clave de modelo (`/api/health` solo dice el
nombre del proveedor y hay una prueba que lo fija), así que un link público no filtraría credenciales.

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
| 3 | `LLM_PROVIDER=mock npm run dev` y abrir `http://127.0.0.1:3000` (o `docker compose up --build` desde `reto-02/`) | «La app completa sin descargar nada: pego el prompt del PRD §11 y aparecen las tarjetas de cada herramienta y la banda de confirmación. En Docker es el mismo comando único que pide el PRD» |
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
| Contexto del prompt + esquemas | **5 735 tokens** medidos en este reto (una sola llamada, sin herramientas) → `num_ctx: 8192`; en el reto 01 eran 4 179 |
| Tiempos medidos (este reto, Ollama local 8B al 100 % GPU) | primer turno con el modelo **frío ~32 s** · con el modelo cargado, un turno de una llamada **3,4 s** · llamadas siguientes **3–20 s** · el buzón completo **182,6 s y 12 llamadas** · la confirmación **78,5 s** y luego **28,4 s** · el mismo recorrido con `mock`, **~20 ms** |
| Coste estimado | **0,005 USD/caso** con proveedor de pago · **0** en local |
| Modelo | `granite4.1:8b` (Ollama, 5,3 GB, Apache 2.0) |
| Pruebas | **96** en verde (F1–F5) · `typecheck` 0 errores · cero `any` |
| Despliegue | `docker compose up --build` desde `reto-02/` · contenedor **healthy** · imagen `reto-02-agente-contratos` · `out/` montado en `solucion/out/` |

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

1. **El link público no se publica, por decisión** (§8): se prueba en local durante la defensa, como admite
   el PRD §9.3, asumiendo el **−10**. El despliegue está validado (imagen y contenedor *healthy*) y las vías
   para publicarlo, documentadas con sus comandos: activarlo son tres minutos si se cambia de idea.
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
11. **El proveedor `mock` es un guion, no un modelo**: repite una política fija (leer el buzón, registrar
    `msg-001`, validar `msg-006` y preguntar por él) para poder enseñar la app sin instalar nada. Desde F4
    **lee la conversación** en vez de contar llamadas al adaptador, así que responde bien al «sí, confirmo»
    aunque se recargue la página, haya dos sesiones abiertas o se pulse varias veces: antes no lo hacía
    —llevaba un contador global— y ese fallo apareció en la primera prueba manual del front. No entiende
    nada más: con `mock` no se puede pedir otro caso que los fixtures, y para eso está `LLM_PROVIDER=ollama`.
