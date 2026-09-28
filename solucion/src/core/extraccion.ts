/**
 * Extracción determinista del contrato (HU-2 · PRD §7.2).
 *
 * Esta es la pieza que sostiene la promesa central del agente: **el valor que se
 * registra nace del texto del documento**, no del modelo. Aquí se leen las
 * partes, el número de contrato, el objeto, el valor, el plazo y la póliza, y a
 * cada campo se le asigna una confianza con una razón.
 *
 * Reglas que no se negocian (PRD §5 HU-2 · §6.3 CA2):
 *   · un campo ausente es `null` con confianza `0`, **nunca inventado**;
 *   · las letras y los dígitos del importe se comparan entre sí: si no coinciden,
 *     la confianza baja y el campo va a revisión humana;
 *   · `extraerContrato` es **total**: no lanza y no falla, devuelve lo que hay.
 *
 * Los patrones se aplican sobre el texto **original** (con tildes y mayúsculas
 * del documento) para conservar la razón social tal como está escrita; el texto
 * normalizado se usa solo para detectar.
 */
import {
  buscarClausula,
  dividirClausulas,
  recortarObjeto,
  tieneClausulaGarantias,
  type Clausula,
} from "./clausulas.ts"
import {
  fechaDesdeTexto,
  formatearFecha,
  monedaDesdeTexto,
  normalizar,
  numeralEspanol,
  sumarMeses,
  valorMonetario,
} from "./normalizacion.ts"
import { identificadorDesdeTexto, paisDesdeTexto } from "./identificadores.ts"
import type { CampoContrato, Contrato, Extraccion, MapaConfianza, Mensaje, Moneda, Pais } from "./tipos.ts"

/** Lo que necesita la extracción: el correo, el texto del documento y quién lo envió. */
export interface ContextoExtraccion {
  mensaje: Mensaje
  texto: string
  /** Nombre del comercial resuelto desde `comerciales.json`; `null` si no está. */
  comercial: string | null
}

/** Campos del contrato, para poder recorrerlos al construir la confianza. */
const CAMPOS: readonly CampoContrato[] = [
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
]

/** Confianza 0 para todo: el punto de partida antes de encontrar cada campo. */
function confianzaVacia(): MapaConfianza {
  const mapa = {} as MapaConfianza
  for (const campo of CAMPOS) mapa[campo] = 0
  return mapa
}

/** Fragmento de texto que sostiene un campo, para poder enseñarlo en el chat. */
function evidencia(texto: string, indice: number, longitud = 140): string {
  const desde = Math.max(0, indice - 40)
  const recorte = texto.slice(desde, indice + longitud).replace(/\s+/g, " ").trim()
  return recorte.length > 0 ? `…${recorte}…` : ""
}

/** ¿El documento es un otrosí? (abre con la palabra `OTROSÍ`) */
export function detectarOtrosi(texto: string): boolean {
  const primera = texto.split(/\r?\n/).find((linea) => linea.trim() !== "") ?? ""
  return normalizar(primera).startsWith("OTROSI")
}

/**
 * Número de contrato escrito en el documento (`No. CT-2026-015`, `No. CM-2026-03`).
 *
 * La confianza depende de dónde aparece: 0.99 si está en el encabezado (primeras
 * tres líneas, que es donde va el número del contrato) y 0.6 si solo se menciona
 * en el cuerpo, porque ahí puede ser una referencia a otro contrato.
 */
export function extraerIdContrato(texto: string): { valor: string | null; confianza: number; fragmento: string } {
  const patron = /\bNo\.?\s*([A-Z]{2,3}-\d{4}-\d{1,4})\b/g
  const primeraLinea = texto.split(/\r?\n/).slice(0, 3).join("\n")
  const enEncabezado = patron.exec(primeraLinea)
  if (enEncabezado) {
    return {
      valor: enEncabezado[1] ?? null,
      confianza: 0.99,
      fragmento: evidencia(primeraLinea, enEncabezado.index),
    }
  }
  patron.lastIndex = 0
  const enCuerpo = patron.exec(texto)
  if (enCuerpo) {
    return { valor: enCuerpo[1] ?? null, confianza: 0.6, fragmento: evidencia(texto, enCuerpo.index) }
  }
  return { valor: null, confianza: 0, fragmento: "" }
}

