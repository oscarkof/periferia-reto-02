# Solución · Agente conversacional «Registro de Contratos Vigentes»

**Periferia IT Group · Reto técnico 02** · Node 24 + TypeScript nativo, `fastify`, `zod` y un modelo
local servido por Ollama. Un comando lo levanta todo:

```bash
cd reto-02 && docker compose up --build      # o: cd solucion && npm install && npm run dev
```

| | |
|---|---|
| **Front de chat + API** | `http://127.0.0.1:3000` (el backend sirve el front: un proceso, un puerto) |
| **Link de prueba** | Ver §8 del README; mientras no esté publicado, se levanta en local con el comando de arriba |
| **Recorrido sin modelo** | `cd solucion && npm run demo` (y `--confirmar` para la segunda pasada) |
| **Pruebas** | `cd solucion && npm test` → **96 en verde**, sin modelo y sin red · `npm run typecheck` → 0 errores |
| **Diseño por dentro** | [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md) (más detalle que este documento) |

---

## 1. El problema en una frase

Los contratos de Periferia IT Group llegan por correo en formatos distintos —nuevos, otrosíes, reenvíos y
cosas que **no son contratos**— y alguien tiene que transcribirlos a mano al maestro; por eso el maestro
está congelado desde mayo y nadie sabe con certeza qué vence ni qué póliza falta.

**A quién le duele:** al área administrativa (transcribe y persigue documentos), a la gerencia (decide
ventas y pólizas con datos viejos) y al comercial (no recibe acuse de que su contrato entró). Y le duele
también en la facturación: se factura por contratos que el maestro no conoce.

Lo que hace este agente: **leer el buzón, extraer y clasificar cada contrato, escribir en el maestro solo
lo que está limpio y preguntar lo dudoso**, dejando el documento archivado y el reporte de alertas al día.
El modelo conversa y elige herramientas; **los valores y las clasificaciones salen de código determinista**,
así que el agente no puede inventar un valor ni corromper el maestro.

---

## 2. Arquitectura

```
        navegador
            │  HTML + CSS + módulos ES (sin framework y sin build)
            │  POST /api/chat  ← SSE con cada evento del turno
            ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ src/server.ts + src/server/     UNA PIEZA: front estático + API                │
│   aplicacion · chat · estaticos · front · memoria · identificadores            │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │  ejecutarTurno(directorio, sesion, mensaje, adaptador, prompt, conocimiento)
┌───────────────────────────────▼────────────────────────────────────────────────┐
│ src/agent/     EL CICLO                                                        │
│   loop.ts          modelo → herramientas → modelo, con topes (25 · 200 000)     │
│   paso.ts          valida con zod, ejecuta y AUDITA lo que propone el modelo    │
│   confirmacion.ts  «sí» explícito del turno anterior, en código (RN5)           │
│   sesion.ts        historial, tokens y acción pendiente → out/sessions/<id>.json│
│   eventos.ts       inicio · llamada · resultado · texto · aviso · error · fin    │
│   prompt.ts        compone agent/prompt.md + src/knowledge/registro-contratos.md│
├────────────────────────────────────────────────────────────────────────────────┤
│ src/llm/       UNA INTERFAZ, TRES PROVEEDORES                                  │
│   adapter.ts   enviar(mensajes, herramientas) → respuesta    (PRD §6.1)         │
│   ollama.ts · openai.ts · mock.ts (reactivo) · fabrica.ts                      │
├────────────────────────────────────────────────────────────────────────────────┤
│ src/tools/contratos.ts     LAS CINCO HERRAMIENTAS                              │
│   leer_buzon · extraer · validar · registrar · alertas                         │
│   la única superficie que el modelo puede llamar y la única fuente de datos    │
├────────────────────────────────────────────────────────────────────────────────┤
│ src/core/  MOTOR DETERMINISTA (aquí no hay lenguaje natural)                   │
│   buzon · extraccion · clausulas · normalizacion · identificadores · comerciales│
│   clasificacion · maestro · csv · archivado · alertas · historial · entorno     │
│   log · rutas · io · tipos · escritor                                          │
└──────────────────────────┬──────────────────────────────┬──────────────────────┘
      LECTURA (nunca se escribe)                 ESCRITURA (confinada a out/)
                           ▼                              ▼
        fixtures/reto-02/                       out/
          buzon/msg-001..006/{correo.json,…}      sharepoint/maestro-contratos.csv  ← copia viva
          maestro-contratos.csv                    sharepoint/Contratos/<año>/<cliente>/<id>.<ext>
          comerciales.json                         sharepoint/historial.jsonl
                                                   procesados.json · alertas.md · log.jsonl · sessions/
```

**Dónde vive cada cosa**

| Pieza | Dónde | Por qué ahí |
|---|---|---|
| **Comportamiento** del agente | `agent/prompt.md` | El PRD §6.5 lo pide fuera del código: cambiar una regla de trato no recompila nada |
| **Conocimiento del proceso** | `src/knowledge/registro-contratos.md` | Separado del comportamiento: las reglas del negocio (RN1–RN7, umbrales, columnas del maestro) son conocimiento, no prosa del prompt |
| **Ejecución** | `src/agent/` (ciclo) + `src/tools/` (superficie) | El modelo decide *qué* llamar; el código decide *qué se escribe* |
| **Valores** | `src/core/` | Extracción, normalización y clasificación deterministas, con evidencia y confianza por campo |
| **Salida** | `out/` (`OUT_DIR` la mueve) | Todo lo inspeccionable en un solo sitio: maestro, contratos archivados, historial, alertas, log y sesiones |
| **Las mismas piezas para otras plataformas** | `modulo/` (bonus, F6) | Empaquetadas como agente, con una prueba de paridad contra la aplicación |

