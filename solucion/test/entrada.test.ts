/**
 * Entrada del proceso: el buzón y el maestro (HU-1 · RN6).
 *
 * Dos cosas que importan y que se fijan aquí:
 *   · **RN6**: el maestro del fixture es de solo lectura; la primera carga lo
 *     copia a `out/` y desde ahí se trabaja, byte a byte igual.
 *   · **HU-1**: un correo con una cotización no es un contrato, y eso se decide
 *     antes de gastar un turno del modelo.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { adjuntoContrato, leerMensaje, listarBuzon } from "../src/core/buzon.ts"
import { buscarPorContrato, candidatoPorCliente, cargarMaestro, guardarMaestro, siguienteAuto } from "../src/core/maestro.ts"
import { dirMensaje, validarIdMensaje } from "../src/core/rutas.ts"
import { FIXTURES, BUZON, dirTemporal, leerMensaje as leerMensajeFixture } from "../test-utils/fixtures.ts"

test("listarBuzon devuelve los seis mensajes ordenados", () => {
  const mensajes = listarBuzon(BUZON)
  assert.equal(mensajes.ok, true)
  if (!mensajes.ok) return
  assert.deepEqual(
    mensajes.data.map((m) => m.id),
    ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"],
  )
  assert.equal(mensajes.data[0]?.de, "lgomez@periferia-ficticia.com")
})

test("un id de mensaje raro se rechaza con mensaje legible", () => {
  const malo = validarIdMensaje("../../etc/passwd")
  assert.equal(malo.ok, false)
  if (malo.ok) return
  assert.match(malo.error, /msg-001/)
  assert.equal(dirMensaje("msg-1").ok, false)
  assert.equal(dirMensaje("msg-001").ok, true)
  const inexistente = leerMensaje(BUZON, "msg-404")
  assert.equal(inexistente.ok, false)
  if (inexistente.ok) return
  assert.match(inexistente.error, /no se pudo leer el correo/)
})

test("se distingue un contrato, un otrosí y una cotización", () => {
  const contrato = adjuntoContrato(leerMensajeFixture("msg-001"), path.join(BUZON, "msg-001"))
  assert.deepEqual(contrato, { archivo: "contrato.txt", clase: "contrato" })

  const otrosi = adjuntoContrato(leerMensajeFixture("msg-003"), path.join(BUZON, "msg-003"))
  assert.deepEqual(otrosi, { archivo: "otrosi.txt", clase: "otrosi" })

  // msg-005 es una cotización: no hay contrato que registrar (RN4).
  const ninguno = adjuntoContrato(leerMensajeFixture("msg-005"), path.join(BUZON, "msg-005"))
  assert.equal(ninguno, null)
})

test("RN6 · cargar el maestro lo copia a out/ y deja el fixture intacto", () => {
  const dir = dirTemporal("reto02-rn6")
  const destino = path.join(dir, "sharepoint", "maestro-contratos.csv")
  const fixture = path.join(FIXTURES, "maestro-contratos.csv")
  const antesDelFixture = fs.readFileSync(fixture, "utf8")

  assert.equal(fs.existsSync(destino), false)
  const cargado = cargarMaestro(fixture, destino)
  assert.equal(cargado.ok, true)
  if (!cargado.ok) return
  assert.equal(fs.existsSync(destino), true)
  assert.equal(fs.readFileSync(destino, "utf8"), antesDelFixture)
  assert.equal(fs.readFileSync(fixture, "utf8"), antesDelFixture)
  assert.equal(cargado.data.filas.length, 8)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("los dos índices del maestro responden por número y por cliente", () => {
  const dir = dirTemporal("reto02-indices")
  const fixture = path.join(FIXTURES, "maestro-contratos.csv")
  const cargado = cargarMaestro(fixture, path.join(dir, "maestro-contratos.csv"))
  assert.equal(cargado.ok, true)
  if (!cargado.ok) return
  const maestro = cargado.data

  // Por número, sin importar mayúsculas.
  assert.equal(buscarPorContrato(maestro, "ct-2026-012")?.cliente, "Clínica San Rafael S.A.")
  assert.equal(buscarPorContrato(maestro, "CT-2026-999"), null)

  // Por cliente: Corporación Andina tiene un contrato, y su objeto no se parece
  // al del contrato marco de Distribuidora Caribe.
  const candidato = candidatoPorCliente(maestro, "1790012345001", "Fábrica de software")
  assert.equal(candidato?.fila.id_contrato, "CT-2026-007")
  assert.ok((candidato?.similitud ?? 1) < 0.9)

  // Sin datos de cliente no hay candidato que proponer.
  assert.equal(candidatoPorCliente(maestro, null, "lo que sea"), null)
  assert.equal(candidatoPorCliente(maestro, "800222333", null), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("el número automático sigue la secuencia del año", () => {
  const dir = dirTemporal("reto02-auto")
  const cargado = cargarMaestro(
    path.join(FIXTURES, "maestro-contratos.csv"),
    path.join(dir, "maestro-contratos.csv"),
  )
  assert.equal(cargado.ok, true)
  if (!cargado.ok) return
  assert.equal(siguienteAuto(cargado.data.filas, "2026"), "AUTO-2026-001")
  assert.equal(siguienteAuto(cargado.data.filas, "2027"), "AUTO-2027-001")

  const conUno = guardarMaestro(path.join(dir, "otro.csv"), cargado.data.filas)
  assert.equal(conUno.ok, true)
  fs.rmSync(dir, { recursive: true, force: true })
})
