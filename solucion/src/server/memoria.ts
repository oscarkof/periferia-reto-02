/**
 * Sesiones vivas del proceso.
 *
 * El PRD (§6.1) permite "memoria o archivo": aquí se usan las dos. La memoria
 * evita releer el disco en cada turno y el archivo (`out/sessions/<id>.json`)
 * conserva el historial entre reinicios.
 */
import { cargarSesion, crearSesion, type Sesion } from "../agent/sesion.ts"

/** Almacén en memoria, compartido entre peticiones. */
export type MemoriaSesiones = Map<string, Sesion>

/** Crea el almacén de sesiones. */
export function crearMemoria(): MemoriaSesiones {
  return new Map<string, Sesion>()
}

/** Recupera la sesión: memoria → disco → nueva. */
export function obtenerSesion(directorio: string, id: string, memoria: MemoriaSesiones): Sesion {
  const enMemoria = memoria.get(id)
  if (enMemoria !== undefined) return enMemoria

  const enDisco = cargarSesion(directorio, id)
  const sesion = enDisco.ok ? enDisco.data : crearSesion(id)
  memoria.set(id, sesion)
  return sesion
}