**El camino de un turno, en orden**

1. El front manda `{sessionId, message}` a `POST /api/chat` y abre el stream.
2. `ejecutarTurno` carga la sesión (memoria → disco → nueva), añade el mensaje del usuario y compone el
   mensaje de sistema (`agent/prompt.md` + conocimiento).
3. Llama al proveedor con las **cinco herramientas** declaradas: `definirHerramienta` convierte cada
   esquema `zod` en JSON Schema, así que el modelo no puede inventar argumentos
   (`additionalProperties: false`).
4. Cada `tool_call` se valida con zod, se ejecuta contra el motor determinista y su resultado vuelve al
   modelo como mensaje `tool`. El modelo **nunca ve el CSV**: ve resúmenes.
5. Se repite hasta que el modelo responde sin herramientas o se agotan los topes (25 iteraciones por
   turno, 200 000 tokens por sesión).
6. Cada evento sale por SSE **mientras ocurre** (`llamada`, `resultado`, `aviso`…), así el front pinta la
   tarjeta de cada herramienta sin esperar al final del turno.
7. `out/log.jsonl` recibe una línea por llamada y `out/sessions/<id>.json` guarda el historial completo,
   para que recargar la página no pierda nada y `GET /api/sessions/:id` devuelva el estado real.

---

## 3. Ciclo del agente

El bucle está en `src/agent/loop.ts` (`ejecutarTurno`) y es lo único que llama al modelo:

```
mensaje del usuario
   │
   ├─ ¿el usuario confirmó o rechazó algo?  → actualiza la acción pendiente de la sesión
   │
   └─ while (iteraciones < 25)
        ├─ adaptador.enviar([system, ...historial], herramientas)   ← la frontera del PRD §6.1
        ├─ ¿error del proveedor?      → se cuenta en el chat y el turno termina sin morir (CA5)
        ├─ ¿tope de tokens?           → aviso claro y se cierra el turno
        ├─ ¿respondió sin herramientas? → cierra con ese texto
        └─ ¿pidió herramientas?       → paso.ts: zod → auditar → ejecutar → resultado al historial
```

**El proveedor es una frontera, no un detalle.** El ciclo solo conoce `enviar(mensajes, herramientas) →
respuesta`; por eso cambiar de Ollama a OpenAI (o al `mock`) es cambiar `LLM_PROVIDER`. Ningún SDK ni
formato de cable de un proveedor entra en `src/agent/`.

**Los topes** son del ciclo, no del prompt: 25 vueltas herramienta → modelo por turno (CA1) y 200 000
tokens por sesión (PRD §8 · Costo), ajustables con `MAX_ITERACIONES` y `MAX_TOKENS_SESION`. Al alcanzar
el tope de iteraciones el turno **no falla**: responde con lo que tiene y pide instrucciones. Al alcanzar
el de tokens, avisa y cierra. Con el modelo de 8B esto no es teórico: el turno largo del buzón llegó a 12
llamadas, y sin tope un modelo charlatán podría seguir indefinidamente.

**La confirmación humana es del código (CA3 · RN5).** El reparto es explícito:

| Quién | Qué decide |
|---|---|
| `contratos_validar` (motor) | **Descubre** los campos dudosos y los devuelve en `requiere_revision` |
| `src/agent/paso.ts` (ciclo) | Deja el registro de ese mensaje como **acción pendiente** y hace que el turno cierre con `needsConfirmation = true` |
| `src/agent/confirmacion.ts` (ciclo) | Decide si el mensaje del usuario del turno **inmediatamente anterior** es un «sí» explícito |
| El modelo | **Nada**: si llama a `contratos_registrar` con `confirmado: true` sin autorización, el ciclo lo sobrescribe (`argumentos = { ...argumentos, confirmado: false }`), la herramienta lo rechaza y el chat muestra el aviso |

Tres detalles que salen de las pruebas, no de la teoría:

- **Confirmar un mensaje no confirma otro**: la acción pendiente está atada a su `mensaje_id`; un «sí» para
  `msg-006` no autoriza a `msg-003`.
- **El «sí» tiene que ser del turno anterior**: no se acumula ni se hereda; y la detección es conservadora
  (si aparece un «no», «espera» o «revisa», no hay confirmación).
- **Escribir con la confirmación puesta es una operación normal**, no un caso raro: la segunda pasada de
  `npm run demo --confirmar` y el botón «Sí, confirmo» del front son el mismo camino.

**Errores y traza.** Ninguna herramienta lanza: devuelve `{ ok: false, error }` con un texto entendible,
y el ciclo lo cuenta en el chat y sigue (CA5). Cada llamada deja una línea en `out/log.jsonl`
(`ts`, `herramienta`, `mensaje_id`, `ok`, `resumen`, `sesion`), que es la traza que se enseña en la
defensa (RN7 · CA4), y el historial completo en `out/sessions/<id>.json`.

**Cómo se prueba sin modelo.** `src/llm/mock.ts` tiene dos guiones: uno **secuencial** (`guionDemo`, pasos
exactos) que usan las pruebas del ciclo, y uno **reactivo** (`guionReactivo`) que usa la aplicación
servida y decide leyendo la conversación, para que la demo no se desalinee si se recarga la página o se
pulsa «confirmo» dos veces. `test/bucle.test.ts` (13 pruebas) cubre topes, confirmación, auditoría
anti-alucinación, duplicados sin escritura, fallo del proveedor y el recorrido completo del PRD §11.

