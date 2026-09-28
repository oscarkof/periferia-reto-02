/**
 * Normalización del español de los contratos (HU-2 · PRD §7.2).
 *
 * Los contratos están escritos en palabras, no en ISO 8601 ni en JSON: aquí se
 * traduce lo que dicen —numerales, fechas con ordinal, importes, monedas— a los
 * tipos del dominio. **Nada de esto usa el modelo**: es la razón de que el valor
 * registrado sea auditable y de que dos ejecuciones den el mismo resultado.
 */
import type { Moneda, Resultado } from "./tipos.ts"

/** Quita tildes, pasa a mayúsculas y colapsa espacios. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Igual que `normalizar`, pero en minúsculas (para comparar etiquetas). */
export function comparable(texto: string): string {
  return normalizar(texto).toLowerCase()
}

// ── Numerales en español ────────────────────────────────────────────────────

const UNIDADES: Record<string, number> = {
  CERO: 0,
  UN: 1,
  UNO: 1,
  UNA: 1,
  PRIMERO: 1,
  PRIMERA: 1,
  DOS: 2,
  SEGUNDO: 2,
  TRES: 3,
  TERCERO: 3,
  CUATRO: 4,
  CUARTO: 4,
  CINCO: 5,
  QUINTO: 5,
  SEIS: 6,
  SEXTO: 6,
  SIETE: 7,
  SEPTIMO: 7,
  OCHO: 8,
  OCTAVO: 8,
  NUEVE: 9,
  NOVENO: 9,
  DIEZ: 10,
  DECIMO: 10,
  ONCE: 11,
  DOCE: 12,
  TRECE: 13,
  CATORCE: 14,
  QUINCE: 15,
  DIECISEIS: 16,
  DIECISIETE: 17,
  DIECIOCHO: 18,
  DIECINUEVE: 19,
  VEINTE: 20,
  TREINTA: 30,
}

const DECENAS: Record<string, number> = {
  CUARENTA: 40,
  CINCUENTA: 50,
  SESENTA: 60,
  SETENTA: 70,
  OCHENTA: 80,
  NOVENTA: 90,
}

const CENTENAS: Record<string, number> = {
  CIEN: 100,
  CIENTO: 100,
  DOSCIENTOS: 200,
  TRESCIENTOS: 300,
  CUATROCIENTOS: 400,
  QUINIENTOS: 500,
  SEISCIENTOS: 600,
  SETECIENTOS: 700,
  OCHOCIENTOS: 800,
  NOVECIENTOS: 900,
}

/**
 * Convierte un numeral español en palabras a número.
 *
 * Admite `cien`, decenas con «y», centenas, `mil` y `millón/millones`, que es
 * todo lo que usan los contratos: «DOSCIENTOS SESENTA Y CINCO MILLONES»,
 * «QUINIENTOS VEINTE MIL», «veinticuatro (24)». Las palabras ajenas al numeral
 * (p. ej. «PESOS», «M/CTE») se ignoran sin invalidar el resultado.
 */
export function numeralEspanol(texto: string): number | null {
  const palabras = normalizar(texto)
    .replace(/[.,;:()]/g, " ")
    .split(" ")
    .filter((p) => p !== "" && p !== "Y" && p !== "DE")

  if (palabras.length === 0) return null

  let total = 0
  let grupo = 0
  let reconocidas = 0

  for (const palabra of palabras) {
    if (palabra in UNIDADES) {
      grupo += UNIDADES[palabra] ?? 0
      reconocidas += 1
    } else if (palabra in DECENAS) {
      grupo += DECENAS[palabra] ?? 0
      reconocidas += 1
    } else if (palabra in CENTENAS) {
      grupo += CENTENAS[palabra] ?? 0
      reconocidas += 1
    } else if (palabra === "MIL") {
      total += (grupo === 0 ? 1 : grupo) * 1_000
      grupo = 0
      reconocidas += 1
    } else if (palabra === "MILLON" || palabra === "MILLONES") {
      total += (grupo === 0 ? 1 : grupo) * 1_000_000
      grupo = 0
      reconocidas += 1
    } else if (palabra.startsWith("VEINTI")) {
      // «VEINTICUATRO», «VEINTIDOS»… escritos de corrido.
      const resto = palabra.slice(6)
      const valor = resto === "" ? 0 : UNIDADES[resto] ?? null
      if (valor === null) continue
      grupo += 20 + valor
      reconocidas += 1
    } else {
      continue
    }
  }

  if (reconocidas === 0) return null
  return total + grupo
}

// ── Fechas ──────────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  SETIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
}

/** Día, mes y año tal como aparecen en el texto (aún sin validar el calendario). */
export interface PartesFecha {
  dia: number
  mes: number
  anio: number
}

/**
 * Lee una fecha escrita como «primero (1) de agosto de 2026», «15 de agosto de
 * 2026» o «1 de agosto de 2026». Si el día viene como ordinal en palabras y sin
 * dígito (`primero de agosto de 2026`), se traduce con `numeralEspanol`.
 *
 * Solo lee la fecha; que exista en el calendario lo decide `formatearFecha`.
 */
