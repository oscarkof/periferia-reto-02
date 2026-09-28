/**
 * Eventos de un turno.
 *
 * El ciclo del agente no habla HTTP: emite estos eventos y el backend decide
 * cómo los transmite (SSE en F3/F4, o el registro de pruebas). Así el front
 * puede mostrar cada llamada a herramienta sin que el ciclo sepa de sockets.
 */

/** Evento emitido durante un turno. */
export type EventoTurno =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; nombre: string; argumentos: Record<string, unknown> }
  | { tipo: "resultado"; nombre: string; ok: boolean; resumen: string }
  | { tipo: "aviso"; texto: string }
  | { tipo: "error"; texto: string }
  | { tipo: "fin"; texto: string; needsConfirmation: boolean; llamadas: number; iteraciones: number }

/** Respuesta de una herramienta, ya interpretada. */
export interface RespuestaHerramienta {
  ok: boolean
  data: Record<string, unknown> | null
  error: string | null
}

/** Interpreta el JSON de una herramienta sin lanzar nunca. */
export function interpretarRespuestaHerramienta(json: string): RespuestaHerramienta {
  try {
    const crudo = JSON.parse(json) as { ok?: unknown; data?: unknown; error?: unknown }
    if (crudo.ok === true) {
      const datos = crudo.data
      return {
        ok: true,
        data: typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : null,
        error: null,
      }
    }
    return { ok: false, data: null, error: typeof crudo.error === "string" ? crudo.error : "error sin detalle" }
  } catch {
    return { ok: false, data: null, error: "la herramienta no devolvió un JSON válido" }
  }
}

/** Resumen legible de una respuesta, para el chat y para el log (CA4). */
export function resumirRespuesta(respuesta: RespuestaHerramienta): string {
  if (!respuesta.ok) return `error: ${respuesta.error ?? "sin detalle"}`

  const datos = respuesta.data
  if (datos === null) return "sin datos"

  const resumen = datos["resumen"]
  if (typeof resumen === "string") return resumen

  const ruta = datos["ruta"]
  if (typeof ruta === "string") {
    const clasificacion = datos["clasificacion"]
    return typeof clasificacion === "string" ? `${clasificacion} · ruta ${ruta}` : `ruta ${ruta}`
  }

  const clasificacion = datos["clasificacion"]
  if (typeof clasificacion === "string") {
    const revision = datos["requiere_revision"]
    const campos = Array.isArray(revision) && revision.length > 0 ? ` (revisar ${revision.join(", ")})` : ""
    return `${clasificacion}${campos}`
  }

  const texto = JSON.stringify(datos)
  return texto.length > 140 ? `${texto.slice(0, 139)}…` : texto
}
