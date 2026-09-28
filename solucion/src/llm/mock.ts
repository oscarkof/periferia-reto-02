/**
 * Adaptador de pruebas: responde con un guion fijo, sin red y sin modelo.
 *
 * Sirve para tres cosas:
 *   · probar el ciclo del agente de forma determinista (tope de iteraciones,
 *     confirmación humana, errores) sin depender de un proveedor;
 *   · permitir que la aplicación arranque y se pueda recorrer de punta a punta
 *     sin ninguna clave (`LLM_PROVIDER=mock` ni siquiera necesita Ollama);
 *   · dar a las pruebas del front un turno real que mostrar, con llamadas a
 *     herramienta y una confirmación pendiente.
 *
 * No es un agente: repite un guion. Está documentado así en el README.
 */
import type {
  AdaptadorLlm,
  DefinicionHerramienta,
  Mensaje,
  OpcionesEnvio,
  RespuestaLlm,
} from "./adapter.ts"
import type { Resultado } from "../core/tipos.ts"

/**
 * Un paso del guion: o pide herramientas, o responde texto.
 *
 * Un guion puede ser una **lista** (avanza por contador de llamadas) o una
 * **función** que mira el historial y decide (ver `guionReactivo`).
 */
export interface PasoMock {
  texto?: string
  llamadas?: { nombre: string; argumentos: Record<string, unknown> }[]
}

/** Guion del adaptador: lista secuencial o función que lee la conversación. */
export type GuionMock = PasoMock[] | ((historial: Mensaje[]) => PasoMock)

/** Adaptador de guion, con contadores para poder afirmar cosas en las pruebas. */
export interface AdaptadorMock extends AdaptadorLlm {
  /** Cuántas veces se llamó al adaptador. */
  readonly envios: number
  /** Historial recibido en cada envío, para inspeccionarlo desde las pruebas. */
  readonly historiales: Mensaje[][]
  /** Herramientas ofrecidas en el último envío. */
  readonly herramientasVistas: string[]
}

/** Crea un adaptador que sigue `guion` (secuencia o función que lee el historial). */
export function crearAdaptadorMock(guion: GuionMock = []): AdaptadorMock {
  let envios = 0
  const historiales: Mensaje[][] = []
  let herramientasVistas: string[] = []

  return {
    proveedor: "mock",
    modelo: "guion",

    get envios() {
      return envios
    },
    get historiales() {
      return historiales
    },
    get herramientasVistas() {
      return herramientasVistas
    },

    async enviar(
      mensajes: Mensaje[],
      herramientas: DefinicionHerramienta[],
      _opciones?: OpcionesEnvio,
    ): Promise<Resultado<RespuestaLlm>> {
      envios += 1
      historiales.push(mensajes.map((mensaje) => ({ ...mensaje })))
      herramientasVistas = herramientas.map((herramienta) => herramienta.nombre)

      const paso = Array.isArray(guion) ? guion[envios - 1] : guion(mensajes)
      if (paso === undefined) {
        return {
          ok: true,
          data: {
            texto:
              "Guion de prueba agotado: no hay más pasos definidos. Reinicia el servidor, usa el guion " +
              "reactivo o cambia a un proveedor con modelo (`LLM_PROVIDER=ollama`).",
            llamadas: [],
            uso: { entrada: 0, salida: 0 },
          },
        }
      }

      return {
        ok: true,
        data: {
          texto: paso.texto ?? null,
          llamadas: (paso.llamadas ?? []).map((llamada, indice) => ({
            id: `llamada-${indice + 1}`,
            nombre: llamada.nombre,
            argumentos: llamada.argumentos,
          })),
          uso: { entrada: 10, salida: 5 },
        },
      }
    },
  }
}

/* ── Guion reactivo: el que usa la aplicación servida ─────────────────────── */

/**
 * ¿El usuario está confirmando?
 *
 * Es la única regla del dominio que el mock necesita, y se queda aquí a
 * propósito: `llm/` no depende de `agent/` (el ciclo importa los adaptadores,
 * nunca al revés). La detección de verdad —la que decide si se escribe— sigue en
 * `agent/confirmacion.ts`, y este chequeo solo sirve para elegir el siguiente
 * paso del guion.
 */
