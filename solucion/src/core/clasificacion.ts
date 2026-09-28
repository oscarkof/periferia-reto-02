/**
 * Clasificación del mensaje y detección de lo que exige revisión humana
 * (HU-3 · RN1-RN5).
 *
 * Este módulo es el guardián del objetivo O2 —«no corromper el maestro»— y tiene
 * tres reglas que se sostienen solas:
 *
 * 1. **El dedupe va por número de contrato primero** (RN1 · RN2). El nombre del
 *    cliente solo entra cuando el número no resuelve, y con umbral de similitud.
 * 2. **`null` significa «el documento no lo dice»**: en una actualización eso es
 *    «conservar el valor del maestro», no borrarlo ni escribirlo vacío.
 * 3. **Lo que bloquea y lo que solo se avisa son cosas distintas**: un remitente
 *    desconocido se reporta (PRD §5 HU-3) pero no detiene el registro; un valor
 *    por debajo del umbral sí lo detiene (RN5).
 */
import { buscarPorContrato, candidatoPorCliente, claveContrato, siguienteAuto, type Maestro } from "./maestro.ts"
import { comparable, formatearFecha } from "./normalizacion.ts"
import type {
  CampoContrato,
  Contrato,
  Diferencia,
  Extraccion,
  FilaMaestro,
  ResultadoValidacion,
} from "./tipos.ts"

/** Umbral de confianza: por debajo, el campo exige confirmación humana (RN5). */
export const UMBRAL_CONFIANZA = 0.8

/** Similitud mínima de objeto para sospechar una actualización por cliente (RN2). */
export const SIMILITUD_MINIMA = 0.9

/** Campos que una fila del maestro necesita para ser útil. */
const OBLIGATORIOS: readonly CampoContrato[] = [
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
]

/** Campos que se avisan pero no bloquean (HU-3). */
const AVISABLES: readonly CampoContrato[] = ["id_contrato", "comercial"]

/** Texto comparable de un valor del contrato, para listar diferencias. */
function aTexto(valor: string | number | boolean | null): string {
  if (valor === null) return ""
  if (typeof valor === "boolean") return valor ? "true" : "false"
  return String(valor)
}

/**
 * Diferencias entre la fila del maestro y el contrato entrante.
 *
 * Solo se comparan los campos que el documento **sí** trae: un `null` en la
 * extracción no es un cambio, es «sin información» (y el registro conserva).
 */
export function diferenciasCon(fila: FilaMaestro, contrato: Contrato): Diferencia[] {
  const diferencias: Diferencia[] = []
  const anotar = (campo: string, antes: string, despues: string): void => {
    if (antes !== despues) diferencias.push({ campo, antes, despues })
  }
  /**
   * Los campos de texto se comparan **normalizados**: que el documento escriba
   * «MINERA LOS ANDES S.A.C.» y el maestro «Minera Los Andes S.A.C.» no es un
   * cambio de contrato, es la misma razón social. Cuando sí cambian, la
   * diferencia se reporta con su escritura original, que es la que el humano
   * necesita ver.
   */
  const anotarTexto = (campo: string, antes: string, despues: string): void => {
    if (comparable(antes) !== comparable(despues)) diferencias.push({ campo, antes, despues })
  }

  if (contrato.cliente !== null) anotarTexto("cliente", fila.cliente, contrato.cliente)
  if (contrato.nit_cliente !== null) anotar("nit_cliente", fila.nit_cliente, contrato.nit_cliente)
  if (contrato.pais !== null) anotar("pais", fila.pais, contrato.pais)
  if (contrato.objeto !== null) anotarTexto("objeto", fila.objeto, contrato.objeto)
  if (contrato.valor !== null) anotar("valor", String(fila.valor), String(contrato.valor))
  if (contrato.moneda !== null) anotar("moneda", fila.moneda, contrato.moneda)
  if (contrato.fecha_inicio !== null) anotar("fecha_inicio", fila.fecha_inicio, contrato.fecha_inicio)
  if (contrato.fecha_fin !== null) anotar("fecha_fin", fila.fecha_fin, contrato.fecha_fin)
  if (contrato.requiere_poliza !== null) {
    anotar("requiere_poliza", aTexto(fila.requiere_poliza), aTexto(contrato.requiere_poliza))
  }
  if (contrato.requiere_poliza === true && contrato.tipo_poliza.length > 0) {
    anotar("tipo_poliza", fila.tipo_poliza, contrato.tipo_poliza.join(";"))
  }
  if (contrato.estado_poliza !== null) anotar("estado_poliza", fila.estado_poliza, contrato.estado_poliza)
  if (contrato.comercial !== null) anotar("comercial", fila.comercial, contrato.comercial)

  return diferencias
}

