/**
 * Lectura y escritura del maestro en CSV (PRD §7.2 · §7.3 RN6).
 *
 * El maestro son 16 columnas fijas. El formato a reproducir es el que ya usa
 * SharePoint: comillas dobles SOLO cuando el campo trae coma, comilla o salto.
 * Por eso se escribe a mano en vez de traer una librería de parsing genérico:
 * el problema es más pequeño que la herramienta.
 *
 * `escribirAtomico` es la única forma admitida de guardar el maestro: escribe un
 * `.tmp` y renombra, así que un fallo a mitad NO deja una fila a medias (O2).
 */
import fs from "node:fs"
import path from "node:path"
import type { EstadoPoliza, FilaMaestro, Fuente, Moneda, Pais, Resultado } from "./tipos.ts"

/**
 * Las 16 columnas del maestro, EN EL ORDEN DEL FIXTURE.
 * Cambiar este arreglo cambia el archivo: es el contrato con SharePoint.
 */
export const COLUMNAS = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const

/** Encabezado exacto del archivo (una línea, sin salto final). */
export const ENCABEZADO = COLUMNAS.join(",")

/** ¿El campo necesita comillas? (coma, comilla o salto dentro del valor) */
function necesitaComillas(campo: string): boolean {
  return campo.includes(",") || campo.includes('"') || campo.includes("\n") || campo.includes("\r")
}

/** Serializa un campo según RFC 4180: comillas dobles dentro del valor. */
export function serializarCampo(campo: string): string {
  if (!necesitaComillas(campo)) return campo
  return `"${campo.replaceAll('"', '""')}"`
}

/** Divide una línea CSV respetando las comillas. */
export function analizarLinea(linea: string): string[] {
  const campos: string[] = []
  let actual = ""
  let entreComillas = false
  for (let i = 0; i < linea.length; i += 1) {
    const caracter = linea[i] ?? ""
    if (entreComillas) {
      if (caracter === '"') {
        if (linea[i + 1] === '"') {
          actual += '"'
          i += 1
        } else {
          entreComillas = false
        }
      } else {
        actual += caracter
      }
    } else if (caracter === '"') {
      entreComillas = true
    } else if (caracter === ",") {
      campos.push(actual)
      actual = ""
    } else {
      actual += caracter
    }
  }
  campos.push(actual)
  return campos
}

/**
 * Divide el contenido completo en líneas lógicas (respeta saltos dentro de comillas).
 */
export function analizarCsv(texto: string): Resultado<{ encabezados: string[]; filas: string[][] }> {
  const lineas: string[] = []
  let actual = ""
  let entreComillas = false
  for (const caracter of texto) {
    if (caracter === '"') entreComillas = !entreComillas
    if ((caracter === "\n" || caracter === "\r") && !entreComillas) {
      if (actual !== "") lineas.push(actual)
      actual = ""
      continue
    }
    actual += caracter
  }
  if (actual !== "") lineas.push(actual)
  if (lineas.length === 0) return { ok: false, error: "el CSV está vacío" }

  const [encabezados, ...filas] = lineas.map(analizarLinea)
  if (encabezados === undefined) return { ok: false, error: "el CSV no tiene encabezado" }
  return { ok: true, data: { encabezados, filas } }
}

/** Texto completo del maestro, con encabezado y salto final. */
export function serializarCsv(filas: readonly FilaMaestro[]): string {
  const cuerpo = filas.map((fila) =>
    COLUMNAS.map((columna) => serializarCampo(filaATexto(fila, columna))).join(","),
  )
  return `${[ENCABEZADO, ...cuerpo].join("\n")}\n`
}

/** Valor de una columna de la fila, ya convertido al texto del CSV. */
function filaATexto(fila: FilaMaestro, columna: (typeof COLUMNAS)[number]): string {
  switch (columna) {
    case "valor":
      return String(fila.valor)
    case "requiere_poliza":
      return fila.requiere_poliza ? "true" : "false"
    default:
      return String(fila[columna])
  }
}

/**
 * Convierte una fila cruda del CSV en `FilaMaestro`, con los tipos del dominio.
 * Un maestro con una fila mal formada o con valor no numérico devuelve error
 * legible: no debe pasar silenciosamente al archivo de trabajo.
 */
export function filaDesdeCrudo(crudo: string[], numero: number): Resultado<FilaMaestro> {
  if (crudo.length !== COLUMNAS.length) {
    return {
      ok: false,
      error: `la fila ${numero} tiene ${crudo.length} columnas y se esperan ${COLUMNAS.length}`,
    }
  }
  const valorCrudo = crudo[5] ?? ""
  const valor = Number(valorCrudo === "" ? "0" : valorCrudo)
  if (!Number.isFinite(valor)) {
    return { ok: false, error: `la fila ${numero} tiene un valor no numérico: "${valorCrudo}"` }
  }
  return {
    ok: true,
    data: {
      id_contrato: crudo[0] ?? "",
      cliente: crudo[1] ?? "",
      nit_cliente: crudo[2] ?? "",
      pais: (crudo[3] ?? "") as Pais,
      objeto: crudo[4] ?? "",
      valor,
      moneda: (crudo[6] ?? "") as Moneda,
      fecha_inicio: crudo[7] ?? "",
      fecha_fin: crudo[8] ?? "",
      requiere_poliza: (crudo[9] ?? "").toLowerCase() === "true",
      tipo_poliza: crudo[10] ?? "",
      estado_poliza: (crudo[11] ?? "no_aplica") as EstadoPoliza,
      comercial: crudo[12] ?? "",
      ruta_sharepoint: crudo[13] ?? "",
      fecha_registro: crudo[14] ?? "",
      fuente: (crudo[15] ?? "buzon") as Fuente,
    },
  }
}

/**
 * Escribe un archivo de forma atómica: primero un `.tmp` y después un `rename`.
 * Si el proceso muere a mitad, el archivo anterior sigue intacto.
 */
export function escribirAtomico(ruta: string, contenido: string): Resultado<string> {
  const temporal = `${ruta}.tmp`
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true })
  } catch {
    return { ok: false, error: `no se pudo preparar la carpeta de ${path.basename(ruta)}` }
  }
  try {
    fs.writeFileSync(temporal, contenido, "utf8")
    fs.renameSync(temporal, ruta)
    return { ok: true, data: ruta }
  } catch {
    try {
      fs.rmSync(temporal, { force: true })
    } catch {
      // Si tampoco se puede limpiar el temporal, el maestro original sigue ahí.
    }
    return { ok: false, error: `no se pudo escribir ${path.basename(ruta)}` }
  }
}

