/**
 * Archivado del documento en la estructura tipo SharePoint (HU-4).
 *
 * Destino: `out/sharepoint/Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>`
 *
 * Dos cosas que se cuidan aquí:
 *   · la ruta **relativa** es la que se guarda en la fila del maestro (es lo que
 *     ve un humano buscando el contrato en SharePoint);
 *   · la ruta **absoluta** se comprueba antes de copiar: siempre dentro de
 *     `Contratos/`, aunque el slug o el id vinieran raros.
 */
import fs from "node:fs"
import path from "node:path"
import { slugCliente } from "./identificadores.ts"
import type { Contrato, Resultado } from "./tipos.ts"

/** Nombre de la carpeta raíz del archivo dentro de `out/sharepoint/`. */
export const CARPETA_ARCHIVO = "Contratos"

/** Extensión del documento tal como llegó (`.txt`, `.pdf`…). */
export function extensionDe(archivo: string): string {
  const extension = path.extname(archivo)
  return extension === "" ? ".txt" : extension.toLowerCase()
}

/** Destino calculado, en sus dos formas. */
export interface DestinoArchivo {
  /** Relativa a `sharepoint/`: la que se guarda en la fila. */
  rutaRelativa: string
  /** Absoluta, dentro de `out/sharepoint/`, la que se usa para copiar. */
  rutaAbsoluta: string
}

/**
 * Calcula dónde va el contrato archivado.
 *
 * El año es el de inicio de la vigencia (así lo hace el maestro que entregó
 * Periferia: `Contratos/2026/<cliente>/<id>.pdf`), y si la fecha no se conoce se
 * usa el año de referencia que se pase.
 */
export function calcularDestino(
  dirArchivo: string,
  contrato: Contrato,
  idContrato: string,
  archivoOriginal: string,
  anio: string,
): Resultado<DestinoArchivo> {
  const cliente = contrato.cliente ?? ""
  const slug = slugCliente(cliente)
  if (slug === "") {
    return { ok: false, error: `no se pudo derivar la carpeta del cliente desde "${cliente}"` }
  }
  if (idContrato.trim() === "") {
    return { ok: false, error: "no hay número de contrato para nombrar el archivo" }
  }

  const anioVigencia = contrato.fecha_inicio !== null && /^\d{4}/.test(contrato.fecha_inicio)
    ? contrato.fecha_inicio.slice(0, 4)
    : anio

  const partes = [CARPETA_ARCHIVO, anioVigencia, slug]
  const nombreArchivo = `${idContrato}${extensionDe(archivoOriginal)}`
  const rutaRelativa = [...partes, nombreArchivo].join("/")

  const raiz = path.resolve(path.dirname(dirArchivo))
  const absoluta = path.resolve(dirArchivo, anioVigencia, slug, nombreArchivo)
  if (!absoluta.startsWith(raiz + path.sep)) {
    return { ok: false, error: `ruta de archivo fuera de out/sharepoint: ${rutaRelativa}` }
  }
  return { ok: true, data: { rutaRelativa, rutaAbsoluta: absoluta } }
}

/** Copia el documento (que está en los fixtures, de solo lectura) al destino. */
export function archivar(origen: string, destino: DestinoArchivo): Resultado<string> {
  try {
    fs.mkdirSync(path.dirname(destino.rutaAbsoluta), { recursive: true })
  } catch {
    return { ok: false, error: `no se pudo crear la carpeta de ${destino.rutaRelativa}` }
  }
  try {
    fs.copyFileSync(origen, destino.rutaAbsoluta)
    return { ok: true, data: destino.rutaRelativa }
  } catch {
    return { ok: false, error: `no se pudo archivar el documento en ${destino.rutaRelativa}` }
  }
}