function pareceConfirmacion(texto: string): boolean {
  // Se compara la **primera palabra** tras quitar la puntuación, en vez de usar
  // `\b` con una regex: en JavaScript `\b` es ASCII, así que «sí» no encuentra su
  // límite después de la «í» y la confirmación se colaba como falsa.
  const primera =
    texto
      .trim()
      .toLowerCase()
      .replace(/[.,;:!¡?¿"'()[\]]/g, " ")
      .trim()
      .split(/\s+/)[0] ?? ""
  return ["si", "sí", "ok", "okay", "dale", "confirmo", "confirmado", "adelante", "registra", "procede", "hazlo"].includes(
    primera,
  )
}

/** Datos de una respuesta de herramienta, sin lanzar si no es JSON válido. */
function datosDe(contenido: string): Record<string, unknown> | null {
  try {
    const cuerpo = JSON.parse(contenido) as { ok?: boolean; data?: unknown }
    return cuerpo.ok === true && typeof cuerpo.data === "object" && cuerpo.data !== null
      ? (cuerpo.data as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Una llamada ya hecha, con el resultado que devolvió (si lo hay). */
interface LlamadaHecha {
  nombre: string
  mensajeId: string
  datos: Record<string, unknown> | null
}

/** La última llamada que cumple el predicado, sin depender de `findLast`. */
function ultima(lista: LlamadaHecha[], predicado: (hecha: LlamadaHecha) => boolean): LlamadaHecha | undefined {
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    const candidata = lista[i]
    if (candidata !== undefined && predicado(candidata)) return candidata
  }
  return undefined
}

/** Empareja cada llamada del historial con el resultado que le siguió. */
function historialDeLlamadas(historial: Mensaje[]): LlamadaHecha[] {
  const pendientes: { nombre: string; mensajeId: string }[] = []
  const hechas: LlamadaHecha[] = []

  for (const mensaje of historial) {
    if (mensaje.rol === "assistant" && mensaje.llamadas !== undefined) {
      for (const llamada of mensaje.llamadas) {
        pendientes.push({
          nombre: llamada.nombre,
          mensajeId: String(llamada.argumentos["mensaje_id"] ?? ""),
        })
      }
      continue
    }
    if (mensaje.rol === "tool") {
      const llamada = pendientes.shift()
      if (llamada !== undefined) hechas.push({ ...llamada, datos: datosDe(mensaje.contenido) })
    }
  }
  return hechas
}

/**
 * Guion que reproduce el prompt de ejemplo del PRD §11 sin ningún modelo.
 *
 * Turno 1 — «Procesa el buzón de este mes: registra lo que esté limpio y
 * muéstrame lo que requiere revisión»: leer el buzón, extraer y validar el primer
 * mensaje limpio (`msg-001`), registrarlo, validar el que exige revisión
 * (`msg-006`) y cerrar pidiendo la confirmación. Turno 2 — el usuario responde
 * «sí»: registrar `msg-006` ya confirmado y resumir.
 *
 * Los ids son los del fixture real (`fixtures/buzon/msg-00X`) y cada paso se
 * consume en una llamada al adaptador, en el orden en que los pide el ciclo: por
 * eso el guion cubre los dos turnos seguidos. Los nombres van como literales a
 * propósito, para que `llm/` no dependa de `tools/`; `test/bucle.test.ts`
 * comprueba que coinciden con el registro de herramientas.
 *
 * Es **secuencial**: cada llamada al adaptador consume el paso siguiente. Para la
 * aplicación servida se usa `guionReactivo`, que no lleva cuenta.
 */
export function guionDemo(): PasoMock[] {
  return [
    { llamadas: [{ nombre: "contratos_leer_buzon", argumentos: {} }] },
    { llamadas: [{ nombre: "contratos_extraer", argumentos: { mensaje_id: "msg-001" } }] },
    { llamadas: [{ nombre: "contratos_validar", argumentos: { mensaje_id: "msg-001" } }] },
    {
      llamadas: [
        { nombre: "contratos_registrar", argumentos: { mensaje_id: "msg-001", confirmado: false } },
      ],
    },
    { llamadas: [{ nombre: "contratos_validar", argumentos: { mensaje_id: "msg-006" } }] },
    {
      texto:
        "Registré el contrato limpio de msg-001. msg-006 queda en revisión: hay que confirmar el valor " +
        "y la fecha de fin antes de escribirlo en el maestro. ¿Confirmas los dos campos?",
    },
    {
      llamadas: [
        { nombre: "contratos_registrar", argumentos: { mensaje_id: "msg-006", confirmado: true } },
      ],
    },
    {
      texto:
        "Listo: msg-006 quedó registrado con los valores que confirmaste y el mensaje salió del buzón. " +
        "Si quieres, genero las alertas de vencimientos con `contratos_alertas`.",
    },
  ]
}

/**
 * Guion **reactivo**: lee la conversación y decide el siguiente paso.
 *
 * Es el que usa la aplicación servida, y existe por un fallo real: el guion
 * secuencial lleva un contador de llamadas al adaptador, así que cualquier clic de
 * más —recargar la página, repetir un turno, dos sesiones a la vez, una prueba por
 * API en el mismo proceso— lo desalinea y el mock acaba respondiendo «guion
 * agotado» justo cuando el usuario pulsa «Sí, confirmo». Eso pasó en la primera
 * demo: la confirmación llegaba y el mock, con el guion gastado, no llamaba a
 * ninguna herramienta.
 *
 * Este no lleva cuenta: mira el historial y hace lo que toca.
 *   1. si el usuario acaba de confirmar y hay un mensaje en revisión → registrarlo;
 *   2. si aún no se ha leído el buzón → `leer_buzon` (una vez por conversación);
 *   3. si solo preguntan qué hay → contestar con lo listado, sin tocar el maestro;
 *   4. el mensaje limpio, paso a paso: `extraer` → `validar` → `registrar`;
 *   5. el que exige revisión: `validar` y dejar el «sí» pendiente;
 *   6. cerrar contando qué se registró y qué falta confirmar.
 *
 * Sigue siendo un guion, no un agente: las decisiones son fijas y pensadas para
 * los fixtures del reto (docs `msg-001` limpio y `msg-006` en revisión).
 */
export function guionReactivo(): (historial: Mensaje[]) => PasoMock {
  return (historial) => {
    const hechas = historialDeLlamadas(historial)
    const hizo = (nombre: string, mensajeId?: string): boolean =>
      hechas.some((hecha) => hecha.nombre === nombre && (mensajeId === undefined || hecha.mensajeId === mensajeId))
    const registrado = (mensajeId: string): boolean =>
      hechas.some((hecha) => hecha.nombre === "contratos_registrar" && hecha.mensajeId === mensajeId && hecha.datos !== null)
    const ultimoUsuario =
      [...historial].reverse().find((mensaje) => mensaje.rol === "user")?.contenido.trim() ?? ""

    // 1 · El usuario confirmó: lo que quedó en revisión se registra (RN5).
    const enRevision = ultima(
      hechas,
      (hecha) =>
        hecha.nombre === "contratos_validar" &&
        Array.isArray(hecha.datos?.["requiere_revision"]) &&
        (hecha.datos["requiere_revision"] as unknown[]).length > 0 &&
        !registrado(hecha.mensajeId),
    )
    if (pareceConfirmacion(ultimoUsuario) && enRevision !== undefined) {
      return {
        llamadas: [
          { nombre: "contratos_registrar", argumentos: { mensaje_id: enRevision.mensajeId, confirmado: true } },
        ],
      }
    }

    // 2 · Primero, ver qué hay en el buzón.
    if (!hizo("contratos_leer_buzon")) return { llamadas: [{ nombre: "contratos_leer_buzon", argumentos: {} }] }

    // 3 · Si solo preguntan qué hay, se contesta con lo listado y no se escribe nada.
    const empezado = ["contratos_extraer", "contratos_validar", "contratos_registrar"].some((nombre) =>
      hizo(nombre),
    )
    if (!empezado && /[?¿]/.test(ultimoUsuario)) {
      const listado = hechas.find((hecha) => hecha.nombre === "contratos_leer_buzon")?.datos
      const mensajes = Array.isArray(listado?.["mensajes"])
        ? (listado["mensajes"] as { id: string; tiene_contrato: boolean }[])
        : []
      const conContrato = mensajes.filter((mensaje) => mensaje.tiene_contrato === true)
      return {
        texto:
          `El buzón tiene ${mensajes.length} mensajes sin procesar y ${conContrato.length} traen contrato ` +
          `(${conContrato.map((mensaje) => mensaje.id).join(", ")}). ` +
          "Dime «procesa el buzón» y registro lo que esté limpio.",
      }
    }

    // 4 · El mensaje limpio, paso a paso.
    if (!hizo("contratos_extraer", "msg-001")) {
      return { llamadas: [{ nombre: "contratos_extraer", argumentos: { mensaje_id: "msg-001" } }] }
    }
    if (!hizo("contratos_validar", "msg-001")) {
      return { llamadas: [{ nombre: "contratos_validar", argumentos: { mensaje_id: "msg-001" } }] }
    }
    if (!registrado("msg-001")) {
      return {
        llamadas: [{ nombre: "contratos_registrar", argumentos: { mensaje_id: "msg-001", confirmado: false } }],
      }
    }

    // 5 · El que exige revisión: se valida y se deja esperando un «sí».
    if (!hizo("contratos_validar", "msg-006")) {
      return { llamadas: [{ nombre: "contratos_validar", argumentos: { mensaje_id: "msg-006" } }] }
    }

    // 6 · Cierre: pedir la confirmación o contar que ya está hecho.
    const revisado = ultima(
      hechas,
      (hecha) => hecha.nombre === "contratos_validar" && hecha.mensajeId === "msg-006",
    )
    const campos = Array.isArray(revisado?.datos?.["requiere_revision"])
      ? (revisado?.datos?.["requiere_revision"] as string[])
      : []
    if (campos.length > 0 && !registrado("msg-006")) {
      return {
        texto:
          `Registré el contrato limpio de msg-001. msg-006 queda en revisión: hay que confirmar ` +
          `${campos.join(" y ")} antes de escribirlo en el maestro. ¿Confirmas?`,
      }
    }
    return {
      texto:
        "Listo: msg-006 quedó registrado con los valores que confirmaste y el mensaje salió del buzón. " +
        "Si quieres, genero las alertas de vencimientos con `contratos_alertas`.",
    }
  }
}
