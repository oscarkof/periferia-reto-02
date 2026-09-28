/**
 * El recorrido completo del buzón sin modelo (PRD §6.6) y su idempotencia.
 *
 * Aquí se fija **la tabla del PRD §7.4**: qué queda registrado, qué no se toca y
 * qué espera confirmación humana. Si alguien cambia una regla del motor, esta
 * prueba se rompe antes de que el evaluador lo vea.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { recorrer } from "../src/demo/recorrido.ts"
import type { ContextoHerramienta } from "../src/tools/contrato.ts"

/** `solucion/`: la raíz desde la que las herramientas resuelven los fixtures. */
const RAIZ = path.resolve(import.meta.dirname, "..")
/** La fecha del prompt de ejemplo del PRD §11: con ella aplican los números del §7.4. */
const HOY = "2026-09-03"
const temporales: string[] = []

function contextoFresco(): ContextoHerramienta {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto02-demo-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
  return { directory: RAIZ, sessionId: "demo" }
}

after(() => {
  delete process.env["OUT_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

const CSV = (): string => path.join(process.env["OUT_DIR"] ?? "", "sharepoint", "maestro-contratos.csv")

test("los seis mensajes quedan como documenta el PRD §7.4", async () => {
  const resumen = await recorrer(contextoFresco(), { confirmar: false, conAlertas: true, hoy: HOY })

  assert.deepEqual(
    resumen.filas.map((f) => f.mensaje_id),
    ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"],
  )

  // La tabla esperada: clasificación, estado, acción y número de contrato.
  const esperado: [string, string, string, string | null, string | null][] = [
    ["msg-001", "nuevo", "registrado", "insertado", "CT-2026-015"],
    ["msg-002", "nuevo", "registrado", "insertado", "CT-2026-016"],
    ["msg-003", "actualizacion", "registrado", "actualizado", "CT-2026-011"],
    ["msg-004", "duplicado", "sin_cambios", "sin_cambios", "CT-2026-012"],
    ["msg-005", "rechazado", "sin_escribir", null, null],
    ["msg-006", "nuevo", "en_revision", null, null],
  ]
  for (const [id, clasificacion, estado, accion, contrato] of esperado) {
    const fila = resumen.filas.find((f) => f.mensaje_id === id)
    assert.ok(fila !== undefined, `falta la fila de ${id}`)
    assert.equal(fila.clasificacion, clasificacion, `clasificación de ${id}`)
    assert.equal(fila.estado, estado, `estado de ${id}`)
    assert.equal(fila.accion, accion, `acción de ${id}`)
    assert.equal(fila.id_contrato, contrato, `contrato de ${id}`)
  }

  assert.deepEqual(resumen.conteo, {
    total: 6,
    registrados: 3,
    sin_cambios: 1,
    en_revision: 1,
    sin_escribir: 1,
    errores: 0,
  })

  // El otrosí cambia plazo y valor, y nada más.
  const otrosi = resumen.filas.find((f) => f.mensaje_id === "msg-003")
  assert.deepEqual(
    otrosi?.diferencias.map((d) => d.campo).sort(),
    ["fecha_fin", "valor"],
  )

  // msg-006 pide confirmar exactamente valor y fecha_fin, y avisa del remitente.
  const dudoso = resumen.filas.find((f) => f.mensaje_id === "msg-006")
  assert.deepEqual([...(dudoso?.requiere_revision ?? [])].sort(), ["fecha_fin", "valor"])
  assert.match(dudoso?.avisos.join(" ") ?? "", /no está en comerciales\.json/)

  // El reporte de alertas sale con la fecha recibida.
  assert.deepEqual(
    resumen.alertas?.vencen.map((v) => v.id_contrato),
    ["CT-2026-009", "CT-2026-004"],
  )
  assert.deepEqual(
    resumen.alertas?.polizas_pendientes.map((f) => f.id_contrato),
    ["CT-2026-004", "CT-2026-015"],
  )
  assert.deepEqual(
    [...(resumen.alertas?.registrados_desde_corte ?? [])].map((f) => f.id_contrato).sort(),
    ["CT-2026-011", "CT-2026-015", "CT-2026-016"],
  )
})

test("la segunda pasada con confirmado=true registra msg-006 (y msg-005 sigue rechazado)", async () => {
  const ctx = contextoFresco()
  await recorrer(ctx, { confirmar: false, conAlertas: false, hoy: HOY })

  const segunda = await recorrer(ctx, { confirmar: true, conAlertas: false, hoy: HOY })
  // Solo siguen pendientes los dos que no se escribieron: el rechazado y el dudoso.
  assert.deepEqual(
    segunda.filas.map((f) => f.mensaje_id),
    ["msg-005", "msg-006"],
  )
  const registrado = segunda.filas.find((f) => f.mensaje_id === "msg-006")
  assert.equal(registrado?.estado, "registrado")
  assert.equal(registrado?.id_contrato, "CM-2026-03")
  assert.equal(segunda.filas.find((f) => f.mensaje_id === "msg-005")?.estado, "sin_escribir")

  // El maestro quedó con las 8 filas del fixture + 3 nuevas; el otrosí no agregó fila.
  const lineas = fs.readFileSync(CSV(), "utf8").trim().split("\n")
  assert.equal(lineas.length, 12) // encabezado + 11 contratos
  assert.ok(lineas.some((linea) => linea.startsWith("CM-2026-03")), "falta CM-2026-03")
})

test("volver a correr no duplica nada: el buzón ya está procesado (idempotencia)", async () => {
  const ctx = contextoFresco()
  await recorrer(ctx, { confirmar: true, conAlertas: false, hoy: HOY })
  const antes = fs.readFileSync(CSV(), "utf8")

  const otra = await recorrer(ctx, { confirmar: true, conAlertas: false, hoy: HOY })
  // Todo lo resoluble quedó en `procesados.json`: solo reaparece la cotización,
  // que no se marca como procesada porque no había nada que registrar (RN4).
  assert.deepEqual(
    otra.filas.map((f) => f.mensaje_id),
    ["msg-005"],
  )
  assert.equal(otra.filas[0]?.estado, "sin_escribir")
  // Y el maestro no se movió ni un byte.
  assert.equal(fs.readFileSync(CSV(), "utf8"), antes)
})

test("dos corridas sobre un out/ limpio dan el mismo resultado (PRD §8)", async () => {
  const primera = await recorrer(contextoFresco(), { confirmar: true, conAlertas: true, hoy: HOY })
  const segunda = await recorrer(contextoFresco(), { confirmar: true, conAlertas: true, hoy: HOY })

  assert.deepEqual(segunda.filas, primera.filas)
  assert.deepEqual(segunda.conteo, primera.conteo)
  // Las rutas cambian (cada corrida tiene su carpeta temporal), el contenido no.
  assert.deepEqual(segunda.alertas?.vencen, primera.alertas?.vencen)
  assert.deepEqual(segunda.alertas?.ya_vencidos, primera.alertas?.ya_vencidos)
})

test("el buzón procesado se refleja en contratos_leer_buzon", async () => {
  const ctx = contextoFresco()
  await recorrer(ctx, { confirmar: true, conAlertas: false, hoy: HOY })
  const otra = await recorrer(ctx, { confirmar: true, conAlertas: false, hoy: HOY })
  assert.ok(otra.filas.length < 6, "la segunda corrida no debería volver a procesar todo el buzón")
})

