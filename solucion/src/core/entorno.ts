/**
 * El entorno de una ejecución: dónde están los datos y dónde se escribe.
 *
 * El contrato de herramientas del PRD §6.2 pasa `ctx.directory` (la raíz del
 * proyecto) en cada llamada, así que el entorno se construye **desde ahí**: el
 * escritor queda confinado a `<raíz>/out` y los datos se leen de
 * `<raíz>/../fixtures/reto-02`. Nada absoluto, nada fuera de sitio.
 *
 * Las pruebas y `demo.ts` también lo usan: crear un entorno sobre una carpeta
 * temporal es la forma de probar sin tocar el `out/` del repositorio.
 */
import path from "node:path"
import { crearEscritor, type Escritor } from "./escritor.ts"
import { formatearFecha, validarFecha } from "./normalizacion.ts"
import type { Resultado } from "./tipos.ts"

/** Sobrescrituras pensadas para pruebas (`out` temporal, fixtures de ejemplo). */
export interface OpcionesEntorno {
  fixtures?: string
  out?: string
  hoy?: string
  sesion?: string
}

/** Todo lo que una herramienta necesita saber para trabajar. */
export interface Entorno {
  /** Raíz del proyecto (`ctx.directory`). */
  raiz: string
  escritor: Escritor
  buzon: string
  maestroFixture: string
  comerciales: string
  maestro: string
  archivo: string
  historial: string
  procesados: string
  alertas: string
  log: string
  sesiones: string
  /** Fecha de referencia `YYYY-MM-DD`: argumento por defecto de las alertas. */
  hoy: string
  sesion: string
}

/** Fecha del sistema en UTC (`YYYY-MM-DD`), sin sorpresas de zona horaria. */
export function fechaDelSistema(ahora: Date = new Date()): string {
  const formateada = formatearFecha({
    dia: ahora.getUTCDate(),
    mes: ahora.getUTCMonth() + 1,
    anio: ahora.getUTCFullYear(),
  })
  return formateada ?? "1970-01-01"
}

/**
 * Construye el entorno. `FECHA_EJECUCION` fija la fecha de referencia para que
 * alertas y vencimientos sean reproducibles (PRD §8 · Determinismo); la opción
 * explícita gana sobre la variable de entorno.
 */
export function crearEntorno(raiz: string, opciones: OpcionesEntorno = {}): Resultado<Entorno> {
  const sesion = opciones.sesion ?? "demo"
  const fixturesEnv = process.env["FIXTURES_DIR"]
  const outEnv = process.env["OUT_DIR"]
  const fixtures =
    opciones.fixtures ??
    (fixturesEnv !== undefined && fixturesEnv.trim() !== ""
      ? path.resolve(fixturesEnv)
      : path.resolve(raiz, "..", "fixtures", "reto-02"))
  const out =
    opciones.out ??
    (outEnv !== undefined && outEnv.trim() !== "" ? path.resolve(outEnv) : path.join(raiz, "out"))

  const hoyCrudo = opciones.hoy ?? process.env["FECHA_EJECUCION"] ?? fechaDelSistema()
  const hoy = validarFecha(hoyCrudo, "FECHA_EJECUCION")
  if (!hoy.ok) return hoy

  const sharepoint = path.join(out, "sharepoint")
  return {
    ok: true,
    data: {
      raiz,
      escritor: crearEscritor(out),
      buzon: path.join(fixtures, "buzon"),
      maestroFixture: path.join(fixtures, "maestro-contratos.csv"),
      comerciales: path.join(fixtures, "comerciales.json"),
      maestro: path.join(sharepoint, "maestro-contratos.csv"),
      archivo: path.join(sharepoint, "Contratos"),
      historial: path.join(sharepoint, "historial.jsonl"),
      procesados: path.join(out, "procesados.json"),
      alertas: path.join(out, "alertas.md"),
      log: path.join(out, "log.jsonl"),
      sesiones: path.join(out, "sessions"),
      hoy: hoy.data,
      sesion,
    },
  }
}