---

## 4. Elección del modelo

**`granite4.1:8b` servido por Ollama local**, detrás de la interfaz propia que pide el PRD §6.1
(`src/llm/adapter.ts` · `enviar(mensajes, herramientas)`), con adaptadores listos para cualquier API
compatible con OpenAI y para un `mock` determinista.

| Criterio | Por qué este modelo (y este proveedor) |
|---|---|
| **Costo** | **0 por caso**: corre en la máquina, sin claves, sin cuotas y sin límite de uso |
| **Privacidad** | Los contratos **no salen de la empresa**. Con contratos reales de clientes esto pesa más que un punto de latencia |
| **Licencia** | Apache 2.0 (IBM): uso comercial sin restricciones |
| **Tool calling** | Verificado en los dos retos, con **llamadas reales registradas** en `out/log.jsonl` (en este: 12 llamadas en un solo turno, incluido el `registrar` tras el «sí») |
| **Tamaño** | 5,3 GB cuantizado: cabe en 16 GB de RAM junto al sistema y el KV cache |
| **Dominio** | Orientado a empresa (GRC, *compliance*) y con salida JSON estructurada, que es el formato del contrato |
| **Español** | Entiende contratos redactados en español y responde en español sin instrucciones raras |

**Medido en este reto** (macOS, Ollama local, modelo al 100 % GPU, contexto 8 192):

| Qué | Medición real |
|---|---|
| Primera llamada del turno | **~32 s** (incluye procesar el prompt del sistema y los cinco esquemas) |
| Llamadas siguientes del mismo turno | **3–20 s** cada una |
| Turno largo del buzón (6 mensajes) | **182,6 s y 12 llamadas** de herramienta: registró `CT-2026-015`, `CT-2026-016`, el otrosí `CT-2026-011`, dejó el duplicado y el rechazado reportados y pidió confirmación por `msg-006` |
| Turno de confirmación | **78,5 s** el primero (registra `msg-006`) y **28,4 s** otro «sí» después; el segundo no escribe nada extra |
| El mismo recorrido con `mock` | **~20 ms**, sin red y determinista |
| Contexto necesario | **5 735 tokens medidos en este reto** con cinco herramientas ⇒ **`OLLAMA_NUM_CTX=8192`** (el valor por defecto de Ollama, 4 096, rechaza la petición) |

Con esas cifras, el turno se siente lento para un chat: por eso la respuesta va **por streaming** y el front
muestra qué herramienta está llamando y cuántos segundos lleva. Y por eso el prompt pide **procesar un
mensaje por completo antes de pasar al siguiente**: leer los seis mensajes antes de actuar duplicaba el
turno sin mejorar el resultado.

**Costo estimado por caso.** En local es 0 (la energía de la máquina). Si mañana se quiere un modelo de
pago para la fase 2, la cuenta con los tokens medidos en el reto 01 (≈14 500 tokens por turno, 0,15/0,60
USD por millón) da **≈0,005 USD por caso**: cinco décimas de centavo. El maestro de este reto se pone al
día por menos de un céntimo al mes.

**Descartados, con la razón.** `qwen3:4b-instruct` (2,5 GB) **no pasa** el turno de confirmación: se niega a
registrar aunque el usuario lo haya confirmado; con 16 GB de RAM el 8B es la elección. `qwen3:14b` y los
modelos de 30B caben a duras penas y disparan la latencia sin mejorar la extracción (que es determinista,
no del modelo). Las APIs de pago quedan **como alternativa lista** (`openai.ts`), no como requisito: si se
quiere, `LLM_PROVIDER=openai OPENAI_MODEL=gpt-4o-mini` y no se toca una línea del ciclo.

**Cómo se cambia, sin tocar código**

```bash
LLM_PROVIDER=ollama OLLAMA_MODEL=granite4.1:8b npm run dev        # por defecto
LLM_PROVIDER=openai OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini npm run dev
LLM_PROVIDER=mock npm run dev                                    # guion, sin modelo: demo y pruebas
```

`GET /api/health` declara en caliente qué está activo y **nunca devuelve la clave**:
`{"ok":true,"provider":"ollama","model":"granite4.1:8b","herramientas":[…]}`.

---

## 5. Estrategia de extracción

**La regla que manda sobre todas: el único origen válido de un dato es el documento o el maestro.** El
modelo no conoce la razón social, el NIT ni el valor de un contrato, y no puede inventarlos: si un campo no
aparece en el texto, es `faltante` y se dice así.

**De dónde sale cada campo** (`src/core/extraccion.ts`, patrones sobre el texto del adjunto):

| Campo | Cómo se encuentra | Confianza típica |
|---|---|---|
| `id_contrato` | Patrón `CONTRATO No. XX-AAAA-NNN` (y `AL CONTRATO No. …` en un otrosí) | 0,95–0,99 |
| `cliente` / `nit_cliente` | «entre … y … S.A.S.» + identificador fiscal normalizado (`890.900.111-4` → `890900111`) | 0,95 |
| `pais` | **Del identificador, no del texto libre**: RUC ecuatoriano → `EC`, NIT colombiano → `CO` | 0,9 |
| `valor` | Importe en cifras o **en letras** («doscientos sesenta y cinco millones») + moneda local o del país | 0,99 explícito · 0,85 deducido |
| `fecha_inicio` | Fecha explícita, incluso ordinal («primero (1) de agosto de 2026»); si no, la del correo | 0,9 · 0,85 · 0,7 |
| `fecha_fin` | Fecha explícita, o **derivada** del plazo («12 meses desde la firma») | 0,9 · **0,7 (va a revisión)** |
| `requiere_poliza` / `tipo_poliza` | Cláusula de garantías o póliza (incluye «póliza de cumplimiento del 20 %») | 0,85–0,95 |
| `objeto` | Frase del objeto del contrato, recortada a su primera oración completa | 0,8–0,9 |
| `comercial` | El remitente, resuelto contra `fixtures/reto-02/comerciales.json` | 0,9 · ausente = revisión |

