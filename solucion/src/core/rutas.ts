/**
 * Resolución de rutas y confinamiento (PRD §6.2 · §8).
 *
 * Regla de oro: las herramientas resuelven SIEMPRE rutas relativas a una raíz,
 * nunca absolutas, y todo camino dinámico se valida antes de tocar el disco —
 * el `mensaje_id` lo propone el modelo (defensa en profundidad frente a `../`).
 *
 * Reparto de datos:
 *   · lectura  → `fixtures/reto-02/`  (buzón, maestro y comerciales; RN6: jamás
 *                se escribe ahí)
 *   · escritura → `out/`              (copia del maestro, archivo, historial…)
 */
import fs from "node:fs"
import path from "node:path"
import type { Resultado } from "./tipos.ts"

/** Id de mensaje admitido: `msg-001`, `msg-002`… (formato de los fixtures). */
const ID_MENSAJE_VALIDO = /^msg-\d{3}$/

/** Ruta del directorio donde vive esta aplicación (`solucion/`). */
export function dirAplicacion(): string {
  // src/core/rutas.ts -> sube dos niveles.
  return path.resolve(import.meta.dirname, "..", "..")
}

/**
 * Raíz del proyecto: se sube desde `solucion/` buscando el `package.json`.
 * Si no aparece, se devuelve `dirAplicacion()`.
 */
export function dirProyecto(): string {
  let actual = dirAplicacion()
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(actual, "package.json"))) return actual
    const padre = path.dirname(actual)
    if (padre === actual) break
    actual = padre
  }
  return dirAplicacion()
}

/**
 * Carpeta de fixtures: por defecto `../fixtures/reto-02` respecto a `solucion/`
 * (los datos entregados se usan en su sitio, sin copiarlos).
 * `FIXTURES_DIR` permite apuntar a otra ubicación sin tocar código.
 */
export function dirFixtures(): string {
  const override = process.env["FIXTURES_DIR"]
  if (override !== undefined && override.trim() !== "") return path.resolve(override)
  return path.resolve(dirProyecto(), "..", "fixtures", "reto-02")
}

/** Buzón de entrada: `fixtures/reto-02/buzon/`. */
export function dirBuzon(): string {
  return path.join(dirFixtures(), "buzon")
}

/** Copia congelada del maestro que entrega Periferia (solo lectura, RN6). */
export function rutaMaestroFixture(): string {
  return path.join(dirFixtures(), "maestro-contratos.csv")
}

/** Directorio de comerciales: `fixtures/reto-02/comerciales.json`. */
export function rutaComerciales(): string {
  return path.join(dirFixtures(), "comerciales.json")
}

/** Carpeta de salida: `out/` dentro de la aplicación (`OUT_DIR` la mueve). */
export function dirOut(): string {
  const override = process.env["OUT_DIR"]
  if (override !== undefined && override.trim() !== "") return path.resolve(override)
  return path.join(dirProyecto(), "out")
}

/** El «SharePoint» simulado: `out/sharepoint/`. */
export function dirSharepoint(): string {
  return path.join(dirOut(), "sharepoint")
}

/** Maestro de trabajo: `out/sharepoint/maestro-contratos.csv` (RN6). */
export function rutaMaestro(): string {
  return path.join(dirSharepoint(), "maestro-contratos.csv")
}

/** Carpeta del archivo de contratos: `out/sharepoint/Contratos/` (HU-4). */
export function dirArchivo(): string {
  return path.join(dirSharepoint(), "Contratos")
}

/** Historial de cambios: `out/sharepoint/historial.jsonl` (HU-4 · O2). */
export function rutaHistorial(): string {
  return path.join(dirSharepoint(), "historial.jsonl")
}

/** Mensajes ya resueltos: `out/procesados.json` (idempotencia, HU-1). */
export function rutaProcesados(): string {
  return path.join(dirOut(), "procesados.json")
}

/** Reporte de riesgos: `out/alertas.md` (HU-5). */
export function rutaAlertas(): string {
  return path.join(dirOut(), "alertas.md")
}

/** Traza de herramientas: `out/log.jsonl` (RN7 · CA4). */
export function rutaLog(): string {
  return path.join(dirOut(), "log.jsonl")
}

/** Sesiones del chat: `out/sessions/` (CA3). */
export function dirSesiones(): string {
  return path.join(dirOut(), "sessions")
}

/** Valida el `mensaje_id` recibido en los argumentos de una herramienta. */
export function validarIdMensaje(id: string): Resultado<string> {
  const limpio = id.trim()
  if (limpio === "") return { ok: false, error: "el id del mensaje está vacío" }
  if (!ID_MENSAJE_VALIDO.test(limpio)) {
    return {
      ok: false,
      error: `id de mensaje inválido "${id}": se espera el formato msg-001`,
    }
  }
  return { ok: true, data: limpio }
}

/**
 * Une `partes` a `base` y verifica que el resultado NO se salga de `base`.
 * Es la única forma admitida de construir rutas dinámicas.
 */
export function resolverDentro(base: string, ...partes: string[]): Resultado<string> {
  const raiz = path.resolve(base)
  const destino = path.resolve(raiz, ...partes)
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
    return { ok: false, error: `ruta fuera del directorio permitido: ${partes.join("/")}` }
  }
  return { ok: true, data: destino }
}

/** Carpeta de un mensaje del buzón, validada y confinada a `buzon/`. */
export function dirMensaje(id: string): Resultado<string> {
  const nombre = validarIdMensaje(id)
  if (!nombre.ok) return nombre
  return resolverDentro(dirBuzon(), nombre.data)
}
