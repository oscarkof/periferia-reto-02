/**
 * Adaptador para **Ollama local** (PRD §6.1).
 *
 * Detalle que condiciona el código, verificado en el smoke test de F0:
 * Ollama devuelve `message.tool_calls[].function.arguments` como **objeto ya
 * parseado**, mientras que otras APIs lo devuelven como string JSON. Aquí se
 * normalizan las dos formas antes de salir del adaptador.
 *
 * El adaptador nunca lanza: devuelve `Resultado` con un mensaje claro, para que
 * el ciclo del agente pueda contarlo en el chat sin morir (CA5).
 */
import {
  errorDeTransporte,
  normalizarArgumentos,
  senalConTiempo,
  type AdaptadorLlm,
  type DefinicionHerramienta,
  type Mensaje,
  type OpcionesEnvio,
  type RespuestaLlm,
} from "./adapter.ts"
import type { Resultado } from "../core/tipos.ts"

/** URL por defecto del servidor local de Ollama. */
export const URL_OLLAMA = "http://localhost:11434"

/**
 * Modelo por defecto.
 *
 * `granite4.1:8b` (5.3 GB) es el medido en las dos pruebas de extremo a extremo
 * del ciclo: paquete listo para firma y paquete bloqueado. IBM lo publica con
 * español declarado, tool calling y salida JSON; ver `docs/modelo-llm.md`.
 *
 * El más liviano que funciona es `qwen3:4b-instruct` (2.5 GB), pero **no** pasa
 * el turno de confirmación: se niega a simular el envío aunque el usuario lo
 * haya confirmado. Con 16 GB de RAM o más, usa el 8B.
 */
export const MODELO_OLLAMA = "granite4.1:8b"

/**
 * Ventana de contexto que se pide a Ollama.
 *
 * Medido en la prueba de extremo a extremo: el prompt del sistema
 * (`agent/prompt.md` + el conocimiento del proceso) más los esquemas JSON de las
 * cinco herramientas ronda **4 179 tokens**, y el valor por defecto de Ollama es
 * **4 096**, así que la petición falla con
 * `request exceeds the available context size`. Se pide una ventana mayor;
 * `OLLAMA_NUM_CTX` permite ajustarla sin tocar código.
 */
export const NUM_CTX_OLLAMA = 8192

/**
 * Niveles de razonamiento que acepta Ollama en el campo `think`.
 *
 * Ollama expone `think` (booleano o nivel) para los modelos que razonan antes de
 * responder. Se envía **solo si se pide** (`OLLAMA_THINK` u `opciones.think`):
 * los modelos que no razonan rechazan el campo, así que por defecto no viaja. Un
 * valor no reconocido se ignora en lugar de romper el arranque —coherente con
 * que este adaptador nunca lanza.
 */
export const NIVELES_THINK = ["low", "medium", "high", "max"] as const

/** Traduce `OLLAMA_THINK` a lo que espera la API, o `undefined` para no enviarlo. */
export function leerThink(valor: string | undefined): boolean | string | undefined {
  if (valor === undefined) return undefined
  const texto = valor.trim().toLowerCase()
  if (texto === "") return undefined
  if (["true", "1", "sí", "si"].includes(texto)) return true
  if (["false", "0", "no"].includes(texto)) return false
  return (NIVELES_THINK as readonly string[]).includes(texto) ? texto : undefined
}

/**
 * Ollama puede tardar en cargar el modelo la primera vez.
 * `LLM_TIMEOUT_MS` lo ajusta sin tocar código.
 */
const TIMEOUT_DEFECTO_MS = 180_000

/** Respuesta cruda de `/api/chat`. */
interface RespuestaOllama {
  message?: {
    content?: string
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[]
  }
  prompt_eval_count?: number
  eval_count?: number
}

export interface OpcionesOllama {
  base?: string
  modelo?: string
  timeoutMs?: number
  /** Ventana de contexto; por defecto se usa `NUM_CTX_OLLAMA`. */
  numCtx?: number
  /** Razonamiento previo (`think`); por defecto se lee `OLLAMA_THINK`. */
  think?: boolean | string
}

/** Traduce un mensaje interno al formato de cable de Ollama. */
function aMensajeOllama(mensaje: Mensaje): Record<string, unknown> {
  if (mensaje.rol === "assistant" && mensaje.llamadas !== undefined && mensaje.llamadas.length > 0) {
    return {
      role: "assistant",
      content: mensaje.contenido,
      tool_calls: mensaje.llamadas.map((llamada) => ({
        function: { name: llamada.nombre, arguments: llamada.argumentos },
      })),
    }
  }
  // Ollama empareja el resultado por orden, no por identificador.
  return { role: mensaje.rol, content: mensaje.contenido }
}

/** Traduce una herramienta interna al formato de Ollama. */
function aHerramientaOllama(herramienta: DefinicionHerramienta): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: herramienta.nombre,
      description: herramienta.description,
      parameters: herramienta.parametros,
    },
  }
}

/** Crea el adaptador de Ollama. */
export function crearAdaptadorOllama(opciones: OpcionesOllama = {}): AdaptadorLlm {
  const base = (opciones.base ?? process.env["OLLAMA_HOST"] ?? URL_OLLAMA).replace(/\/+$/, "")
  const modelo = opciones.modelo ?? process.env["OLLAMA_MODEL"] ?? MODELO_OLLAMA
  const timeoutDefecto =
    opciones.timeoutMs ?? Number(process.env["LLM_TIMEOUT_MS"] ?? TIMEOUT_DEFECTO_MS)
  const numCtx = opciones.numCtx ?? Number(process.env["OLLAMA_NUM_CTX"] ?? NUM_CTX_OLLAMA)
  const think = opciones.think ?? leerThink(process.env["OLLAMA_THINK"])

  return {
    proveedor: "ollama",
    modelo,

    async enviar(
      mensajes: Mensaje[],
      herramientas: DefinicionHerramienta[],
      opciones: OpcionesEnvio = {},
    ): Promise<Resultado<RespuestaLlm>> {
      const { signal, cancelar } = senalConTiempo(opciones.timeoutMs ?? timeoutDefecto)
      try {
        const respuesta = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            model: modelo,
            stream: false,
            messages: mensajes.map(aMensajeOllama),
            ...(herramientas.length > 0 ? { tools: herramientas.map(aHerramientaOllama) } : {}),
            ...(think === undefined ? {} : { think }),
            options: { temperature: opciones.temperatura ?? 0, num_ctx: numCtx },
          }),
        })

        if (!respuesta.ok) {
          const detalle = await respuesta.text()
          return {
            ok: false,
            error: `el proveedor ollama respondió ${respuesta.status}: ${detalle.slice(0, 200)}`,
          }
        }

        const cuerpo = (await respuesta.json()) as RespuestaOllama
        const llamadas = (cuerpo.message?.tool_calls ?? [])
          .map((llamada, indice) => ({
            id: `llamada-${indice + 1}`,
            nombre: llamada.function?.name ?? "",
            argumentos: normalizarArgumentos(llamada.function?.arguments),
          }))
          .filter((llamada) => llamada.nombre !== "")

        const texto = cuerpo.message?.content?.trim() ?? ""
        return {
          ok: true,
          data: {
            texto: texto === "" ? null : texto,
            llamadas,
            uso: { entrada: cuerpo.prompt_eval_count ?? 0, salida: cuerpo.eval_count ?? 0 },
          },
        }
      } catch (error) {
        return { ok: false, error: errorDeTransporte("ollama", error) }
      } finally {
        cancelar()
      }
    },
  }
}
