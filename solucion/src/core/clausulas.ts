/**
 * Troceado del contrato en cláusulas (HU-2).
 *
 * Los contratos de los fixtures son documentos colombianos estándar: cada
 * cláusula abre con un ordinal en mayúsculas y un punto (`PRIMERA. OBJETO.`).
 * Ese patrón es la columna vertebral de la extracción: sin él, buscar «valor» o
 * «plazo» en el texto sería adivinar. Un otrosí usa el mismo patrón para decir
 * qué cláusula modifica.
 */
import { normalizar } from "./normalizacion.ts"

/** Una cláusula del documento: su encabezado y su cuerpo. */
export interface Clausula {
  /** Texto del encabezado (`PRIMERA. OBJETO.`), ya normalizado. */
  encabezado: string
  /** Palabra clave del encabezado (`OBJETO`, `VALOR`, `PLAZO`, `GARANTIAS`…). */
  clave: string
  /** Cuerpo completo de la cláusula, sin el encabezado. */
  cuerpo: string
}

/** Ordinales que abren cláusula en los contratos y otrosíes de los fixtures. */
const ORDINALES = [
  "PRIMERA",
  "SEGUNDA",
  "TERCERA",
  "CUARTA",
  "QUINTA",
  "SEXTA",
  "SEPTIMA",
  "OCTAVA",
  "NOVENA",
  "DECIMA",
  "DECIMOPRIMERA",
  "PRIMERO",
  "SEGUNDO",
  "TERCERO",
]

/** ¿La línea abre una cláusula? (`TERCERA. PLAZO. El plazo…`) */
function abreClausula(linea: string): boolean {
  const inicio = normalizar(linea).split(" ")[0]?.replace(/[^A-Z]/g, "") ?? ""
  return ORDINALES.includes(inicio)
}

/** ¿El segmento es una etiqueta en mayúsculas (`OBJETO`, `FORMA DE PAGO`)? */
function esEtiqueta(segmento: string): boolean {
  const limpio = segmento.replace(/[.,:;]/g, "").trim()
  if (limpio === "") return false
  return limpio === limpio.toUpperCase() && /^[A-ZÁÉÍÓÚÑÜ0-9\s]+$/.test(limpio)
}

/**
 * Separa el encabezado del cuerpo cuando vienen en la misma línea, que es como
 * están escritos los fixtures:
 * `PRIMERA. OBJETO. EL CONTRATISTA se obliga a ejecutar…` →
 * encabezado `PRIMERA. OBJETO.`, cuerpo `EL CONTRATISTA se obliga a ejecutar…`.
 *
 * Se consumen hasta cuatro segmentos en mayúsculas seguidos (para admitir
 * `CUARTA. FORMA DE PAGO.`) y el resto es cuerpo.
 */
export function partirLineaClausula(linea: string): { encabezado: string; resto: string } {
  const segmentos = linea.split(/(?<=\.)\s+/)
  let encabezado = ""
  let i = 0
  for (; i < segmentos.length && i < 4; i += 1) {
    const segmento = segmentos[i] ?? ""
    if (!esEtiqueta(segmento)) break
    encabezado = encabezado === "" ? segmento : `${encabezado} ${segmento}`
  }
  return { encabezado: encabezado.trim(), resto: segmentos.slice(i).join(" ").trim() }
}

/**
 * Palabra clave del encabezado. Se toman las mayúsculas del encabezado y se
 * busca la primera que no sea el ordinal (`TERCERA. PLAZO.` → `PLAZO`).
 */
function claveDe(encabezado: string): string {
  const palabras = normalizar(encabezado).replace(/[.,:;]/g, " ").split(" ")
  for (const palabra of palabras) {
    if (palabra === "" || ORDINALES.includes(palabra)) continue
    return palabra
  }
  return ""
}

/**
 * Divide el documento en cláusulas. El texto previo a la primera (las partes, el
 * encabezado del contrato) se descarta aquí: cada consumidor busca lo suyo con
 * `buscarClausula` o con una búsqueda propia sobre el texto completo.
 */
export function dividirClausulas(texto: string): Clausula[] {
  const clausulas: Clausula[] = []
  let encabezadoActual: string | null = null
  let cuerpo: string[] = []

  const cerrar = (): void => {
    if (encabezadoActual === null) return
    clausulas.push({
      encabezado: encabezadoActual,
      clave: claveDe(encabezadoActual),
      cuerpo: cuerpo.join("\n").trim(),
    })
  }

  for (const linea of texto.split(/\r?\n/)) {
    if (abreClausula(linea)) {
      cerrar()
      const { encabezado, resto } = partirLineaClausula(linea)
      encabezadoActual = encabezado === "" ? linea.trim() : encabezado
      cuerpo = resto === "" ? [] : [resto]
      continue
    }
    if (encabezadoActual !== null) cuerpo.push(linea)
  }
  cerrar()
  return clausulas
}

/** Primera cláusula cuya clave coincida con alguna de las pedidas. */
export function buscarClausula(clausulas: readonly Clausula[], claves: readonly string[]): Clausula | null {
  for (const clausula of clausulas) {
    if (claves.includes(clausula.clave)) return clausula
  }
  for (const clausula of clausulas) {
    if (claves.some((clave) => clausula.clave.includes(clave))) return clausula
  }
  return null
}

/** ¿El documento tiene alguna cláusula de garantías? (aunque no mencione póliza) */
export function tieneClausulaGarantias(clausulas: readonly Clausula[]): boolean {
  return clausulas.some(
    (c) => c.clave.includes("GARANT") || normalizar(c.cuerpo).includes("POLIZA"),
  )
}

/**
 * Recorta el objeto a los 200 caracteres que admite el maestro (PRD §7.2).
 * Devuelve también si hubo recorte, para poder bajar la confianza del campo.
 */
export function recortarObjeto(objeto: string, limite = 200): { texto: string; recortado: boolean } {
  const limpio = objeto.replace(/\s+/g, " ").trim()
  if (limpio.length <= limite) return { texto: limpio, recortado: false }
  return { texto: limpio.slice(0, limite - 1).trimEnd(), recortado: true }
}