/**
 * Número de contrato que quedará registrado: el del documento o uno automático
 * `AUTO-<año>-<secuencia>` cuando el documento no lo trae (PRD §7.2).
 */
export function idParaRegistrar(contrato: Contrato, maestro: Maestro, anio: string): string {
  if (contrato.id_contrato !== null && contrato.id_contrato.trim() !== "") return contrato.id_contrato
  const candidato = claveContrato(contrato.id_contrato_referenciado ?? "")
  if (candidato !== "" && maestro.porContrato.has(candidato)) {
    const fila = maestro.porContrato.get(candidato)
    if (fila !== undefined) return fila.id_contrato
  }
  return siguienteAuto(maestro.filas, anio)
}

/** Año con el que se numeran los contratos automáticos: el de inicio, o el de hoy. */
export function anioDeReferencia(contrato: Contrato, hoy: string): string {
  const inicio = contrato.fecha_inicio
  if (inicio !== null && /^\d{4}/.test(inicio)) return inicio.slice(0, 4)
  const validada = formatearFecha({
    dia: Number(hoy.slice(8, 10)),
    mes: Number(hoy.slice(5, 7)),
    anio: Number(hoy.slice(0, 4)),
  })
  return validada === null ? "1970" : validada.slice(0, 4)
}

// ── Rechazo (RN4) ──────────────────────────────────────────────────────────

/** Resultado para un mensaje que no trae contrato: no se escribe nada (RN4). */
export function rechazar(mensajeId: string, motivo: string): ResultadoValidacion {
  return {
    mensaje_id: mensajeId,
    clasificacion: "rechazado",
    id_contrato_existente: null,
    requiere_revision: [],
    motivos: [],
    diferencias: [],
    motivo_rechazo: motivo,
    avisos: [],
  }
}

// ── Clasificación ──────────────────────────────────────────────────────────

/** Lo que la clasificación necesita saber del contexto del turno. */
export interface ContextoClasificacion {
  /** Fecha de referencia `YYYY-MM-DD` (para numerar los contratos automáticos). */
  hoy: string
  /** Correo de quien envió el mensaje, para el aviso de comercial desconocido. */
  remitente: string
}

/** Valor extraído de un campo del contrato (obligatorio o avisable). */
function valorDe(contrato: Contrato, campo: CampoContrato): string | number | null {
  switch (campo) {
    case "id_contrato":
      return contrato.id_contrato
    case "cliente":
      return contrato.cliente
    case "nit_cliente":
      return contrato.nit_cliente
    case "pais":
      return contrato.pais
    case "objeto":
      return contrato.objeto
    case "valor":
      return contrato.valor
    case "moneda":
      return contrato.moneda
    case "fecha_inicio":
      return contrato.fecha_inicio
    case "fecha_fin":
      return contrato.fecha_fin
    case "comercial":
      return contrato.comercial
    default:
      return null
  }
}

/**
 * Clasifica el contrato y decide qué exige confirmación humana (RN1–RN5).
 *
 * El orden de las preguntas es el del PRD y no es casual:
 * ¿es un contrato? (RN4) → ¿ya está, idéntico? (RN1) → ¿modifica algo? (RN2) →
 * es nuevo (RN3). Y solo después de saber **qué** es, se mira **cuánto se duda**.
 */
