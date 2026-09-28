/**
 * Recorrido de los seis mensajes del buzón sin modelo (PRD §6.6).
 *
 * Es la pieza que demuestra el motor determinista en 30 segundos: llama a las
 * herramientas **en el mismo orden en que las llamaría el agente**, pero sin
 * modelo, sin claves y sin red. Y respeta la regla que da sentido a todo: lo que
 * queda en revisión **no se registra** en la primera pasada; solo se registra en
 * la segunda, cuando llega `confirmado: true` (RN5 · CA3).
 */
import { alertas as toolAlertas, extraer, leer_buzon, registrar, validar } from "../tools/contratos.ts"
import type { ContextoHerramienta } from "../tools/contrato.ts"
import type {
  AccionRegistro,
  Clasificacion,
  Diferencia,
  Extraccion,
  MensajeResumen,
  ReporteAlertas,
  Resultado,
  ResultadoValidacion,
} from "../core/tipos.ts"

/** Cómo terminó un mensaje dentro del recorrido. */
export type EstadoMensaje = "registrado" | "sin_cambios" | "en_revision" | "sin_escribir" | "error"

/** Lo que la demo cuenta de cada mensaje (y lo que se escribe en `resumen.json`). */
export interface FilaRecorrido {
  mensaje_id: string
  clasificacion: Clasificacion | null
  estado: EstadoMensaje
  id_contrato: string | null
  accion: AccionRegistro | null
  requiere_revision: string[]
  motivos: string[]
  avisos: string[]
  diferencias: Diferencia[]
  ruta_archivo: string | null
  /** Una línea con el contrato leído, para que la demo se pueda leer de un vistazo. */
  detalle: string | null
}

/** Totales del recorrido. */
export interface ConteoRecorrido {
  total: number
  /** Filas escritas o modificadas en el maestro. */
  registrados: number
  /** Duplicados: el contrato ya estaba tal cual, no se escribió nada. */
  sin_cambios: number
  en_revision: number
  sin_escribir: number
  errores: number
}

/** Resultado completo: las filas, los totales y el reporte de alertas. */
export interface ResumenRecorrido {
  filas: FilaRecorrido[]
  conteo: ConteoRecorrido
  alertas: ReporteAlertas | null
}

/** Opciones del recorrido. */
export interface OpcionesRecorrido {
  /** Segunda pasada: registra lo que quedó en revisión (PRD §6.6). */
  confirmar: boolean
  /** Genera además `out/alertas.md` (HU-5). */
  conAlertas: boolean
  /** Fecha de referencia para las alertas. */
  hoy: string
}

/** Lee la respuesta de una herramienta (`{ ok, data | error }`). */
export function interpretar<T>(respuesta: string): Resultado<T> {
  try {
    const cuerpo = JSON.parse(respuesta) as { ok?: boolean; data?: T; error?: string }
    if (cuerpo.ok === true && cuerpo.data !== undefined) return { ok: true, data: cuerpo.data }
    return { ok: false, error: cuerpo.error ?? "respuesta sin datos" }
  } catch {
    return { ok: false, error: "la herramienta devolvió algo que no es JSON" }
  }
}

/** Una línea legible con lo que el documento dice, para imprimirla en la demo. */
function detalleDe(extraccion: Extraccion): string {
  const { contrato } = extraccion
  const partes: string[] = [contrato.id_contrato ?? "(sin número)"]
  if (contrato.cliente !== null) partes.push(contrato.cliente)
  if (contrato.valor !== null) partes.push(`${contrato.valor} ${contrato.moneda ?? ""}`.trim())
  if (contrato.fecha_inicio !== null || contrato.fecha_fin !== null) {
    partes.push(`${contrato.fecha_inicio ?? "?"} → ${contrato.fecha_fin ?? "?"}`)
  }
  return partes.join(" · ")
}

