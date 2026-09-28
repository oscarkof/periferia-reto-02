/**
 * Construcción del adaptador de lenguaje según `LLM_PROVIDER` (PRD §6.1).
 *
 * La clave del modelo se lee aquí, de una variable de entorno del backend, y
 * **nunca** se registra ni se devuelve por la API (PRD §6.1 y §8).
 */
import type { AdaptadorLlm } from "./adapter.ts"
import { crearAdaptadorMock, guionDemo } from "./mock.ts"
import { crearAdaptadorOllama } from "./ollama.ts"
import { crearAdaptadorOpenAi } from "./openai.ts"
import type { Resultado } from "../core/tipos.ts"

/** Proveedores soportados por el adaptador. */
export type ProveedorLlm = "ollama" | "openai" | "mock"

/** Lista de proveedores válidos, en el orden que se documenta. */
export const PROVEEDORES: readonly ProveedorLlm[] = ["ollama", "openai", "mock"]

/** Proveedor por defecto: local, sin claves y ya validado en el smoke test. */
export const PROVEEDOR_DEFECTO: ProveedorLlm = "ollama"

/** ¿El texto es un proveedor válido? */
export function esProveedor(valor: string): valor is ProveedorLlm {
  return (PROVEEDORES as readonly string[]).includes(valor)
}

export interface OpcionesFabrica {
  /** Fuerza el proveedor en vez de leer `LLM_PROVIDER`. */
  proveedor?: string
  /** Guion que usará el proveedor `mock` en vez del de la demo. */
  guionMock?: Parameters<typeof crearAdaptadorMock>[0]
}

/**
 * Crea el adaptador configurado. Devuelve error legible si el proveedor no se
 * reconoce o si falta la clave que ese proveedor necesita.
 */
export function crearAdaptador(opciones: OpcionesFabrica = {}): Resultado<AdaptadorLlm> {
  const solicitado = (opciones.proveedor ?? process.env["LLM_PROVIDER"] ?? PROVEEDOR_DEFECTO)
    .trim()
    .toLowerCase()

  if (!esProveedor(solicitado)) {
    return {
      ok: false,
      error: `LLM_PROVIDER desconocido: "${solicitado}". Usa uno de: ${PROVEEDORES.join(", ")}`,
    }
  }

  if (solicitado === "openai") return crearAdaptadorOpenAi()
  if (solicitado === "mock") {
    return { ok: true, data: crearAdaptadorMock(opciones.guionMock ?? guionDemo()) }
  }
  return { ok: true, data: crearAdaptadorOllama() }
}

/** Descripción pública del proveedor para `/api/health`: sin claves ni rutas. */
export function describirProveedor(adaptador: AdaptadorLlm): { proveedor: string; modelo: string } {
  return { proveedor: adaptador.proveedor, modelo: adaptador.modelo }
}