# Proceso: registro de contratos vigentes

> Conocimiento del proceso que el agente consulta. No es comportamiento (eso vive en
> `agent/prompt.md`): aquí está **qué es verdad del negocio**, no cómo debe hablar el agente.

## 1. Qué resuelve

Periferia IT Group firma contratos con clientes de varios países. Los documentos llegan por correo
(PDF, Word o texto ya normalizado), con formatos distintos: contratos nuevos, otrosíes que modifican
un contrato existente, reenvíos y, a veces, cosas que **no son contratos** (cotizaciones, propuestas).

Hoy una persona lee cada adjunto y transcribe los campos al maestro de contratos, y el maestro se
desactualiza. Este proceso automatiza esa transcripción y **deja la confirmación de lo dudoso en manos
de una persona**.

## 2. Actores

| Actor | Qué hace |
|---|---|
| Comercial / practicante | Envía el contrato al buzón. No usa el agente. |
| Área administrativa | Conversa con el agente, confirma los campos en revisión y revisa el reporte. |
| Gerencia | Recibe las alertas de vencimiento y las pólizas pendientes. |
| El agente | Lee, extrae, clasifica, pregunta y escribe en el maestro **solo lo confirmado**. |

## 3. Entradas: el buzón

Cada mensaje es una carpeta en `fixtures/reto-02/buzon/<id>/`:

| Archivo | Qué aporta |
|---|---|
| `correo.json` | Correo normalizado: `id`, `de`, `para`, `asunto`, `fecha`, `cuerpo`, `adjuntos[]` |
| `contrato.txt` | El documento del contrato. Es la **única fuente** de los valores |
| `otrosi.txt` | Una modificación de un contrato ya registrado |
| `cotizacion.txt` | **No es un contrato** (existe justo para probar el rechazo, RN4) |

El mensaje `msg-005` no trae contrato: es el caso que el sistema debe **rechazar con motivo**, no
arreglar.

## 4. Fuentes de datos (y la regla de oro)

| Fuente | Contenido | ¿Se escribe? |
|---|---|---|
| `fixtures/reto-02/maestro-contratos.csv` | Las 16 columnas del maestro, con los contratos ya registrados | **Nunca** (RN6) |
| `fixtures/reto-02/comerciales.json` | `email`, `nombre` y `region` de cada comercial | **Nunca** |
| `out/sharepoint/maestro-contratos.csv` | **Copia de trabajo** del maestro: es la que se modifica | Sí |

**Regla de oro:** el único origen válido de un valor es el documento del mensaje o el maestro. Si un
campo no aparece en ninguno de los dos, **no se completa con un valor plausible**: se pide o queda en
revisión. El fixture es de solo lectura (RN6) y la escritura está confinada a `out/`.

## 5. Las 16 columnas del maestro

`id_contrato`, `cliente`, `nit_cliente`, `pais`, `objeto`, `valor`, `moneda`, `fecha_inicio`,
`fecha_fin`, `requiere_poliza`, `tipo_poliza`, `estado_poliza`, `comercial`, `ruta_sharepoint`,
`fecha_registro`, `fuente`.

| Columna | Detalle que importa |
|---|---|
| `id_contrato` | Si el documento no trae número, se genera con el consecutivo del maestro |
| `nit_cliente` | Sin dígito de verificación y **sin ceros a la izquierda**: `890.900.111-4` → `890900111` |
| `pais` | Se deduce del identificador fiscal: RUC ecuatoriano → `EC`, NIT colombiano → `CO` |
| `valor` | Número sin separadores de miles. Un contrato **sin cifra** se guarda como `0` y se marca `valor_indeterminado` (marca interna): va a revisión |
| `fecha_fin` | Si el documento expresa plazo («12 meses desde la firma»), se **deriva** de `fecha_inicio` y va a revisión |
| `tipo_poliza` | Puede ser más de una; en el CSV van separadas por `;` |
| `estado_poliza` | `vigente`, `pendiente`, `vencida` o `no_aplica`. Un contrato que exige póliza nace `pendiente` |
| `comercial` | Se resuelve por el remitente contra `comerciales.json`. Si el remitente no está, el campo va a revisión **pero no bloquea** |
| `ruta_sharepoint` | Ruta relativa donde se archiva el documento: `Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>` |
| `fuente` | `buzon` para lo registrado por el agente; `migracion` para lo que vino del histórico |

## 6. Confianza y revisión: cuándo se pregunta (RN5)

Cada campo extraído viaja con su **confianza** (0 a 1) y la **evidencia** que lo sostiene (el
fragmento de texto del que salió). El umbral es **0.8**:

| Confianza | Qué significa | Qué hace el proceso |
|---|---|---|
| ≥ 0.95 | El documento lo dice de forma explícita | Se escribe |
| 0.80 – 0.95 | Se dedujo con una regla clara (país por identificador fiscal, póliza por cláusula) | Se escribe |
| < 0.80 | Dudoso o incompleto | **No se escribe sin confirmación humana**: entra en `requiere_revision` con su motivo |

Un contrato con campos en revisión **no se registra** en la primera pasada. La persona confirma en el
chat («confirmo el valor 0 y la fecha fin 2027-08-31») y entonces sí se escribe. Confirmar un mensaje
**no** confirma otro.

Con los fixtures, el caso que lo demuestra es `msg-006`: no trae cifra, así que su `valor` es dudoso por
diseño y el sistema **pregunta** en vez de registrar mal. Todos sus campos van a revisión, pero
`comercial` es distinto: el remitente no está en `comerciales.json`, y eso **se reporta sin bloquear**
el registro.

## 7. Clasificación (RN1–RN4)

