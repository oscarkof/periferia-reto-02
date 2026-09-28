/**
 * Reglas del español de los contratos, en aislamiento (HU-2).
 *
 * Son las funciones más «sorpresivas» del motor —numerales en palabras, fechas
 * con ordinal, identificadores por país— así que se prueban una a una, sin
 * fixtures de por medio: si alguna se rompe, aquí se sabe exactamente cuál.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  diasEntre,
  fechaDesdeTexto,
  formatearFecha,
  monedaDesdeTexto,
  numeralEspanol,
  sumarMeses,
  validarFecha,
  valorMonetario,
} from "../src/core/normalizacion.ts"
import { idContratoValido, normalizarIdentificador, paisDesdeTexto, similitud, slugCliente } from "../src/core/identificadores.ts"

test("numerales en palabras, como los escriben los contratos", () => {
  assert.equal(numeralEspanol("DOSCIENTOS SESENTA Y CINCO MILLONES DE PESOS M/CTE"), 265000000)
  assert.equal(numeralEspanol("QUINIENTOS VEINTE MIL SOLES"), 520000)
  assert.equal(numeralEspanol("CIENTO VEINTE MIL DÓLARES"), 120000)
  assert.equal(numeralEspanol("TREINTA MIL"), 30000)
  assert.equal(numeralEspanol("SEIS"), 6)
  assert.equal(numeralEspanol("MIL"), 1000)
  assert.equal(numeralEspanol("veinticuatro"), 24)
  assert.equal(numeralEspanol("CIEN"), 100)
  // Un texto sin numerales no inventa un número.
  assert.equal(numeralEspanol("el contratista se obliga a ejecutar"), null)
})

test("fechas escritas con ordinal y con dígitos", () => {
  assert.deepEqual(fechaDesdeTexto("primero (1) de agosto de 2026"), { dia: 1, mes: 8, anio: 2026 })
  assert.deepEqual(fechaDesdeTexto("treinta y uno (31) de julio de 2027"), { dia: 31, mes: 7, anio: 2027 })
  assert.deepEqual(fechaDesdeTexto("15 de mayo de 2026"), { dia: 15, mes: 5, anio: 2026 })
  // Sin dígitos entre paréntesis, se traduce el ordinal.
  assert.deepEqual(fechaDesdeTexto("primero de agosto de 2026"), { dia: 1, mes: 8, anio: 2026 })
  assert.equal(fechaDesdeTexto("no hay fecha aquí"), null)
})

test("formatearFecha y validarFecha rechazan fechas que no existen", () => {
  assert.equal(formatearFecha({ dia: 31, mes: 2, anio: 2026 }), null)
  assert.equal(formatearFecha({ dia: 29, mes: 2, anio: 2024 }), "2024-02-29")
  const mala = validarFecha("2026-02-31", "hoy")
  assert.equal(mala.ok, false)
  if (mala.ok) return
  assert.match(mala.error, /no existe en el calendario/)
  const buena = validarFecha("2026-09-03", "hoy")
  assert.equal(buena.ok, true)
})

test("sumarMeses recorta al último día del mes destino", () => {
  assert.equal(sumarMeses("2026-08-31", 12), "2027-08-31")
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28")
  assert.equal(sumarMeses("2026-01-15", 6), "2026-07-15")
  assert.equal(sumarMeses("no-es-fecha", 1), null)
})

test("diasEntre cuenta los días de la ventana de alertas", () => {
  assert.equal(diasEntre("2026-09-03", "2026-11-02"), 60)
  assert.equal(diasEntre("2026-09-03", "2026-11-03"), 61)
  assert.equal(diasEntre("2026-09-03", "2026-09-02"), -1)
})

test("importes: separador local frente a formato inglés", () => {
  assert.equal(valorMonetario("COP $265.000.000"), 265000000)
  assert.equal(valorMonetario("USD 120,000.00"), 120000)
  assert.equal(valorMonetario("PEN 520,000.00"), 520000)
  assert.equal(valorMonetario("sin importe"), null)
})

test("moneda por código ISO o por el nombre del numeral", () => {
  assert.equal(monedaDesdeTexto("DOSCIENTOS MILLONES DE PESOS M/CTE"), "COP")
  assert.equal(monedaDesdeTexto("QUINIENTOS VEINTE MIL SOLES"), "PEN")
  assert.equal(monedaDesdeTexto("USD 120,000.00"), "USD")
  assert.equal(monedaDesdeTexto("sin moneda"), null)
})

test("país del cliente: el identificador manda sobre el domicilio", () => {
  assert.equal(paisDesdeTexto("INDUSTRIAS DELTA S.A.S., identificada con NIT 890.900.111-4, de Bogotá"), "CO")
  assert.equal(paisDesdeTexto("CORPORACIÓN ANDINA, RUC 1790012345001, Quito, Ecuador"), "EC")
  assert.equal(paisDesdeTexto("MINERA LOS ANDES S.A.C., RUC 20512345678, Lima, Perú"), "PE")
  assert.equal(paisDesdeTexto("AGROEXPORT SULA, RTN 08019995123456, San Pedro Sula"), "HN")
  // RUC de nueve dígitos: el domicilio decide entre Panamá y Ecuador.
  assert.equal(paisDesdeTexto("LOGÍSTICA DEL ISTMO S.A., RUC 155612345, Ciudad de Panamá"), "PA")
})

test("el NIT se guarda sin puntos ni dígito de verificación", () => {
  assert.equal(normalizarIdentificador("890.900.111-4"), "890900111")
  assert.equal(normalizarIdentificador("800.222.333-9"), "800222333")
  assert.equal(normalizarIdentificador("1790012345001"), "1790012345001")
})

test("slug de carpeta: conserva las partículas y quita la forma societaria", () => {
  assert.equal(slugCliente("Industrias Delta S.A.S."), "industrias-delta")
  assert.equal(slugCliente("Corporación Andina de Servicios S.A."), "corporacion-andina-de-servicios")
  assert.equal(slugCliente("Logística del Istmo S.A."), "logistica-del-istmo")
  assert.equal(slugCliente("Universidad del Valle del Río"), "universidad-del-valle-del-rio")
  assert.equal(slugCliente("Agroexport Sula S. de R.L."), "agroexport-sula")
})

test("similitud: idénticos 1, distintos por debajo del umbral de RN2", () => {
  assert.equal(similitud("Desarrollo de portal de pedidos B2B", "Desarrollo de portal de pedidos B2B"), 1)
  const distintos = similitud(
    "Desarrollo de portal de pedidos B2B",
    "Soporte y mantenimiento de plataforma SAP",
  )
  assert.ok(distintos < 0.9, `la similitud debería ser baja, fue ${distintos}`)
})

test("idContratoValido acepta los formatos del maestro y rechaza basura", () => {
  assert.equal(idContratoValido("ct-2026-015").ok, true)
  assert.equal(idContratoValido("CM-2026-03").ok, true)
  assert.equal(idContratoValido("../etc/passwd").ok, false)
  assert.equal(idContratoValido("ab").ok, false)
})
