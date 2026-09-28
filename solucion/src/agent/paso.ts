/**
 * Ejecución de las llamadas a herramientas de una respuesta del modelo.
 *
 * Aquí viven las dos reglas que el PRD no deja en manos del prompt:
 *   · **CA2**: la herramienta es la única fuente de valores (lo que proponga el
 *     modelo lo audita `contratos_validar` comparando contra el buzón);
 *   · **CA3 · RN5**: el valor de `confirmado` lo impone este código a partir del
 *     mensaje del usuario, nunca el modelo.
 *
 * El reparto con el resto del ciclo: `contratos_validar` es quien **descubre** los
 * campos por confirmar, así que es él quien deja la acción pendiente y quien hace
 * que el turno cierre con `needsConfirmation = true`. El «sí» del usuario llega en
 * el turno siguiente y solo entonces `contratos_registrar` queda autorizado, y
 * solo para **ese** mensaje: confirmar un contrato no confirma el siguiente.
 */
import { ejecutarValidando, type ContextoHerramienta, type HerramientaGenerica } from "../tools/contrato.ts"
import { NOMBRES } from "../tools/contratos.ts"
import type { LlamadaHerramienta } from "../llm/adapter.ts"
import { interpretarRespuestaHerramienta, resumirRespuesta, type EventoTurno } from "./eventos.ts"
import type { AccionPendiente, Sesion } from "./sesion.ts"

/** Herramienta cuyo uso está gobernado por la confirmación humana (RN5). */
export const HERRAMIENTA_REGISTRAR = NOMBRES.registrar

/** Herramienta que descubre los campos por confirmar. */
export const HERRAMIENTA_VALIDAR = NOMBRES.validar

/** Aviso cuando el modelo intenta firmar la confirmación que le toca al usuario. */
export const AVISO_SIN_CONFIRMACION =
  "el modelo intentó registrar sin confirmación previa del usuario: se forzó confirmado=false (RN5)"

/** Clasificación que nunca se registra: el mensaje se descarta con motivo. */
const CLASIFICACION_RECHAZADO = "rechazado"

export interface OpcionesPaso {
  sesion: Sesion
  llamadas: LlamadaHerramienta[]
  indice: Map<string, HerramientaGenerica>
  nombresDisponibles: string[]
  contexto: ContextoHerramienta
  pendientePrevio: AccionPendiente | null
  /** ¿El mensaje del usuario en este turno es una confirmación explícita? */
  confirma: boolean
  /** Escritor de eventos del turno. */
  emitir: (evento: EventoTurno) => void
}

/** Campos que `contratos_validar` dejó pidiendo confirmación. */
function camposPorConfirmar(datos: Record<string, unknown> | null): string[] {
  const revision = datos?.["requiere_revision"]
  if (!Array.isArray(revision)) return []
  return revision.filter((campo): campo is string => typeof campo === "string")
}

/**
 * ¿El error de `contratos_registrar` es el de RN5?
 *
 * Es la única comprobación sobre texto de error del ciclo, y existe porque un
 * registro sin confirmación **no es un fallo** sino una acción pendiente: el
 * mensaje de la herramienta lo dice con las palabras «requiere revisión antes de
 * registrar» (`contratos_registrar`), y aquí solo se traduce a estado del turno.
 */
function requiereConfirmacion(error: string | null): boolean {
  return error !== null && /requiere revisi[oó]n antes de registrar/i.test(error)
}

/**
 * Ejecuta todas las llamadas y devuelve cuántas se intentaron.
 * Los resultados se añaden al historial de la sesión (CA4).
 */
