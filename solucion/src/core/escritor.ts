/**
 * Escritor confinado dentro del directorio de salida (PRD §6.2 · §6.5).
 *
 * El contrato de las herramientas pasa `ctx.directory` (la raíz del proyecto) en
 * cada llamada, y el PRD pide que **las rutas se resuelvan desde ahí y nunca en
 * absoluto**. Por eso el escritor se construye con esa raíz: las herramientas
 * hacen `crearEscritor(path.join(ctx.directory, "out"))` y todo lo que escriben
 * queda dentro de `out/`, sin posibilidad de salirse aunque la ruta venga del
 * modelo.
 *
 * Ninguna función lanza: todas devuelven `Resultado`.
 */
import fs from "node:fs"
import path from "node:path"
import { dirOut } from "./rutas.ts"
import type { Resultado } from "./tipos.ts"

/** Marcador de carpeta que `limpiar()` conserva. */
export const MARCADOR = ".gitkeep"

/** Superficie de escritura que reciben las herramientas. */
export interface Escritor {
  /** Directorio base (absoluto): el `out/` de la ejecución. */
  readonly base: string
  /** Ruta absoluta confinada, sin crear nada. */
  ruta(...partes: string[]): Resultado<string>
  /** ¿Ya existe algo en esa ruta de la salida? */
  existe(...partes: string[]): boolean
  /** Crea la carpeta (con padres) y devuelve su ruta. */
  carpeta(...partes: string[]): Resultado<string>
  /** Escribe texto UTF-8. */
  texto(contenido: string, ...partes: string[]): Resultado<string>
  /** Escribe bytes (xlsx, pdf). */
  bytes(datos: Uint8Array, ...partes: string[]): Resultado<string>
  /** Copia un archivo externo (un soporte del repositorio). */
  copiar(origen: string, ...destino: string[]): Resultado<string>
  /** Añade una línea (para los `log.jsonl`). */
  anexar(linea: string, ...partes: string[]): Resultado<string>
  /** Vacía la salida conservando el marcador `.gitkeep`. */
  limpiar(): Resultado<number>
}

/** Crea un escritor confinado a `base` (por defecto el `out/` del proyecto). */
export function crearEscritor(base: string = dirOut()): Escritor {
  const raiz = path.resolve(base)

  const ruta = (...partes: string[]): Resultado<string> => {
    const destino = path.resolve(raiz, ...partes)
    if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
      return { ok: false, error: `ruta fuera del directorio de salida: ${partes.join("/")}` }
    }
    return { ok: true, data: destino }
  }

  const carpeta = (...partes: string[]): Resultado<string> => {
    const destino = ruta(...partes)
    if (!destino.ok) return destino
    try {
      fs.mkdirSync(destino.data, { recursive: true })
      return { ok: true, data: destino.data }
    } catch {
      return { ok: false, error: `no se pudo crear la carpeta ${partes.join("/")} en out/` }
    }
  }

  const escribir = (datos: string | Uint8Array, partes: string[]): Resultado<string> => {
    const creada = carpeta(...partes.slice(0, -1))
    if (!creada.ok) return creada
    const destino = ruta(...partes)
    if (!destino.ok) return destino
    try {
      fs.writeFileSync(destino.data, datos)
      return { ok: true, data: destino.data }
    } catch {
      return { ok: false, error: `no se pudo escribir ${partes.join("/")} en out/` }
    }
  }

  return {
    base: raiz,
    ruta,

    existe(...partes) {
      const destino = ruta(...partes)
      return destino.ok && fs.existsSync(destino.data)
    },

    carpeta,
    texto: (contenido, ...partes) => escribir(contenido, partes),
    bytes: (datos, ...partes) => escribir(datos, partes),

    copiar(origen, ...destino) {
      const creada = carpeta(...destino.slice(0, -1))
      if (!creada.ok) return creada
      const objetivo = ruta(...destino)
      if (!objetivo.ok) return objetivo
      try {
        fs.copyFileSync(origen, objetivo.data)
        return { ok: true, data: objetivo.data }
      } catch {
        return { ok: false, error: `no se pudo copiar ${path.basename(origen)} a out/` }
      }
    },

    anexar(linea, ...partes) {
      const creada = carpeta(...partes.slice(0, -1))
      if (!creada.ok) return creada
      const destino = ruta(...partes)
      if (!destino.ok) return destino
      try {
        fs.appendFileSync(destino.data, `${linea}\n`, "utf8")
        return { ok: true, data: destino.data }
      } catch {
        return { ok: false, error: `no se pudo escribir en ${partes.join("/")}` }
      }
    },

    limpiar() {
      let entradas: string[]
      try {
        entradas = fs.readdirSync(raiz)
      } catch {
        return { ok: true, data: 0 }
      }
      let eliminadas = 0
      for (const entrada of entradas) {
        if (entrada === MARCADOR) continue
        try {
          fs.rmSync(path.join(raiz, entrada), { recursive: true, force: true })
          eliminadas += 1
        } catch {
          // Un fallo de limpieza no debe impedir el trabajo: la escritura
          // siguiente sobrescribe el archivo que corresponda.
        }
      }
      return { ok: true, data: eliminadas }
    },
  }
}
