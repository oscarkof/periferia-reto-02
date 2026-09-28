/**
 * Las cinco herramientas del contrato (PRD §6.2).
 *
 * El nombre que ve el modelo es `<archivo>_<export>`: `contratos_leer_buzon`,
 * `contratos_extraer`, `contratos_validar`, `contratos_registrar` y
 * `contratos_alertas`. Son la **única** superficie que el modelo puede llamar y
 * la única fuente de valores que puede afirmar (CA2).
 *
 * Dos reglas que se cumplen en todas:
 *   · `execute` devuelve **string JSON** `{ ok, data | error }` y **nunca lanza**;
 *   · toda llamada queda en `out/log.jsonl` con su resumen (RN7 · CA4).
 *
 * `demo.ts` las usa directamente, sin modelo ni servidor (PRD §6.6).
 */
import { z } from "zod"
import { adjuntoContrato, leerMensaje, listarBuzon } from "../core/buzon.ts"
import { escribirAlertas, generarAlertas } from "../core/alertas.ts"
import { archivar, calcularDestino } from "../core/archivado.ts"
import { clasificar, rechazar } from "../core/clasificacion.ts"
import { anexarCambio, marcarProcesado } from "../core/historial.ts"
import { buscarPorContrato, guardarMaestro } from "../core/maestro.ts"
import { validarFecha } from "../core/normalizacion.ts"
import { aplicarFila, construirFila, resolverId } from "../core/registro.ts"
import type {
  AccionRegistro,
  Contrato,
  EntradaHistorial,
  MensajeResumen,
  Resultado,
  ResultadoRegistro,
  ResultadoValidacion,
} from "../core/tipos.ts"
import { nombreHerramienta, type Herramienta } from "./contrato.ts"
import {
  auditarContrato,
  cargarTodo,
  completarContrato,
  conRegistro,
  esquemaContrato,
  extraccionDe,
  mensajeConTexto,
  type ContextoTrabajo,
} from "./contexto.ts"
import path from "node:path"

/** Nombre visible de cada herramienta, derivado de archivo y export. */
export const NOMBRES = {
  leer_buzon: nombreHerramienta("contratos", "leer_buzon"),
  extraer: nombreHerramienta("contratos", "extraer"),
  validar: nombreHerramienta("contratos", "validar"),
  registrar: nombreHerramienta("contratos", "registrar"),
  alertas: nombreHerramienta("contratos", "alertas"),
} as const

// ── contratos_leer_buzon (HU-1) ─────────────────────────────────────────────

const argsLeerBuzon = z.object({})

export const leer_buzon: Herramienta<typeof argsLeerBuzon> = {
  description:
    "Lista los mensajes del buzón de contratos que aún no se han procesado, con sus adjuntos y si traen contrato.",
  args: argsLeerBuzon,

  async execute(_argumentos, ctx): Promise<string> {
    return conRegistro(
      NOMBRES.leer_buzon,
      ctx,
      null,
      (): Resultado<{ mensajes: MensajeResumen[] }> => {
        const trabajo = cargarTodo(ctx)
        if (!trabajo.ok) return trabajo

        const listado = listarBuzon(trabajo.data.entorno.buzon)
        if (!listado.ok) return listado

        const mensajes: MensajeResumen[] = listado.data
          .filter((mensaje) => !trabajo.data.procesados.includes(mensaje.id))
          .map((mensaje) => ({
            id: mensaje.id,
            de: mensaje.de,
            asunto: mensaje.asunto,
            fecha: mensaje.fecha,
            adjuntos: mensaje.adjuntos,
            tiene_contrato:
              adjuntoContrato(mensaje, path.join(trabajo.data.entorno.buzon, mensaje.id)) !== null,
            procesado: false,
          }))

        return { ok: true, data: { mensajes } }
      },
      (data) =>
        `${data.mensajes.length} mensaje(s) sin procesar · con contrato: ${data.mensajes.filter((m) => m.tiene_contrato).length}`,
    )
  },
}

// ── contratos_extraer (HU-2) ────────────────────────────────────────────────

const argsExtraer = z.object({
  mensaje_id: z.string().describe("Id del mensaje del buzón, por ejemplo msg-001"),
})

export const extraer: Herramienta<typeof argsExtraer> = {
  description:
    "Lee el contrato adjunto de un mensaje y devuelve sus campos con la confianza de cada uno y la evidencia en que se apoya.",
  args: argsExtraer,

  async execute(argumentos, ctx): Promise<string> {
    return conRegistro(
      NOMBRES.extraer,
      ctx,
      argumentos.mensaje_id,
      () => {
        const trabajo = cargarTodo(ctx)
        if (!trabajo.ok) return trabajo
        const extraccion = extraccionDe(trabajo.data, argumentos.mensaje_id)
        if (!extraccion.ok) return extraccion
        return { ok: true, data: extraccion.data }
      },
      (data) => {
        const valores = Object.values(data.confianza)
        const minima = valores.length === 0 ? 0 : Math.min(...valores)
        return `contrato ${data.contrato.id_contrato ?? "(sin número)"} · confianza mínima ${minima.toFixed(2)}`
      },
    )
  },
}

