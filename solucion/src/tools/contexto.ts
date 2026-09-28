/**
 * Contexto compartido por las herramientas de contratos.
 *
 * Aquí vive lo que las cinco herramientas necesitan por igual: resolver el
 * entorno desde `ctx.directory` (PRD §6.2), cargar de una vez el maestro y los
 * comerciales, leer un mensaje con su documento, registrar cada ejecución
 * (RN7 · CA4) y **auditar** el contrato que devuelve el modelo.
 *
 * La auditoría es la salvaguarda anti-alucinación del PRD (CA2): el modelo puede
 * proponer un contrato con valores «arreglados» y el sistema **no los usa**.
 * `contratos_validar` vuelve a extraer del documento y compara campo por campo,
 * y lo que no coincida entra en revisión en vez de registrarse.
 */
import path from "node:path"
import { z } from "zod"
import { adjuntoContrato, leerAdjunto, leerMensaje } from "../core/buzon.ts"
import { cargarComerciales, resolverComercial, type Comercial } from "../core/comerciales.ts"
import { crearEntorno, type Entorno } from "../core/entorno.ts"
import { extraerContrato, type ContextoExtraccion } from "../core/extraccion.ts"
import { leerProcesados } from "../core/historial.ts"
import { registrar } from "../core/log.ts"
import { cargarMaestro, type Maestro } from "../core/maestro.ts"
import type { CampoContrato, Contrato, Extraccion, Mensaje, Resultado } from "../core/tipos.ts"
import { exito, fallo, type ContextoHerramienta } from "./contrato.ts"

/**
 * Esquema del contrato que puede enviar el modelo en `validar` y `registrar`.
 *
 * Todo es opcional salvo el mensaje: el modelo puede proponer unos campos y el
 * resto se rellena con lo que dice el documento. Lo que **sí** envía se audita.
 */
export const esquemaContrato = z.object({
  id_contrato: z.string().nullable().optional().describe("Número de contrato tal como aparece en el documento"),
  cliente: z.string().nullable().optional().describe("Razón social de la contraparte"),
  nit_cliente: z.string().nullable().optional().describe("Identificador tributario sin puntos ni dígito de verificación"),
  pais: z.enum(["CO", "EC", "PE", "PA", "HN"]).nullable().optional(),
  objeto: z.string().nullable().optional().describe("Objeto del contrato, máximo 200 caracteres"),
  valor: z.number().nullable().optional().describe("Valor sin separadores; 0 si el contrato es por demanda"),
  valor_indeterminado: z.boolean().optional().describe("true cuando el contrato no fija un valor"),
  moneda: z.enum(["COP", "USD", "PEN", "PAB", "HNL"]).nullable().optional(),
  fecha_inicio: z.string().nullable().optional().describe("Fecha de inicio en formato AAAA-MM-DD"),
  fecha_fin: z.string().nullable().optional().describe("Fecha de fin en formato AAAA-MM-DD"),
  requiere_poliza: z.boolean().nullable().optional(),
  tipo_poliza: z.array(z.string()).optional().describe("Tipos de póliza del contrato"),
  estado_poliza: z.enum(["vigente", "pendiente", "vencida", "no_aplica"]).nullable().optional(),
  comercial: z.string().nullable().optional().describe("Nombre del comercial resuelto desde comerciales.json"),
  es_otrosi: z.boolean().optional(),
  id_contrato_referenciado: z.string().nullable().optional(),
})

/** Contrato tal como llega del modelo: todos los campos pueden faltar. */
export type ContratoParcial = z.infer<typeof esquemaContrato>

/** Rellena los huecos de un contrato parcial para poder auditarlo. */
export function completarContrato(parcial: ContratoParcial): Contrato {
  return {
    id_contrato: parcial.id_contrato ?? null,
    cliente: parcial.cliente ?? null,
    nit_cliente: parcial.nit_cliente ?? null,
    pais: parcial.pais ?? null,
    objeto: parcial.objeto ?? null,
    valor: parcial.valor ?? null,
    valor_indeterminado: parcial.valor_indeterminado ?? false,
    moneda: parcial.moneda ?? null,
    fecha_inicio: parcial.fecha_inicio ?? null,
    fecha_fin: parcial.fecha_fin ?? null,
    requiere_poliza: parcial.requiere_poliza ?? null,
    tipo_poliza: parcial.tipo_poliza ?? [],
    estado_poliza: parcial.estado_poliza ?? null,
    comercial: parcial.comercial ?? null,
    es_otrosi: parcial.es_otrosi ?? false,
    id_contrato_referenciado: parcial.id_contrato_referenciado ?? null,
  }
}

/** Todo lo que hace falta para operar sobre el buzón. */
export interface ContextoTrabajo {
  entorno: Entorno
  maestro: Maestro
  comerciales: Comercial[]
  /** Mensajes ya resueltos en ejecuciones anteriores (idempotencia, HU-1). */
  procesados: string[]
}

