/**
 * Navegador mínimo para probar el front sin navegador.
 *
 * El front es JavaScript que corre en el navegador: si ninguna prueba lo
 * ejecutara, un `limpiarAviso()` sin definir —o un `estado.caso` que ya no
 * existe— llegaría a la pantalla con la suite entera en verde. Aquí se carga
 * `web/app.js` dentro de un contexto de `vm` con lo justo del DOM que el front
 * usa, y su `fetch` se conecta al backend real con `app.inject()`: el turno que se
 * prueba es el de verdad, con su stream SSE troceado a propósito para probar
 * también el reensamblado.
 *
 * Lo que esto **no** es: un navegador. No hay CSS ni pintado, así que no sustituye
 * a mirar la pantalla (para eso, Playwright en F5).
 */
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { TextDecoder } from "node:util"
import type { FastifyInstance } from "fastify"
import { dirProyecto } from "../src/core/rutas.ts"
import { crearAcumulador, FIN } from "../web/sse.js"

/** Petición que el front manda al backend. */
export interface Peticion {
  url: string
  metodo: string
  cuerpo: string
}

/** Respuesta tal como la ve el front (solo lo que `app.js` usa). */
interface RespuestaFalsa {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  body: { getReader: () => { read: () => Promise<{ value: Uint8Array | undefined; done: boolean }> } }
}

/** Si un nodo responde a un selector simple de los que usa el front (`#id`, `.clase`). */
function coincide(nodo: Nodo, selector: string): boolean {
  if (selector.startsWith("#")) return nodo.id === selector.slice(1)
  if (selector.startsWith(".")) {
    const clase = selector.slice(1)
    return nodo.className.split(/\s+/).includes(clase) || nodo.clases.has(clase)
  }
  return nodo.etiqueta === selector
}

/** Nodo del DOM falso: guarda lo que el front le escribe. */
export class Nodo {
  readonly etiqueta: string
  hijos: Nodo[] = []
  padre: Nodo | null = null
  className = ""
  id = ""
  hidden = false
  value = ""
  type = ""
  title = ""
  href = ""
  target = ""
  rel = ""
  #texto = ""
  readonly dataset: Record<string, string> = {}
  readonly clases = new Set<string>()
  readonly oyentes: { tipo: string; fn: (evento: unknown) => void }[] = []
  /** Lo mismo que ofrece el navegador: `classList.add(...)`. */
  readonly classList = {
    add: (nombre: string): void => {
      this.clases.add(nombre)
    },
    contains: (nombre: string): boolean => this.clases.has(nombre),
  }

  constructor(etiqueta: string) {
    this.etiqueta = etiqueta
  }

  /** El texto del nodo y sus hijos, como el `textContent` del navegador. */
  get textContent(): string {
    return [this.#texto, ...this.hijos.map((hijo) => hijo.textContent)].join("")
  }

  /** Escribir texto reemplaza el contenido, igual que en el navegador. */
  set textContent(valor: string) {
    this.#texto = valor
    this.hijos = []
  }

  /** Los hijos, como `element.children` del navegador. */
  get children(): Nodo[] {
    return this.hijos
  }

  append(...nodos: Nodo[]): void {
    for (const nodo of nodos) {
      nodo.padre = this
      this.hijos.push(nodo)
    }
  }

  replaceChildren(...nodos: Nodo[]): void {
    this.hijos = []
    this.append(...nodos)
  }

  /** Busca por identificador o clase entre los descendientes, como el navegador. */
  querySelector(selector: string): Nodo | null {
    return this.descendientes().find((nodo) => coincide(nodo, selector)) ?? null
  }

  /** El propio nodo o uno de sus antecesores, como el navegador. */
  closest(selector: string): Nodo | null {
    for (let nodo: Nodo | null = this; nodo !== null; nodo = nodo.padre) {
      if (coincide(nodo, selector)) return nodo
    }
    return null
  }

  addEventListener(tipo: string, fn: (evento: unknown) => void): void {
    this.oyentes.push({ tipo, fn })
  }

  /** El front lo usa al añadir un turno; aquí no hay nada que desplazar. */
  scrollIntoView(): void {}

  /** El front enfoca el campo al terminar; aquí no hay foco. */
  focus(): void {}

  /** Todos los hijos, nietos y siguientes, en orden. */
  descendientes(): Nodo[] {
    return this.hijos.flatMap((hijo) => [hijo, ...hijo.descendientes()])
  }
}

/** Documento falso: los elementos que ya trae el HTML y los que el front crea. */
export class Documento {
  readonly elementos = new Map<string, Nodo>()
  readonly creados: Nodo[] = []
  readonly oyentes: { tipo: string; fn: (evento: unknown) => void }[] = []

