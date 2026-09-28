/**
 * La API del backend (PRD §6.4).
 *
 * Se prueba contra la aplicación real con `app.inject()`: sin abrir puertos ni
 * procesos externos. El proveedor es el `mock`, así que las respuestas son
 * deterministas y no hace falta ningún modelo.
 *
 * Cada prueba monta su propia aplicación y su propio `OUT_DIR` temporal.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { cargarContextoAgente } from "../src/agent/prompt.ts"
import { crearAdaptadorMock, guionDemo } from "../src/llm/mock.ts"
import { crearAplicacion } from "../src/server/aplicacion.ts"

/** `solucion/`: la raíz desde la que las herramientas resuelven los fixtures. */
const RAIZ = path.resolve(import.meta.dirname, "..")
const temporales: string[] = []

/** Aplicación con `out/` temporal y el guion del PRD §11 (dos turnos). */
async function appDePrueba(): Promise<{ app: FastifyInstance; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto02-api-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir

  const contexto = cargarContextoAgente(RAIZ)
  if (!contexto.ok) throw new Error(`no se pudo cargar el contexto del agente: ${contexto.error}`)

  const app = await crearAplicacion({
    directorio: RAIZ,
    adaptador: crearAdaptadorMock(guionDemo()),
    prompt: contexto.data.prompt,
    conocimiento: contexto.data.conocimiento,
  })
  return { app, dir }
}

after(() => {
  delete process.env["OUT_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Contenido del maestro vivo de una ejecución. */
function maestro(dir: string): string {
  return fs.readFileSync(path.join(dir, "sharepoint", "maestro-contratos.csv"), "utf8")
}

test("GET /api/health describe proveedor, herramientas y buzón sin exponer claves", async () => {
  const { app } = await appDePrueba()
  const respuesta = await app.inject({ method: "GET", url: "/api/health" })
  assert.equal(respuesta.statusCode, 200)

  const cuerpo = respuesta.json() as {
    ok: boolean
    provider: string
    model: string
    herramientas: string[]
    buzon: { total: number; sin_procesar: number } | null
    sesiones: number
  }
  assert.equal(cuerpo.ok, true)
  assert.equal(cuerpo.provider, "mock")
  assert.equal(cuerpo.model, "guion")
  assert.deepEqual(cuerpo.herramientas, [
    "contratos_leer_buzon",
    "contratos_extraer",
    "contratos_validar",
    "contratos_registrar",
    "contratos_alertas",
  ])
  assert.deepEqual(cuerpo.buzon, { total: 6, sin_procesar: 6 })
  assert.equal(cuerpo.sesiones, 0)
  // Sin claves ni rutas del sistema en la respuesta pública
  assert.equal(respuesta.body.includes("sk-"), false)
  assert.equal(respuesta.body.includes(RAIZ), false)
})

test("POST /api/chat?json=1 ejecuta el turno del PRD §11 y deja la traza (CA4 · RN7)", async () => {
  const { app, dir } = await appDePrueba()
  const respuesta = await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: {
      sessionId: "api-prueba",
      message:
        "Procesa el buzón de este mes: registra lo que esté limpio y muéstrame lo que requiere revisión.",
    },
  })
  assert.equal(respuesta.statusCode, 200)

  const cuerpo = respuesta.json() as {
    ok: boolean
    sessionId: string
    reply: string
    needsConfirmation: boolean
    toolCalls: { nombre: string }[]
  }
  assert.equal(cuerpo.ok, true)
  assert.equal(cuerpo.sessionId, "api-prueba")
  assert.equal(cuerpo.needsConfirmation, true)
  assert.deepEqual(
    cuerpo.toolCalls.map((llamada) => llamada.nombre),
    ["contratos_leer_buzon", "contratos_extraer", "contratos_validar", "contratos_registrar", "contratos_validar"],
  )
  assert.match(cuerpo.reply, /msg-006/)

  // El maestro vivo: el limpio está, el dudoso no
  const filas = maestro(dir)
  assert.equal(filas.includes("CT-2026-015"), true)
  assert.equal(filas.includes("CM-2026-03"), false)

  // RN7: cada ejecución de herramienta deja su línea en out/log.jsonl
  const lineas = fs
    .readFileSync(path.join(dir, "log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((linea) => JSON.parse(linea) as { herramienta: string; ok: boolean })
  assert.equal(lineas.length >= 5, true)
  assert.equal(lineas.every((linea) => linea.ok), true)
})

test("la sesión sobrevive entre peticiones y GET /api/sessions/:id devuelve el historial", async () => {
  const { app } = await appDePrueba()
  const primera = await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: { sessionId: "api-dos-turnos", message: "procesa el buzón de este mes" },
  })
  assert.equal(primera.json().needsConfirmation, true)

  const segunda = await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: { sessionId: "api-dos-turnos", message: "confirmo el valor 0 y la fecha fin 2027-08-31" },
  })
  assert.equal(segunda.statusCode, 200)
  assert.equal(segunda.json().needsConfirmation, false)

  const sesion = await app.inject({ method: "GET", url: "/api/sessions/api-dos-turnos" })
  assert.equal(sesion.statusCode, 200)
  const cuerpo = sesion.json() as { data: { mensajes: { rol: string }[]; pendiente: unknown } }
  const roles = cuerpo.data.mensajes.map((mensaje) => mensaje.rol)
  assert.equal(roles.includes("user"), true)
  assert.equal(roles.includes("tool"), true)
  assert.equal(cuerpo.data.pendiente, null)
})