Cada campo viaja con su **evidencia**: el fragmento exacto de texto del que salió. No es adorno: es lo que
permite auditar una fila del maestro meses después y responder «¿de dónde salió este número?».

**La confianza decide si se pregunta (RN5).** El umbral es **0.8**:

| Confianza | Qué significa | Qué hace el proceso |
|---|---|---|
| ≥ 0,95 | El documento lo dice de forma explícita | Se escribe |
| 0,80–0,95 | Se dedujo con una regla clara (país por identificador, póliza por cláusula) | Se escribe |
| < 0,80 | Dudoso o incompleto | **No se escribe sin confirmación humana**: entra en `requiere_revision` con su motivo |

**Dónde entra el modelo y dónde no.** El modelo **conversa** (entiende «procesa el buzón»), **elige
herramientas** y **propone** valores si quiere; el motor determinista **extrae**, **clasifica** y **escribe**.
Si el modelo pasa un `contrato` con valores a `contratos_validar` o `contratos_registrar`, el ciclo lo
**audita campo por campo** contra el documento (`auditarContrato` + `camposAlterados`): en cuanto un valor no
coincide, **manda el documento**, el campo entra en `requiere_revision` con el motivo «el valor propuesto no
coincide con el documento» y se informa al usuario. Un valor alterado no llega al maestro nunca; el
argumento se acepta en vez de rechazarse justo para que el desvío quede **auditado** en lugar de invisible.
Hay prueba de esto (`test/bucle.test.ts`: «un valor propuesto que no coincide con el documento se manda a
revisión»; `test/herramientas.test.ts` cubre lo mismo a nivel de herramienta).

**Los cinco mensajes del fixture, campo por campo**, son los casos dorados de `test/extraccion.test.ts`: por
ejemplo `msg-001` da `CT-2026-015`, NIT `890900111`, COP 265 000 000 con confianza 0,99 y póliza de
cumplimiento; el otrosí `msg-003` sube el valor a PEN 520 000 y extiende el plazo a 2027-11-01; y `msg-006`
no trae cifra, así que su `valor` queda en **0 con `valor_indeterminado`** y su `fecha_fin` se **deriva** del
plazo: los dos campos van a revisión, que es exactamente lo que se quiere demostrar.

---

## 6. Regla de gobierno propuesta (PRD §7.5)

> Es una propuesta de **una página**. Existe porque el problema es tanto de proceso como de tecnología: si
> cada comercial sigue enviando el contrato por donde quiere, el agente automatiza el desorden. Esta página
> la adopta (o la ajusta) el área administrativa al arrancar; el software ya la asume.

**1. Canal único.** Un solo buzón: **`contratos@periferia.com`** (alias del actual, compartido). Lo
administra el **área administrativa**, que es la dueña del proceso; el agente solo lo lee y responde por él.
Ningún contrato se considera recibido si llegó a un correo personal, por chat o por carpeta compartida.

**2. Obligación del comercial.** Enviar al buzón **el mismo día de la firma** (máximo 24 horas hábiles; 48 si
la firma fue fuera del país), con estas reglas:

| Qué | Cómo |
|---|---|
| Formato | **PDF firmado por ambas partes** (o Word + el PDF firmado al día siguiente). Un escaneo ilegible no cuenta como entregado |
| Asunto | `CONTRATO <cliente> · <tipo>` con `tipo` ∈ `nuevo`, `otrosí`, `terminación`, `adenda` |
| Otrosíes y adendas | Deben **citar el número del contrato que modifican** (`AL CONTRATO No. CT-2026-011`) |
| Terminaciones | Número del contrato + fecha de terminación (para poder cerrar la póliza) |
| Cuerpo | Una línea: quién firma, con quién y qué se firmó. Sin adjuntos duplicados ni cadenas reenviadas |

**3. Acuse automático.** El agente responde al remitente **en menos de 5 minutos** (en la fase 2, por la API
del buzón; hoy, dejando el acuse en `out/log.jsonl` y en el panel del chat) con: número asignado
(`id_contrato`), campos registrados, campos que quedaron **en revisión y quién los revisa**, y la ruta del
documento archivado. Si el documento **no es un contrato** (una cotización, un borrador), el acuse lo dice
con el motivo. Un comercial que no recibe acuse sabe que su contrato **no** entró: ese es el punto.

**4. Excepciones y escalamiento.** Nada se resuelve «hablando»: cada excepción tiene dueño y plazo.

| Caso | Qué hace el proceso | Quién responde |
|---|---|---|
| Llega **sin firmar** (falta una firma) | `rechazado` con ese motivo, acuse al comercial y copia a su jefe de ventas | Comercial |
| Llega **sin valor** (contrato por demanda) | Se registra con `valor_indeterminado` y va a **revisión**; si a los 5 días hábiles no hay cifra, se escala | Administración |
| Llega **sin número de contrato** | No se inventa: se registra con el número que asigne el maestro y el campo va a revisión | Administración |
| El remitente **no está en `comerciales.json`** | Se registra; se reporta y lo único en revisión es el campo `comercial` | Administración / jefe de ventas |
| **Duplicado o reenvío** | No se escribe nada (RN1); acuse: «ya estaba registrado» | — |
| **Otrosí de un contrato que no está** en el maestro | No se registra: se pide el contrato original; si es de la campaña, lo resuelve Administración | Administración |
| **Discrepancia** entre el documento y lo que dice el comercial | **Manda el documento**; si insiste, decide Administración | Administración |

