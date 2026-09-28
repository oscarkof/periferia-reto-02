/**
 * El ciclo del agente de punta a punta (PRD §6.1 · §6.3).
 *
 * Todo corre con el adaptador `mock`: sin red, sin modelo y determinista, así que
 * estas pruebas se pueden ejecutar en cualquier máquina. Lo que se comprueba aquí
 * son las reglas que el PRD exige al **ciclo** y no al prompt: CA1 (tope de
 * iteraciones), CA2 (el modelo no es fuente de valores), CA3 · RN5 (confirmación
 * humana), CA4 (traza) y CA5 (un fallo del proveedor no tumba la sesión).
 *
 * Cada prueba escribe en su propio `OUT_DIR` temporal.
 */
import { after, test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cargarContextoAgente } from "../src/agent/prompt.ts"
import { esConfirmacionExplicita, esRechazo } from "../src/agent/confirmacion.ts"
import { MAX_ITERACIONES, ejecutarTurno, type ResultadoTurno } from "../src/agent/loop.ts"
import { crearSesion, type Sesion } from "../src/agent/sesion.ts"
import type { EventoTurno } from "../src/agent/eventos.ts"
import type { AdaptadorLlm } from "../src/llm/adapter.ts"
import { crearAdaptadorMock, guionDemo, type PasoMock } from "../src/llm/mock.ts"
import { listarHerramientas } from "../src/tools/contratos.ts"

/** `solucion/`: la raíz desde la que las herramientas resuelven los fixtures. */
const RAIZ = path.resolve(import.meta.dirname, "..")
const temporales: string[] = []

/** `OUT_DIR` temporal: el `out/` del repositorio no se toca. */
function outTemporal(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto02-bucle-"))
  temporales.push(dir)
  process.env["OUT_DIR"] = dir
}

after(() => {
  delete process.env["OUT_DIR"]
  for (const dir of temporales) fs.rmSync(dir, { recursive: true, force: true })
})

/** Contexto del agente: prompt y conocimiento son los reales del repositorio. */
function contexto(): { prompt: string; conocimiento: string } {
  const cargado = cargarContextoAgente(RAIZ)
  assert.equal(cargado.ok, true, "no se pudieron cargar prompt.md y el conocimiento")
  return cargado.ok ? cargado.data : { prompt: "", conocimiento: "" }
}

/** Ejecuta un turno con el adaptador dado y devuelve el resultado, los eventos y la sesión. */
async function turnoCon(
  adaptador: AdaptadorLlm,
  mensaje: string,
  sesion: Sesion = crearSesion("prueba-bucle"),
): Promise<{ resultado: ResultadoTurno; eventos: EventoTurno[]; sesion: Sesion }> {
  const eventos: EventoTurno[] = []
  const contextoAgente = contexto()
  const ejecutado = await ejecutarTurno({
    directorio: RAIZ,
    sesion,
    mensajeUsuario: mensaje,
    adaptador,
    prompt: contextoAgente.prompt,
    conocimiento: contextoAgente.conocimiento,
    emitir: (evento) => eventos.push(evento),
  })
  if (!ejecutado.ok) throw new Error(`el turno falló: ${ejecutado.error}`)
  return { resultado: ejecutado.data, eventos, sesion }
}

/**
 * Igual, con un guion nuevo. Para seguir el mismo guion en varios turnos hay que
 * pasar el adaptador a `turnoCon`: el guion avanza a nivel de llamada, no de turno.
 */
function turno(guion: PasoMock[], mensaje: string, sesion?: Sesion): Promise<{
  resultado: ResultadoTurno
  eventos: EventoTurno[]
  sesion: Sesion
}> {
  return turnoCon(crearAdaptadorMock(guion), mensaje, sesion)
}

/** Filas del maestro vivo (`out/sharepoint/maestro-contratos.csv`), sin cabecera. */
function filasMaestro(): string[] {
  const ruta = path.join(process.env["OUT_DIR"] ?? "", "sharepoint", "maestro-contratos.csv")
  return fs.readFileSync(ruta, "utf8").trim().split("\n").slice(1)
}

/** ¿El maestro tiene una fila de ese contrato? */
function registrado(idContrato: string): boolean {
  return filasMaestro().some((fila) => fila.startsWith(`${idContrato},`))
}

test("la confirmación se detecta con la puntuación que escribe una persona", () => {
  for (const texto of ["sí", "sí, confirmo", "Sí.", "confirmo el valor 0", "ok, adelante"]) {
    assert.equal(esConfirmacionExplicita(texto), true, `debería ser confirmación: ${texto}`)
  }
  for (const texto of ["no", "todavía no", "sí, pero revisa antes", "espera"]) {
    assert.equal(esConfirmacionExplicita(texto), false, `no debería ser confirmación: ${texto}`)
  }
  assert.equal(esRechazo("no, gracias"), true, "«no, gracias» es un rechazo explícito")
})