/** Construye el entorno desde `ctx.directory` y carga maestro y comerciales (RN6). */
export function cargarTodo(ctx: ContextoHerramienta): Resultado<ContextoTrabajo> {
  const entorno = crearEntorno(ctx.directory, { sesion: ctx.sessionId })
  if (!entorno.ok) return entorno

  const maestro = cargarMaestro(entorno.data.maestroFixture, entorno.data.maestro)
  if (!maestro.ok) return maestro

  const comerciales = cargarComerciales(entorno.data.comerciales)
  if (!comerciales.ok) return comerciales

  const procesados = leerProcesados(entorno.data.procesados)
  if (!procesados.ok) return procesados

  return {
    ok: true,
    data: {
      entorno: entorno.data,
      maestro: maestro.data,
      comerciales: comerciales.data,
      procesados: procesados.data,
    },
  }
}

// ── Lectura del mensaje y su documento ─────────────────────────────────────

/** Mensaje del buzón con el texto de su adjunto de contrato. */
export interface MensajeConTexto {
  mensaje: Mensaje
  archivo: string
  texto: string
}

/** Lee un mensaje del buzón y el texto del documento que trae (o explica por qué no). */
export function mensajeConTexto(trabajo: ContextoTrabajo, mensajeId: string): Resultado<MensajeConTexto> {
  const { entorno } = trabajo
  const mensaje = leerMensaje(entorno.buzon, mensajeId)
  if (!mensaje.ok) return mensaje

  const dir = path.join(entorno.buzon, mensajeId)
  const adjunto = adjuntoContrato(mensaje.data, dir)
  if (adjunto === null) {
    return {
      ok: false,
      error: `${mensajeId} no trae un adjunto de contrato: sin contrato no hay nada que extraer (RN4)`,
    }
  }
  const texto = leerAdjunto(dir, adjunto.archivo)
  if (!texto.ok) return texto

  return { ok: true, data: { mensaje: mensaje.data, archivo: adjunto.archivo, texto: texto.data } }
}

/** Extrae el contrato de un mensaje, resolviendo antes su comercial. */
export function extraccionDe(trabajo: ContextoTrabajo, mensajeId: string): Resultado<Extraccion> {
  const leido = mensajeConTexto(trabajo, mensajeId)
  if (!leido.ok) return leido

  const comercial = resolverComercial(trabajo.comerciales, leido.data.mensaje.de)
  const contexto: ContextoExtraccion = {
    mensaje: leido.data.mensaje,
    texto: leido.data.texto,
    comercial: comercial?.nombre ?? null,
  }
  return { ok: true, data: extraerContrato(contexto) }
}

// ── Auditoría del contrato propuesto por el modelo (CA2) ────────────────────

/** Campos del contrato que se auditan cuando el modelo los envía. */
const AUDITABLES: readonly CampoContrato[] = [
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
]

/** Texto comparable de un valor, para detectar alteraciones. */
function comparable(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  if (Array.isArray(valor)) return valor.join(";")
  return String(valor)
}

/**
 * Compara el contrato recibido del modelo con el que el motor extrae del
 * documento. Devuelve un aviso por cada campo alterado o inventado.
 *
 * El resultado **no** es un error: los valores autoritativos siguen siendo los
 * del documento. Los campos alterados se añaden a `requiere_revision` para que un
 * humano lo vea, que es exactamente lo que pide CA2.
 */
export function auditarContrato(recibido: Contrato, autoritativo: Contrato): string[] {
  const alterados: string[] = []
  for (const campo of AUDITABLES) {
    const propuesto = recibido[campo]
    if (propuesto === null) continue
    if (comparable(propuesto) !== comparable(autoritativo[campo])) alterados.push(campo)
  }

  if (alterados.length === 0) return []
  return [
    `no se usaron ${alterados.length} valor(es) propuestos que no coinciden con el documento (${alterados.join(", ")}): los valores se releen del contrato`,
  ]
}

// ── Ejecución con registro (CA4 · CA5) ─────────────────────────────────────

/**
 * Ejecuta la acción de una herramienta, la registra en `out/log.jsonl` y devuelve
 * la respuesta del contrato. Centraliza CA4 (toda llamada queda en el log) y CA5
 * (los errores vuelven como `{ ok: false, error }`, la sesión no muere).
 */
export async function conRegistro<T extends object>(
  nombre: string,
  ctx: ContextoHerramienta,
  mensajeId: string | null,
  accion: () => Promise<Resultado<T>> | Resultado<T>,
  resumir: (data: T) => string,
): Promise<string> {
  const resultado = await accion()
  const resumen = resultado.ok ? resumir(resultado.data) : resultado.error

  const entorno = crearEntorno(ctx.directory, { sesion: ctx.sessionId })
  if (entorno.ok) {
    registrar(entorno.data.escritor, {
      mensaje_id: mensajeId,
      herramienta: nombre,
      ok: resultado.ok,
      resumen,
      sesion: ctx.sessionId,
    })
  }

  return resultado.ok ? exito(resultado.data) : fallo(resultado.error)
}

