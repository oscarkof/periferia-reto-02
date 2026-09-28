/**
 * Casos dorados de la extracción (HU-2).
 *
 * Cada prueba lee el **documento real** del fixture y fija lo que el PRD §7.4
 * espera de él. Si alguien cambia una regla de extracción, se rompe aquí y no en
 * la cara del evaluador.
 *
 * Nota de diseño: la razón social se conserva **tal como está escrita en el
 * documento** (en estos contratos, en mayúsculas). La forma del nombre no decide
 * nada: el dedupe va por identificador y número de contrato, y el slug de carpeta
 * normaliza a minúsculas.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { extraerContrato, type ContextoExtraccion } from "../src/core/extraccion.ts"
import type { Mensaje } from "../src/core/tipos.ts"

const BUZON = path.resolve(import.meta.dirname, "..", "..", "fixtures", "reto-02", "buzon")

/** Comerciales del fixture, para resolver el remitente del correo. */
const COMERCIALES: Record<string, string> = {
  "lgomez@periferia-ficticia.com": "Laura Gómez Restrepo",
  "cruiz@periferia-ficticia.com": "Carlos Ruiz Medina",
  "amolina@periferia-ficticia.com": "Andrés Molina Pardo",
}

function contexto(id: string, adjunto: string): ContextoExtraccion {
  const dir = path.join(BUZON, id)
  const mensaje = JSON.parse(fs.readFileSync(path.join(dir, "correo.json"), "utf8")) as Mensaje
  const texto = fs.readFileSync(path.join(dir, adjunto), "utf8")
  return { mensaje, texto, comercial: COMERCIALES[mensaje.de] ?? null }
}

test("msg-001 · contrato nuevo con póliza de cumplimiento", () => {
  const { contrato, confianza } = extraerContrato(contexto("msg-001", "contrato.txt"))
  assert.equal(contrato.id_contrato, "CT-2026-015")
  assert.equal(contrato.cliente, "INDUSTRIAS DELTA S.A.S.")
  assert.equal(contrato.nit_cliente, "890900111")
  assert.equal(contrato.pais, "CO")
  assert.equal(contrato.valor, 265000000)
  assert.equal(contrato.moneda, "COP")
  assert.equal(contrato.fecha_inicio, "2026-08-01")
  assert.equal(contrato.fecha_fin, "2027-07-31")
  assert.equal(contrato.requiere_poliza, true)
  assert.deepEqual(contrato.tipo_poliza, ["cumplimiento"])
  assert.equal(contrato.estado_poliza, "pendiente")
  assert.equal(contrato.comercial, "Laura Gómez Restrepo")
  assert.equal(contrato.es_otrosi, false)
  // Letras y dígitos coinciden: no hay nada que revisar.
  assert.equal(confianza.valor, 0.99)
  assert.equal(confianza.fecha_fin, 0.99)
  assert.equal(confianza.cliente, 0.95)
})

test("msg-002 · mismo cliente que CT-2026-007 pero otro contrato, sin póliza", () => {
  const { contrato, confianza } = extraerContrato(contexto("msg-002", "contrato.txt"))
  assert.equal(contrato.id_contrato, "CT-2026-016")
  assert.equal(contrato.cliente, "CORPORACIÓN ANDINA DE SERVICIOS S.A.")
  assert.equal(contrato.nit_cliente, "1790012345001")
  assert.equal(contrato.pais, "EC")
  assert.equal(contrato.valor, 120000)
  assert.equal(contrato.moneda, "USD")
  assert.equal(contrato.fecha_inicio, "2026-08-15")
  assert.equal(contrato.fecha_fin, "2027-08-14")
  assert.equal(contrato.requiere_poliza, false)
  assert.equal(contrato.estado_poliza, "no_aplica")
  // La ausencia de cláusula de garantías no bloquea: 0.85 supera el umbral.
  assert.equal(confianza.requiere_poliza, 0.85)
})

test("msg-003 · otrosí que modifica plazo y valor del CT-2026-011", () => {
  const { contrato, confianza } = extraerContrato(contexto("msg-003", "otrosi.txt"))
  assert.equal(contrato.es_otrosi, true)
  assert.equal(contrato.id_contrato, "CT-2026-011")
  assert.equal(contrato.id_contrato_referenciado, "CT-2026-011")
  assert.equal(contrato.cliente, "MINERA LOS ANDES S.A.C.")
  assert.equal(contrato.nit_cliente, "20512345678")
  assert.equal(contrato.pais, "PE")
  assert.equal(contrato.fecha_fin, "2027-11-01")
  assert.equal(contrato.valor, 520000)
  assert.equal(contrato.moneda, "PEN")
  // Lo que el otrosí no toca se conserva: no se inventa un inicio ni una póliza.
  assert.equal(contrato.fecha_inicio, null)
  assert.equal(contrato.requiere_poliza, null)
  assert.equal(contrato.objeto, null)
  assert.equal(confianza.fecha_fin, 0.9)
  assert.equal(confianza.valor, 0.99)
})