test("POST /api/chat sin ?json=1 responde con un stream SSE de eventos", async () => {
  const { app } = await appDePrueba()
  const respuesta = await app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { sessionId: "api-sse", message: "procesa el buzón de este mes" },
  })

  assert.equal(respuesta.statusCode, 200)
  assert.match(String(respuesta.headers["content-type"]), /text\/event-stream/)
  // El front (F4) necesita ver el arranque, cada llamada y el cierre
  assert.match(respuesta.body, /"tipo":"inicio"/)
  assert.match(respuesta.body, /"tipo":"llamada"/)
  assert.match(respuesta.body, /"tipo":"resultado"/)
  assert.match(respuesta.body, /"tipo":"fin"/)
  assert.match(respuesta.body, /\[DONE\]/)
})

test("la API sirve lo generado y no deja salir de out/ (PRD §6.4 · §8)", async () => {
  const { app } = await appDePrueba()
  await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: { sessionId: "api-ficheros", message: "procesa el buzón de este mes" },
  })

  const archivo = await app.inject({
    method: "GET",
    url: "/api/files/sharepoint/maestro-contratos.csv",
  })
  assert.equal(archivo.statusCode, 200)
  assert.match(String(archivo.headers["content-type"]), /text\/csv/)
  assert.equal(archivo.body.includes("CT-2026-015"), true)

  // Un intento de salir de out/ no puede servir nada de fuera del directorio
  const escapes = [
    "/api/files/..%2F..%2Fpackage.json",
    "/api/files/sharepoint%2F..%2F..%2Fpackage.json",
  ]
  for (const ruta of escapes) {
    const fuera = await app.inject({ method: "GET", url: ruta })
    assert.equal([400, 404].includes(fuera.statusCode), true, `respuesta rara en ${ruta}`)
    assert.equal(fuera.body.includes('"name": "reto-02-agente-contratos"'), false, `se filtró ${ruta}`)
  }
})

test("las peticiones mal formadas se rechazan con 400 sin tumbar el servidor", async () => {
  const { app } = await appDePrueba()

  const sinMensaje = await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: { sessionId: "api-errores" },
  })
  assert.equal(sinMensaje.statusCode, 400)

  const sesionRara = await app.inject({
    method: "POST",
    url: "/api/chat?json=1",
    payload: { sessionId: "../etc/passwd", message: "hola" },
  })
  assert.equal(sesionRara.statusCode, 400)

  // Tras los dos errores el servicio sigue atendiendo
  const sano = await app.inject({ method: "GET", url: "/api/health" })
  assert.equal(sano.statusCode, 200)
  assert.equal((sano.json() as { ok: boolean }).ok, true)
})
