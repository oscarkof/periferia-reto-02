/**
 * Construcción de la fila del maestro y aplicación del cambio (HU-4 · RN1-RN3).
 *
 * Aquí aterriza la regla más delicada del reto: **`null` significa «el documento
 * no lo dice»**, y en una actualización eso es *conservar el valor del maestro*,
 * no borrarlo. Por eso toda la construcción se apoya en la fila existente.
 *
 * Este módulo es puro (no toca disco): construir una fila y aplicarla sobre el
 * conjunto se prueba en aislamiento, y el archivo lo escribe `historial`/`csv`.
 */
import { anioDeReferencia, idParaRegistrar, type ContextoClasificacion } from "./clasificacion.ts"
import { claveContrato, type Maestro } from "./maestro.ts"
import type {
  Contrato,
  EstadoPoliza,
  FilaMaestro,
  Fuente,
  Moneda,
  Pais,
  Resultado,
} from "./tipos.ts"

/** Lo que hay que saber para armar la fila, además del contrato. */
export interface DatosFila {
  /** Número definitivo: el del documento o el automático que decidió la validación. */
  idContrato: string
  /** Ruta relativa dentro del «SharePoint» (HU-4). */
  rutaRelativa: string
  /** Fecha de registro `YYYY-MM-DD` (la de referencia de la ejecución). */
  hoy: string
}

/** Campos que una fila necesita para ser útil: sin ellos no se escribe. */
const OBLIGATORIOS: readonly (keyof FilaMaestro)[] = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
]

/** Valor conservado: lo que trae el documento o, si no lo trae, lo que ya estaba. */
function conservar<T>(nuevo: T | null, anterior: T | undefined, porDefecto: T): T {
  if (nuevo !== null) return nuevo
  if (anterior !== undefined) return anterior
  return porDefecto
}

/**
 * Construye la fila que quedará en el maestro.
 *
 * `existente === null` → fila nueva. `existente !== null` → actualización: cada
 * campo que el documento no menciona se conserva del maestro.
 *
 * Devuelve error legible si falta algo obligatorio: es la última red antes de
 * escribir, y evita que una confirmación humana deje una fila incompleta.
 */
export function construirFila(
  contrato: Contrato,
  existente: FilaMaestro | null,
  datos: DatosFila,
): Resultado<FilaMaestro> {
  const poliza = conservar<boolean>(contrato.requiere_poliza, existente?.requiere_poliza, false)
  const tipos = contrato.requiere_poliza === true && contrato.tipo_poliza.length > 0
    ? contrato.tipo_poliza.join(";")
    : existente?.tipo_poliza ?? ""
  const estado = conservar<EstadoPoliza>(
    contrato.estado_poliza,
    existente?.estado_poliza,
    poliza ? "pendiente" : "no_aplica",
  )

  const fila: FilaMaestro = {
    id_contrato: datos.idContrato,
    cliente: conservar(contrato.cliente, existente?.cliente, ""),
    nit_cliente: conservar(contrato.nit_cliente, existente?.nit_cliente, ""),
    pais: conservar<Pais>(contrato.pais, existente?.pais, "CO"),
    objeto: conservar(contrato.objeto, existente?.objeto, ""),
    valor: conservar<number>(contrato.valor, existente?.valor, 0),
    moneda: conservar<Moneda>(contrato.moneda, existente?.moneda, "COP"),
    fecha_inicio: conservar(contrato.fecha_inicio, existente?.fecha_inicio, ""),
    fecha_fin: conservar(contrato.fecha_fin, existente?.fecha_fin, ""),
    requiere_poliza: poliza,
    tipo_poliza: tipos,
    estado_poliza: estado,
    comercial: conservar(contrato.comercial, existente?.comercial, ""),
    ruta_sharepoint: datos.rutaRelativa,
    fecha_registro: datos.hoy,
    fuente: "buzon" as Fuente,
  }

  const faltantes = OBLIGATORIOS.filter((campo) => {
    const valor = fila[campo]
    return typeof valor === "string" && valor.trim() === ""
  })
  if (faltantes.length > 0) {
    return {
      ok: false,
      error: `no se puede escribir la fila de ${datos.idContrato}: faltan ${faltantes.join(", ")}`,
    }
  }
  return { ok: true, data: fila }
}

/**
 * Aplica la fila al conjunto: reemplaza la existente (misma clave de contrato) o
 * la añade al final. El orden del maestro se respeta para que el archivo siga
 * siendo reconocible.
 */
export function aplicarFila(
  filas: readonly FilaMaestro[],
  fila: FilaMaestro,
  existente: FilaMaestro | null,
): FilaMaestro[] {
  if (existente === null) return [...filas, fila]
  const clave = claveContrato(existente.id_contrato)
  return filas.map((actual) => (claveContrato(actual.id_contrato) === clave ? fila : actual))
}

/** Número definitivo del contrato: el del documento, el referenciado o uno automático. */
export function resolverId(
  contrato: Contrato,
  maestro: Maestro,
  ctx: ContextoClasificacion,
): string {
  return idParaRegistrar(contrato, maestro, anioDeReferencia(contrato, ctx.hoy))
}
