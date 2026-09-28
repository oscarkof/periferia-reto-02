/**
 * El front del chat, ejecutado de verdad (PRD §6.1 · §6.5 · CA3 · CA4).
 *
 * Se probaban el HTML, el CSS y el parser SSE, pero no el guion que los une: así
 * llega a la pantalla un botón que no hace nada con la suite entera en verde.
 * Aquí `web/app.js` se carga en un contexto con DOM falso (`test-utils/front.ts`)
 * y su `fetch` se conecta al backend real con `app.inject()`, así que lo que se
 * recorre es el camino completo: arranque, stream SSE troceado a propósito,
 * tarjetas de herramienta, confirmación humana por el botón y fallos.
 *
 * Cada prueba monta su servidor con el guion del PRD §11 y su propio `OUT_DIR`
 * temporal: el `out/` del repositorio no se toca.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { dirProyecto } from "../src/core/rutas.ts"
import { crearAdaptadorMock, guionDemo } from "../src/llm/mock.ts"
import { crearAplicacion } from "../src/server/aplicacion.ts"
import { crearMemoria } from "../src/server/memoria.ts"
import { cargarFront, conClase, type Front, type Nodo } from "../test-utils/front.ts"

/** El mensaje del PRD §11, el mismo que el front ofrece como primer ejemplo. */
const PROMPT_PRD =
  "Procesa el buzón de este mes: registra lo que esté limpio y muéstrame lo que requiere revisión."

const apps: FastifyInstance[] = []
const temporales: string[] = []

after(async () => {
  for (const app of apps) await app.close()
  delete process.env["OUT_DIR"]
  for (const carpeta of temporales) fs.rmSync(carpeta, { recursive: true, force: true })
})

/** Servidor real con el guion de la demo, sobre un `out/` temporal. */
async function montar(): Promise<FastifyInstance> {
  const salida = fs.mkdtempSync(path.join(os.tmpdir(), "reto02-front-"))
  temporales.push(salida)
  process.env["OUT_DIR"] = salida

  const app = await crearAplicacion({
    directorio: dirProyecto(),
    adaptador: crearAdaptadorMock(guionDemo()),
    prompt: "comportamiento de prueba",
    conocimiento: "conocimiento de prueba",
    memoria: crearMemoria(),
  })
  apps.push(app)
  return app
}

/** El único nodo con esa clase, o falla diciendo cuántos hay. */
function soloUno(nodos: Nodo[], que: string): Nodo {
  assert.equal(nodos.length, 1, `se esperaba un solo ${que} y hay ${nodos.length}`)
  const nodo = nodos[0]
  if (nodo === undefined) throw new Error(`no se pintó ${que}`)
  return nodo
}

/** Cuerpo JSON de la última petición al chat. */
function cuerpoDelChat(front: Front): { sessionId?: string; message?: string } {
  const peticiones = front.peticiones.filter((peticion) => peticion.url === "/api/chat")
  const ultima = peticiones[peticiones.length - 1]
  assert.ok(ultima !== undefined, "el front no llegó a pedir un turno al backend")
  return JSON.parse(ultima.cuerpo) as { sessionId?: string; message?: string }
}

/** Maestro vivo de esta ejecución: `out/sharepoint/maestro-contratos.csv`. */
function maestro(): string {
  return fs.readFileSync(
    path.join(process.env["OUT_DIR"] ?? "", "sharepoint", "maestro-contratos.csv"),
    "utf8",
  )
}

/* ── Arranque ─────────────────────────────────────────────────────────────── */

test("el front arranca contra el backend y pinta cabecera, buzón y ejemplos", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  assert.match(front.nodo("#estado-servidor").textContent, /·/, "la cabecera muestra proveedor y modelo")
  assert.match(
    front.nodo("#casos").textContent,
    /Buzón: 6 mensajes · 6 sin procesar/,
    "el panel lateral dice cómo está el buzón",
  )
  assert.equal(front.nodo("#sugerencias").children.length, 3, "los tres ejemplos de mensaje")
  assert.equal(front.nodo("#entrada").value, "", "el campo de entrada empieza vacío")
  assert.equal(front.nodo("#pensando").hidden, true, "el indicador de trabajo empieza oculto")
  assert.equal(front.nodo("#confirmacion").hidden, true, "no hay nada pendiente de confirmar al arrancar")
  assert.match(front.nodo("#archivos").textContent, /procesa el buzón/)
})

/* ── Un turno completo ────────────────────────────────────────────────────── */