test("el guion del mock usa los nombres reales del registro de herramientas", () => {
  const reales = new Set<string>(listarHerramientas().map((entrada) => entrada.nombre))
  const usados = new Set(
    guionDemo().flatMap((paso) => (paso.llamadas ?? []).map((llamada) => llamada.nombre)),
  )
  for (const nombre of usados) assert.equal(reales.has(nombre), true, `nombre desconocido: ${nombre}`)
})

test("un turno del guion del PRD §11 registra lo limpio y deja msg-006 esperando confirmación", async () => {
  outTemporal()
  const { resultado, eventos } = await turno(
    guionDemo(),
    "Procesa el buzón de este mes: registra lo que esté limpio y muéstrame lo que requiere revisión.",
  )

  // CA4: cada llamada a herramienta queda en los eventos del turno
  const llamadas = eventos.filter((evento) => evento.tipo === "llamada").map((evento) => evento.nombre)
  assert.deepEqual(llamadas, [
    "contratos_leer_buzon",
    "contratos_extraer",
    "contratos_validar",
    "contratos_registrar",
    "contratos_validar",
  ])

  // RN3: lo limpio se registra. RN5: lo dudoso no se escribe todavía.
  assert.equal(registrado("CT-2026-015"), true)
  assert.equal(registrado("CM-2026-03"), false)

  // CA3: el turno sabe que falta un «sí», y lo sabe por el ciclo, no por el texto
  assert.equal(resultado.needsConfirmation, true)
  assert.equal(resultado.sesion.pendiente?.argumentos["mensaje_id"], "msg-006")

  // El historial queda persistido para sobrevivir a un reinicio
  const archivo = path.join(process.env["OUT_DIR"] ?? "", "sessions", "prueba-bucle.json")
  assert.equal(fs.existsSync(archivo), true)
})

test("el «sí» del usuario registra el mensaje en revisión y cierra el pendiente (RN5 · CA3)", async () => {
  outTemporal()
  // El mismo adaptador en los dos turnos: el guion avanza entre llamadas.
  const mock = crearAdaptadorMock(guionDemo())
  const primera = await turnoCon(
    mock,
    "Procesa el buzón de este mes: registra lo que esté limpio y muéstrame lo que requiere revisión.",
  )
  assert.equal(primera.resultado.needsConfirmation, true)

  const segunda = await turnoCon(mock, "confirmo el valor 0 y la fecha fin 2027-08-31", primera.sesion)
  assert.equal(segunda.resultado.needsConfirmation, false)
  assert.equal(registrado("CM-2026-03"), true)
  assert.equal(segunda.sesion.pendiente, null)

  const llamada = segunda.eventos.find(
    (evento): evento is Extract<EventoTurno, { tipo: "llamada" }> =>
      evento.tipo === "llamada" && evento.nombre === "contratos_registrar",
  )
  assert.equal(llamada?.argumentos["confirmado"], true)
})

test("una confirmación no autoriza otro mensaje: el ciclo fuerza confirmado=false (RN5)", async () => {
  outTemporal()
  const guion: PasoMock[] = [
    { llamadas: [{ nombre: "contratos_validar", argumentos: { mensaje_id: "msg-006" } }] },
    { texto: "msg-006 queda en revisión: valor y fecha_fin. ¿Confirmas los dos campos?" },
    {
      llamadas: [
        { nombre: "contratos_registrar", argumentos: { mensaje_id: "msg-003", confirmado: true } },
      ],
    },
    { texto: "hecho" },
  ]
  const mock = crearAdaptadorMock(guion)
  const primera = await turnoCon(mock, "procesa el buzón")
  assert.equal(primera.resultado.needsConfirmation, true)

  const segunda = await turnoCon(mock, "sí", primera.sesion)
  const llamada = segunda.eventos.find(
    (evento): evento is Extract<EventoTurno, { tipo: "llamada" }> =>
      evento.tipo === "llamada" && evento.nombre === "contratos_registrar",
  )
  assert.equal(llamada?.argumentos["confirmado"], false, "el «sí» no se puede transferir a otro mensaje")
  assert.equal(
    segunda.eventos.some((evento) => evento.tipo === "aviso" && /confirmado=false/.test(evento.texto)),
    true,
  )
  // Y el pendiente de msg-006 sigue en pie: registrar otro mensaje no lo cierra
  assert.equal(segunda.sesion.pendiente?.argumentos["mensaje_id"], "msg-006")
})