export function fechaDesdeTexto(entrada: string): PartesFecha | null {
  // Los ordinales vienen entre paréntesis («primero (1) de agosto de 2026»), así
  // que los paréntesis se convierten en espacio ANTES de buscar el patrón.
  const texto = normalizar(entrada.replace(/[()]/g, " "))
  const nombreMes = (nombre: string | undefined): number | null =>
    nombre === undefined ? null : MESES[nombre] ?? null

  const conDigito = /(\d{1,2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})/.exec(texto)
  if (conDigito) {
    const mes = nombreMes(conDigito[2])
    if (mes === null) return null
    return { dia: Number(conDigito[1]), mes, anio: Number(conDigito[3]) }
  }

  const enPalabras = /\b([A-Z]+)\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})/.exec(texto)
  if (enPalabras) {
    const dia = numeralEspanol(enPalabras[1] ?? "")
    const mes = nombreMes(enPalabras[2])
    if (dia === null || mes === null) return null
    return { dia, mes, anio: Number(enPalabras[3]) }
  }
  return null
}

/** Valida contra el calendario y devuelve `YYYY-MM-DD`; `null` si no existe. */
export function formatearFecha(partes: PartesFecha): string | null {
  const { dia, mes, anio } = partes
  if (!Number.isInteger(dia) || !Number.isInteger(mes) || !Number.isInteger(anio)) return null
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 1900 || anio > 2200) return null
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
}

/** Valida una fecha `YYYY-MM-DD` recibida como argumento de herramienta. */
export function validarFecha(texto: string, etiqueta = "fecha"): Resultado<string> {
  const limpio = texto.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) {
    return { ok: false, error: `${etiqueta} inválida "${texto}": se espera el formato AAAA-MM-DD` }
  }
  const [anio, mes, dia] = limpio.split("-").map(Number)
  const formateada = formatearFecha({ anio: anio ?? 0, mes: mes ?? 0, dia: dia ?? 0 })
  if (formateada === null) {
    return { ok: false, error: `${etiqueta} inválida "${texto}": esa fecha no existe en el calendario` }
  }
  return { ok: true, data: formateada }
}

/** Suma meses a una fecha `YYYY-MM-DD`, recortando al último día del mes destino. */
export function sumarMeses(fecha: string, meses: number): string | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!partes) return null
  const anio = Number(partes[1])
  const mes = Number(partes[2])
  const dia = Number(partes[3])
  const destino = new Date(Date.UTC(anio, mes - 1 + meses, 1))
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0))
  return formatearFecha({
    dia: Math.min(dia, ultimoDia.getUTCDate()),
    mes: destino.getUTCMonth() + 1,
    anio: destino.getUTCFullYear(),
  })
}

/** Días enteros entre dos fechas `YYYY-MM-DD` (b − a). */
export function diasEntre(desde: string, hasta: string): number | null {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

// ── Importes y monedas ──────────────────────────────────────────────────────

const FORMATO_INGLES = /\d{1,3}(,\d{3})+(\.\d+)?/
const FORMATO_LOCAL = /\d{1,3}(\.\d{3})+/

/**
 * Primer importe que aparezca en el texto, como número.
 *
 * Distingue `120,000.00` (separador de miles por coma) de `265.000.000`
 * (separador por punto) por el patrón, no por la longitud: así no hay que
 * adivinar la convención del país.
 */
export function valorMonetario(texto: string): number | null {
  const ingles = FORMATO_INGLES.exec(texto)
  if (ingles) {
    const numero = Number(ingles[0].replaceAll(",", ""))
    return Number.isFinite(numero) ? numero : null
  }
  const local = FORMATO_LOCAL.exec(texto)
  if (local) {
    const numero = Number(local[0].replaceAll(".", ""))
    return Number.isFinite(numero) ? numero : null
  }
  const simple = /\b(\d{4,})\b/.exec(texto)
  if (simple) {
    const numero = Number(simple[1])
    return Number.isFinite(numero) ? numero : null
  }
  return null
}

const MONEDAS_POR_CODIGO: Record<string, Moneda> = {
  COP: "COP",
  USD: "USD",
  PEN: "PEN",
  PAB: "PAB",
  HNL: "HNL",
}

const MONEDAS_POR_PALABRA: Record<string, Moneda> = {
  PESOS: "COP",
  PESO: "COP",
  SOLES: "PEN",
  SOL: "PEN",
  DOLARES: "USD",
  DOLAR: "USD",
  BALBOAS: "PAB",
  BALBOA: "PAB",
  LEMPIRAS: "HNL",
  LEMPIRA: "HNL",
}

/** Moneda por el código ISO o por el nombre que acompaña al numeral. */
export function monedaDesdeTexto(texto: string): Moneda | null {
  const normalizado = normalizar(texto)
  const porCodigo = /\b(COP|USD|PEN|PAB|HNL)\b/.exec(normalizado)
  if (porCodigo) return MONEDAS_POR_CODIGO[porCodigo[1] ?? ""] ?? null
  for (const [palabra, moneda] of Object.entries(MONEDAS_POR_PALABRA)) {
    if (new RegExp(`\\b${palabra}\\b`).test(normalizado)) return moneda
  }
  return null
}