export function clasificar(
  extraccion: Extraccion,
  maestro: Maestro,
  ctx: ContextoClasificacion,
): ResultadoValidacion {
  const { contrato, confianza } = extraccion
  const avisos: string[] = []

  // RN4: sin partes no hay contrato que registrar.
  if (contrato.cliente === null) {
    return rechazar(
      extraccion.mensaje_id,
      "el documento no permite identificar las partes (RN4): se revisa a mano",
    )
  }
  // Un **otrosí** es la excepción al objeto: no lo describe, modifica el de un
  // contrato que ya está en el maestro. Rechazarlo por «sin objeto» perdería la
  // actualización, así que aquí solo se exige el objeto a los contratos.
  if (contrato.objeto === null && !contrato.es_otrosi) {
    return rechazar(
      extraccion.mensaje_id,
      "el documento no permite identificar el objeto (RN4): se revisa a mano",
    )
  }

  const porNumero =
    contrato.id_contrato === null ? null : buscarPorContrato(maestro, contrato.id_contrato)
  const candidato = porNumero === null ? candidatoPorCliente(maestro, contrato.nit_cliente, contrato.objeto) : null
  const porCliente = candidato !== null && candidato.similitud >= SIMILITUD_MINIMA ? candidato.fila : null
  const existente = porNumero ?? porCliente

  let clasificacion: "nuevo" | "actualizacion" | "duplicado"
  let diferencias: Diferencia[] = []

  if (existente !== null) {
    // RN1: mismo número y mismos valor, inicio y fin → está ya, tal cual.
    const mismoValor = contrato.valor === null || contrato.valor === existente.valor
    const mismoInicio = contrato.fecha_inicio === null || contrato.fecha_inicio === existente.fecha_inicio
    const mismoFin = contrato.fecha_fin === null || contrato.fecha_fin === existente.fecha_fin
    if (porNumero !== null && mismoValor && mismoInicio && mismoFin) {
      clasificacion = "duplicado"
      avisos.push(
        `${existente.id_contrato} ya está en el maestro con el mismo valor y el mismo plazo: no se escribió nada`,
      )
    } else {
      clasificacion = "actualizacion" // RN2
      diferencias = diferenciasCon(existente, contrato)
      if (porCliente !== null) {
        avisos.push(
          `se parece a ${porCliente.id_contrato} (similitud ${candidato?.similitud.toFixed(2) ?? "0"}): se trata como actualización`,
        )
      }
    }
  } else {
    clasificacion = "nuevo" // RN3
  }

  // ── RN5: qué exige confirmación humana ──
  const requiere_revision: string[] = []
  const motivos: string[] = []
  const agregar = (campo: string, motivo: string): void => {
    if (requiere_revision.includes(campo)) return
    requiere_revision.push(campo)
    motivos.push(motivo)
  }

  if (clasificacion === "nuevo") {
    for (const campo of OBLIGATORIOS) {
      const valor = valorDe(contrato, campo)
      if (valor === null || valor === "") {
        // Un otrosí no trae objeto, valor ni moneda: no describe un contrato, lo
        // modifica. Si además su contrato original no está en el maestro, la fila
        // que se crearía tendría huecos, y eso lo decide una persona. El motivo lo
        // dice con esas palabras para que el chat no suene a error del sistema.
        agregar(
          campo,
          contrato.es_otrosi
            ? `el otrosí no trae ${campo} y su contrato original no está en el maestro: hay que completarlo`
            : `no se encontró ${campo} en el documento`,
        )
      } else if (confianza[campo] < UMBRAL_CONFIANZA) {
        agregar(campo, `${campo} = ${valor} con confianza ${confianza[campo].toFixed(2)}`)
      }
    }
  } else if (clasificacion === "actualizacion") {
    for (const diferencia of diferencias) {
      const campo = diferencia.campo as CampoContrato
      const c = confianza[campo]
      if (c !== undefined && c < UMBRAL_CONFIANZA) {
        agregar(
          diferencia.campo,
          `${diferencia.campo}: ${diferencia.antes} → ${diferencia.despues} con confianza ${c.toFixed(2)}`,
        )
      }
    }
  }

  // ── Avisos: se reportan, no bloquean (HU-3) ──
  // Recorrer `AVISABLES` mantiene en un solo sitio la lista de campos que no
  // detienen el registro, y obliga a darle un mensaje a cada uno.
  for (const campo of AVISABLES) {
    const valor = valorDe(contrato, campo)
    if (valor !== null && String(valor).trim() !== "") continue
    if (campo === "comercial") {
      avisos.push(
        `el remitente ${ctx.remitente} no está en comerciales.json: se registra sin comercial asignado`,
      )
    }
    if (campo === "id_contrato" && clasificacion === "nuevo") {
      avisos.push(
        `el documento no trae número de contrato: se asignará ${idParaRegistrar(contrato, maestro, anioDeReferencia(contrato, ctx.hoy))}`,
      )
    }
  }
  if (contrato.valor_indeterminado) {
    avisos.push("contrato por demanda: el valor se registra como 0 y conviene confirmarlo")
  }
  // El maestro admite 200 caracteres de objeto (PRD §7.2): si el documento trae
  // más, se recorta y se avisa. No es una duda de lectura, es un límite de formato.
  if (contrato.objeto !== null && contrato.objeto.length >= 199) {
    avisos.push("el objeto se recortó al límite de 200 caracteres del maestro")
  }
  if (contrato.es_otrosi && porNumero === null) {
    agregar(
      "id_contrato",
      `el otrosí modifica ${contrato.id_contrato_referenciado ?? "un contrato"} que no está en el maestro: confirmar antes de crear la fila`,
    )
  }

  return {
    mensaje_id: extraccion.mensaje_id,
    clasificacion,
    id_contrato_existente: existente?.id_contrato ?? null,
    requiere_revision,
    motivos,
    diferencias,
    motivo_rechazo: null,
    avisos,
  }
}