El plazo de revisión es de **2 días hábiles**. Lo que nadie revisa aparece en `out/alertas.md` como
pendiente y, a la semana, se escala a Dirección Administrativa.

**5. Cierre del gap junio–agosto de 2026** (una sola campaña, tres semanas, sin transcribir a mano):

1. **Semana 1 · recolección.** Administración vuelca a `buzon/` los correos del periodo con el mismo formato
   que el agente espera (correo + adjunto). Nada se copia a mano.
2. **Semana 2 · carga asistida.** El agente recorre los mensajes: los limpios se registran solos y las
   revisiones se confirman **en lote por día** (una persona, dos horas al día). Los contratos sin cifra se
   completan con el valor que **ya está en facturación**, citando la factura como fuente: no se inventa nada.
3. **Semana 3 · conciliación.** El maestro del periodo se compara contra facturación y el objetivo es
   **0 contratos facturados sin fila**. Se firma el cierre y, a partir de ahí, el maestro **no se toca a
   mano**: se alimenta del buzón.
4. Esta reconstrucción se **documenta, no se ejecuta** en este reto: los fixtures traen seis mensajes, no tres
   meses de correo.

**6. Indicador mensual.** El principal: **% de contratos facturados del mes que existen en el maestro**,
meta **≥ 99 %** (objetivo 100 %), desglosado por comercial y publicado el **día 3** de cada mes junto al
reporte de alertas. Complementarios: contratos recibidos **fuera de plazo** (meta ≤ 5 %), **tiempo medio
firma → registro** (meta ≤ 1 día hábil) y **campos en revisión más de 2 días** (meta 0). Si el indicador
principal baja de 95 % dos meses seguidos, se revisa la **regla**, no solo el software.

Lo que entrega este reto es la regla escrita y el software que la hace cumplir: el canal único es el buzón
que el agente lee, la obligación es el formato que el extractor entiende, el acuse es el resumen que el
agente devuelve, y el indicador se calcula con el maestro que el propio agente mantiene.

---

## 7. Decisiones y trade-offs

### 7.1 Modelo local en vez de API de pago

**Decidido:** `granite4.1:8b` en Ollama, en la máquina.
**Alternativa descartada:** empezar con una API de pago (más rápida y algo mejor en instrucciones).
**Por qué:** los contratos son documentos de clientes: con el modelo local **no salen de la empresa**, no hay
claves que proteger ni cuotas que agotar, y el costo por caso es 0. Lo que se paga es latencia (32 s la
primera llamada del turno, que incluye cargar el modelo y procesar el prompt).
**Mitigación del costo:** el turno va por streaming con las tarjetas de herramienta visibles, el prompt pide
procesar un mensaje por completo antes de pasar al siguiente, y cambiar a un proveedor de pago es una
variable de entorno porque `src/llm/openai.ts` ya implementa la misma interfaz.

### 7.2 Front estático sin framework, en vez de React o Vue

**Decidido:** `web/` con HTML, CSS y módulos ES (`app.js` + `sse.js`), servido por el propio backend.
**Alternativa descartada:** un SPA con React y su build (Vite).
**Por qué:** el entregable se evalúa **abriendo un link**, con `docker compose up` o con `npm run dev`: sin
paso de build, la imagen de Docker solo copia archivos y el arranque no puede fallar por compilación; además
un chat con tarjetas de herramienta no necesita el peso de un framework.
**Lo que se paga:** el pintado del DOM se escribe a mano (~600 líneas) y no hay recarga en caliente.
**Mitigación:** `test/front-navegador.test.ts` **ejecuta `app.js` de verdad** en un DOM mínimo contra el
backend real (7 pruebas), así que el front no es la parte sin cubrir que suele ser en estos retos. Si algún
día crece, `src/server/front.ts` ya prefiere `web/dist` si existe: migrar a un build no cambia el backend.

### 7.3 Los valores y la clasificación en código determinista, no en el modelo

**Decidido:** el modelo conversa y elige herramientas; el `id_contrato`, los valores, las fechas, el país y
la clasificación (RN1–RN4) salen de `src/core/`; lo que el modelo proponga se audita contra el documento.
**Alternativa descartada:** dejar que el modelo extraiga el contrato y escriba la fila.
**Por qué:** un LLM es excelente eligiendo herramientas y pésimo garantizando un número. Un contrato
clasificado como «nuevo» cuando era un otrosí **corrompe el maestro en silencio**, y ese error no se detecta
mirando el chat. Con esta separación, el peor caso es un campo en revisión —y en revisión entra también
cualquier valor que el modelo proponga distinto del documento.
**Lo que se paga:** hay que mantener expresiones regulares y reglas para cada redacción nueva (por eso el
conocimiento del proceso está en un Markdown y no repartido por el código).

### 7.4 El maestro es un CSV copiado a `out/`, con escritura atómica