// ── contratos_validar (HU-3 · RN1-RN5) ─────────────────────────────────────

const argsValidar = z.object({
  mensaje_id: z.string().describe("Id del mensaje del buzón, por ejemplo msg-001"),
  contrato: esquemaContrato
    .optional()
    .describe("Contrato propuesto por el modelo; se audita contra el documento antes de usarlo"),
})

/** Texto comparable de un valor del contrato, para detectar alteraciones. */
function textoDe(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  if (Array.isArray(valor)) return valor.join(";")
  if (typeof valor === "boolean") return valor ? "true" : "false"
  return String(valor)
}

/** Campos en los que la propuesta del modelo discrepa del documento. */
function camposAlterados(recibido: Contrato, autoritativo: Contrato): string[] {
  const auditables = [
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
    "comercial",
  ] as const
  const alterados: string[] = []
  for (const campo of auditables) {
    if (recibido[campo] === null) continue
    if (textoDe(recibido[campo]) !== textoDe(autoritativo[campo])) alterados.push(campo)
  }
  return alterados
}

/**
 * Clasifica un mensaje y, si el modelo propuso un contrato, **audita la propuesta**.
 *
 * La clasificación se calcula siempre sobre lo que dice el documento. Lo que el
 * modelo proponga solo puede **añadir** campos a revisión, nunca cambiar el
 * resultado: es la mitigación del riesgo «el modelo redondea el valor» (PRD §10).
 */
export function validarContrato(
  trabajo: ContextoTrabajo,
  mensajeId: string,
  propuesto?: z.infer<typeof esquemaContrato>,
): Resultado<ResultadoValidacion> {
  const mensaje = leerMensaje(trabajo.entorno.buzon, mensajeId)
  if (!mensaje.ok) return mensaje

  const extraccion = extraccionDe(trabajo, mensajeId)
  // Un mensaje que existe pero no trae contrato no es un error del sistema: es un
  // rechazo con motivo (RN4), y así se reporta.
  if (!extraccion.ok) return { ok: true, data: rechazar(mensajeId, extraccion.error) }

  const validacion = clasificar(extraccion.data, trabajo.maestro, {
    hoy: trabajo.entorno.hoy,
    remitente: mensaje.data.de,
  })

  if (propuesto !== undefined) {
    const recibido = completarContrato(propuesto)
    const avisos = auditarContrato(recibido, extraccion.data.contrato)
    if (avisos.length > 0) {
      validacion.avisos.push(...avisos)
      for (const campo of camposAlterados(recibido, extraccion.data.contrato)) {
        if (validacion.requiere_revision.includes(campo)) continue
        validacion.requiere_revision.push(campo)
        validacion.motivos.push(
          `${campo}: el valor propuesto no coincide con el documento (manda el documento)`,
        )
      }
    }
  }
  return { ok: true, data: validacion }
}

export const validar: Herramienta<typeof argsValidar> = {
  description:
    "Clasifica el contrato de un mensaje (nuevo, actualización, duplicado o rechazado) y dice qué campos exigen confirmación humana.",
  args: argsValidar,

  async execute(argumentos, ctx): Promise<string> {
    return conRegistro(
      NOMBRES.validar,
      ctx,
      argumentos.mensaje_id,
      () => {
        const trabajo = cargarTodo(ctx)
        if (!trabajo.ok) return trabajo
        return validarContrato(trabajo.data, argumentos.mensaje_id, argumentos.contrato)
      },
      (data) =>
        data.clasificacion +
        (data.requiere_revision.length === 0 ? "" : ` · revisión: ${data.requiere_revision.join(", ")}`),
    )
  },
}

// ── contratos_registrar (HU-4 · RN5) ───────────────────────────────────────

const argsRegistrar = z.object({
  mensaje_id: z.string().describe("Id del mensaje del buzón"),
  contrato: esquemaContrato.optional().describe("Contrato a registrar; lo no enviado se relee del documento"),
  confirmado: z
    .boolean()
    .optional()
    .describe("true solo si el humano confirmó los campos que estaban en revisión"),
})

/**
 * Escribe la fila en el maestro, archiva el documento, deja la línea del
 * historial y marca el mensaje como procesado.
 *
 * El orden de las comprobaciones es el de las reglas del PRD: RN4 (¿es un
 * contrato?) → RN5 (¿está confirmado lo dudoso?) → RN1 (¿ya está?) → escribir.
 * El número de contrato también sale del documento, no de lo que proponga el modelo.
 */