/**
 * Contrato al que se refiere un otrosí. `msg-003` abre con
 * `OTROSÍ No. 1 AL CONTRATO … No. CT-2026-011` y después repite la referencia en
 * el cuerpo; se toma la primera aparición.
 */
export function extraerReferencia(
  texto: string,
): { valor: string | null; confianza: number; fragmento: string } {
  const patron = /(?:AL\s+CONTRATO[^.]{0,80}?|CONTRATO)\s+No\.?\s*([A-Z]{2,3}-\d{4}-\d{1,4})/i
  const encontrado = patron.exec(texto)
  if (encontrado) {
    return {
      valor: (encontrado[1] ?? "").toUpperCase(),
      confianza: 0.99,
      fragmento: evidencia(texto, encontrado.index),
    }
  }
  return extraerIdContrato(texto)
}

// ── Partes, identificador, país y objeto ───────────────────────────────────

/**
 * Razón social de la contraparte.
 *
 * En estos contratos el CONTRATANTE se menciona primero y Periferia después
 * («…y PERIFERIA IT GROUP S.A.S., … EL CONTRATISTA»), así que se toma **la
 * primera aparición**: es una regla, no una casualidad, y está en las pruebas.
 */
export function extraerCliente(texto: string): { valor: string | null; confianza: number; fragmento: string } {
  const patron = /(?:suscritos,\s*|Entre\s+)([^,\n]{4,90}?),\s*(?:identificad[ao]s?\s+con\s+|con\s+)?(?:NIT|RUC|RTN)\b/i
  const encontrado = patron.exec(texto)
  if (!encontrado) return { valor: null, confianza: 0, fragmento: "" }
  const limpio = (encontrado[1] ?? "").replace(/\s+/g, " ").trim()
  if (limpio === "" || normalizar(limpio).includes("PERIFERIA")) {
    return { valor: null, confianza: 0, fragmento: "" }
  }
  return { valor: limpio, confianza: 0.95, fragmento: evidencia(texto, encontrado.index) }
}

/** Identificador tributario del cliente, sin puntos ni dígito de verificación. */
export function extraerNit(texto: string): { valor: string | null; confianza: number; fragmento: string } {
  const identificador = identificadorDesdeTexto(texto)
  if (identificador === null) return { valor: null, confianza: 0, fragmento: "" }
  const indice = texto.indexOf(identificador.tipo)
  return { valor: identificador.valor, confianza: 0.99, fragmento: evidencia(texto, Math.max(0, indice)) }
}

/**
 * País del cliente (PRD §7.2). La confianza distingue las dos vías: 0.95 cuando
 * decide el identificador tributario y 0.7 cuando solo hay domicilio, porque un
 * domicilio puede ser una oficina y no el país del cliente.
 */
export function extraerPais(texto: string): { valor: string | null; confianza: number; fragmento: string } {
  const pais = paisDesdeTexto(texto)
  if (pais === null) return { valor: null, confianza: 0, fragmento: "" }
  const confianza = identificadorDesdeTexto(texto) !== null ? 0.95 : 0.7
  return { valor: pais, confianza, fragmento: "" }
}

/** Objeto del contrato, recortado a los 200 caracteres del maestro (PRD §7.2). */
export function extraerObjeto(
  clausulas: readonly Clausula[],
  texto: string,
): { valor: string | null; confianza: number; fragmento: string } {
  const clausula = buscarClausula(clausulas, ["OBJETO"])
  const cuerpo =
    clausula?.cuerpo !== undefined && clausula.cuerpo !== ""
      ? clausula.cuerpo
      : (/OBJETO\.?\s*([^.]{10,300})/i.exec(texto)?.[1] ?? "")
  if (cuerpo === "") return { valor: null, confianza: 0, fragmento: "" }
  const { texto: recortado, recortado: huboRecorte } = recortarObjeto(cuerpo)
  return {
    valor: recortado === "" ? null : recortado,
    confianza: huboRecorte ? 0.6 : 0.9,
    fragmento: evidencia(cuerpo, 0),
  }
}

// ── Valor ──────────────────────────────────────────────────────────────────

/** Frases que significan «este contrato no tiene un valor fijo» (PRD §7.2). */
const INDETERMINADO =
  /no tiene un valor determinado|no tiene valor determinado|no tiene un valor fijo|valor indeterminado|seg[uú]n las tarifas|tarifas del anexo|por demanda|a la orden de servicio/i