  createElement(etiqueta: string): Nodo {
    const nodo = new Nodo(etiqueta)
    this.creados.push(nodo)
    return nodo
  }

  createTextNode(texto: string): Nodo {
    const nodo = new Nodo("#texto")
    nodo.textContent = texto
    return nodo
  }

  querySelector(selector: string): Nodo {
    return this.para(selector)
  }

  /** Elemento del HTML por su selector; se crea la primera vez que se pide. */
  para(selector: string): Nodo {
    const existente = this.elementos.get(selector)
    if (existente !== undefined) return existente

    const nodo = new Nodo(selector)
    nodo.id = selector.startsWith("#") ? selector.slice(1) : selector
    this.elementos.set(selector, nodo)
    return nodo
  }

  addEventListener(tipo: string, fn: (evento: unknown) => void, ..._resto: unknown[]): void {
    this.oyentes.push({ tipo, fn })
  }

  /** Lanza un evento del documento, como haría el navegador al pulsar un botón. */
  disparar(tipo: string, evento: unknown): void {
    for (const oyente of this.oyentes) {
      if (oyente.tipo === tipo) oyente.fn(evento)
    }
  }
}

/** Descendientes (y el propio nodo) que llevan una clase CSS. */
export function conClase(nodo: Nodo, clase: string): Nodo[] {
  return [nodo, ...nodo.descendientes()].filter((candidato) => coincide(candidato, `.${clase}`))
}

/**
 * Temporizadores que no llegan a disparar.
 * Con ellos el aviso no se esconde solo y ninguna prueba deja timers vivos, así
 * que lo que se comprueba es lo que el front pintó, no una carrera contra el reloj.
 */
function relojFalso(): {
  setTimeout: (fn: () => void, ...resto: unknown[]) => number
  setInterval: (fn: () => void, ...resto: unknown[]) => number
  clearTimeout: (id: number) => void
  clearInterval: (id: number) => void
} {
  const pendientes = new Map<number, () => void>()
  let siguiente = 1

  const apartar = (fn: () => void): number => {
    const id = siguiente
    siguiente += 1
    pendientes.set(id, fn)
    return id
  }

  return {
    setTimeout: (fn: () => void, ..._resto: unknown[]): number => apartar(fn),
    setInterval: (fn: () => void, ..._resto: unknown[]): number => apartar(fn),
    clearTimeout: (id: number): void => {
      pendientes.delete(id)
    },
    clearInterval: (id: number): void => {
      pendientes.delete(id)
    },
  }
}

/** Consola que guarda lo que el front imprime: así se comprueba qué versión cargó. */
function consolaFalsa(registro: string[]): Record<string, (...partes: unknown[]) => void> {
  const apuntar = (...partes: unknown[]): void => {
    registro.push(partes.map((parte) => String(parte)).join(" "))
  }
  return { info: apuntar, log: apuntar, warn: apuntar, error: apuntar }
}

/** Respuesta con cuerpo troceado a propósito: un stream SSE nunca llega entero. */
function respuestaFalsa(cuerpo: string, estado: number, trozo = 64): RespuestaFalsa {
  const partes = cuerpo.match(new RegExp(`[\\s\\S]{1,${trozo}}`, "g")) ?? []
  let indice = 0

  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => JSON.parse(cuerpo) as unknown,
    body: {
      getReader: () => ({
        read: async () => {
          const parte = partes[indice]
          indice += 1
          if (parte === undefined) return { value: undefined, done: true }
          return { value: new TextEncoder().encode(parte), done: false }
        },
      }),
    },
  }
}

/** Lo que `app.js` espera del navegador, más las funciones que él mismo declara. */
interface ContextoFront {
  readonly document: Documento
  window: { addEventListener: (tipo: string, fn: (evento: unknown) => void) => void }
  console: Record<string, (...partes: unknown[]) => void>
  fetch: (url: string, opciones?: { method?: string; body?: string }) => Promise<RespuestaFalsa>
  readonly TextDecoder: typeof TextDecoder
  readonly crypto: Crypto
  readonly Element: typeof Nodo
  readonly Error: ErrorConstructor
  readonly setTimeout: (fn: () => void, ...resto: unknown[]) => number
  readonly setInterval: (fn: () => void, ...resto: unknown[]) => number
  readonly clearTimeout: (id: number) => void
  readonly clearInterval: (id: number) => void
  readonly crearAcumulador: typeof crearAcumulador
  readonly FIN: typeof FIN
  /** Existe porque el guion corre en el ámbito global del contexto, no como módulo. */
  enviar?: (mensaje: string) => Promise<void>
}

