/**
 * Construcción de la aplicación HTTP del agente (PRD §6.4).
 *
 *   POST /api/chat            { sessionId, message } → stream SSE (ver chat.ts)
 *   GET  /api/sessions/:id    historial completo de la sesión
 *   GET  /api/health          { ok, provider, model } sin exponer claves
 *   GET  /api/files/<caso>/…  descarga de lo generado en `out/`
 *
 * El backend no contiene reglas de negocio: compone el ciclo del agente, que a
 * su vez usa las herramientas. Cambiar una regla del proceso no toca este archivo.
 */
import Fastify, { type FastifyInstance } from "fastify"
import fastifyStatic from "@fastify/static"
import { idValido, listarSesiones } from "../agent/sesion.ts"
import { listarBuzon } from "../core/buzon.ts"
import type { AdaptadorLlm } from "../llm/adapter.ts"
import { cargarTodo } from "../tools/contexto.ts"
import { NOMBRES } from "../tools/contratos.ts"
import { registrarChat } from "./chat.ts"
import { leerDeOut } from "./estaticos.ts"
import { raizFront } from "./front.ts"
import { crearMemoria, obtenerSesion, type MemoriaSesiones } from "./memoria.ts"

/** Dependencias ya resueltas que necesita la aplicación. */
export interface Dependencias {
  /** Raíz del proyecto. */
  directorio: string
  adaptador: AdaptadorLlm
  prompt: string
  conocimiento: string
  /** Almacén de sesiones compartido; se puede inyectar en las pruebas. */
  memoria?: MemoriaSesiones
}

/** Crea la aplicación con todas sus rutas. */
export async function crearAplicacion(deps: Dependencias): Promise<FastifyInstance> {
  const { directorio, adaptador, prompt, conocimiento } = deps
  const memoria = deps.memoria ?? crearMemoria()
  const app = Fastify({ logger: false })

  // El front de desarrollo corre en otro puerto; en producción comparten origen.
  app.addHook("onSend", async (_peticion, reply) => {
    reply.header("access-control-allow-origin", "*")
    reply.header("access-control-allow-headers", "content-type")
  })
  app.options("/*", async (_peticion, reply) => reply.code(204).send())

  // El front se sirve solo si existe: la API funciona sin él (PRD §6.1).
  const raizWeb = raizFront(directorio)
  if (raizWeb !== null) {
    await app.register(fastifyStatic, { root: raizWeb, prefix: "/", wildcard: false })
  }

  // Registro de peticiones: sin esto, cuando el front "no hace nada" no hay
  // forma de saber desde la terminal si la petición llegó siquiera.
  const comienzos = new WeakMap<object, number>()
  app.addHook("onRequest", async (peticion) => {
    comienzos.set(peticion, Date.now())
  })
  app.addHook("onResponse", async (peticion, respuesta) => {
    const inicio = comienzos.get(peticion) ?? Date.now()
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1)
    console.log(
      `[${new Date().toTimeString().slice(0, 8)}] ${peticion.method} ${peticion.url} → ${respuesta.statusCode} (${segundos} s)`,
    )
  })
  app.setErrorHandler((error: unknown, peticion, respuesta) => {
    const detalle = error instanceof Error ? error.message : String(error)
    const declarado = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined
    const codigo = typeof declarado === "number" ? declarado : 500
    console.error(`[${new Date().toTimeString().slice(0, 8)}] error en ${peticion.method} ${peticion.url}: ${detalle}`)
    void respuesta.code(codigo).send({ ok: false, error: detalle })
  })

  app.get("/api/health", async () => {
    const sesiones = listarSesiones(directorio)
    // El estado del buzón de un vistazo: cuántos mensajes hay y cuántos siguen
    // sin procesar. Se lee con las mismas funciones que usan las herramientas,
    // así que lo que dice `/api/health` es lo que verá `contratos_leer_buzon`.
    const trabajo = cargarTodo({ directory: directorio, sessionId: "health" })
    let buzon: { total: number; sin_procesar: number } | null = null
    if (trabajo.ok) {
      const listado = listarBuzon(trabajo.data.entorno.buzon)
      if (listado.ok) {
        buzon = {
          total: listado.data.length,
          sin_procesar: listado.data.filter((mensaje) => !trabajo.data.procesados.includes(mensaje.id))
            .length,
        }
      }
    }

    return {
      ok: true,
      provider: adaptador.proveedor,
      model: adaptador.modelo,
      herramientas: Object.values(NOMBRES),
      buzon,
      sesiones: sesiones.ok ? sesiones.data.length : 0,
    }
  })

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (peticion, reply) => {
    const { id } = peticion.params
    if (!idValido(id)) return reply.code(400).send({ ok: false, error: "identificador de sesión inválido" })
    return { ok: true, data: obtenerSesion(directorio, id, memoria) }
  })

  app.get<{ Params: { "*": string } }>("/api/files/*", async (peticion, reply) => {
    const partes = (peticion.params["*"] ?? "").split("/").filter((parte) => parte !== "")
    const archivo = leerDeOut(directorio, partes)
    if (!archivo.ok) return reply.code(404).send({ ok: false, error: archivo.error })
    return reply
      .header("content-type", archivo.data.tipo)
      .header("content-disposition", `inline; filename="${archivo.data.nombre}"`)
      .send(archivo.data.contenido)
  })

  registrarChat(app, { directorio, adaptador, prompt, conocimiento, memoria })

  return app
}
