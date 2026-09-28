/**
 * Arranque del backend (PRD §6.4).
 *
 * Un comando levanta el agente: `npm run dev`. El proceso solo comprueba que el
 * comportamiento, el conocimiento y el proveedor estén disponibles, y delega en
 * `server/aplicacion.ts`.
 */
import { cargarContextoAgente } from "./agent/prompt.ts"
import { dirProyecto } from "./core/rutas.ts"
import { crearAdaptador, describirProveedor } from "./llm/fabrica.ts"
import { crearAplicacion } from "./server/aplicacion.ts"

const PUERTO = Number(process.env["PORT"] ?? 3000)
const HOST = process.env["HOST"] ?? "127.0.0.1"

async function arrancar(): Promise<void> {
  const directorio = dirProyecto()

  const contexto = cargarContextoAgente(directorio)
  if (!contexto.ok) {
    console.error(`No se pudo cargar el contexto del agente: ${contexto.error}`)
    process.exitCode = 1
    return
  }

  const adaptador = crearAdaptador()
  if (!adaptador.ok) {
    console.error(`No se pudo configurar el proveedor de lenguaje: ${adaptador.error}`)
    process.exitCode = 1
    return
  }

  const { proveedor, modelo } = describirProveedor(adaptador.data)
  const app = await crearAplicacion({
    directorio,
    adaptador: adaptador.data,
    prompt: contexto.data.prompt,
    conocimiento: contexto.data.conocimiento,
  })

  try {
    await app.listen({ port: PUERTO, host: HOST })
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    console.error(`No se pudo escuchar en ${HOST}:${PUERTO}: ${detalle}`)
    process.exitCode = 1
    return
  }

  console.log(`agente escuchando en http://${HOST}:${PUERTO}`)
  console.log(`proveedor: ${proveedor} · modelo: ${modelo}`)
  console.log("rutas: POST /api/chat · GET /api/sessions/:id · GET /api/health · GET /api/files/*")
}

await arrancar()
