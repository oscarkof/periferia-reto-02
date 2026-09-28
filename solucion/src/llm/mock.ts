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

/** Un paso del guion: o pide herramientas, o responde texto. */
export interface PasoMock {
  texto?: string
  llamadas?: { nombre: string; argumentos: Record<string, unknown> }[]
}

/** Adaptador de guion, con contadores para poder afirmar cosas en las pruebas. */
export interface AdaptadorMock extends AdaptadorLlm {
  /** Cuántas veces se llamó al adaptador. */
  readonly envios: number
  /** Historial recibido en cada envío, para inspeccionarlo desde las pruebas. */
  readonly historiales: Mensaje[][]
  /** Herramientas ofrecidas en el último envío. */
  readonly herramientasVistas: string[]
}

/** Crea un adaptador que sigue `guion` paso a paso. */
export function crearAdaptadorMock(guion: PasoMock[] = []): AdaptadorMock {
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

      const paso = guion[envios - 1]
      if (paso === undefined) {
        return {
          ok: true,
          data: {
            texto: "Guion de prueba agotado: no hay más pasos definidos.",
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