test("un turno pinta una tarjeta por herramienta, la banda de confirmación y los archivos (CA3 · CA4)", async () => {
  const app = await montar()
  const front = await cargarFront(app)
  await front.listo()

  await front.llamar("enviar", PROMPT_PRD)

  const tarjetas = conClase(front.nodo("#conversacion"), "llamada")
  assert.equal(tarjetas.length, 5, `una tarjeta por llamada del guion y hay ${tarjetas.length}`)
  assert.deepEqual(
    tarjetas.map((tarjeta) => tarjeta.querySelector(".llamada__nombre")?.textContent ?? ""),
    [
      "Leer buzón",
      "Extraer contrato",
      "Validar y clasificar",
      "Registrar en el maestro",
      "Validar y clasificar",
    ],
    "las tarjetas llevan el nombre legible de cada herramienta",
  )
  assert.equal(conClase(front.nodo("#conversacion"), "llamada--ok").length, 5, "todas fueron bien")

  // CA3 · RN5: el turno cierra pidiendo confirmación, y el front lo resalta
  assert.equal(front.nodo("#confirmacion").hidden, false, "la banda de confirmación está visible")
  assert.match(front.nodo("#confirmacion-detalle").textContent, /msg-006/)

  // Y lo generado queda a un clic: el documento registrado se sirve de verdad
  const enlaces = front.nodo("#archivos").descendientes().filter((nodo) => nodo.etiqueta === "a")
  assert.ok(enlaces.length >= 1, "el panel de archivos ofrece el documento archivado")
  const href = enlaces[0]?.href ?? ""
  assert.match(href, /^\/api\/files\/sharepoint\/Contratos\//, `enlace inesperado: ${href}`)
  const descarga = await app.inject({ method: "GET", url: href })
  assert.equal(descarga.statusCode, 200, `el enlace tiene que servir el archivo: ${href}`)
})

test("el botón «Sí, confirmo» registra el mensaje en revisión (RN5 de punta a punta)", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  await front.llamar("enviar", PROMPT_PRD)
  assert.equal(maestro().includes("CM-2026-03"), false, "lo dudoso no se escribe sin confirmación")

  front.documento.disparar("click", {
    preventDefault: () => {},
    target: front.nodo("#boton-confirmar"),
  })
  await front.esperar(() => maestro().includes("CM-2026-03") && front.nodo("#pensando").hidden === true)

  assert.equal(cuerpoDelChat(front).message, "sí, confirmo", "el botón manda una confirmación explícita")
  assert.equal(front.nodo("#confirmacion").hidden, true, "ya no queda nada pendiente")
})

/* ── El envío, que es donde el front se quedaba mudo ──────────────────────── */

test("el clic en Enviar arranca el turno aunque el navegador no dispare el submit", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  front.nodo("#entrada").value = "¿Qué hay en el buzón?"
  front.documento.disparar("click", { preventDefault: () => {}, target: front.nodo("#boton-enviar") })

  await front.esperar(
    () =>
      conClase(front.nodo("#conversacion"), "turno").length >= 2 &&
      front.nodo("#pensando").hidden === true,
  )

  const deChat = front.peticiones.filter((peticion) => peticion.url === "/api/chat")
  assert.equal(deChat.length, 1, "un clic manda exactamente un mensaje")
  assert.equal(cuerpoDelChat(front).message, "¿Qué hay en el buzón?")
  assert.equal(typeof cuerpoDelChat(front).sessionId, "string")
  assert.ok(
    front.consola.some((linea) => linea.includes("[front] enviando")),
    `la consola avisa del envío: ${front.consola.join(" | ")}`,
  )
})

test("un mensaje vacío avisa sin llamar al backend y el aviso se limpia al empezar el turno siguiente", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  await front.llamar("enviar", "   ")
  assert.match(front.nodo("#aviso").textContent, /Escribe un mensaje antes de enviar/)
  assert.equal(front.peticiones.filter((peticion) => peticion.url === "/api/chat").length, 0)

  // Empezar un turno limpia el aviso anterior: si `limpiarAviso` no existe, revienta.
  await front.llamar("enviar", "¿Qué hay en el buzón?")
  assert.equal(front.nodo("#aviso").textContent, "", "el aviso anterior no se queda encima del turno nuevo")
  assert.equal(front.nodo("#aviso").hidden, true)
  assert.equal(conClase(front.nodo("#conversacion"), "turno").length, 2, "y el turno se pinta igual")
})

/* ── Fallos ───────────────────────────────────────────────────────────────── */

test("si el backend no responde, el fallo se ve en pantalla y el turno queda marcado", async () => {
  const front = await cargarFront(await montar())
  await front.listo()

  front.contexto.fetch = () => Promise.reject(new Error("sin conexión con el backend"))

  await front.llamar("enviar", "hola")

  const agente = soloUno(conClase(front.nodo("#conversacion"), "turno--agente"), "turno del agente")
  assert.ok(agente.clases.has("turno--error"), "el turno que falló queda marcado")
  assert.match(agente.textContent, /No pude completar el turno: sin conexión con el backend/)
  assert.match(front.nodo("#aviso").textContent, /No pude completar el turno: sin conexión con el backend/)
  assert.equal(front.nodo("#pensando").hidden, true, "el indicador se apaga aunque el turno falle")
})

/* ── Saber qué versión estás mirando ──────────────────────────────────────── */

test("la versión del pie, la de la consola y la del cache-busting son la misma", () => {
  const html = fs.readFileSync(path.join(dirProyecto(), "web", "index.html"), "utf8")
  const guion = fs.readFileSync(path.join(dirProyecto(), "web", "app.js"), "utf8")

  const version = /\?v=(\d+)/.exec(html)?.[1]
  assert.ok(version !== undefined, "el HTML debe cache-bustear el guion con `?v=`")
  assert.match(html, new RegExp(`interfaz v${version}`), "el pie debe decir la versión que se sirve")
  assert.match(guion, new RegExp(`cargado · v${version}`), "y la consola la misma")
})
