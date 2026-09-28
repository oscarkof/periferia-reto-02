/**
 * Comerciales: quién envió el contrato (HU-3 · PRD §7.1).
 *
 * `comerciales.json` es la lista de remitentes conocidos. Un remitente que no
 * está en la lista **no bloquea el registro**: se reporta y el campo queda para
 * que administración lo asigne (el PRD lo dice así de explícito, y `msg-006`
 * —enviado por un practicante— existe justo para probarlo).
 */
import { leerJson, esObjeto } from "./io.ts"
import type { Resultado } from "./tipos.ts"

/** Una fila de `fixtures/reto-02/comerciales.json`. */
export interface Comercial {
  email: string
  nombre: string
  region: string
}

/** Valida el contenido del archivo de comerciales. */
function comoComerciales(valor: unknown): Resultado<Comercial[]> {
  if (!Array.isArray(valor)) return { ok: false, error: "comerciales.json no es una lista" }
  const comerciales: Comercial[] = []
  for (const entrada of valor) {
    if (!esObjeto(entrada)) continue
    const email = entrada["email"]
    const nombre = entrada["nombre"]
    if (typeof email !== "string" || typeof nombre !== "string") continue
    comerciales.push({
      email: email.toLowerCase().trim(),
      nombre: nombre.trim(),
      region: typeof entrada["region"] === "string" ? entrada["region"] : "",
    })
  }
  if (comerciales.length === 0) return { ok: false, error: "comerciales.json no tiene filas válidas" }
  return { ok: true, data: comerciales }
}

/** Carga la lista de comerciales desde el fixture. */
export function cargarComerciales(ruta: string): Resultado<Comercial[]> {
  const crudo = leerJson<unknown>(ruta)
  if (!crudo.ok) return { ok: false, error: `no se pudo leer comerciales.json: ${crudo.error}` }
  return comoComerciales(crudo.data)
}

/**
 * Nombre del comercial que escribió desde `email`, o `null` si no está en la
 * lista (ese `null` es el que hace que el campo entre en revisión).
 */
export function resolverComercial(comerciales: readonly Comercial[], email: string): Comercial | null {
  const buscado = email.toLowerCase().trim()
  return comerciales.find((c) => c.email === buscado) ?? null
}