**Decidido:** el maestro de `fixtures/` nunca se toca (RN6); al arrancar se copia a
`out/sharepoint/maestro-contratos.csv` y sobre esa copia se escribe con `.tmp` + rename.
**Alternativa descartada:** una base de datos (SQLite o Postgres) como fuente de verdad.
**Por qué:** el maestro **ya existe** como CSV, lo abre el área administrativa en Excel y es lo que pide el
PRD §7.2; una base de datos obligaría a construir importación/exportación y a sincronizar dos verdades. La
escritura atómica y un `procesados.json` evitan las dos averías reales: archivo a medias y filas duplicadas
al repetir el buzón.
**Lo que se paga:** no hay concurrencia entre procesos (sin *locks*) ni consultas. Está declarado como límite;
si el maestro crece, `src/core/maestro.ts` es la única capa a cambiar: las herramientas no saben cómo se
guarda.

### 7.5 `procesados.json` y `historial.jsonl`, además del maestro

**Decidido:** el maestro guarda el estado; `procesados.json` recuerda qué mensajes ya se resolvieron e
`historial.jsonl` guarda una línea por cambio de fila (qué cambió y de qué valor a qué valor).
**Alternativa descartada:** deducir «ya procesado» comparando el mensaje con el maestro.
**Por qué:** sin `procesados.json`, volver a pasar el buzón mezcla reenvíos idénticos con contratos
legítimamente iguales; sin historial, un otrosí cambia un valor y **nadie sabe cuál era el anterior**, que es
justo lo que hay que poder responder en una auditoría.
**Lo que se paga:** son dos archivos más que mantener y el `historial.jsonl` crece; se rota por año.

### 7.6 Streaming SSE, con `?json=1` para automatizar

**Decidido:** `POST /api/chat` responde con un stream de eventos; `?json=1` devuelve todo de una vez.
**Alternativa descartada:** WebSocket, o sondeo cada segundo.
**Por qué:** el flujo de un turno es **unidireccional** (servidor → cliente) y SSE es HTTP normal: sin
dependencias, sin reconexión propia y sin abrir un puerto extra. Con WebSocket habría que gestionar el ciclo
de vida del socket para transmitir lo mismo. `?json=1` existe porque las pruebas usan `app.inject()` y porque
`curl` no debería obligar a parsear un stream.

### 7.7 `mock` como proveedor de primera clase, y reactivo

**Decidido:** hay un tercer proveedor sin modelo, con guion, y la aplicación servida usa el **reactivo** (lee
la conversación).
**Alternativa descartada:** exigir Ollama para cualquier prueba o demo.
**Por qué:** `npm test` y el recorrido sin modelo corren **sin red, sin claves y en menos de un segundo**, y
eso es lo que permite que 96 pruebas no dependan de una máquina con 6 GB de modelo. El guion reactivo nació
de un fallo real: el secuencial contaba llamadas al adaptador, así que al pulsar «Sí, confirmo» después de
recargar la página el mock respondía «guion agotado» y no llamaba a ninguna herramienta.
**Lo que se paga:** el mock no entiende nada más que los dos documentos de la demo; para cualquier otro caso
hay que usar un modelo.

**Otros dos, en una línea cada uno**

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| `src/core/csv.ts` propio (11 pruebas) | Una librería de CSV | El 90 % del problema son comillas, comas y saltos **dentro** de un campo, más la escritura atómica; ~150 líneas con pruebas no justifican una dependencia de producción |
| Similitud de objeto con Jaccard propio (umbral 0,9) | Una librería de distancia de textos | Solo se usa para **sospechar** una actualización cuando el número de contrato no resuelve, y cualquier duda va a revisión: nada crítico depende de la precisión |

---

## 8. Supuestos

1. **Los adjuntos son texto.** Los fixtures traen `.txt` y el PRD §3.2 excluye el OCR. Leer PDF con texto es
   una capa más en `src/core/buzon.ts` (P1) y no cambia nada del ciclo.
2. **«Buzón» es una carpeta** con `correo.json` + adjuntos, y «SharePoint» es `out/sharepoint/` con la
   estructura de rutas del maestro. El PRD §2.3 autoriza simularlo; la conexión real (Graph/Exchange) sería
   fase 2.
3. **Fecha de referencia 2026-09-03** (la del PRD §11): es el valor por defecto en Docker y en las pruebas, y
   se cambia con `FECHA_EJECUCION`. Sin definir, se usa la del sistema. Sin esto, «vence en 60 días» daría
   resultados distintos cada día y no se podría comparar nada.
4. **El maestro traía contratos ya vencidos** (`CT-2025-018` el 2026-06-30 y `CT-2026-002` el 2026-07-09): el
   reporte de alertas **no** asume que todo lo listado está vigente, son listas separadas.
5. **`nit_cliente` va sin dígito de verificación y sin ceros a la izquierda** (`890.900.111-4` → `890900111`),
   como el maestro del fixture; el país se deduce del identificador, no del texto libre.
6. **«Valor indeterminado» no es una columna del maestro**: un contrato por demanda se guarda con
   `valor = 0` y la marca vive en la validación y el registro. El maestro tiene las 16 columnas del PRD §7.2
   y no se le añaden.
7. **Un solo proceso y un solo usuario.** El maestro es un CSV y las sesiones son archivos; la concurrencia
   entre procesos no está soportada y está declarada como límite.
8. **Si el documento no trae número de contrato**, el sistema asigna el consecutivo del año siguiendo el
   formato del maestro (`<PREFIJO>-<AÑO>-NNN`) y el campo queda en revisión.
9. **El corte del maestro es 2026-05-30** (el que declara `alertas.ts`), y «registrados desde el corte» es lo
   que alimenta la tercera sección del reporte.
