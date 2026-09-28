/**
 * Utilidades de prueba sobre los fixtures reales.
 *
 * No son pruebas (por eso viven en `test-utils/` y no en `test/`): son el puente
 * entre los documentos que entregó Periferia y el motor determinista. Todas
 * escriben en una **carpeta temporal**, nunca en el `out/` del repositorio.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cargarComerciales, resolverComercial } from "../src/core/comerciales.ts"
import { cargarMaestro, type Maestro } from "../src/core/maestro.ts"
import type { ContextoExtraccion } from "../src/core/extraccion.ts"
import type { Mensaje } from "../src/core/tipos.ts"

/** `reto-02/fixtures/reto-02/`, resolviendo desde `solucion/test-utils/`. */
export const FIXTURES = path.resolve(import.meta.dirname, "..", "..", "fixtures", "reto-02")

export const BUZON = path.join(FIXTURES, "buzon")

/** Carpeta temporal por prueba. */
export function dirTemporal(prefijo: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefijo}-`))
}

/** Correo de un mensaje del buzón. */
export function leerMensaje(id: string): Mensaje {
  return JSON.parse(fs.readFileSync(path.join(BUZON, id, "correo.json"), "utf8")) as Mensaje
}

/** Texto de un adjunto del buzón. */
export function leerDocumento(id: string, adjunto: string): string {
  return fs.readFileSync(path.join(BUZON, id, adjunto), "utf8")
}

/** Contexto de extracción de un mensaje, con su comercial resuelto si existe. */
export function contextoDe(id: string, adjunto?: string): ContextoExtraccion {
  const mensaje = leerMensaje(id)
  const archivo = adjunto ?? mensaje.adjuntos[0] ?? "contrato.txt"
  const comerciales = cargarComerciales(path.join(FIXTURES, "comerciales.json"))
  const comercial = comerciales.ok ? resolverComercial(comerciales.data, mensaje.de) : null
  return { mensaje, texto: leerDocumento(id, archivo), comercial: comercial?.nombre ?? null }
}

/** Maestro cargado desde el fixture y copiado a un `out/` temporal (RN6). */
export function maestroTemporal(): { maestro: Maestro; dir: string } {
  const dir = dirTemporal("reto02-maestro")
  const ruta = path.join(dir, "sharepoint", "maestro-contratos.csv")
  const cargado = cargarMaestro(path.join(FIXTURES, "maestro-contratos.csv"), ruta)
  if (!cargado.ok) throw new Error(`no se pudo cargar el maestro del fixture: ${cargado.error}`)
  return { maestro: cargado.data, dir }
}

/** Mensaje sintético, para los casos que los fixtures no cubren. */
export function mensajeSintetico(id: string, de = "lgomez@periferia-ficticia.com"): Mensaje {
  return {
    id,
    de,
    para: "contratos@periferia-ficticia.com",
    asunto: "prueba",
    fecha: "2026-09-01T09:00:00-05:00",
    cuerpo: "",
    adjuntos: [],
  }
}