/** Suma los estados del recorrido. */
function contar(filas: readonly FilaRecorrido[]): ConteoRecorrido {
  return {
    total: filas.length,
    registrados: filas.filter((f) => f.estado === "registrado").length,
    sin_cambios: filas.filter((f) => f.estado === "sin_cambios").length,
    en_revision: filas.filter((f) => f.estado === "en_revision").length,
    sin_escribir: filas.filter((f) => f.estado === "sin_escribir").length,
    errores: filas.filter((f) => f.estado === "error").length,
  }
}

/** Fila vacía, para poder completarla paso a paso. */
function filaBase(mensajeId: string, clasificacion: Clasificacion | null): FilaRecorrido {
  return {
    mensaje_id: mensajeId,
    clasificacion,
    estado: "error",
    id_contrato: null,
    accion: null,
    requiere_revision: [],
    motivos: [],
    avisos: [],
    diferencias: [],
    ruta_archivo: null,
    detalle: null,
  }
}

/**
 * Recorre el buzón llamando a las herramientas, en el mismo orden en que las
 * llamaría el agente: `leer_buzon` → `validar` → (`extraer`) → `registrar`.
 *
 * Con `confirmar: false` los mensajes con campos en revisión quedan **sin
 * registrar** y el motivo queda escrito en la fila. Con `confirmar: true` se
 * registran, que es lo que demuestra que la escritura depende del humano.
 */
export async function recorrer(
  ctx: ContextoHerramienta,
  opciones: OpcionesRecorrido,
): Promise<ResumenRecorrido> {
  const filas: FilaRecorrido[] = []

  const listado = interpretar<{ mensajes: MensajeResumen[] }>(await leer_buzon.execute({}, ctx))
  if (!listado.ok) {
    const fila = filaBase("(buzón)", null)
    fila.detalle = listado.error
    return { filas: [fila], conteo: contar([fila]), alertas: null }
  }

  for (const mensaje of listado.data.mensajes) {
    const fila = filaBase(mensaje.id, null)

    const validado = interpretar<ResultadoValidacion>(await validar.execute({ mensaje_id: mensaje.id }, ctx))
    if (!validado.ok) {
      fila.detalle = validado.error
      filas.push(fila)
      continue
    }

    fila.clasificacion = validado.data.clasificacion
    fila.requiere_revision = validado.data.requiere_revision
    fila.motivos = validado.data.motivos
    fila.avisos = validado.data.avisos
    fila.diferencias = validado.data.diferencias

    // RN4: un mensaje sin contrato no se registra, y no es un error del sistema.
    if (validado.data.clasificacion === "rechazado") {
      fila.estado = "sin_escribir"
      fila.detalle = validado.data.motivo_rechazo
      filas.push(fila)
      continue
    }

    const extraido = interpretar<Extraccion>(await extraer.execute({ mensaje_id: mensaje.id }, ctx))
    if (extraido.ok) fila.detalle = detalleDe(extraido.data)

    const escrito = interpretar<{
      id_contrato: string
      accion: AccionRegistro
      ruta_archivo: string
    }>(await registrar.execute({ mensaje_id: mensaje.id, confirmado: opciones.confirmar }, ctx))

    if (escrito.ok) {
      // Un duplicado no es un registro: no se escribió nada (RN1).
      fila.estado = escrito.data.accion === "sin_cambios" ? "sin_cambios" : "registrado"
      fila.id_contrato = escrito.data.id_contrato
      fila.accion = escrito.data.accion
      fila.ruta_archivo = escrito.data.ruta_archivo
    } else if (validado.data.requiere_revision.length > 0 && !opciones.confirmar) {
      // El registro se negó, y es exactamente lo que tenía que pasar (RN5).
      fila.estado = "en_revision"
      fila.detalle = escrito.error
    } else {
      fila.detalle = escrito.error
    }

    filas.push(fila)
  }

  let alertas: ReporteAlertas | null = null
  if (opciones.conAlertas) {
    const reporte = interpretar<ReporteAlertas>(await toolAlertas.execute({ hoy: opciones.hoy }, ctx))
    alertas = reporte.ok ? reporte.data : null
  }

  return { filas, conteo: contar(filas), alertas }
}