10. **La reconstrucción de junio–agosto se documenta, no se ejecuta**: los fixtures traen seis mensajes de
    agosto de 2026, no tres meses de correo.
11. **Datos ficticios.** Correos, clientes y NIT de los fixtures son inventados por el PRD: no hay datos
    personales ni credenciales reales en el repositorio.

---

## 9. Cobertura

| Requisito | Estado | Dónde se comprueba |
|---|---|---|
| **HU-1** Leer el buzón | ✅ | `contratos_leer_buzon` + `procesados.json` (idempotencia) + panel del front; `test/entrada.test.ts` |
| **HU-2** Extraer con confianza y evidencia | ✅ | `contratos_extraer`; `test/extraccion.test.ts` recorre los seis documentos campo por campo |
| **HU-3** Validar y clasificar (RN1–RN4) | ✅ | `src/core/clasificacion.ts`; 9 pruebas con los seis mensajes y casos sintéticos (objeto idéntico con número nuevo, otrosí de contrato desconocido, número automático) |
| **HU-4** Registrar y archivar | ✅ | `contratos_registrar` con escritura atómica, `ruta_sharepoint` e `historial.jsonl` |
| **HU-5** Alertar | ✅ | `contratos_alertas` → `out/alertas.md`; 7 pruebas con los bordes de los 60 días |
| **HU-6** Errores sin trazas | ✅ | ids raros rechazados, sobres fuera de `out/`, proveedor caído, herramienta inexistente y argumentos inválidos: todo con mensaje claro |
| **CA1** tope de iteraciones y de tokens | ✅ | `test/bucle.test.ts` (topes 25 · 200 000) |
| **CA2** el modelo no es fuente de valores | ✅ | Auditoría contra el documento en `tools/contexto.ts`; pruebas en `bucle.test.ts` y `herramientas.test.ts` |
| **CA3 · RN5** confirmación humana | ✅ | `agent/paso.ts` + `agent/confirmacion.ts`; pruebas de que el modelo no puede autorizarse y de que confirmar un mensaje no confirma otro. El front ejecuta el «sí» de punta a punta |
| **CA4 · RN7** traza de cada llamada | ✅ | `out/log.jsonl`; se comprueba en `test/api.test.ts` y `test/herramientas.test.ts` |
| **CA5** un fallo no tumba la sesión | ✅ | `test/bucle.test.ts` (proveedor que falla) y las herramientas que nunca lanzan |
| **API del PRD §6.4** | ✅ | `POST /api/chat` (SSE y `?json=1`), `GET /api/sessions/:id`, `GET /api/health`, `GET /api/files/*`; `test/api.test.ts` (7 pruebas) |
| **Front con llamadas visibles y banda de confirmación** | ✅ | F4; `test/front-navegador.test.ts` (7 pruebas) ejecuta `app.js` de verdad |
| **`demo.ts` sin modelo** | ✅ | `npm run demo` → `6/6` clasificados; `--confirmar` registra `msg-006`; repetirlo no duplica (`test/demo.test.ts`) |
| **Regla de gobierno (§7.5)** | ✅ | §6 de este documento |
| **Un comando para levantar** | ✅ | `docker compose up --build` y `npm run dev`; `test/api.test.ts` comprueba que el backend sirve el front |
| **Link público** | ⏳ | Pendiente de publicar (ver README §8). Mientras, se levanta en local con un comando |
| **Bonus: módulo reutilizable** | ⏳ | F6: `modulo/` + `test/paridad-modulo.test.ts` |

**Qué falta para llevarlo a producción**

1. **Conexión real al buzón** (Graph/Exchange) y al SharePoint real; hoy son carpetas locales.
2. **Autenticación y multiusuario**: el link es público y no hay login; en producción haría falta SSO y
   separación por área.
3. **Cola y reintentos** con *backoff*: hoy los turnos corren en el proceso del servidor.
4. **OCR** para PDFs escaneados, si el cliente deja de enviar PDFs con texto.
5. **Base de datos** en cuanto haya más de una instancia escribiendo el maestro.
6. **Retención y backup**: rotación de `log.jsonl` y `historial.jsonl`, y copia del maestro.
7. **Panel de confirmaciones en lote** para la campaña de reconstrucción (hoy se confirma mensaje a mensaje).
8. **Pruebas con un mes real** de correo anonimizado, para medir el % de campos que caen en revisión.

---

## 10. Uso de IA

| Quién | Para qué |
|---|---|
| **Cline** (extensión de VS Code) sobre **Claude Sonnet 4.5**, en modo agente | El código de la aplicación: módulos de `src/core/`, herramientas, ciclo, servidor, front y las 96 pruebas |
| **granite4.1:8b** vía Ollama | El agente **en ejecución**: conversa y elige herramientas. No escribe valores |

**Para qué tareas concretas lo usé** (y qué verifiqué después):

1. **Estructura inicial** de los módulos de `src/core/` a partir del PRD §6 y §7. Revisé cada módulo y
   reescribí las reglas de negocio yo mismo (clasificación, confianza, construcción de la fila del maestro).
2. **Los casos de prueba**: la tabla de casos dorados campo por campo para los seis documentos y el barrido de
   bordes (ventana de 60 días, duplicados, ids raros, sobres fuera de `out/`).
3. **El front** (HTML/CSS/JS) y el DOM mínimo que hace que `app.js` se pueda ejecutar en una prueba.
4. **El prompt del sistema** y el conocimiento del proceso, en Markdown, iterando con el modelo real.
5. **Redacción y aburrimiento**: este documento, el README y la documentación de arquitectura.
6. **Refactor**: nombres, tipos compartidos y la eliminación de `any`.

