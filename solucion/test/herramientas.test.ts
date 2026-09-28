/**
 * Contrato de las cinco herramientas: forma de la respuesta, auditoría
 * anti-alucinación y la regla de confirmación humana (PRD §6.2 · CA2 · RN5).
 *
 * Cada prueba trabaja sobre un `OUT_DIR` temporal, así que el `out/` del
 * repositorio no se toca y las pruebas pueden correr en cualquier orden.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { alertas, extraer, leer_buzon, registrar, validar } from "../src/tools/contratos.ts"
import type { ContextoHerramienta } from "../src/tools/contrato.ts"
import type { Contrato } from "../src/core/tipos.ts"

/** `solucion/`: la raíz desde la que las herramientas resuelven los fixtures. */
const RAIZ = path.resolve(import.meta.dirname, "..")
const temporales: string[] = []

/** Contexto con su propio `out/` temporal: aislamiento total entre pruebas. */
function contextoFresco(): ContextoHerramienta {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto02-tools-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
  return { directory: RAIZ, sessionId: "prueba" }
}

after(() => {
  delete process.env["OUT_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Lee la respuesta de una herramienta y falla si no es `{ ok: true }`. */
function datos<T>(respuesta: string): T {
  const cuerpo = JSON.parse(respuesta) as { ok: boolean; data?: T; error?: string }
  assert.equal(cuerpo.ok, true, `la herramienta falló: ${cuerpo.error ?? "sin detalle"}`)
  return cuerpo.data as T
}

/** Lee la respuesta esperando un error y devuelve su mensaje. */
function errorDe(respuesta: string): string {
  const cuerpo = JSON.parse(respuesta) as { ok: boolean; error?: string }
  assert.equal(cuerpo.ok, false, `se esperaba un error y llegó: ${respuesta.slice(0, 120)}`)
  return cuerpo.error ?? ""
}

const CSV = (): string => path.join(process.env["OUT_DIR"] ?? "", "sharepoint", "maestro-contratos.csv")

test("contratos_leer_buzon lista los seis mensajes y marca los que traen contrato", async () => {
  const ctx = contextoFresco()
  const { mensajes } = datos<{ mensajes: { id: string; tiene_contrato: boolean }[] }>(
    await leer_buzon.execute({}, ctx),
  )
  assert.equal(mensajes.length, 6)
  assert.deepEqual(
    mensajes.map((m) => m.tiene_contrato),
    [true, true, true, true, false, true],
  )
})

test("contratos_extraer devuelve el contrato con su confianza y su evidencia", async () => {
  const ctx = contextoFresco()
  const extraccion = datos<{ contrato: Contrato; confianza: Record<string, number> }>(
    await extraer.execute({ mensaje_id: "msg-001" }, ctx),
  )
  assert.equal(extraccion.contrato.id_contrato, "CT-2026-015")
  assert.equal(extraccion.contrato.valor, 265000000)
  assert.equal(extraccion.confianza["valor"], 0.99)
})

test("contratos_extraer explica por qué una cotización no se puede extraer (RN4)", async () => {
  const ctx = contextoFresco()
  const mensaje = errorDe(await extraer.execute({ mensaje_id: "msg-005" }, ctx))
  assert.match(mensaje, /no trae un adjunto de contrato/)
  assert.match(mensaje, /RN4/)
})

test("un mensaje inexistente o con id raro da error legible, no una traza", async () => {
  const ctx = contextoFresco()
  assert.match(errorDe(await extraer.execute({ mensaje_id: "msg-999" }, ctx)), /no se pudo leer/)
  assert.match(errorDe(await extraer.execute({ mensaje_id: "../../etc/passwd" }, ctx)), /inválido/)
})

test("contratos_validar clasifica y dice qué exige confirmación humana", async () => {
  const ctx = contextoFresco()
  const nuevo = datos<{ clasificacion: string; requiere_revision: string[] }>(
    await validar.execute({ mensaje_id: "msg-002" }, ctx),
  )
  assert.equal(nuevo.clasificacion, "nuevo")
  assert.deepEqual(nuevo.requiere_revision, [])

  const dudoso = datos<{ requiere_revision: string[] }>(
    await validar.execute({ mensaje_id: "msg-006" }, ctx),
  )
  assert.deepEqual([...dudoso.requiere_revision].sort(), ["fecha_fin", "valor"])

  const cotizacion = datos<{ clasificacion: string; motivo_rechazo: string }>(
    await validar.execute({ mensaje_id: "msg-005" }, ctx),
  )
  assert.equal(cotizacion.clasificacion, "rechazado")
  assert.match(cotizacion.motivo_rechazo, /no trae un adjunto de contrato/)
})

test("CA2 · un valor propuesto que no está en el documento va a revisión y no se usa", async () => {
  const ctx = contextoFresco()
  // El modelo «redondea» el valor de msg-001 (265 000 000 → 300 000 000).
  const propuesta = {
    mensaje_id: "msg-001",
    contrato: { valor: 300000000, id_contrato: "CT-2026-015", cliente: "INDUSTRIAS DELTA S.A.S." },
  }
  const validado = datos<{ clasificacion: string; requiere_revision: string[]; avisos: string[] }>(
    await validar.execute(propuesta, ctx),
  )
  assert.equal(validado.clasificacion, "nuevo")
  assert.ok(validado.requiere_revision.includes("valor"), "el valor alterado debe ir a revisión")
  assert.match(validado.avisos.join(" "), /no se usaron .* propuestos/)

  // Sin confirmación explícita no se escribe: el registro se niega.
  assert.match(errorDe(await registrar.execute(propuesta, ctx)), /requiere revisión/)
  // Y lo que manda es el documento, no la propuesta. El maestro ya existe como
  // copia de trabajo (RN6), pero **no** tiene la fila del contrato.
  assert.equal(fs.readFileSync(CSV(), "utf8").includes("CT-2026-015"), false)
})

test("RN5 · msg-006 solo se registra cuando llega confirmado=true", async () => {
  const ctx = contextoFresco()
  assert.match(
    errorDe(await registrar.execute({ mensaje_id: "msg-006" }, ctx)),
    /requiere revisión antes de registrar: valor, fecha_fin/,
  )

  const registrado = datos<{ id_contrato: string; accion: string; ruta_archivo: string }>(
    await registrar.execute({ mensaje_id: "msg-006", confirmado: true }, ctx),
  )
  assert.equal(registrado.id_contrato, "CM-2026-03")
  assert.equal(registrado.accion, "insertado")
  assert.match(registrado.ruta_archivo, /^Contratos\/2026\/distribuidora-caribe\/CM-2026-03\.txt$/)

  // La fila quedó con el valor 0 acordado y la fecha derivada, no con otra cosa.
  const fila = fs
    .readFileSync(CSV(), "utf8")
    .split("\n")
    .find((linea) => linea.startsWith("CM-2026-03"))
  assert.ok(fila !== undefined, "la fila de CM-2026-03 debería estar en el maestro")
  assert.match(fila, /,0,COP,2026-08-31,2027-08-31,/)
})

test("registrar deja archivo, historial y mensaje marcado; y repetirlo no duplica", async () => {
  const ctx = contextoFresco()
  const salida = process.env["OUT_DIR"] ?? ""

  const primero = datos<{ accion: string }>(await registrar.execute({ mensaje_id: "msg-001" }, ctx))
  assert.equal(primero.accion, "insertado")

  const archivado = path.join(salida, "sharepoint", "Contratos", "2026", "industrias-delta", "CT-2026-015.txt")
  assert.equal(fs.existsSync(archivado), true)
  assert.match(fs.readFileSync(path.join(salida, "sharepoint", "historial.jsonl"), "utf8"), /CT-2026-015/)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(salida, "procesados.json"), "utf8")), ["msg-001"])

  // Repetir el mismo mensaje no duplica: la fila ya está idéntica (RN1).
  const segundo = datos<{ accion: string }>(await registrar.execute({ mensaje_id: "msg-001" }, ctx))
  assert.equal(segundo.accion, "sin_cambios")
  const filas = fs
    .readFileSync(CSV(), "utf8")
    .split("\n")
    .filter((linea) => linea.startsWith("CT-2026-015"))
  assert.equal(filas.length, 1)
})

