/**
 * Historial de cambios y control de lo ya procesado (HU-4 · O2).
 *
 * Dos archivos con dos responsabilidades distintas, y conviene no confundirlas:
 *
 *   · `out/sharepoint/historial.jsonl` — **qué cambió** en el maestro: es la
 *     memoria del proceso y lo que permite auditar una actualización de un otrosí.
 *   · `out/procesados.json` — **qué mensajes ya se resolvieron**. Es lo que hace
 *     el proceso idempotente: `contratos_leer_buzon` los excluye, así que correr
 *     la demo dos veces no duplica nada.
 *
 * Las escrituras reutilizan el escritor atómico que protege el maestro: un fallo
 * a mitad no deja un JSON cortado ni un historial sin cerrar.
 */
import fs from "node:fs"
import { escribirAtomico } from "./csv.ts"
import { leerJson } from "./io.ts"
import type { EntradaHistorial, Resultado } from "./tipos.ts"

// ── Mensajes procesados ────────────────────────────────────────────────────

/** Lista de `mensaje_id` ya resueltos (vacía si el archivo no existe todavía). */
export function leerProcesados(ruta: string): Resultado<string[]> {
  if (!fs.existsSync(ruta)) return { ok: true, data: [] }
  const crudo = leerJson<unknown>(ruta)
  if (!crudo.ok) return { ok: false, error: `no se pudo leer procesados.json: ${crudo.error}` }
  if (!Array.isArray(crudo.data)) return { ok: false, error: "procesados.json no es una lista" }
  return { ok: true, data: crudo.data.filter((v): v is string => typeof v === "string") }
}

/** ¿Ese mensaje ya se resolvió en una ejecución anterior? */
export function estaProcesado(procesados: readonly string[], mensajeId: string): boolean {
  return procesados.includes(mensajeId)
}

/** Marca un mensaje como resuelto y devuelve la lista actualizada. */
export function marcarProcesado(ruta: string, mensajeId: string): Resultado<string[]> {
  const actuales = leerProcesados(ruta)
  if (!actuales.ok) return actuales
  const lista = estaProcesado(actuales.data, mensajeId) ? actuales.data : [...actuales.data, mensajeId]
  const escrito = escribirAtomico(ruta, `${JSON.stringify(lista, null, 2)}\n`)
  if (!escrito.ok) return escrito
  return { ok: true, data: lista }
}

// ── Historial de cambios ───────────────────────────────────────────────────

/** Añade una línea al historial (una entrada por cambio real en el maestro). */
export function anexarCambio(ruta: string, entrada: EntradaHistorial): Resultado<string> {
  try {
    fs.mkdirSync(ruta.slice(0, ruta.lastIndexOf("/")) || ".", { recursive: true })
  } catch {
    return { ok: false, error: "no se pudo preparar la carpeta del historial" }
  }
  try {
    fs.appendFileSync(ruta, `${JSON.stringify(entrada)}\n`, "utf8")
    return { ok: true, data: ruta }
  } catch {
    return { ok: false, error: "no se pudo escribir en historial.jsonl" }
  }
}

/** Lee el historial completo (líneas JSON), ignorando líneas vacías. */
export function leerHistorial(ruta: string): Resultado<EntradaHistorial[]> {
  if (!fs.existsSync(ruta)) return { ok: true, data: [] }
  let texto: string
  try {
    texto = fs.readFileSync(ruta, "utf8")
  } catch {
    return { ok: false, error: "no se pudo leer historial.jsonl" }
  }
  const entradas: EntradaHistorial[] = []
  for (const linea of texto.split("\n")) {
    if (linea.trim() === "") continue
    try {
      entradas.push(JSON.parse(linea) as EntradaHistorial)
    } catch {
      return { ok: false, error: "historial.jsonl tiene una línea que no es JSON válido" }
    }
  }
  return { ok: true, data: entradas }
}

/** ¿Ese contrato tiene una entrada de actualización desde la fecha del corte? */
export function actualizadosDesde(
  historial: readonly EntradaHistorial[],
  corte: string,
  idContrato: string | null = null,
): EntradaHistorial[] {
  return historial.filter(
    (e) => e.ts.slice(0, 10) >= corte && (idContrato === null || e.id_contrato === idContrato),
  )
}
