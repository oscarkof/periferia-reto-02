/**
 * Alertas de vencimiento y pólizas (HU-5).
 *
 * Lo que importa fijar son los **bordes**: el contrato que vence dentro de la
 * ventana frente al que se queda fuera por días, y que la fecha de referencia
 * entre como argumento (si dependiera del reloj, el reporte no sería comparable
 * entre corridas).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { alertasMarkdown, generarAlertas, CORTE_MAESTRO, VENTANA_DIAS } from "../src/core/alertas.ts"
import { maestroTemporal } from "../test-utils/fixtures.ts"
import type { FilaMaestro } from "../src/core/tipos.ts"

const HOY = "2026-09-03"

/** Fila mínima para probar una fecha límite concreta. */
function fila(fechaFin: string, extra: Partial<FilaMaestro> = {}): FilaMaestro {
  return {
    id_contrato: "CT-2026-900",
    cliente: "Cliente de prueba S.A.S.",
    nit_cliente: "900000000",
    pais: "CO",
    objeto: "Objeto de prueba",
    valor: 1000,
    moneda: "COP",
    fecha_inicio: "2026-01-01",
    fecha_fin: fechaFin,
    requiere_poliza: false,
    tipo_poliza: "",
    estado_poliza: "no_aplica",
    comercial: "Laura Gómez Restrepo",
    ruta_sharepoint: "Contratos/2026/cliente-de-prueba/CT-2026-900.txt",
    fecha_registro: "2026-01-02",
    fuente: "buzon",
    ...extra,
  }
}

test("el maestro real con hoy=2026-09-03 da las tres secciones esperadas", () => {
  const { maestro } = maestroTemporal()
  const reporte = generarAlertas(maestro.filas, HOY)
  assert.deepEqual(
    reporte.vencen.map((v) => v.id_contrato),
    ["CT-2026-009", "CT-2026-004"],
  )
  assert.deepEqual(
    reporte.polizas_pendientes.map((f) => f.id_contrato),
    ["CT-2026-004"],
  )
  // Nada del maestro se registró después del corte: el hueco es real.
  assert.deepEqual(reporte.registrados_desde_corte, [])
  assert.deepEqual(
    reporte.ya_vencidos.map((v) => v.id_contrato),
    ["CT-2026-002", "CT-2025-018"],
  )
})

test("el borde de la ventana: 60 días entra, 61 no", () => {
  const dentro = generarAlertas([fila("2026-11-02")], HOY)
  const fuera = generarAlertas([fila("2026-11-03")], HOY)
  assert.equal(dentro.vencen.length, 1)
  assert.equal(dentro.vencen[0]?.dias_restantes, VENTANA_DIAS)
  assert.equal(fuera.vencen.length, 0)
  assert.equal(fuera.ya_vencidos.length, 0)
})

test("un contrato vencido ayer no entra en «vencen»", () => {
  const reporte = generarAlertas([fila("2026-09-02")], HOY)
  assert.equal(reporte.vencen.length, 0)
  assert.equal(reporte.ya_vencidos.length, 1)
})

test("una póliza vigente no aparece como pendiente", () => {
  const reporte = generarAlertas(
    [],
    HOY,
  )
  assert.deepEqual(reporte.polizas_pendientes, [])
  const conPoliza = generarAlertas(
    [fila("2027-01-01", { requiere_poliza: true, estado_poliza: "pendiente" }), fila("2027-01-01", { id_contrato: "CT-2026-901", requiere_poliza: true, estado_poliza: "vigente" })],
    HOY,
  )
  assert.deepEqual(
    conPoliza.polizas_pendientes.map((f) => f.id_contrato),
    ["CT-2026-900"],
  )
})

test("lo registrado después del corte se lista por fecha", () => {
  const reporte = generarAlertas(
    [
      fila("2027-01-01", { id_contrato: "CT-2026-902", fecha_registro: "2026-08-20" }),
      fila("2027-01-01", { id_contrato: "CT-2026-903", fecha_registro: CORTE_MAESTRO }),
      fila("2027-01-01", { id_contrato: "CT-2026-904", fecha_registro: "2026-05-29" }),
    ],
    HOY,
  )
  assert.deepEqual(
    reporte.registrados_desde_corte.map((f) => f.id_contrato),
    ["CT-2026-903", "CT-2026-902"],
  )
})

test("el reporte en Markdown trae las cuatro secciones y la fecha de referencia", () => {
  const { maestro } = maestroTemporal()
  const markdown = alertasMarkdown(generarAlertas(maestro.filas, HOY))
  assert.match(markdown, new RegExp(`Fecha de referencia: \\*\\*${HOY}\\*\\*`))
  assert.match(markdown, /## 1\. Vencen/)
  assert.match(markdown, /## 2\. Pólizas pendientes/)
  assert.match(markdown, /## 3\. Registrados desde el corte/)
  assert.match(markdown, /## Contexto: contratos ya vencidos/)
  assert.match(markdown, /CT-2026-009/)
})

test("una fila con fecha de fin ilegible no rompe el reporte", () => {
  const reporte = generarAlertas([fila(""), fila("2027-01-01", { id_contrato: "CT-2026-905" })], HOY)
  // La fila sin fecha válida no entra en ningún cálculo de vencimiento, pero
  // tampoco tumba el reporte: los demás siguen contándose.
  assert.equal(reporte.vencen.length + reporte.ya_vencidos.length, 0)
  assert.equal(reporte.polizas_pendientes.length, 0)
  // Las dos filas tienen fecha_registro 2026-01-02, anterior al corte (2026-05-30).
  assert.equal(reporte.registrados_desde_corte.length, 0)
})