**Qué descarté de lo que me propuso, y por qué:**

| Propuesta de la IA | Por qué la descarté |
|---|---|
| Un SPA con React/Vite para el front | Añade build, dependencias y un servidor más para un chat con tarjetas; sin build el arranque no puede fallar |
| Que el modelo extrajera los campos y escribiera la fila | Un número mal extraído corrompe el maestro **en silencio**; los valores salen del motor determinista |
| Un contador de tokens estimado (`caracteres / 4`) para declarar el contexto | Un número inventado no vale más que no tener número: se quedó el **medido** con Ollama |
| `dayjs`/`luxon` para fechas | Las reglas usan fechas ISO **sin zonas**; `Date` de Node basta y una dependencia menos en la imagen |
| Un `mock` con guion secuencial para la app servida | **Falló en la práctica**: al confirmar tras recargar, respondía «guion agotado». Se reemplazó por el guion reactivo, con pruebas de regresión |
| Detección del «sí» con `\b` | Es ASCII: no reconocía «sí» con acento, que es el caso real (hoy se compara la primera palabra ya normalizada) |
| Validar los argumentos del modelo con `extraer` estricto | Si el objeto no coincide, la herramienta rechaza; se cambió a **auditar** para que el desvío quede registrado en la traza y en la revisión, en vez de invisible |

**Cómo verifico lo que la IA escribe.** Nada entra sin pasar `npm test` (96 pruebas), `npm run typecheck`
(0 errores), `npm run demo` (6/6 y sin duplicar al repetir), un turno real contra Ollama revisado en
`out/log.jsonl` y el `docker compose up --build` con el contenedor *healthy*. Los commits los firmo yo, uno
por intención, y **puedo explicar cada línea**: el diseño de reglas, los umbrales y las decisiones de §7 son
míos, y el fallo del `mock` está documentado aquí porque me lo encontró el usuario probando la app, no una
herramienta.

---

## 11. Riesgos de llevarlo a producción

| # | Riesgo | Qué pasaría | Mitigación |
|---|---|---|---|
| 1 | El buzón real trae **PDFs escaneados** o formatos que el extractor no entiende | Campos `faltante` en todos los mensajes y la cola de revisión se desborda | La regla de gobierno obliga a PDF firmado con texto; medir el % en revisión con un mes real **antes** de generalizar; añadir OCR (P1) |
| 2 | El maestro es un **CSV** y alguien lo edita a mano mientras el agente escribe | Fila perdida o archivo a medias | Escritura atómica (`.tmp` + rename); regla «el maestro no se toca a mano»; copia de seguridad diaria; migrar a base de datos al pasar de una instancia o de un umbral de filas |
| 3 | **Clave del modelo filtrada** (si se usa API de pago) | Gasto ajeno y fuga de datos | Hoy no hay clave: el modelo es local. Si se usa API: solo en variable de entorno, nunca al front, a los logs ni a `/api/health` (hay prueba), `.env` ignorado por git, y **tope de tokens por sesión** (200 000) |
| 4 | **Costo descontrolado** con API de pago | Factura inesperada | Modelo local por defecto; topes por turno y por sesión; ≈0,005 USD por caso medido |
| 5 | El modelo **alucina** un valor y alguien lo aprueba sin mirar | Dato falso en el maestro | Los valores salen del documento, no del modelo; la auditoría detecta y **marca** cualquier propuesta distinta; el maestro no se escribe sin confirmación cuando el campo es dudoso |
| 6 | **Clasificación equivocada** (un otrosí tratado como nuevo, o al revés) por un caso no previsto | Contrato duplicado o valor desactualizado | RN1–RN4 con umbral de similitud y revisión para lo dudoso; `historial.jsonl` permite ver y revertir el cambio; reconciliación mensual contra facturación |
| 7 | **Caída del proceso a mitad de un turno** | Mensaje procesado a medias | `procesados.json` se escribe **después** de registrar y el maestro es idempotente: volver a pasar el buzón es seguro. En producción, cola con reintentos y *backoff* |
| 8 | **Cambio de modelo o de versión** de Ollama | El chat responde distinto | El ciclo no depende del modelo (96 pruebas sin él); `OLLAMA_MODEL` queda fijado y documentado; cambiar de proveedor es una variable |
| 9 | **Alteración de los contratos archivados** (son archivos) | Pérdida de la evidencia original | Se guardan como **copia del adjunto**, nunca se modifican; en producción, permisos de solo-escritura y versionado del SharePoint |
| 10 | **Datos personales** en los correos (remitentes, firmantes) | Incumplimiento de privacidad | Hoy son fixtures ficticios; con datos reales: política de retención, minimizar lo que se guarda en `log.jsonl` y aviso en la regla de gobierno |
| 11 | **Latencia**: 182,6 s en el turno largo con el modelo local | Parece que la aplicación se colgó | Streaming con la herramienta en curso y los segundos visibles; `/api/health` dice qué proveedor está activo; `LLM_PROVIDER=mock` demuestra el flujo entero en 20 ms |

**Lo que no es un riesgo, y conviene decir por qué:** que el modelo esté caído. Ya está probado
(`test/bucle.test.ts`): el turno falla con un mensaje claro, la sesión sobrevive y el siguiente caso entra
igual. El sistema degrada, no se cae.

---

Para levantar la aplicación, las variables de entorno y el link de prueba, ver el
[`README.md`](README.md); para el detalle de cada módulo, [`solucion/docs/arquitectura.md`](solucion/docs/arquitectura.md).