export function registrarContrato(
  trabajo: ContextoTrabajo,
  mensajeId: string,
  propuesto: z.infer<typeof esquemaContrato> | undefined,
  confirmado: boolean,
): Resultado<ResultadoRegistro> {
  const validacion = validarContrato(trabajo, mensajeId, propuesto)
  if (!validacion.ok) return validacion

  const leido = mensajeConTexto(trabajo, mensajeId)
  if (!leido.ok) return leido

  if (validacion.data.clasificacion === "rechazado") {
    return {
      ok: false,
      error: `no se puede registrar: ${validacion.data.motivo_rechazo ?? "documento sin contrato identificable"}`,
    }
  }
  // RN5: lo dudoso no se escribe sin confirmación explícita del humano.
  if (validacion.data.requiere_revision.length > 0 && !confirmado) {
    return {
      ok: false,
      error: `requiere revisión antes de registrar: ${validacion.data.requiere_revision.join(", ")}`,
    }
  }

  const extraccion = extraccionDe(trabajo, mensajeId)
  if (!extraccion.ok) return extraccion

  const existente =
    validacion.data.id_contrato_existente === null
      ? null
      : buscarPorContrato(trabajo.maestro, validacion.data.id_contrato_existente)

  // RN1: está ya, tal cual. No se escribe nada, pero sí se marca como procesado.
  if (validacion.data.clasificacion === "duplicado" && existente !== null) {
    marcarProcesado(trabajo.entorno.procesados, mensajeId)
    return {
      ok: true,
      data: {
        id_contrato: existente.id_contrato,
        accion: "sin_cambios",
        ruta_archivo: existente.ruta_sharepoint,
        diferencias: [],
      },
    }
  }

  const idContrato = resolverId(extraccion.data.contrato, trabajo.maestro, {
    hoy: trabajo.entorno.hoy,
    remitente: leido.data.mensaje.de,
  })
  const destino = calcularDestino(
    trabajo.entorno.archivo,
    extraccion.data.contrato,
    idContrato,
    leido.data.archivo,
    trabajo.entorno.hoy.slice(0, 4),
  )
  if (!destino.ok) return destino

  const fila = construirFila(extraccion.data.contrato, existente, {
    idContrato,
    rutaRelativa: destino.data.rutaRelativa,
    hoy: trabajo.entorno.hoy,
  })
  if (!fila.ok) return fila

  const origen = path.join(trabajo.entorno.buzon, mensajeId, leido.data.archivo)
  const copiado = archivar(origen, destino.data)
  if (!copiado.ok) return copiado

  const guardado = guardarMaestro(
    trabajo.entorno.maestro,
    aplicarFila(trabajo.maestro.filas, fila.data, existente),
  )
  if (!guardado.ok) return guardado

  const accion: AccionRegistro = existente === null ? "insertado" : "actualizado"
  const entrada: EntradaHistorial = {
    ts: new Date().toISOString(),
    id_contrato: fila.data.id_contrato,
    accion,
    cambios: validacion.data.diferencias,
    mensaje_id: mensajeId,
  }
  const historial = anexarCambio(trabajo.entorno.historial, entrada)
  if (!historial.ok) return historial

  marcarProcesado(trabajo.entorno.procesados, mensajeId)
  return {
    ok: true,
    data: {
      id_contrato: fila.data.id_contrato,
      accion,
      ruta_archivo: destino.data.rutaRelativa,
      diferencias: validacion.data.diferencias,
    },
  }
}

export const registrar: Herramienta<typeof argsRegistrar> = {
  description:
    "Registra el contrato en el maestro y archiva el documento; se niega si hay campos en revisión y no llega confirmado=true.",
  args: argsRegistrar,

  async execute(argumentos, ctx): Promise<string> {
    return conRegistro(
      NOMBRES.registrar,
      ctx,
      argumentos.mensaje_id,
      () => {
        const trabajo = cargarTodo(ctx)
        if (!trabajo.ok) return trabajo
        return registrarContrato(
          trabajo.data,
          argumentos.mensaje_id,
          argumentos.contrato,
          argumentos.confirmado ?? false,
        )
      },
      (data) => `${data.accion} ${data.id_contrato} → ${data.ruta_archivo}`,
    )
  },
}

// ── contratos_alertas (HU-5) ───────────────────────────────────────────────

const argsAlertas = z.object({
  hoy: z.string().describe("Fecha de referencia en formato AAAA-MM-DD, por ejemplo 2026-09-03"),
})

export const alertas: Herramienta<typeof argsAlertas> = {
  description:
    "Genera out/alertas.md con los contratos que vencen en 60 días, las pólizas pendientes y lo registrado desde el corte.",
  args: argsAlertas,

  async execute(argumentos, ctx): Promise<string> {
    return conRegistro(
      NOMBRES.alertas,
      ctx,
      null,
      () => {
        const fecha = validarFecha(argumentos.hoy, "hoy")
        if (!fecha.ok) return fecha

        const trabajo = cargarTodo(ctx)
        if (!trabajo.ok) return trabajo

        const reporte = generarAlertas(trabajo.data.maestro.filas, fecha.data)
        const escrito = escribirAlertas(reporte, trabajo.data.entorno.alertas)
        if (!escrito.ok) return escrito

        return { ok: true, data: { ...reporte, ruta: escrito.data } }
      },
      (data) =>
        `alertas: ${data.vencen.length} por vencer · ${data.polizas_pendientes.length} póliza(s) pendiente(s) · ${data.registrados_desde_corte.length} registrado(s) desde el corte`,
    )
  },
}

/** Las cinco herramientas, en el orden en que las usa un turno típico. */
export const HERRAMIENTAS = [leer_buzon, extraer, validar, registrar, alertas] as const