Antes de escribir nada, cada mensaje se clasifica. **Manda el número de contrato**: el cliente solo se
usa para *sospechar* actualización, nunca para decidir.

| Regla | Clasificación | Cuándo | Qué hace el proceso |
|---|---|---|---|
| **RN1** | `duplicado` | El `id_contrato` ya está y los valores son idénticos | **No escribe nada**; reporta y marca el mensaje como procesado |
| **RN2** | `actualizacion` | Un otrosí que menciona un contrato existente, o mismo cliente con objeto parecido ≥ 0.9 | Modifica la fila y anota el cambio en `historial.jsonl` |
| **RN3** | `nuevo` | No hay coincidencia en el maestro | Inserta la fila y archiva el documento |
| **RN4** | `rechazado` | El mensaje no trae un contrato (una cotización, un anexo suelto) | **No registra**; reporta el motivo |

**Un otrosí no es un contrato nuevo** (RN2): modifica el contrato que menciona y solo los campos que
cambia. Y un mismo cliente con **otro** número de contrato es `nuevo`, no duplicado ni actualización.

## 8. Las cinco herramientas

| Herramienta | Para qué | Argumentos |
|---|---|---|
| `contratos_leer_buzon` | Lista los mensajes sin procesar, con sus adjuntos y si traen contrato | — |
| `contratos_extraer` | Campos del contrato, con confianza y evidencia de cada uno | `mensaje_id` |
| `contratos_validar` | Clasifica el mensaje y dice qué campos exigen confirmación | `mensaje_id`, `contrato` (opcional) |
| `contratos_registrar` | Escribe en el maestro, archiva el documento, anota el historial y marca procesado | `mensaje_id`, `contrato` (opcional), `confirmado` |
| `contratos_alertas` | Genera `out/alertas.md` con vencimientos, pólizas y registros recientes | `hoy` (`AAAA-MM-DD`) |

`contrato` es **opcional** en validar y registrar: si el modelo propone valores, se **auditan** contra
el documento y se comparan campo por campo. Si alguno no coincide, **manda el documento**, el campo
entra en `requiere_revision` y se le dice al usuario que hubo divergencia. Un valor alterado no llega
al maestro nunca.

## 9. Dónde se escribe (todo dentro de `out/`)

| Ruta | Qué deja |
|---|---|
| `out/sharepoint/maestro-contratos.csv` | El maestro vivo: el fixture copiado y luego modificado |
| `out/sharepoint/Contratos/<año>/<cliente>/<id>.pdf` | El documento archivado |
| `out/sharepoint/historial.jsonl` | Una línea por cambio de una fila (qué cambió, de qué valor a qué valor) |
| `out/procesados.json` | Ids ya procesados: es lo que permite repetir el buzón sin duplicar |
| `out/alertas.md` | El reporte de la herramienta de alertas |
| `out/log.jsonl` | Una línea por ejecución de herramienta: `{ ts, herramienta, ok, resumen }` (RN7) |
| `out/sessions/<id>.json` | El historial de cada conversación |

Nada de esto toca `fixtures/` (RN6).

## 10. El reporte de alertas

`out/alertas.md` tiene tres secciones:

1. **Contratos que vencen en 60 días**: para avisar a la gerencia con tiempo.
2. **Pólizas pendientes**: los contratos que exigen póliza y todavía no la tienen.
3. **Registrados desde el corte**: lo que el agente ha alimentado al maestro.

La fecha de referencia se pasa como argumento `hoy`. El maestro trae **contratos ya vencidos**, así que
el reporte nunca asume que todo lo listado está vigente: son tres listas, no un semáforo global.

## 11. Cómo responder a un error

Ninguna herramienta lanza excepciones: siempre devuelve `{ ok: false, error }` con un mensaje entendible.

| Situación | Qué hace el proceso |
|---|---|
| El mensaje no existe o el id tiene forma rara | Error legible (nunca una traza) y se puede probar otro |
| El mensaje no trae contrato | **No es un error del sistema**: es un rechazo con motivo (RN4) |
| El maestro no se puede leer | Error legible y **no se escribe nada** |
| Una herramienta recibe argumentos inválidos | Se rechaza antes de ejecutar y el detalle vuelve al modelo |
| El proveedor del modelo falla o expira | Mensaje claro en el chat; la sesión sigue viva |

## 12. Los seis mensajes de referencia

| Mensaje | Documento | Qué trae | Clasificación |
|---|---|---|---|
| `msg-001` | `contrato.txt` | `CT-2026-015` · Industrias Delta · COP 265.000.000 · 2026-08-01 → 2027-07-31 · póliza de cumplimiento | `nuevo` limpio |
| `msg-002` | `contrato.txt` | `CT-2026-016` · Corporación Andina (RUC → país EC) · USD 120.000 · sin cláusula de garantías | `nuevo` limpio |
| `msg-003` | `otrosi.txt` | Otrosí al `CT-2026-011`: extiende el plazo y sube el valor (PEN 520.000) | `actualizacion` |
| `msg-004` | `contrato.txt` | Reenvío del `CT-2026-012` con valores idénticos a la fila del maestro | `duplicado` (RN1) |
| `msg-005` | `cotizacion.txt` | `COT-2026-088`: una cotización, sin contrato | `rechazado` (RN4) |
| `msg-006` | `contrato.txt` | Contrato marco `CM-2026-03` · Distribuidora Caribe · **valor indeterminado** · plazo «12 meses desde la firma» | `nuevo` **con revisión** (RN5) |

`msg-002` es el mismo cliente que un contrato ya registrado (`CT-2026-007`) pero **otro contrato**: no
es duplicado ni actualización. Es la prueba de que manda el número de contrato y no el cliente.
