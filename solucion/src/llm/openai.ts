/**
 * Adaptador para cualquier API **compatible con OpenAI** (`/chat/completions`).
 *
 * Existe para demostrar la afirmación del PRD §6.1: cambiar de proveedor no toca
 * el ciclo del agente. Este adaptador habla un formato de cable distinto al de
 * Ollama:
 *   · los argumentos viajan como **string JSON** (Ollama los manda como objeto);
 *   · los mensajes de resultado exigen `tool_call_id`;
 *   · el consumo viene en `usage.prompt_tokens` / `usage.completion_tokens`.
 *
 * La clave se lee de `OPENAI_API_KEY` y **nunca** se registra ni se devuelve.
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

const BASE_DEFECTO = "https://api.openai.com/v1"
const MODELO_DEFECTO = "gpt-4o-mini"
/** El modelo puede tardar; `LLM_TIMEOUT_MS` lo ajusta sin tocar código. */
const TIMEOUT_DEFECTO_MS = 120_000

interface RespuestaOpenAi {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export interface OpcionesOpenAi {
  apiKey?: string
  base?: string
  modelo?: string
  timeoutMs?: number
}

/** Traduce un mensaje interno al formato de OpenAI. */
function aMensajeOpenAi(mensaje: Mensaje): Record<string, unknown> {
  if (mensaje.rol === "assistant" && mensaje.llamadas !== undefined && mensaje.llamadas.length > 0) {
    return {
      role: "assistant",
      content: mensaje.contenido === "" ? null : mensaje.contenido,
      tool_calls: mensaje.llamadas.map((llamada) => ({
        id: llamada.id,
        type: "function",
        function: { name: llamada.nombre, arguments: JSON.stringify(llamada.argumentos) },
      })),
    }
  }
  if (mensaje.rol === "tool") {
    // Aquí sí hace falta el identificador: OpenAI empareja por id, no por orden.
    return { role: "tool", content: mensaje.contenido, tool_call_id: mensaje.idLlamada ?? "" }
  }
  return { role: mensaje.rol, content: mensaje.contenido }
}

/** Traduce una herramienta interna al formato de OpenAI. */
function aHerramientaOpenAi(herramienta: DefinicionHerramienta): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: herramienta.nombre,
      description: herramienta.description,
      parameters: herramienta.parametros,
    },
  }
}

/** Crea el adaptador compatible con OpenAI, o un error si falta la clave. */
export function crearAdaptadorOpenAi(opciones: OpcionesOpenAi = {}): Resultado<AdaptadorLlm> {
  const apiKey = opciones.apiKey ?? process.env["OPENAI_API_KEY"] ?? ""
  if (apiKey.trim() === "") {
    return {
      ok: false,
      error: "falta OPENAI_API_KEY: configúrala en el entorno del backend (nunca en el repositorio)",
    }
  }

  const base = (opciones.base ?? process.env["OPENAI_BASE_URL"] ?? BASE_DEFECTO).replace(/\/+$/, "")
  const modelo = opciones.modelo ?? process.env["OPENAI_MODEL"] ?? MODELO_DEFECTO
  const timeoutDefecto =
    opciones.timeoutMs ?? Number(process.env["LLM_TIMEOUT_MS"] ?? TIMEOUT_DEFECTO_MS)

  const adaptador: AdaptadorLlm = {
    proveedor: "openai",
    modelo,

    async enviar(
      mensajes: Mensaje[],
      herramientas: DefinicionHerramienta[],
      opcionesEnvio: OpcionesEnvio = {},
    ): Promise<Resultado<RespuestaLlm>> {
      const { signal, cancelar } = senalConTiempo(opcionesEnvio.timeoutMs ?? timeoutDefecto)
      try {
        const respuesta = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          signal,
          body: JSON.stringify({
            model: modelo,
            messages: mensajes.map(aMensajeOpenAi),
            ...(herramientas.length > 0 ? { tools: herramientas.map(aHerramientaOpenAi) } : {}),
            temperature: opcionesEnvio.temperatura ?? 0,
          }),
        })

        if (!respuesta.ok) {
          // El cuerpo del error puede contener detalles del proveedor, nunca la clave.
          const detalle = await respuesta.text()
          return {
            ok: false,
            error: `el proveedor openai respondió ${respuesta.status}: ${detalle.slice(0, 200)}`,
          }
        }

        const cuerpo = (await respuesta.json()) as RespuestaOpenAi
        const mensaje = cuerpo.choices?.[0]?.message
        const llamadas = (mensaje?.tool_calls ?? [])
          .map((llamada, indice) => ({
            id: llamada.id ?? `llamada-${indice + 1}`,
            nombre: llamada.function?.name ?? "",
            argumentos: normalizarArgumentos(llamada.function?.arguments),
          }))
          .filter((llamada) => llamada.nombre !== "")

        const texto = (mensaje?.content ?? "").trim()
        return {
          ok: true,
          data: {
            texto: texto === "" ? null : texto,
            llamadas,
            uso: {
              entrada: cuerpo.usage?.prompt_tokens ?? 0,
              salida: cuerpo.usage?.completion_tokens ?? 0,
            },
          },
        }
      } catch (error) {
        return { ok: false, error: errorDeTransporte("openai", error) }
      } finally {
        cancelar()
      }
    },
  }

  return { ok: true, data: adaptador }
}
