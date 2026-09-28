/**
 * Clasificación y revisión humana sobre los seis mensajes reales (HU-3 · RN1-RN5).
 *
 * Aquí se fija lo que el PRD §7.4 espera: qué se registra, qué no se toca y
 * **cuál es exactamente la lista de campos que exige confirmación**. Es la prueba
 * que protege el objetivo O2 (no corromper el maestro).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { clasificar, idParaRegistrar, rechazar } from "../src/core/clasificacion.ts"
import { extraerContrato } from "../src/core/extraccion.ts"
import { contextoDe, maestroTemporal, mensajeSintetico } from "../test-utils/fixtures.ts"

const HOY = "2026-09-03"

/** Extrae y clasifica un mensaje del buzón contra el maestro del fixture. */
function validar(id: string, adjunto?: string) {
  const { maestro } = maestroTemporal()
  const contexto = contextoDe(id, adjunto)
  const extraccion = extraerContrato(contexto)
  return clasificar(extraccion, maestro, { hoy: HOY, remitente: contexto.mensaje.de })
}

test("msg-001 · nuevo, sin nada que revisar", () => {
  const resultado = validar("msg-001")
  assert.equal(resultado.clasificacion, "nuevo")
  assert.deepEqual(resultado.requiere_revision, [])
  assert.equal(resultado.id_contrato_existente, null)
  assert.equal(resultado.motivo_rechazo, null)
})

test("msg-002 · nuevo: el mismo cliente no lo convierte en actualización", () => {
  const resultado = validar("msg-002")
  // CT-2026-007 es del mismo cliente (Corporación Andina, mismo RUC) pero otro
  // contrato: si esto se clasificara como actualización, se corrompería el maestro.
  assert.equal(resultado.clasificacion, "nuevo")
  assert.deepEqual(resultado.requiere_revision, [])
})

test("msg-003 · actualización: cambia plazo y valor del CT-2026-011", () => {
  const resultado = validar("msg-003")
  assert.equal(resultado.clasificacion, "actualizacion")
  assert.equal(resultado.id_contrato_existente, "CT-2026-011")
  assert.deepEqual(resultado.requiere_revision, [])
  const campos = resultado.diferencias.map((d) => d.campo).sort()
  assert.deepEqual(campos, ["fecha_fin", "valor"])
  const fin = resultado.diferencias.find((d) => d.campo === "fecha_fin")
  assert.deepEqual(fin, { campo: "fecha_fin", antes: "2027-05-01", despues: "2027-11-01" })
})

test("msg-004 · duplicado: no se escribe nada", () => {
  const resultado = validar("msg-004")
  assert.equal(resultado.clasificacion, "duplicado")
  assert.equal(resultado.id_contrato_existente, "CT-2026-012")
  assert.deepEqual(resultado.requiere_revision, [])
  assert.deepEqual(resultado.diferencias, [])
  assert.match(resultado.avisos.join(" "), /ya está en el maestro/)
})

test("msg-006 · nuevo con revisión exactamente en (valor, fecha_fin)", () => {
  const resultado = validar("msg-006")
  assert.equal(resultado.clasificacion, "nuevo")
  // La lista del PRD §7.4, ni más ni menos: el valor 0 indeterminado y la fecha
  // derivada. El remitente desconocido se avisa, pero no bloquea (HU-3).
  assert.deepEqual(resultado.requiere_revision.sort(), ["fecha_fin", "valor"])
  assert.match(resultado.avisos.join(" "), /no está en comerciales.json/)
  assert.match(resultado.avisos.join(" "), /por demanda/)
  assert.match(resultado.motivos.join(" "), /confianza 0\.5/)
})

test("msg-005 · la cotización real se rechaza por no identificar a las partes", () => {
  const { maestro } = maestroTemporal()
  const contexto = contextoDe("msg-005", "cotizacion.txt")
  const resultado = clasificar(extraerContrato(contexto), maestro, {
    hoy: HOY,
    remitente: contexto.mensaje.de,
  })
  assert.equal(resultado.clasificacion, "rechazado")
  assert.match(resultado.motivo_rechazo ?? "", /las partes/)
  assert.deepEqual(resultado.requiere_revision, [])
})