test("msg-004 · reenvío del CT-2026-012: los campos que deciden el duplicado", () => {
  const { contrato } = extraerContrato(contexto("msg-004", "contrato.txt"))
  assert.equal(contrato.id_contrato, "CT-2026-012")
  assert.equal(contrato.cliente, "CLÍNICA SAN RAFAEL S.A.")
  assert.equal(contrato.nit_cliente, "890903456")
  assert.equal(contrato.pais, "CO")
  assert.equal(contrato.valor, 210000000)
  assert.equal(contrato.fecha_inicio, "2026-05-15")
  assert.equal(contrato.fecha_fin, "2026-11-14")
  assert.equal(contrato.requiere_poliza, false)
})

test("msg-006 · contrato marco: valor indeterminado, plazo en meses y remitente desconocido", () => {
  const { contrato, confianza } = extraerContrato(contexto("msg-006", "contrato.txt"))
  assert.equal(contrato.id_contrato, "CM-2026-03")
  assert.equal(contrato.cliente, "DISTRIBUIDORA CARIBE S.A.S.")
  assert.equal(contrato.nit_cliente, "800222333")
  assert.equal(contrato.pais, "CO")
  assert.equal(contrato.valor, 0)
  assert.equal(contrato.valor_indeterminado, true)
  // El plazo se deduce del mes de firma y de la fecha del correo, no se lee: por
  // eso las dos fechas quedan por debajo del umbral y piden confirmación humana.
  assert.equal(contrato.fecha_inicio, "2026-08-31")
  assert.equal(contrato.fecha_fin, "2027-08-31")
  assert.ok(confianza.valor < 0.8, "el valor 0 indeterminado debe ir a revisión")
  assert.ok(confianza.fecha_fin < 0.8, "la fecha derivada debe ir a revisión")
  // El remitente no está en comerciales.json: se reporta, no bloquea.
  assert.equal(contrato.comercial, null)
  assert.equal(confianza.comercial, 0)
  // La póliza es condicional (por orden de servicio): se contempla, sin bloquear.
  assert.equal(contrato.requiere_poliza, true)
  assert.equal(confianza.requiere_poliza, 0.85)
  assert.deepEqual(contrato.tipo_poliza, ["cumplimiento"])
})

test("cada campo extraído arrastra su evidencia (auditoría del turno)", () => {
  const { evidencia } = extraerContrato(contexto("msg-001", "contrato.txt"))
  const campos = ["id_contrato", "cliente", "nit_cliente", "valor", "fecha_fin"] as const
  for (const campo of campos) {
    assert.ok((evidencia[campo] ?? "").length > 10, `sin evidencia para ${campo}`)
  }
})

test("un crédito con letras y dígitos distintos baja la confianza a 0.5", () => {
  const { contrato, confianza } = extraerContrato({
    mensaje: {
      id: "msg-999",
      de: "lgomez@periferia-ficticia.com",
      para: "contratos@periferia-ficticia.com",
      asunto: "prueba",
      fecha: "2026-09-01T00:00:00-05:00",
      cuerpo: "",
      adjuntos: [],
    },
    texto: [
      "CONTRATO DE PRESTACIÓN DE SERVICIOS No. CT-2026-099",
      "",
      "Entre los suscritos, PRUEBA S.A.S., identificada con NIT 900.111.222-3, con domicilio en Bogotá,",
      "y PERIFERIA IT GROUP S.A.S., NIT 900.123.456-7, se celebra el presente contrato:",
      "",
      "PRIMERA. OBJETO. Prestar servicios de prueba de la extracción determinista.",
      "SEGUNDA. VALOR. El valor total será de CIEN MILLONES DE PESOS (COP $265.000.000).",
      "TERCERA. PLAZO. El plazo será desde el primero (1) de enero de 2026 hasta el treinta y uno (31) de diciembre de 2026.",
    ].join("\n"),
    comercial: null,
  })
  // Las letras dicen 100 millones y los dígitos 265: no coinciden, así que el
  // valor queda a revisión en vez de registrarse en silencio.
  assert.equal(contrato.valor, 265000000)
  assert.equal(confianza.valor, 0.5)
  assert.equal(contrato.cliente, "PRUEBA S.A.S.")
  assert.equal(contrato.nit_cliente, "900111222")
  assert.equal(contrato.fecha_fin, "2026-12-31")
})

