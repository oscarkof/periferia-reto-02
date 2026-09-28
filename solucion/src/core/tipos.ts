/**
 * Tipos compartidos del motor determinista de contratos (PRD §7.2 y §7.3).
 *
 * Este módulo NO importa nada: describe el contrato del dominio tal como lo
 * fijan los fixtures y el PRD. Todo lo demás se apoya en estos nombres.
 */

/**
 * Resultado tipado de toda operación que puede fallar (PRD §8 · Robustez):
 * `{ ok: false, error }` legible y nada que lance hacia el agente.
 */
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

/** Países que atiende el proceso (PRD §7.2 · `pais`). */
export type Pais = "CO" | "EC" | "PE" | "PA" | "HN"

/** Monedas admitidas por el maestro (PRD §7.2 · `moneda`). */
export type Moneda = "COP" | "USD" | "PEN" | "PAB" | "HNL"

/** Clasificación de un mensaje del buzón (PRD §7.3 · RN1-RN4). */
export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"

/** Estado de la póliza dentro de la fila del maestro (PRD §7.2). */
export type EstadoPoliza = "vigente" | "pendiente" | "vencida" | "no_aplica"

/** Origen de la fila del maestro (PRD §7.2 · `fuente`). */
export type Fuente = "buzon" | "manual" | "migracion"

/** Acción efectiva sobre el maestro (HU-4). */
export type AccionRegistro = "insertado" | "actualizado" | "sin_cambios"

/** Correo del buzón, tal como viene en `<mensaje_id>/correo.json` (PRD §7.1). */
export interface Mensaje {
  id: string
  de: string
  para: string
  asunto: string
  fecha: string
  cuerpo: string
  adjuntos: string[]
}

/** Lo que `contratos_leer_buzon` devuelve por cada mensaje (HU-1). */
export interface MensajeResumen {
  id: string
  de: string
  asunto: string
  fecha: string
  adjuntos: string[]
  /** ¿Trae un adjunto que parece contrato u otrosí? Si no, se rechaza (RN4). */
  tiene_contrato: boolean
  procesado: boolean
}

/**
 * Campos que se extraen y se auditan (PRD §7.2). El nombre es el de la columna
 * del maestro, para que la trazabilidad campo ↔ confianza ↔ fila sea directa.
 */
export type CampoContrato =
  | "id_contrato"
  | "cliente"
  | "nit_cliente"
  | "pais"
  | "objeto"
  | "valor"
  | "moneda"
  | "fecha_inicio"
  | "fecha_fin"
  | "requiere_poliza"
  | "tipo_poliza"
  | "estado_poliza"
  | "comercial"

/**
 * Contrato extraído del documento (HU-2).
 *
 * Regla dura: un campo ausente en el texto es `null` con confianza `0`,
 * **nunca inventado**. `valor_indeterminado` existe porque el maestro guarda `0`
 * cuando el contrato es por demanda (PRD §7.2), pero el 0 hay que confirmarlo.
 */
export interface Contrato {
  id_contrato: string | null
  cliente: string | null
  nit_cliente: string | null
  pais: Pais | null
  objeto: string | null
  valor: number | null
  valor_indeterminado: boolean
  moneda: Moneda | null
  fecha_inicio: string | null
  fecha_fin: string | null
  requiere_poliza: boolean | null
  tipo_poliza: string[]
  estado_poliza: EstadoPoliza | null
  comercial: string | null
  /** ¿El documento es un otrosí que modifica un contrato existente? (RN2) */
  es_otrosi: boolean
  /** Id del contrato que el otrosí modifica, si lo menciona. */
  id_contrato_referenciado: string | null
}

/** Confianza en [0, 1] por cada campo extraído (RN5). */
export type MapaConfianza = Record<CampoContrato, number>

/** Resultado de `contratos_extraer`: el contrato y por qué se cree cada valor. */
export interface Extraccion {
  mensaje_id: string
  contrato: Contrato
  confianza: MapaConfianza
  /** Fragmento de texto que sostiene cada campo (auditoría, no adorno). */
  evidencia: Partial<Record<CampoContrato, string>>
}

/** Fila del maestro: las 16 columnas del PRD §7.2, en su orden. */
export interface FilaMaestro {
  id_contrato: string
  cliente: string
  nit_cliente: string
  pais: Pais
  objeto: string
  valor: number
  moneda: Moneda
  fecha_inicio: string
  fecha_fin: string
  requiere_poliza: boolean
  tipo_poliza: string
  estado_poliza: EstadoPoliza
  comercial: string
  ruta_sharepoint: string
  fecha_registro: string
  fuente: Fuente
}

/** Cambio de un campo entre la fila existente y el contrato entrante (RN2). */
export interface Diferencia {
  campo: string
  antes: string
  despues: string
}

/** Lo que `contratos_validar` devuelve (HU-3 · RN1-RN5). */
export interface ResultadoValidacion {
  mensaje_id: string
  clasificacion: Clasificacion
  /** Fila del maestro con la que se compara, cuando existe. */
  id_contrato_existente: string | null
  /** Campos que impiden registrar sin confirmación humana (RN5). */
  requiere_revision: string[]
  /** Motivo legible por campo en revisión. */
  motivos: string[]
  diferencias: Diferencia[]
  /** Motivo del rechazo, cuando `clasificacion === "rechazado"` (RN4). */
  motivo_rechazo: string | null
  /**
   * Cosas que hay que contarle al usuario pero que **no bloquean** el registro
   * (PRD §5 HU-3: «un remitente desconocido se reporta pero no bloquea»).
   */
  avisos: string[]
}

/** Una línea de `out/sharepoint/historial.jsonl` (HU-4 · O2). */
export interface EntradaHistorial {
  ts: string
  id_contrato: string
  accion: AccionRegistro
  cambios: Diferencia[]
  mensaje_id: string
}

/** Lo que `contratos_registrar` devuelve cuando escribió (HU-4). */
export interface ResultadoRegistro {
  id_contrato: string
  accion: AccionRegistro
  ruta_archivo: string
  diferencias: Diferencia[]
}

/** Un contrato que vence dentro de la ventana de alertas (HU-5). */
export interface Vencimiento {
  id_contrato: string
  cliente: string
  fecha_fin: string
  dias_restantes: number
  requiere_poliza: boolean
  estado_poliza: EstadoPoliza
}

/** Lo que `contratos_alertas` devuelve y escribe en `out/alertas.md` (HU-5). */
export interface ReporteAlertas {
  ruta: string
  hoy: string
  vencen: Vencimiento[]
  polizas_pendientes: FilaMaestro[]
  registrados_desde_corte: FilaMaestro[]
  /** Contratos del maestro que ya vencieron: contexto para gerencia. */
  ya_vencidos: Vencimiento[]
}