test("una actualización conserva lo que el otrosí no toca", async () => {
  const ctx = contextoFresco()
  datos(await registrar.execute({ mensaje_id: "msg-003" }, ctx))
  const fila = fs
    .readFileSync(CSV(), "utf8")
    .split("\n")
    .find((linea) => linea.startsWith("CT-2026-011"))
  assert.ok(fila !== undefined)
  // El otrosí cambia valor y fecha de fin; el objeto y el inicio siguen siendo los de mayo.
  assert.match(fila, /,520000,PEN,2026-05-02,2027-11-01,/)
  assert.match(fila, /Célula ágil de desarrollo/)
})

test("contratos_alertas escribe el reporte con la fecha recibida", async () => {
  const ctx = contextoFresco()
  const reporte = datos<{ vencen: { id_contrato: string }[]; ruta: string }>(
    await alertas.execute({ hoy: "2026-09-03" }, ctx),
  )
  assert.deepEqual(
    reporte.vencen.map((v) => v.id_contrato),
    ["CT-2026-009", "CT-2026-004"],
  )
  assert.equal(fs.existsSync(reporte.ruta), true)
  assert.match(fs.readFileSync(reporte.ruta, "utf8"), /## 1\. Vencen en los próximos 60 días/)

  // Una fecha inválida no rompe nada: devuelve error legible.
  assert.match(errorDe(await alertas.execute({ hoy: "03/09/2026" }, ctx)), /AAAA-MM-DD/)
})

test("cada ejecución deja su línea en out/log.jsonl (RN7 · CA4)", async () => {
  const ctx = contextoFresco()
  await leer_buzon.execute({}, ctx)
  await validar.execute({ mensaje_id: "msg-002" }, ctx)
  const lineas = fs
    .readFileSync(path.join(process.env["OUT_DIR"] ?? "", "log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((linea) => JSON.parse(linea) as { herramienta: string; mensaje_id: string | null; ok: boolean })
  assert.deepEqual(
    lineas.map((l) => l.herramienta),
    ["contratos_leer_buzon", "contratos_validar"],
  )
  assert.equal(lineas[1]?.mensaje_id, "msg-002")
  assert.equal(lineas.every((l) => l.ok), true)
})

