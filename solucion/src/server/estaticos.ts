/**
 * Servicio de archivos generados (PRD §6.4).
 *
 * Permite descargar lo que el agente produce: el formulario, el paquete y el
 * checklist. Todo el acceso está **confinado a `out/`**: ni el caso ni el resto
 * de la ruta pueden escapar del directorio de salida, aunque vengan de la URL.
 */
import fs from "node:fs"
import path from "node:path"
import { resolverDentro } from "../core/rutas.ts"
import type { Resultado } from "../core/tipos.ts"

/** Tipos que el agente produce, con su content-type. */
const TIPOS: Record<string, string> = {
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

/** Content-type por extensión, con un valor neutro por defecto. */
export function tipoDeContenido(ruta: string): string {
  return TIPOS[path.extname(ruta).toLowerCase()] ?? "application/octet-stream"
}

/** Contenido de un archivo de `out/`, ya confinado. */
export interface ArchivoServido {
  contenido: Buffer
  tipo: string
  nombre: string
}

/**
 * Lee un archivo de `out/` a partir de sus segmentos de ruta.
 * Rechaza cualquier intento de salir del directorio de salida.
 */
export function leerDeOut(directorio: string, partes: string[]): Resultado<ArchivoServido> {
  if (partes.length === 0) return { ok: false, error: "no se indicó ningún archivo" }

  const base = path.join(directorio, "out")
  const ruta = resolverDentro(base, ...partes)
  if (!ruta.ok) return { ok: false, error: "ruta no permitida: solo se sirven archivos de out/" }

  try {
    const estadistica = fs.statSync(ruta.data)
    if (!estadistica.isFile()) return { ok: false, error: "la ruta no es un archivo" }
    if (estadistica.size > 25 * 1024 * 1024) return { ok: false, error: "el archivo supera el tamaño permitido" }

    return {
      ok: true,
      data: {
        contenido: fs.readFileSync(ruta.data),
        tipo: tipoDeContenido(ruta.data),
        nombre: path.basename(ruta.data),
      },
    }
  } catch {
    return { ok: false, error: `no existe el archivo ${partes.join("/")} en out/` }
  }
}