test("RN3 · un documento sin número de contrato recibe uno automático del año de inicio", () => {
  const { maestro } = maestroTemporal()
  const extraccion = extraerContrato({
    mensaje: mensajeSintetico("msg-998", "cruiz@periferia-ficticia.com"),
    texto: [
      "CONTRATO DE PRESTACIÓN DE SERVICIOS",
      "",
      "Entre los suscritos, AGROEXPORT SULA S. DE R.L., identificada con RTN 08019995123456, con domicilio en San Pedro Sula,",
      "y PERIFERIA IT GROUP S.A.S., identificada con NIT 900.123.456-7, se celebra el presente contrato:",
      "",
      "PRIMERA. OBJETO. Capacitación en ciberseguridad para el personal administrativo de la planta.",
      "SEGUNDA. VALOR. El valor total será de TREINTA MIL DÓLARES (USD 30,000.00), más impuestos.",
      "TERCERA. PLAZO. El plazo será desde el primero (1) de febrero de 2027 hasta el treinta y uno (31) de julio de 2027.",
    ].join("\n"),
    comercial: "Carlos Ruiz Medina",
  })
  const resultado = clasificar(extraccion, maestro, { hoy: HOY, remitente: "cruiz@periferia-ficticia.com" })
  assert.equal(resultado.clasificacion, "nuevo")
  // El mismo cliente tiene CT-2026-009, pero con otro objeto: no es actualización.
  assert.deepEqual(resultado.requiere_revision, [])
  assert.match(resultado.avisos.join(" "), /se asignará AUTO-2027-001/)
  assert.equal(idParaRegistrar(extraccion.contrato, maestro, "2027"), "AUTO-2027-001")
})

test("RN2 · objeto idéntico con número nuevo se trata como actualización", () => {
  const { maestro } = maestroTemporal()
  // Es el objeto exacto de CT-2026-002 (Distribuidora Caribe) con otro número:
  // RN2 pide tratarlo como actualización para no duplicar la fila del cliente.
  const resultado = clasificar(
    extraerContrato({
      mensaje: mensajeSintetico("msg-997", "lgomez@periferia-ficticia.com"),
      texto: [
        "CONTRATO DE PRESTACIÓN DE SERVICIOS No. CT-2026-030",
        "",
        "Entre los suscritos, DISTRIBUIDORA CARIBE S.A.S., identificada con NIT 800.222.333-9, con domicilio en Barranquilla,",
        "y PERIFERIA IT GROUP S.A.S., con NIT 900.123.456-7, se celebra el presente contrato:",
        "",
        "PRIMERA. OBJETO. Desarrollo de portal de pedidos B2B.",
        "SEGUNDA. VALOR. El valor total será de NOVENTA MILLONES DE PESOS (COP $90.000.000).",
        "TERCERA. PLAZO. El plazo será desde el dos (2) de febrero de 2026 hasta el primero (1) de febrero de 2027.",
      ].join("\n"),
      comercial: "Laura Gómez Restrepo",
    }),
    maestro,
    { hoy: HOY, remitente: "lgomez@periferia-ficticia.com" },
  )
  assert.equal(resultado.clasificacion, "actualizacion")
  assert.equal(resultado.id_contrato_existente, "CT-2026-002")
  assert.deepEqual(resultado.requiere_revision, [])
  assert.match(resultado.avisos.join(" "), /se parece a CT-2026-002/)
})

test("un otrosí que modifica un contrato desconocido pide confirmación antes de crear la fila", () => {
  const { maestro } = maestroTemporal()
  const resultado = clasificar(
    extraerContrato({
      mensaje: mensajeSintetico("msg-996", "cruiz@periferia-ficticia.com"),
      texto: [
        "OTROSÍ No. 2 AL CONTRATO DE PRESTACIÓN DE SERVICIOS No. CT-2026-777",
        "",
        "Entre MINERA LOS ANDES S.A.C., identificada con RUC 20512345678, con domicilio en Lima,",
        "y PERIFERIA IT GROUP S.A.S., con NIT 900.123.456-7, se acuerda modificar:",
        "",
        "PRIMERA. Modificar la cláusula TERCERA (PLAZO), que quedará así: \"El plazo se extiende hasta el primero (1) de junio de 2028.\"",
      ].join("\n"),
      comercial: "Carlos Ruiz Medina",
    }),
    maestro,
    { hoy: HOY, remitente: "cruiz@periferia-ficticia.com" },
  )
  // No se rechaza (tiene partes), pero tampoco se escribe en silencio: como el
  // contrato original no está en el maestro, la fila que se crearía no tendría
  // objeto, valor, moneda ni fecha de inicio, así que se piden todos esos campos.
  assert.equal(resultado.clasificacion, "nuevo")
  assert.deepEqual(
    [...resultado.requiere_revision].sort(),
    ["fecha_inicio", "id_contrato", "moneda", "objeto", "valor"],
  )
  assert.match(resultado.motivos.join(" "), /no está en el maestro/)
  assert.match(resultado.motivos.join(" "), /el otrosí no trae objeto/)
})

test("rechazar() deja el resultado en el estado que espera el registro", () => {
  const resultado = rechazar("msg-995", "sin adjunto de contrato")
  assert.equal(resultado.clasificacion, "rechazado")
  assert.equal(resultado.motivo_rechazo, "sin adjunto de contrato")
  assert.deepEqual(resultado.requiere_revision, [])
  assert.deepEqual(resultado.avisos, [])
})

