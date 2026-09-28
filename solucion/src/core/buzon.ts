/**
 * El buzón de contratos (HU-1 · §7.1).
 *
 * Un mensaje es una carpeta `buzon/<mensaje_id>/` con `correo.json` y sus
 * adjuntos. Aquí se lee y se decide algo que el PRD deja claro: **un correo sin
 * adjunto de contrato no es un contrato** (msg-005 trae una cotización), y eso se
 * detecta antes de gastar un turno del modelo (RN4).
 */
import fs from "node:fs"
import path from "node:path"
import { leerJson, listarDirectorio, leerTexto, esObjeto } from "./io.ts"
import { validarIdMensaje } from "./rutas.ts"
import { normalizar } from "./normalizacion.ts"
import type { Mensaje, Resultado } from "./tipos.ts"

/** Clase de adjunto que interesa al proceso. */
export type ClaseAdjunto = "contrato" | "otrosi"

/** Adjunto que contiene un contrato u otrosí, con su clase. */
export interface AdjuntoContrato {
  archivo: string
  clase: ClaseAdjunto
}

/** Valida y tipa el contenido de un `correo.json`. */
function comoMensaje(valor: unknown, id: string): Resultado<Mensaje> {
  if (!esObjeto(valor)) return { ok: false, error: `el correo de ${id} no es un objeto JSON` }
  const adjuntos = valor["adjuntos"]
  if (!Array.isArray(adjuntos) || adjuntos.some((a) => typeof a !== "string")) {
    return { ok: false, error: `el correo de ${id} no tiene una lista de adjuntos válida` }
  }
  const texto = (clave: string): string => {
    const v = valor[clave]
    return typeof v === "string" ? v : ""
  }
  return {
    ok: true,
    data: {
      id: texto("id") === "" ? id : texto("id"),
      de: texto("de"),
      para: texto("para"),
      asunto: texto("asunto"),
      fecha: texto("fecha"),
      cuerpo: texto("cuerpo"),
      adjuntos: adjuntos as string[],
    },
  }
}

/** Lee un mensaje concreto del buzón. */
export function leerMensaje(dirBuzon: string, id: string): Resultado<Mensaje> {
  const validado = validarIdMensaje(id)
  if (!validado.ok) return validado
  const crudo = leerJson<unknown>(path.join(dirBuzon, validado.data, "correo.json"))
  if (!crudo.ok) return { ok: false, error: `no se pudo leer el correo de ${id}: ${crudo.error}` }
  return comoMensaje(crudo.data, validado.data)
}

/**
 * Lista el buzón completo, ordenado por id (el orden de los fixtures es el que
 * espera `demo.ts`: msg-001 … msg-006).
 */
export function listarBuzon(dirBuzon: string): Resultado<Mensaje[]> {
  const entradas = listarDirectorio(dirBuzon)
  if (!entradas.ok) return entradas

  const mensajes: Mensaje[] = []
  for (const entrada of entradas.data) {
    if (!/^msg-\d{3}$/.test(entrada)) continue
    const leido = leerMensaje(dirBuzon, entrada)
    if (!leido.ok) return leido
    mensajes.push(leido.data)
  }
  return { ok: true, data: mensajes }
}

/** ¿El nombre del archivo apunta a un contrato u otrosí? */
function clasePorNombre(archivo: string): ClaseAdjunto | null {
  const nombre = normalizar(archivo)
  if (nombre.includes("OTROSI")) return "otrosi"
  if (nombre.includes("CONTRATO")) return "contrato"
  return null
}

/** ¿El contenido parece un contrato u otrosí? (por su encabezado) */
function clasePorTexto(texto: string): ClaseAdjunto | null {
  const primera = normalizar(texto.split("\n")[0] ?? "")
  if (primera.startsWith("OTROSI")) return "otrosi"
  if (primera.startsWith("CONTRATO")) return "contrato"
  return null
}

/**
 * Adjunto que contiene el contrato, o `null` si el mensaje no trae ninguno.
 * Se acepta por nombre (`contrato.txt`, `otrosi.txt`) o por el encabezado del
 * documento, que es lo que distingue un contrato de una cotización.
 */
export function adjuntoContrato(mensaje: Mensaje, dirMensaje: string): AdjuntoContrato | null {
  for (const archivo of mensaje.adjuntos) {
    const clase = clasePorNombre(archivo)
    if (clase !== null) return { archivo, clase }

    const contenido = leerTexto(path.join(dirMensaje, archivo))
    if (!contenido.ok) continue
    const porTexto = clasePorTexto(contenido.data)
    if (porTexto !== null) return { archivo, clase: porTexto }
  }
  return null
}

/** Texto del adjunto que contiene el contrato (o error legible). */
export function leerAdjunto(dirMensaje: string, archivo: string): Resultado<string> {
  return leerTexto(path.join(dirMensaje, archivo))
}

/** ¿El buzón tiene mensajes? Se usa para avisar cuando está vacío. */
export function hayMensajes(dirBuzon: string): boolean {
  if (!fs.existsSync(dirBuzon)) return false
  return fs.readdirSync(dirBuzon).some((entrada) => /^msg-\d{3}$/.test(entrada))
}