export async function ejecutarLlamadas(opciones: OpcionesPaso): Promise<number> {
  const { sesion, llamadas, indice, nombresDisponibles, contexto, pendientePrevio, confirma, emitir } = opciones
  let ejecutadas = 0
  /** Acción que este turno deja esperando un «sí», si el turno no registró nada. */
  let pendienteDeEsteTurno: AccionPendiente | null = null
  /** Mensaje que se registró de verdad en este turno (`null` si no hubo ninguno). */
  let registrado: string | null = null

  for (const llamada of llamadas) {
    ejecutadas += 1
    const implementacion = indice.get(llamada.nombre)

    if (implementacion === undefined) {
      const error = `herramienta desconocida "${llamada.nombre}". Disponibles: ${nombresDisponibles.join(", ")}`
      emitir({ tipo: "resultado", nombre: llamada.nombre, ok: false, resumen: error })
      sesion.mensajes.push({ rol: "tool", contenido: JSON.stringify({ ok: false, error }), idLlamada: llamada.id })
      continue
    }

    let argumentos = llamada.argumentos
    let autorizada = false
    const mensajeId = String(argumentos["mensaje_id"] ?? "")

    if (llamada.nombre === HERRAMIENTA_REGISTRAR) {
      const esLaPendiente =
        pendientePrevio !== null &&
        pendientePrevio.herramienta === llamada.nombre &&
        String(pendientePrevio.argumentos["mensaje_id"] ?? "") === mensajeId

      autorizada = confirma && (pendientePrevio === null || esLaPendiente)
      if (argumentos["confirmado"] === true && !autorizada) {
        emitir({ tipo: "aviso", texto: AVISO_SIN_CONFIRMACION })
      }
      // El ciclo impone el valor: el modelo no puede autorizarse a sí mismo.
      argumentos = { ...argumentos, confirmado: autorizada }
    }

    emitir({ tipo: "llamada", nombre: llamada.nombre, argumentos })
    const salida = await ejecutarValidando(implementacion, llamada.nombre, argumentos, contexto)
    const interpretada = interpretarRespuestaHerramienta(salida)
    emitir({
      tipo: "resultado",
      nombre: llamada.nombre,
      ok: interpretada.ok,
      resumen: resumirRespuesta(interpretada),
    })
    sesion.mensajes.push({ rol: "tool", contenido: salida, idLlamada: llamada.id })

    if (llamada.nombre === HERRAMIENTA_VALIDAR && interpretada.ok) {
      const clasificacion = String(interpretada.data?.["clasificacion"] ?? "")
      const campos = camposPorConfirmar(interpretada.data)
      if (clasificacion !== CLASIFICACION_RECHAZADO && campos.length > 0) {
        pendienteDeEsteTurno = {
          herramienta: HERRAMIENTA_REGISTRAR,
          argumentos: { mensaje_id: mensajeId, confirmado: true },
          descripcion: `registrar el contrato de ${mensajeId} confirmando: ${campos.join(", ")}`,
        }
      }
    }

    if (llamada.nombre === HERRAMIENTA_REGISTRAR) {
      if (interpretada.ok) registrado = mensajeId
      // El modelo intentó registrar lo dudoso sin pasar por la validación: la
      // herramienta lo rechaza (RN5) y aquí se deja el registro pendiente, para
      // que el turno cierre pidiendo el «sí» en vez de terminar en silencio.
      else if (requiereConfirmacion(interpretada.error)) {
        pendienteDeEsteTurno = {
          herramienta: HERRAMIENTA_REGISTRAR,
          argumentos: { mensaje_id: mensajeId, confirmado: true },
          descripcion: `registrar el contrato de ${mensajeId} una vez confirmados los campos en revisión`,
        }
        emitir({
          tipo: "aviso",
          texto: `el registro de ${mensajeId} queda pendiente de confirmación del usuario (RN5)`,
        })
      }
    }
  }

  // El estado de la sesión se decide aquí, al final y no dentro del bucle: así el
  // orden en que el modelo pida las herramientas no cambia el resultado.
  //
  //   · un registro efectivo cierra el pendiente **solo si era ese mismo
  //     mensaje**: confirmar uno no confirma el siguiente;
  //   · una validación con campos por confirmar abre su pendiente (y gana, porque
  //     describe lo último que el usuario tiene delante);
  //   · si el turno no hizo ninguna de las dos cosas, el pendiente anterior sigue
  //     vigente: el usuario todavía no ha respondido.
  if (
    registrado !== null &&
    pendientePrevio !== null &&
    String(pendientePrevio.argumentos["mensaje_id"] ?? "") === registrado
  ) {
    sesion.pendiente = null
  }
  if (pendienteDeEsteTurno !== null) sesion.pendiente = pendienteDeEsteTurno

  return ejecutadas
}
