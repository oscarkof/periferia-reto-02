/**
 * Sesión de conversación (PRD §6.1 y §8).
 *
 * Se mantiene en memoria mientras dura el proceso y se persiste en
 * `out/sessions/<id>.json`, para que el historial sobreviva a un reinicio y para
 * que `GET /api/sessions/:id` pueda devolverlo completo.
 */
import fs from "node:fs"
import path from "node:path"
import { resolverDentro } from "../core/rutas.ts"
import type { Resultado } from "../core/tipos.ts"
import type { Mensaje } from "../llm/adapter.ts"

/** Identificador de sesión admitido (lo propone el cliente). */
const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * Acción que espera confirmación explícita del usuario (CA3 · RN4).
 *
 * Queda pendiente por dos caminos, y en los dos el valor lo pone el ciclo:
 *   · el modelo intentó el envío sin autorización y la herramienta lo rechazó;
 *   · el paquete quedó armado y simular el envío es el paso natural.
 * El segundo caso es el que permite que `needsConfirmation` sea verdadero en el
 * flujo normal, sin depender de que el modelo pregunte en prosa.
 */
export interface AccionPendiente {
  /** Nombre de la herramienta que quedó esperando. */
  herramienta: string
  /** Argumentos ya resueltos, incluida la confirmación. */
  argumentos: Record<string, unknown>
  /** Explicación para el usuario. */
  descripcion: string
}

/** Estado completo de una conversación. */
export interface Sesion {
  id: string
  mensajes: Mensaje[]
  /** Acción gobernada esperando un "sí" del usuario; `null` si no hay ninguna. */
  pendiente: AccionPendiente | null
  /** Turnos completados. */
  turnos: number
  /** Tokens consumidos acumulados, para los topes de costo. */
  tokens: number
  creada: string
  actualizada: string
}

/** ¿El identificador de sesión es aceptable? */
export function idValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

/** Crea una sesión vacía. */
export function crearSesion(id: string, ahora: Date = new Date()): Sesion {
  const marca = ahora.toISOString()
  return { id, mensajes: [], pendiente: null, turnos: 0, tokens: 0, creada: marca, actualizada: marca }
}

/** Carpeta de sesiones: el `out/` de esta ejecución más `sessions`. */
export function dirSesiones(directorio: string): string {
  const outEnv = process.env["OUT_DIR"]
  const out = outEnv !== undefined && outEnv.trim() !== "" ? path.resolve(outEnv) : path.join(directorio, "out")
  return path.join(out, "sessions")
}

/** Persiste la sesión. Devuelve la ruta escrita. */
export function guardarSesion(directorio: string, sesion: Sesion, ahora: Date = new Date()): Resultado<string> {
  if (!idValido(sesion.id)) return { ok: false, error: `identificador de sesión inválido: "${sesion.id}"` }

  const destino = resolverDentro(dirSesiones(directorio), `${sesion.id}.json`)
  if (!destino.ok) return destino

  const conFecha: Sesion = { ...sesion, actualizada: ahora.toISOString() }
  try {
    fs.mkdirSync(path.dirname(destino.data), { recursive: true })
    fs.writeFileSync(destino.data, `${JSON.stringify(conFecha, null, 2)}\n`, "utf8")
    return { ok: true, data: destino.data }
  } catch {
    return { ok: false, error: `no se pudo guardar la sesión ${sesion.id} en out/sessions/` }
  }
}

/** Recupera una sesión del disco. */
export function cargarSesion(directorio: string, id: string): Resultado<Sesion> {
  if (!idValido(id)) return { ok: false, error: `identificador de sesión inválido: "${id}"` }

  const origen = resolverDentro(dirSesiones(directorio), `${id}.json`)
  if (!origen.ok) return origen

  let crudo: string
  try {
    crudo = fs.readFileSync(origen.data, "utf8")
  } catch {
    return { ok: false, error: `no existe la sesión "${id}"` }
  }

  try {
    const sesion = JSON.parse(crudo) as Sesion
    if (typeof sesion.id !== "string" || !Array.isArray(sesion.mensajes)) {
      return { ok: false, error: `la sesión "${id}" está corrupta` }
    }
    return { ok: true, data: sesion }
  } catch {
    return { ok: false, error: `la sesión "${id}" no es un JSON válido` }
  }
}

/** Identificadores de sesión guardados, ordenados. */
export function listarSesiones(directorio: string): Resultado<string[]> {
  try {
    const archivos = fs.readdirSync(dirSesiones(directorio))
    return {
      ok: true,
      data: archivos
        .filter((archivo) => archivo.endsWith(".json"))
        .map((archivo) => archivo.replace(/\.json$/, ""))
        .sort(),
    }
  } catch {
    return { ok: true, data: [] }
  }
}
