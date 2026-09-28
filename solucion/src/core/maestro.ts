/**
 * El maestro de contratos y sus dos índices (HU-3 · RN1-RN3).
 *
 * RN6 es la regla dura: **el fixture es de solo lectura**. La primera ejecución
 * lo copia a `out/sharepoint/maestro-contratos.csv` y desde ahí se trabaja; el
 * original nunca se toca, así que dos corridas parten siempre del mismo estado.
 *
 * Los dos índices son lo que permite responder «¿este contrato ya existe?» sin
 * recorrer el CSV por cada mensaje, y son también el corazón de la mitigación del
 * riesgo que declara el PRD §10: el dedupe va por `id_contrato` primero.
 */
import fs from "node:fs"
import { analizarCsv, escribirAtomico, filaDesdeCrudo, serializarCsv } from "./csv.ts"
import { normalizar } from "./normalizacion.ts"
import { idContratoValido, similitud } from "./identificadores.ts"
import type { FilaMaestro, Resultado } from "./tipos.ts"

/** Clave normalizada de un id de contrato (mayúsculas, sin espacios). */
export function claveContrato(id: string): string {
  return normalizar(id).replace(/\s+/g, "")
}

/** El maestro cargado, con los índices ya construidos. */
export interface Maestro {
  ruta: string
  filas: FilaMaestro[]
  /** Índice por número de contrato: duplicado y actualización (RN1 · RN2). */
  porContrato: Map<string, FilaMaestro>
  /** Índice por cliente: sospecha de actualización cuando el id no resuelve. */
  porCliente: Map<string, FilaMaestro[]>
}

/** Índice por `nit_cliente`: puede haber varios contratos del mismo cliente. */
function indexarPorCliente(filas: readonly FilaMaestro[]): Map<string, FilaMaestro[]> {
  const indice = new Map<string, FilaMaestro[]>()
  for (const fila of filas) {
    const clave = fila.nit_cliente.trim()
    if (clave === "") continue
    const lista = indice.get(clave) ?? []
    lista.push(fila)
    indice.set(clave, lista)
  }
  return indice
}

/**
 * Carga el maestro de trabajo, copiándolo desde el fixture si es la primera vez
 * (RN6). Devuelve error legible si el fixture no está o si trae filas mal formadas.
 */
export function cargarMaestro(rutaFixture: string, rutaDestino: string): Resultado<Maestro> {
  if (!fs.existsSync(rutaDestino)) {
    let original: string
    try {
      original = fs.readFileSync(rutaFixture, "utf8")
    } catch {
      return { ok: false, error: `no se pudo leer el maestro de referencia en ${rutaFixture}` }
    }
    const copia = escribirAtomico(rutaDestino, original)
    if (!copia.ok) return { ok: false, error: `no se pudo copiar el maestro a out/: ${copia.error}` }
  }

  let crudo: string
  try {
    crudo = fs.readFileSync(rutaDestino, "utf8")
  } catch {
    return { ok: false, error: `no se pudo leer el maestro de trabajo en ${rutaDestino}` }
  }

  const analizado = analizarCsv(crudo)
  if (!analizado.ok) return analizado

  const filas: FilaMaestro[] = []
  for (const [indice, linea] of analizado.data.filas.entries()) {
    const fila = filaDesdeCrudo(linea, indice + 1)
    if (!fila.ok) return fila
    filas.push(fila.data)
  }

  const porContrato = new Map<string, FilaMaestro>()
  for (const fila of filas) porContrato.set(claveContrato(fila.id_contrato), fila)

  return { ok: true, data: { ruta: rutaDestino, filas, porContrato, porCliente: indexarPorCliente(filas) } }
}

/** Guarda el maestro completo en `ruta` sin posibilidad de dejarlo a medias. */
export function guardarMaestro(ruta: string, filas: readonly FilaMaestro[]): Resultado<string> {
  return escribirAtomico(ruta, serializarCsv(filas))
}

/** Fila del maestro con ese número de contrato, o `null`. */
export function buscarPorContrato(maestro: Maestro, id: string): FilaMaestro | null {
  return maestro.porContrato.get(claveContrato(id)) ?? null
}

/** Resultado de sospechar una actualización por cliente + objeto (RN2). */
export interface CandidatoCliente {
  fila: FilaMaestro
  /** Similitud de Jaccard entre los objetos, en [0, 1]. RN2 exige ≥ 0.9. */
  similitud: number
}

/**
 * Mejor candidato por `nit_cliente` cuyo objeto se parezca al entrante.
 * No decide nada: devuelve la evidencia y `clasificacion.ts` aplica el umbral.
 */
export function candidatoPorCliente(
  maestro: Maestro,
  nit: string | null,
  objeto: string | null,
): CandidatoCliente | null {
  if (nit === null || nit === "" || objeto === null || objeto === "") return null
  const filas = maestro.porCliente.get(nit.trim()) ?? []
  let mejor: CandidatoCliente | null = null
  for (const fila of filas) {
    if (claveContrato(fila.id_contrato) === "") continue
    const puntaje = similitud(fila.objeto, objeto)
    if (mejor === null || puntaje > mejor.similitud) mejor = { fila, similitud: puntaje }
  }
  return mejor
}

/**
 * Siguiente id automático para un contrato sin número (`AUTO-<año>-<secuencia>`),
 * mirando los que ya existen para no repetir secuencia.
 */
export function siguienteAuto(filas: readonly FilaMaestro[], anio: string): string {
  const patron = new RegExp(`^AUTO-${anio}-(\\d{3,})$`)
  let mayor = 0
  for (const fila of filas) {
    const encontrado = patron.exec(claveContrato(fila.id_contrato))
    if (encontrado) mayor = Math.max(mayor, Number(encontrado[1]))
  }
  return `AUTO-${anio}-${String(mayor + 1).padStart(3, "0")}`
}

/** Normaliza un id propuesto por el modelo antes de usarlo como clave. */
export function normalizarIdPropuesto(id: string): Resultado<string> {
  return idContratoValido(id)
}