/** Resultado de leer el importe, con la razón de su confianza. */
export interface ValorLeido {
  valor: number | null
  indeterminado: boolean
  confianza: number
  fragmento: string
}

/**
 * Importe del contrato.
 *
 * La regla que da valor a esta función: **las letras y los dígitos se comparan**.
 * Si coinciden (es lo normal en un contrato bien redactado: «DOSCIENTOS SESENTA Y
 * CINCO MILLONES … (COP $265.000.000)») la confianza es 0.99; si no coinciden se
 * toma el número y la confianza cae a 0.5 para que un humano lo mire — es la
 * mitigación directa del riesgo «el modelo redondea el valor» del PRD §10, aquí
 * aplicada a la propia extracción.
 *
 * Un contrato por demanda devuelve `0` con `valor_indeterminado = true` y
 * confianza 0.5: el maestro guarda `0`, pero el 0 hay que confirmarlo.
 */
export function extraerValor(clausulas: readonly Clausula[], texto: string): ValorLeido {
  const clausula = buscarClausula(clausulas, ["VALOR", "PRECIO"])
  const cuerpo = clausula?.cuerpo ?? ""
  const indice = /valor total|valor del contrato|valor del presente contrato/i.exec(texto)?.index
  const porTexto = indice === undefined ? "" : texto.slice(indice, indice + 240)
  const base = cuerpo !== "" ? cuerpo : porTexto !== "" ? porTexto : texto

  if (INDETERMINADO.test(base)) {
    return { valor: 0, indeterminado: true, confianza: 0.5, fragmento: evidencia(base, 0) }
  }

  const enPalabras = numeralEspanol(base)
  const enDigitos = valorMonetario(base)

  if (enPalabras !== null && enDigitos !== null) {
    const coinciden = enPalabras === enDigitos
    return {
      valor: enDigitos,
      indeterminado: false,
      confianza: coinciden ? 0.99 : 0.5,
      fragmento: evidencia(base, 0),
    }
  }
  if (enDigitos !== null) {
    return { valor: enDigitos, indeterminado: false, confianza: 0.95, fragmento: evidencia(base, 0) }
  }
  if (enPalabras !== null) {
    return { valor: enPalabras, indeterminado: false, confianza: 0.9, fragmento: evidencia(base, 0) }
  }
  return { valor: null, indeterminado: false, confianza: 0, fragmento: "" }
}

// ── Moneda ─────────────────────────────────────────────────────────────────

/** Moneda por defecto del país del cliente: solo se usa si el documento calla. */
const MONEDA_POR_PAIS: Record<Pais, Moneda> = {
  CO: "COP",
  EC: "USD",
  PE: "PEN",
  PA: "PAB",
  HN: "HNL",
}

/**
 * Moneda del contrato. Tres vías, en este orden:
 *   1. la que menciona el documento (0.9 por el nombre del numeral, 0.99 si el
 *      código ISO está presente);
 *   2. la del país del cliente cuando el contrato es por demanda (0.85: es una
 *      deducción razonable, no una lectura);
 *   3. nada, con confianza 0 y a revisión.
 */
export function extraerMoneda(
  clausulas: readonly Clausula[],
  texto: string,
  pais: Pais | null,
  indeterminado: boolean,
): { valor: Moneda | null; confianza: number; fragmento: string } {
  const clausula = buscarClausula(clausulas, ["VALOR", "PRECIO"])
  const base = clausula?.cuerpo ?? texto
  const mencionada = monedaDesdeTexto(base) ?? monedaDesdeTexto(texto)
  if (mencionada !== null) {
    const conIso = new RegExp(`\\b${mencionada}\\b`).test(base)
    return { valor: mencionada, confianza: conIso ? 0.99 : 0.9, fragmento: evidencia(base, 0) }
  }
  if (indeterminado && pais !== null) {
    return { valor: MONEDA_POR_PAIS[pais], confianza: 0.85, fragmento: "" }
  }
  return { valor: null, confianza: 0, fragmento: "" }
}

// ── Fechas ─────────────────────────────────────────────────────────────────

/** Fechas leídas del documento, cada una con su confianza. */
export interface FechasLeidas {
  inicio: string | null
  fin: string | null
  confianza_inicio: number
  confianza_fin: number
  fragmento: string
}

const MESES_EN_PALABRA: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