/** Front cargado: su documento, lo que pidió al backend y sus funciones. */
export interface Front {
  readonly documento: Documento
  readonly contexto: ContextoFront
  readonly peticiones: Peticion[]
  readonly consola: string[]
  /** Ejecuta una función del front por su nombre, como haría un clic o el teclado. */
  llamar<T = void>(nombre: string, ...argumentos: unknown[]): Promise<T>
  /** Elemento del HTML falso, por ejemplo `#aviso`. */
  nodo(selector: string): Nodo
  /** Espera a que el front llegue al estado esperado; falla si no lo hace. */
  esperar(condicion: () => boolean, ms?: number): Promise<void>
  /** Espera a que el arranque (salud del backend y sesión) haya terminado. */
  listo(): Promise<void>
}

/** Carga `web/app.js` en un contexto aislado, con su `fetch` apuntando al backend. */
export async function cargarFront(app: FastifyInstance): Promise<Front> {
  const documento = new Documento()
  const consola: string[] = []
  const peticiones: Peticion[] = []
  const reloj = relojFalso()

  // El estado inicial del DOM es el del HTML: lo que trae `hidden` empieza oculto.
  const html = fs.readFileSync(path.join(dirProyecto(), "web", "index.html"), "utf8")
  for (const etiqueta of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    if (!/\shidden[\s>/]/.test(etiqueta[0] ?? "")) continue
    documento.para(`#${etiqueta[1] ?? ""}`).hidden = true
  }

  const fetchFalso = async (
    url: string,
    opciones?: { method?: string; body?: string },
  ): Promise<RespuestaFalsa> => {
    const metodo = opciones?.method ?? "GET"
    const cuerpo = opciones?.body ?? ""
    peticiones.push({ url, metodo, cuerpo })

    const respuesta =
      metodo === "POST"
        ? await app.inject({ method: "POST", url, payload: JSON.parse(cuerpo) as Record<string, unknown> })
        : await app.inject({ method: "GET", url })

    return respuestaFalsa(respuesta.body, respuesta.statusCode)
  }

  const sandbox: ContextoFront = {
    document: documento,
    window: {
      addEventListener: (tipo, fn): void => {
        documento.oyentes.push({ tipo, fn })
      },
    },
    console: consolaFalsa(consola),
    fetch: fetchFalso,
    TextDecoder,
    crypto: globalThis.crypto,
    Element: Nodo,
    Error,
    ...reloj,
    crearAcumulador,
    FIN,
  }

  // `createContext` devuelve el mismo objeto ya contextificado: el sandbox.
  const contexto = vm.createContext(sandbox) as unknown as ContextoFront
  const fuente = fs
    .readFileSync(path.join(dirProyecto(), "web", "app.js"), "utf8")
    // El navegador resuelve este `import` por su cuenta; aquí se le inyecta ya resuelto.
    .replace(/^import .*$/m, "")
  new vm.Script(fuente, { filename: "web/app.js" }).runInContext(contexto)

  const nodo = (selector: string): Nodo => documento.para(selector)

  const esperar = async (condicion: () => boolean, ms = 5000): Promise<void> => {
    const limite = Date.now() + ms
    while (!condicion()) {
      if (Date.now() > limite) throw new Error("el front no llegó al estado esperado a tiempo")
      await new Promise<void>((seguir) => {
        setTimeout(seguir, 5)
      })
    }
  }

  return {
    documento,
    contexto,
    peticiones,
    consola,
    nodo,
    esperar,
    listo: () =>
      esperar(
        () =>
          nodo("#estado-servidor").textContent !== "" &&
          nodo("#dato-sesion").textContent !== "" &&
          nodo("#sugerencias").children.length > 0,
      ),
    llamar: async <T>(nombre: string, ...argumentos: unknown[]): Promise<T> => {
      const funcion = (contexto as unknown as Record<string, unknown>)[nombre]
      if (typeof funcion !== "function") throw new Error(`app.js no define «${nombre}»: el front no responde`)
      return (await (funcion as (...args: unknown[]) => unknown)(...argumentos)) as T
    },
  }
}