test("un duplicado no escribe nada en el maestro (RN1)", async () => {
  outTemporal()
  const mock = crearAdaptadorMock([
    {
      llamadas: [
        { nombre: "contratos_registrar", argumentos: { mensaje_id: "msg-001", confirmado: false } },
      ],
    },
    { llamadas: [{ nombre: "contratos_validar", argumentos: { mensaje_id: "msg-004" } }] },
    {
      llamadas: [
        { nombre: "contratos_registrar", argumentos: { mensaje_id: "msg-004", confirmado: true } },
      ],
    },
    { texto: "msg-004 ya estaba en el maestro: no escribí nada." },
  ])

  // El primer turno deja el maestro vivo con el contrato de msg-001
  await turnoCon(mock, "registra msg-001")
  const antes = filasMaestro()

  // El segundo revisa el reenvío: es duplicado, así que el maestro no cambia
  await turnoCon(mock, "revisa msg-004")
  assert.deepEqual(filasMaestro(), antes, "un duplicado no puede modificar el maestro")
})

test("al tope de iteraciones el turno cierra con lo que hay, sin morir (CA1)", async () => {
  outTemporal()
  const enBucle: PasoMock[] = Array.from({ length: MAX_ITERACIONES + 2 }, () => ({
    llamadas: [{ nombre: "contratos_leer_buzon", argumentos: {} }],
  }))
  const { resultado } = await turno(enBucle, "lee el buzón en bucle")
  assert.equal(resultado.iteraciones, MAX_ITERACIONES)
  assert.equal(resultado.llamadas, MAX_ITERACIONES)
  assert.match(resultado.texto, /tope de \d+ iteraciones/)
})

test("un valor propuesto que no coincide con el documento se manda a revisión (CA2)", async () => {
  outTemporal()
  const { eventos } = await turno(
    [
      {
        llamadas: [
          {
            nombre: "contratos_validar",
            argumentos: { mensaje_id: "msg-001", contrato: { valor: 999 } },
          },
        ],
      },
      { texto: "listo" },
    ],
    "valida msg-001 con un valor inventado",
  )

  const resultado = eventos.find(
    (evento): evento is Extract<EventoTurno, { tipo: "resultado" }> =>
      evento.tipo === "resultado" && evento.nombre === "contratos_validar",
  )
  assert.equal(resultado?.ok, true)
  const resumen = resultado?.resumen ?? ""
  assert.match(resumen, /revis/i, `se esperaba un aviso de revisión, llegó: ${resumen}`)
  assert.match(resumen, /valor/, `el campo alterado tiene que aparecer: ${resumen}`)
})

test("un fallo del proveedor se cuenta en el chat y la sesión sigue viva (CA5)", async () => {
  outTemporal()
  const roto: AdaptadorLlm = {
    proveedor: "prueba",
    modelo: "roto",
    enviar: async () => ({ ok: false, error: "no se pudo contactar el proveedor prueba" }),
  }
  const sesion = crearSesion("prueba-bucle")
  const eventos: EventoTurno[] = []
  const contextoAgente = contexto()
  const ejecutado = await ejecutarTurno({
    directorio: RAIZ,
    sesion,
    mensajeUsuario: "hola",
    adaptador: roto,
    prompt: contextoAgente.prompt,
    conocimiento: contextoAgente.conocimiento,
    emitir: (evento) => eventos.push(evento),
  })

  assert.equal(ejecutado.ok, false)
  assert.equal(
    eventos.some(
      (evento) => evento.tipo === "error" && /no pude hablar con el modelo/i.test(evento.texto),
    ),
    true,
  )

  // La sesión no muere: el turno siguiente responde con normalidad
  const siguiente = await turnoCon(crearAdaptadorMock([{ texto: "sigo aquí" }]), "¿sigues?", sesion)
  assert.equal(siguiente.resultado.texto, "sigo aquí")
})

test("el tope de tokens de la sesión cierra el turno con un aviso (costo)", async () => {
  outTemporal()
  const contextoAgente = contexto()
  const ejecutado = await ejecutarTurno({
    directorio: RAIZ,
    sesion: crearSesion("prueba-bucle"),
    mensajeUsuario: "hola",
    adaptador: crearAdaptadorMock([{ texto: "listo" }]),
    prompt: contextoAgente.prompt,
    conocimiento: contextoAgente.conocimiento,
    maxTokensSesion: 12,
  })

  assert.equal(ejecutado.ok, true)
  if (!ejecutado.ok) return
  assert.match(ejecutado.data.texto, /tope de tokens/)
  assert.equal(ejecutado.data.sesion.tokens, 15)
})