/**
 * Mes y año de la firma, tal como aparece al final del documento
 * («…en el mes de agosto de 2026», «…a los treinta (30) días del mes de julio de
 * 2026»). Es la única pista de fecha que trae un contrato sin plazo explícito.
 */
export function mesDeFirma(texto: string): { mes: number; anio: number } | null {
  const encontrado = /(?:del mes de|en el mes de)\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i.exec(texto)
  if (!encontrado) return null
  const mes = MESES_EN_PALABRA[(encontrado[1] ?? "").toLowerCase()]
  if (mes === undefined) return null
  return { mes, anio: Number(encontrado[2]) }
}

/** Último día de un mes, como fecha `YYYY-MM-DD`. */
function ultimoDiaDelMes(mes: number, anio: number): string | null {
  const ultimo = new Date(Date.UTC(anio, mes, 0))
  return formatearFecha({ dia: ultimo.getUTCDate(), mes, anio })
}

/** Meses que dura el contrato, escritos con dígito o en palabras. */
export function mesesDePlazo(base: string): number | null {
  const enParentesis = /\((\d{1,3})\)\s*meses/i.exec(base)
  if (enParentesis) return Number(enParentesis[1])
  const suelto = /(\d{1,3})\s*meses/i.exec(base)
  if (suelto) return Number(suelto[1])
  const conPalabras = /([a-záéíóúñü\s]{3,40}?)\s*\(?\s*meses/i.exec(base)
  if (conPalabras) {
    const valor = numeralEspanol(conPalabras[1] ?? "")
    if (valor !== null && valor > 0 && valor < 600) return valor
  }
  return null
}

/**
 * Fechas de vigencia (PRD §7.2).
 *
 * Se resuelven por este orden, que es el orden en que aparecen en los contratos:
 *
 * 1. **Rango explícito** (`desde el … hasta el …`) → las dos fechas, confianza
 *    0.99 si el día venía también en dígitos y 0.9 si solo en palabras.
 * 2. **Solo el final** (un otrosí que «extiende hasta el …») → solo `fin`; el
 *    inicio **no se inventa**: `null` significa «conservar el del maestro».
 * 3. **Plazo en meses** (`duración de doce (12) meses … a partir de la fecha de su
 *    firma`) → el inicio se deduce del mes de firma y el fin se calcula. Confianza
 *    **0.6 y 0.7**: es la fecha derivada que el PRD espera ver en revisión, y la
 *    razón de que `msg-006` pida confirmación humana.
 */
export function extraerFechas(texto: string, fechaCorreo: string, esOtrosi: boolean): FechasLeidas {
  const clausulas = dividirClausulas(texto)
  const clausulaPlazo = buscarClausula(clausulas, ["PLAZO", "VIGENCIA", "DURACION"])
  const base = clausulaPlazo?.cuerpo ?? texto

  const rango = /desde el\s+(.{4,60}?)\s+hasta el\s+(.{4,60}?)(?:[,.;]|$)/i.exec(base)
  if (rango) {
    const partesInicio = fechaDesdeTexto(rango[1] ?? "")
    const partesFin = fechaDesdeTexto(rango[2] ?? "")
    const inicio = partesInicio === null ? null : formatearFecha(partesInicio)
    const fin = partesFin === null ? null : formatearFecha(partesFin)
    const conDigitos = /\d/.test(rango[1] ?? "") && /\d/.test(rango[2] ?? "")
    return {
      inicio,
      fin,
      confianza_inicio: inicio === null ? 0 : conDigitos ? 0.99 : 0.9,
      confianza_fin: fin === null ? 0 : conDigitos ? 0.99 : 0.9,
      fragmento: evidencia(base, rango.index),
    }
  }

  const soloFin = /hasta el\s+(.{4,60}?)(?:[,.;]|$)/i.exec(base)

  if (esOtrosi) {
    const partesFin = soloFin === null ? null : fechaDesdeTexto(soloFin[1] ?? "")
    const fin = partesFin === null ? null : formatearFecha(partesFin)
    return {
      inicio: null,
      fin,
      confianza_inicio: 0,
      confianza_fin: fin === null ? 0 : 0.9,
      fragmento: soloFin === null ? "" : evidencia(base, soloFin.index),
    }
  }

  const meses = mesesDePlazo(base)
  if (meses !== null) {
    const firma = mesDeFirma(texto)
    const fechaDelCorreo = fechaCorreo.slice(0, 10)
    const mesCorreo = Number(fechaDelCorreo.slice(5, 7))
    const anioCorreo = Number(fechaDelCorreo.slice(0, 4))
    const coincideElCorreo = firma !== null && firma.mes === mesCorreo && firma.anio === anioCorreo
    const inicio =
      coincideElCorreo ? fechaDelCorreo : firma === null ? null : ultimoDiaDelMes(firma.mes, firma.anio)
    const fin = inicio === null ? null : sumarMeses(inicio, meses)
    return {
      inicio,
      fin,
      confianza_inicio: inicio === null ? 0 : coincideElCorreo ? 0.6 : 0.7,
      confianza_fin: fin === null ? 0 : 0.7,
      fragmento: evidencia(base, 0),
    }
  }

  return { inicio: null, fin: null, confianza_inicio: 0, confianza_fin: 0, fragmento: "" }
}

// ── Póliza ─────────────────────────────────────────────────────────────────

/** Tipos de póliza que el maestro admite, separados por `;` (PRD §7.2). */
const TIPOS_POLIZA: readonly { patron: RegExp; tipo: string }[] = [
  { patron: /cumplimiento/i, tipo: "cumplimiento" },
  { patron: /calidad/i, tipo: "calidad" },
  { patron: /responsabilidad civil/i, tipo: "responsabilidad_civil" },
  { patron: /salarios|prestaciones/i, tipo: "salarios_prestaciones" },
  { patron: /todo riesgo/i, tipo: "todo_riesgo" },
]

/** Póliza leída: `requiere = null` significa «el documento no lo trata, se conserva». */
export interface PolizaLeida {
  requiere: boolean | null
  tipos: string[]
  confianza: number
  fragmento: string
}

/**
 * ¿El contrato exige póliza, y de qué tipo?
 *
 * Tres situaciones distintas, y la confianza las distingue porque no valen lo
 * mismo:
 *
 * · **Presencia** de la cláusula de póliza → `true`, 0.95.
 * · **Condicional** («para cada orden de servicio cuyo valor supere…», que es el
 *   caso del contrato marco `CM-2026-03`) → `true`, 0.85: el contrato la
 *   contempla, pero no para todo.
 * · **Ausencia**: si hay cláusula de garantías que no menciona póliza, 0.6 (a
 *   revisión, porque puede ser un olvido del redactor); si no hay ninguna cláusula
 *   de garantías, 0.85 (es el caso de `CT-2026-016`, que no pide póliza).
 *
 * En un **otrosí** que no toca las garantías devuelve `null` con 0.9: no es una
 * ausencia, es un «sin cambios», y el registro conserva lo que ya estaba.
 */
export function extraerPoliza(
  clausulas: readonly Clausula[],
  texto: string,
  esOtrosi: boolean,
): PolizaLeida {
  const clausula = buscarClausula(clausulas, ["GARANTIA", "GARANTIAS"])
  const cuerpo = clausula?.cuerpo ?? ""
  const conPoliza =
    /p[oó]liza/i.test(cuerpo) ? cuerpo : (/p[oó]liza[^.]{0,220}/i.exec(texto)?.[0] ?? "")

  if (conPoliza !== "") {
    const condicional = /para cada orden de servicio|cuyo valor supere|seg[uú]n el valor/i.test(conPoliza)
    const tipos = TIPOS_POLIZA.filter((t) => t.patron.test(conPoliza)).map((t) => t.tipo)
    return {
      requiere: true,
      tipos,
      confianza: condicional ? 0.85 : 0.95,
      fragmento: evidencia(conPoliza, 0),
    }
  }
  if (esOtrosi) return { requiere: null, tipos: [], confianza: 0.9, fragmento: "" }
  if (tieneClausulaGarantias(clausulas)) {
    return { requiere: false, tipos: [], confianza: 0.6, fragmento: "" }
  }
  return { requiere: false, tipos: [], confianza: 0.85, fragmento: "" }
}

// ── Comercial ──────────────────────────────────────────────────────────────

/**
 * Comercial que envió el contrato.
 *
 * Si el remitente no está en `comerciales.json` el valor es `null` con confianza
 * 0. Eso **no bloquea el registro** (PRD §5 HU-3): se reporta como aviso y
 * administración lo asigna, que es justo el caso de `msg-006`, enviado por un
 * practicante que no figura en la lista.
 */
export function extraerComercial(comercial: string | null): { valor: string | null; confianza: number } {
  if (comercial === null || comercial.trim() === "") return { valor: null, confianza: 0 }
  return { valor: comercial.trim(), confianza: 1 }
}

// ── Ensamblado ─────────────────────────────────────────────────────────────

/**
 * Extrae el contrato completo de un documento.
 *
 * Es una función **total**: siempre devuelve una `Extraccion`, nunca lanza. Lo
 * que no se encuentra queda `null` con confianza 0, y quien decide qué hacer con
 * esa incertidumbre es `clasificacion.ts` (RN5): si es un campo obligatorio, el
 * registro se detiene y el agente pregunta.
 *
 * `null` tiene un significado preciso en este módulo: **«el documento no lo
 * dice»**. En una actualización eso es «conservar el valor del maestro», no
 * «borrarlo», y así lo aplica el registro.
 */
export function extraerContrato(ctx: ContextoExtraccion): Extraccion {
  const texto = ctx.texto
  const esOtrosi = detectarOtrosi(texto)
  const clausulas = dividirClausulas(texto)

  const propio = extraerIdContrato(texto)
  const referencia = extraerReferencia(texto)
  const cliente = extraerCliente(texto)
  const nit = extraerNit(texto)
  const pais = extraerPais(texto)
  const objeto = extraerObjeto(clausulas, texto)
  const valor = extraerValor(clausulas, texto)
  const moneda = extraerMoneda(clausulas, texto, (pais.valor as Pais | null) ?? null, valor.indeterminado)
  const fechas = extraerFechas(texto, ctx.mensaje.fecha, esOtrosi)
  const poliza = extraerPoliza(clausulas, texto, esOtrosi)
  const comercial = extraerComercial(ctx.comercial)

  const contrato: Contrato = {
    id_contrato: esOtrosi ? referencia.valor : propio.valor,
    cliente: cliente.valor,
    nit_cliente: nit.valor,
    pais: (pais.valor as Pais | null) ?? null,
    objeto: objeto.valor,
    valor: valor.valor,
    valor_indeterminado: valor.indeterminado,
    moneda: moneda.valor,
    fecha_inicio: fechas.inicio,
    fecha_fin: fechas.fin,
    requiere_poliza: poliza.requiere,
    tipo_poliza: poliza.tipos,
    estado_poliza: esOtrosi
      ? null
      : poliza.requiere === true
        ? "pendiente"
        : poliza.requiere === false
          ? "no_aplica"
          : null,
    comercial: comercial.valor,
    es_otrosi: esOtrosi,
    id_contrato_referenciado: esOtrosi ? referencia.valor : null,
  }

  const confianza = confianzaVacia()
  confianza.id_contrato = esOtrosi ? referencia.confianza : propio.confianza
  confianza.cliente = cliente.confianza
  confianza.nit_cliente = nit.confianza
  confianza.pais = pais.confianza
  confianza.objeto = objeto.confianza
  confianza.valor = valor.confianza
  confianza.moneda = moneda.confianza
  confianza.fecha_inicio = fechas.confianza_inicio
  confianza.fecha_fin = fechas.confianza_fin
  confianza.requiere_poliza = poliza.confianza
  confianza.tipo_poliza = poliza.requiere === true ? poliza.confianza : 0.85
  confianza.estado_poliza = contrato.estado_poliza === null ? 0 : confianza.requiere_poliza
  confianza.comercial = comercial.confianza

  const evidenciaPor: Partial<Record<CampoContrato, string>> = {}
  const anotar = (campo: CampoContrato, fragmento: string): void => {
    if (fragmento !== "") evidenciaPor[campo] = fragmento
  }
  anotar("id_contrato", esOtrosi ? referencia.fragmento : propio.fragmento)
  anotar("cliente", cliente.fragmento)
  anotar("nit_cliente", nit.fragmento)
  anotar("objeto", objeto.fragmento)
  anotar("valor", valor.fragmento)
  anotar("moneda", moneda.fragmento)
  anotar("fecha_inicio", fechas.fragmento)
  anotar("fecha_fin", fechas.fragmento)
  anotar("requiere_poliza", poliza.fragmento)

  return { mensaje_id: ctx.mensaje.id, contrato, confianza, evidencia: evidenciaPor }
}




