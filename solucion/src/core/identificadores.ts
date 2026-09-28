/**
 * Identificación de terceros y comparación de textos (HU-3 · RN2).
 *
 * Aquí vive lo que decide «esto es de Ecuador y no de Colombia» y «este objeto se
 * parece al del maestro»: son reglas del dominio, deterministas y probadas, no
 * inferencias del modelo.
 */
import { normalizar, comparable } from "./normalizacion.ts"
import type { Pais, Resultado } from "./tipos.ts"

/**
 * Deja el identificador tributario sin puntos, sin guiones y **sin dígito de
 * verificación**: el PRD §7.2 pide `nit_cliente` sin DV ni separadores, así que
 * `890.900.111-4` → `890900111`.
 */
export function normalizarIdentificador(texto: string): string {
  return texto
    .replace(/[.\s]/g, "")
    .replace(/-\d$/, "")
    .replace(/-D$/i, "")
    .replace(/-$/, "")
}

/** Identificador tributario que acompañe a `NIT`, `RUC` o `RTN` en el texto. */
export function identificadorDesdeTexto(texto: string): { tipo: string; valor: string } | null {
  const encontrado = /\b(NIT|RUC|RTN)\b[\s:]*([0-9][0-9.\-\s]{6,20})/.exec(normalizar(texto))
  if (!encontrado) return null
  const valor = normalizarIdentificador(encontrado[2] ?? "")
  if (valor === "") return null
  return { tipo: encontrado[1] ?? "", valor }
}

const PAISES_POR_PALABRA: Record<string, Pais> = {
  COLOMBIA: "CO",
  BOGOTA: "CO",
  MEDELLIN: "CO",
  BARRANQUILLA: "CO",
  CALI: "CO",
  ECUADOR: "EC",
  QUITO: "EC",
  GUAYAQUIL: "EC",
  PERU: "PE",
  LIMA: "PE",
  PANAMA: "PA",
  HONDURAS: "HN",
  TEGUCIGALPA: "HN",
  "SAN PEDRO SULA": "HN",
}

/**
 * País del cliente (PRD §7.2: «inferido del identificador o del texto»).
 *
 * Regla del identificador: NIT → CO; RUC de 13 dígitos → EC; RUC de 11 → PE;
 * RUC de 9-10 → PA; RTN de 14 → HN. Cuando el identificador no basta (un NIT de
 * nueve dígitos podría ser CO o PA) decide el domicilio que aparece en el texto.
 */
export function paisDesdeTexto(texto: string): Pais | null {
  const normalizado = normalizar(texto)
  const identificador = identificadorDesdeTexto(texto)
  const porDomicilio = paisPorDomicilio(normalizado)

  if (identificador) {
    const { tipo, valor } = identificador
    if (tipo === "NIT") return porDomicilio === "PA" ? "PA" : "CO"
    if (tipo === "RTN") return "HN"
    if (tipo === "RUC") {
      if (valor.length === 13) return "EC"
      if (valor.length === 11) return "PE"
      if (valor.length >= 9 && valor.length <= 10) return porDomicilio === "EC" ? "EC" : "PA"
    }
  }
  return porDomicilio
}

/**
 * País por el domicilio o la ciudad mencionados.
 * Se busca la coincidencia más larga para que «San Pedro Sula» gane a «Sula».
 */
export function paisPorDomicilio(texto: string): Pais | null {
  const entradas = Object.entries(PAISES_POR_PALABRA).sort((a, b) => b[0].length - a[0].length)
  for (const [palabra, pais] of entradas) {
    if (new RegExp(`\\b${palabra}\\b`).test(texto)) return pais
  }
  return null
}

const FORMAS_SOCIETARIAS = [
  /(S\.?\s*A\.?\s*S\.?)$/i,
  /(S\.?\s*A\.?\s*C\.?)$/i,
  /(S\.?\s*A\.?)$/i,
  /(S\.?\s*DE\s*R\.?\s*L\.?(\s*DE\s*C\.?\s*V\.?)?)$/i,
  /(SOCIEDAD\s+AN[OÓ]NIMA)$/i,
  /(SOCIEDAD\s+POR\s+ACCIONES\s+SIMPLIFICADA)$/i,
  /(LTDA\.?)$/i,
  /(LIMITADA)$/i,
  /(CORP\.?)$/i,
  /(INC\.?)$/i,
]

/**
 * Slug de carpeta para el archivo (HU-4): «Industrias Delta S.A.S.» →
 * `industrias-delta`.
 *
 * Quita la forma societaria —que no distingue a nadie— y **conserva las
 * partículas**, porque el maestro que entrega Periferia las conserva:
 * `corporacion-andina-de-servicios`, `logistica-del-istmo`,
 * `universidad-del-valle-del-rio`.
 */
export function slugCliente(razonSocial: string): string {
  let limpio = razonSocial.trim().replace(/\s+/g, " ")
  for (const patron of FORMAS_SOCIETARIAS) limpio = limpio.replace(patron, "").trim()
  return limpio
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Palabras significativas de un texto, para comparar objetos (RN2). */
export function tokens(texto: string): Set<string> {
  return new Set(
    comparable(texto)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(" ")
      .filter((t) => t.length > 3),
  )
}

/** Índice de Jaccard entre dos textos, en [0, 1]. RN2 corta en 0.9. */
export function similitud(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let interseccion = 0
  for (const t of ta) if (tb.has(t)) interseccion += 1
  return interseccion / (ta.size + tb.size - interseccion)
}

/** Valida la forma de un id de contrato recibido del modelo o del documento. */
export function idContratoValido(id: string): Resultado<string> {
  const limpio = normalizar(id).replace(/\s+/g, "")
  if (!/^[A-Z0-9][A-Z0-9-]{3,29}$/.test(limpio)) {
    return { ok: false, error: `id de contrato inválido: "${id}"` }
  }
  return { ok: true, data: limpio }
}
