/**
 * Front del chat del registro de contratos (PRD §6.1 · CA3 · CA4).
 *
 * Responsabilidades, y nada más:
 *   · enviar el mensaje al backend y leer su stream SSE;
 *   · mostrar el historial, cada llamada a herramienta y el indicador de trabajo;
 *   · **resaltar** el turno en que el agente pide confirmación (CA3 · RN5);
 *   · ofrecer el maestro, el historial y las alertas generadas para descargar.
 *
 * Todo lo que se pinta se construye con nodos del DOM y `textContent`: el texto
 * del modelo nunca se interpreta como HTML.
 */
import { crearAcumulador, FIN } from "./sse.js"

/** Referencias al documento, en un solo sitio. */
const dom = {
  estado: document.querySelector("#estado-servidor"),
  conversacion: document.querySelector("#conversacion"),
  pensando: document.querySelector("#pensando"),
  pensandoTexto: document.querySelector("#pensando-texto"),
  confirmacion: document.querySelector("#confirmacion"),
  confirmacionDetalle: document.querySelector("#confirmacion-detalle"),
  sugerencias: document.querySelector("#sugerencias"),
  entrada: document.querySelector("#entrada"),
  datoSesion: document.querySelector("#dato-sesion"),
  datoTurnos: document.querySelector("#dato-turnos"),
  archivos: document.querySelector("#archivos"),
  casos: document.querySelector("#casos"),
  aviso: document.querySelector("#aviso"),
}

/** Ejemplos de mensaje: el primero es el del PRD §11, palabra por palabra. */
const SUGERENCIAS = [
  "Procesa el buzón de este mes: registra lo que esté limpio y muéstrame lo que requiere revisión.",
  "¿Qué hay en el buzón y cuántos mensajes quedan sin procesar?",
  "Genera las alertas de vencimientos con la fecha 2026-09-03.",
]

/**
 * Nombre legible de cada herramienta, para las tarjetas del chat.
 * La clave es el nombre que usa el modelo (`contratos_*`); si aparece una
 * herramienta nueva, la tarjeta muestra su nombre tal cual y sigue funcionando.
 */
const ETIQUETAS = {
  contratos_leer_buzon: "Leer buzón",
  contratos_extraer: "Extraer contrato",
  contratos_validar: "Validar y clasificar",
  contratos_registrar: "Registrar en el maestro",
  contratos_alertas: "Generar alertas",
}

/** Estado de la sesión en curso. */
const estado = {
  sesion: nuevoIdentificador(),
  ocupado: false,
}

/** Identificador de sesión válido para el backend. */
function nuevoIdentificador() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `web-${Date.now().toString(36)}`
}

let temporizadorAviso = null

/** Muestra un aviso flotante que se va solo. */
function avisar(texto) {
  dom.aviso.textContent = texto
  dom.aviso.hidden = false
  if (temporizadorAviso !== null) clearTimeout(temporizadorAviso)
  temporizadorAviso = setTimeout(() => {
    dom.aviso.hidden = true
  }, 8000)
}

/**
 * Quita el aviso de la pantalla ahora, sin esperar los 8 s.
 * Se llama al empezar un turno: el aviso de un problema anterior no debe quedarse
 * encima del turno nuevo. Esta función se llamaba desde `enviar` sin estar
 * definida, y eso rompía el turno con «limpiarAviso is not defined».
 */
function limpiarAviso() {
  if (temporizadorAviso !== null) {
    clearTimeout(temporizadorAviso)
    temporizadorAviso = null
  }
  dom.aviso.hidden = true
  dom.aviso.textContent = ""
}

/** Escribe texto en un nodo, sin interpretar HTML. */
function escribir(nodo, texto) {
  nodo.textContent = texto
  return nodo
}

/**
 * Pinta el texto del agente respetando lo mínimo del Markdown que usa
 * (encabezados, viñetas, negritas y `código`) sin `innerHTML`: cada pieza se
 * crea como nodo, así que nada de lo que devuelva el modelo puede ejecutarse.
 */
function pintarTexto(contenedor, texto) {
  contenedor.replaceChildren()

  for (const linea of texto.split("\n")) {
    const limpia = linea.trimEnd()
    if (limpia.trim() === "") continue

    const encabezado = /^(#{1,6})\s+(.*)$/.exec(limpia)
    const vineta = /^[-*]\s+(.*)$/.exec(limpia)
    const nodo = document.createElement(encabezado ? "h3" : vineta ? "li" : "p")
    const contenido = encabezado ? encabezado[2] : vineta ? vineta[1] : limpia

    for (const pieza of contenido.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (pieza.startsWith("**") && pieza.endsWith("**")) {
        nodo.append(escribir(document.createElement("strong"), pieza.slice(2, -2)))
      } else if (pieza.startsWith("`") && pieza.endsWith("`")) {
        nodo.append(escribir(document.createElement("code"), pieza.slice(1, -1)))
      } else if (pieza !== "") {
        nodo.append(document.createTextNode(pieza))
      }
    }

    if (vineta) {
      const lista = document.createElement("ul")
      lista.append(nodo)
      contenedor.append(lista)
    } else {
      contenedor.append(nodo)
    }
  }
}

/** Añade un turno a la conversación y devuelve sus nodos para ir rellenándolos. */
function agregarTurno(quien, texto) {
  const turno = document.createElement("li")
  turno.className = `turno turno--${quien}`

  const titulo = escribir(document.createElement("span"), quien === "usuario" ? "Tú" : "Agente")
  titulo.className = "turno__quien"

  const cuerpo = document.createElement("div")
  cuerpo.className = "turno__cuerpo"

  // El texto va en su propio nodo a propósito: el turno se repinta cada vez que
  // llega un trozo de respuesta, y si el texto se pintara sobre el cuerpo entero
  // borraría las tarjetas de herramienta que ya estaban en ese turno (CA4).
  const cuerpoTexto = document.createElement("div")
  cuerpoTexto.className = "turno__texto"
  if (typeof texto === "string") cuerpoTexto.textContent = texto
  cuerpo.append(cuerpoTexto)

  turno.append(titulo, cuerpo)
  dom.conversacion.append(turno)
  turno.scrollIntoView({ block: "end", behavior: "smooth" })
  return { turno, cuerpo, texto: cuerpoTexto }
}

/** Texto base del indicador y su contador de segundos. */
let contadorTrabajo = null
let inicioTrabajo = 0

/**
 * Muestra el indicador de trabajo, con los segundos transcurridos.
 * El contador no es decorativo: con el modelo local un turno tarda más de un
 * minuto, y sin señal de avance la pantalla parece colgada.
 */
function mostrarTrabajo(texto = "El agente está trabajando…") {
  dom.pensandoTexto.dataset["base"] = texto
  dom.pensandoTexto.textContent = `${texto} · 0 s`

  if (contadorTrabajo === null) {
    inicioTrabajo = Date.now()
    contadorTrabajo = setInterval(() => {
      const segundos = Math.round((Date.now() - inicioTrabajo) / 1000)
      dom.pensandoTexto.textContent = `${dom.pensandoTexto.dataset["base"] ?? ""} · ${segundos} s`
    }, 1000)
  }

  dom.pensando.hidden = false
}

/** Oculta el indicador y detiene el contador. */
function ocultarTrabajo() {
  if (contadorTrabajo !== null) {
    clearInterval(contadorTrabajo)
    contadorTrabajo = null
  }
  dom.pensando.hidden = true
}

/** Identificador y turnos en el panel lateral. */
function pintarSesion(turnos) {
  dom.datoSesion.textContent = estado.sesion
  if (typeof turnos === "number") dom.datoTurnos.textContent = String(turnos)
}

/** Tarjeta de una llamada a herramienta; se rellena al llegar su resultado. */
function agregarLlamada(cuerpoDelTurno, evento) {
  let lista = cuerpoDelTurno.querySelector(".llamadas")
  if (lista === null) {
    lista = document.createElement("ul")
    lista.className = "llamadas"
    cuerpoDelTurno.append(lista)
  }

  const item = document.createElement("li")
  item.className = "llamada"
  item.dataset["herramienta"] = evento.nombre

  const nombre = document.createElement("span")
  nombre.className = "llamada__nombre"
  escribir(nombre, ETIQUETAS[evento.nombre] ?? evento.nombre)
  nombre.title = evento.nombre

  const args = document.createElement("span")
  args.className = "llamada__args"
  escribir(args, JSON.stringify(evento.argumentos ?? {}))

  const resumen = document.createElement("span")
  resumen.className = "llamada__resumen"
  escribir(resumen, "…")

  item.append(nombre, args, resumen)
  lista.append(item)
  return item
}

/** Color de la tarjeta: verde si la herramienta fue bien, rojo si falló. */
function marcarResultado(contenedor, evento) {
  contenedor.classList.add(evento.ok ? "llamada--ok" : "llamada--fallo")
  const resumen = contenedor.querySelector(".llamada__resumen")
  if (resumen !== null) escribir(resumen, `${evento.ok ? "ok" : "falló"} · ${evento.resumen}`)
}

/** Estado del backend en la cabecera y del buzón en el panel lateral. */
async function consultarSalud() {
  try {
    const respuesta = await fetch("/api/health")
    const datos = await respuesta.json()

    escribir(dom.estado, `${datos.provider} · ${datos.model}`)
    dom.estado.className = "insignia insignia--ok"

    dom.casos.replaceChildren()
    const buzon = datos.buzon ?? null
    if (buzon === null) {
      dom.casos.append(escribir(document.createElement("li"), "No pude leer el buzón de `fixtures/`."))
      return
    }

    dom.casos.append(
      escribir(
        document.createElement("li"),
        `Buzón: ${buzon.total} mensajes · ${buzon.sin_procesar} sin procesar`,
      ),
    )

    const boton = escribir(document.createElement("button"), "Procesar el buzón")
    boton.type = "button"
    boton.className = "caso"
    boton.addEventListener("click", () => {
      dom.entrada.value = SUGERENCIAS[0]
      dom.entrada.focus()
    })

    const item = document.createElement("li")
    item.append(boton)
    dom.casos.append(item)
  } catch {
    escribir(dom.estado, "Sin conexión con el backend")
    dom.estado.className = "insignia insignia--error"
    avisar("No pude hablar con el backend. Revisa que el servidor esté levantado.")
  }
}

/** Botones con ejemplos de mensaje. */
function pintarSugerencias() {
  for (const sugerencia of SUGERENCIAS) {
    const etiqueta = sugerencia.length > 62 ? `${sugerencia.slice(0, 60)}…` : sugerencia
    const boton = escribir(document.createElement("button"), etiqueta)
    boton.type = "button"
    boton.className = "sugerencia"
    boton.title = sugerencia
    boton.addEventListener("click", () => {
      dom.entrada.value = sugerencia
      dom.entrada.focus()
    })
    dom.sugerencias.append(boton)
  }
}

/** Muestra la banda de confirmación con la acción que quedó pendiente (CA3). */
function mostrarConfirmacion(descripcion) {
  escribir(dom.confirmacionDetalle, descripcion)
  dom.confirmacion.hidden = false
}

/** Oculta la banda de confirmación. */
function ocultarConfirmacion() {
  dom.confirmacion.hidden = true
}

/** Rutas de archivo que aparecen en la respuesta de una herramienta. */
function rutasDeArchivo(contenido) {
  try {
    const datos = JSON.parse(contenido)?.data
    if (datos === null || typeof datos !== "object") return []

    // `ruta_archivo` es la del documento archivado; `ruta`, la de las alertas y
    // del log. Se aceptan las dos formas porque las herramientas son distintas.
    const rutas = []
    for (const clave of ["ruta", "ruta_archivo", "archivo", "documento"]) {
      const valor = datos[clave]
      if (typeof valor === "string") rutas.push(valor)
    }
    for (const valor of datos["archivos"] ?? []) {
      if (typeof valor === "string") rutas.push(valor)
    }
    return rutas
  } catch {
    return []
  }
}

/** Prefijos que viven bajo `out/sharepoint/` (el «SharePoint» simulado, RN6). */
const BAJO_SHAREPOINT = ["Contratos/", "historial.jsonl", "maestro-contratos.csv"]

/**
 * Convierte una ruta devuelta por una herramienta en algo descargable por
 * `/api/files/`, que sirve `out/`.
 *
 * En las respuestas conviven tres formas de la misma ruta: la absoluta del
 * proceso (`/…/out/sharepoint/maestro-contratos.csv`), la relativa a `out/`
 * (`alertas.md`, `procesados.json`) y la relativa al «SharePoint»
 * (`Contratos/2026/…`, `historial.jsonl`, `maestro-contratos.csv`). Las tres
 * tienen que acabar en la misma URL, y nada fuera de `out/` es descargable.
 */
function rutaDescargable(ruta) {
  const texto = String(ruta).trim()
  if (texto === "" || !/\.[a-z0-9]+$/i.test(texto)) return null

  const marca = texto.lastIndexOf("/out/")
  const relativa = marca >= 0 ? texto.slice(marca + "/out/".length) : texto.replace(/^\.?\//, "")
  if (relativa === "" || relativa.split("/").includes("..")) return null

  const dentro = BAJO_SHAREPOINT.some((prefijo) => relativa.startsWith(prefijo))
    ? `sharepoint/${relativa}`
    : relativa
  return `/api/files/${dentro.split("/").map(encodeURIComponent).join("/")}`
}

/** Lista de archivos generados en la sesión, con enlace de descarga. */
function pintarArchivos(mensajes) {
  const vistos = new Set()
  const enlaces = []

  for (const mensaje of mensajes) {
    if (mensaje.rol !== "tool") continue
    for (const ruta of rutasDeArchivo(mensaje.contenido)) {
      const url = rutaDescargable(ruta)
      if (url !== null && !vistos.has(url)) {
        vistos.add(url)
        enlaces.push({ url, etiqueta: url.replace("/api/files/", "") })
      }
    }
  }

  dom.archivos.replaceChildren()
  if (enlaces.length === 0) {
    dom.archivos.append(escribir(document.createElement("li"), "Aún no hay archivos: procesa el buzón."))
    return
  }

  for (const enlace of enlaces) {
    const ancla = escribir(document.createElement("a"), enlace.etiqueta)
    ancla.href = enlace.url
    ancla.target = "_blank"
    ancla.rel = "noreferrer"

    const item = document.createElement("li")
    item.append(ancla)
    dom.archivos.append(item)
  }
}

/** Relee la sesión del backend: turnos, acción pendiente y archivos generados. */
async function refrescarSesion() {
  try {
    const respuesta = await fetch(`/api/sessions/${encodeURIComponent(estado.sesion)}`)
    const cuerpo = await respuesta.json()
    if (cuerpo.ok !== true) return

    pintarSesion(cuerpo.data.turnos)
    if (cuerpo.data.pendiente) mostrarConfirmacion(cuerpo.data.pendiente.descripcion)
    else ocultarConfirmacion()
    pintarArchivos(cuerpo.data.mensajes ?? [])
  } catch {
    // Un fallo al releer la sesión no debe romper la conversación.
  }
}

/**
 * Procesa un evento del stream dentro del turno en curso.
 * Los tipos son los del ciclo del agente (`src/agent/eventos.ts`).
 */
function procesarEvento(evento, actual) {
  if (evento.tipo === "inicio") return

  if (evento.tipo === "llamada") {
    mostrarTrabajo(`Ejecutando ${ETIQUETAS[evento.nombre] ?? evento.nombre}…`)
    actual.llamadas.push({ nombre: evento.nombre, nodo: agregarLlamada(actual.cuerpo, evento) })
    return
  }

  if (evento.tipo === "resultado") {
    const pendiente = actual.llamadas.find((llamada) => llamada.nombre === evento.nombre && llamada.marcada !== true)
    if (pendiente !== undefined) {
      marcarResultado(pendiente.nodo, evento)
      pendiente.marcada = true
    }
    return
  }

  if (evento.tipo === "texto") {
    actual.fragmentos.push(evento.texto)
    pintarTexto(actual.texto, actual.fragmentos.join(""))
    return
  }

  if (evento.tipo === "aviso") {
    const nodo = escribir(document.createElement("span"), evento.texto)
    nodo.className = "aviso-turno"
    actual.cuerpo.append(nodo)
    return
  }

  if (evento.tipo === "error") {
    escribir(actual.texto, evento.texto)
    actual.fila.classList.add("turno--error")
    return
  }

  if (evento.tipo === "fin") {
    pintarTexto(actual.texto, actual.fragmentos.join("") || evento.texto)
    if (evento.needsConfirmation === true) {
      mostrarConfirmacion("El agente terminó el turno esperando tu confirmación.")
    }
  }
}

/** Envía el mensaje y consume el stream SSE del backend. */
async function consumirStream(mensaje, actual) {
  const respuesta = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: estado.sesion, message: mensaje }),
  })

  if (!respuesta.ok || respuesta.body === null) {
    const cuerpo = await respuesta.json().catch(() => ({}))
    throw new Error(cuerpo.error ?? `el backend respondió ${respuesta.status}`)
  }

  const lector = respuesta.body.getReader()
  const decodificador = new TextDecoder()
  const acumulador = crearAcumulador()

  for (;;) {
    const { value, done } = await lector.read()
    if (done === true) return

    for (const evento of acumulador.empujar(decodificador.decode(value, { stream: true }))) {
      if (evento === FIN) return
      procesarEvento(evento, actual)
    }
  }
}

/** Un turno completo: pinta lo del usuario, consume el stream y refresca el estado. */
async function enviar(mensaje) {
  const texto = typeof mensaje === "string" ? mensaje.trim() : ""
  if (texto === "") {
    avisar("Escribe un mensaje antes de enviar.")
    return
  }
  if (estado.ocupado) {
    avisar("Todavía estoy con el turno anterior: espera a que termine.")
    return
  }

  estado.ocupado = true
  limpiarAviso()
  ocultarConfirmacion()
  dom.entrada.value = ""

  agregarTurno("usuario", texto)
  const creado = agregarTurno("agente")
  const actual = {
    fila: creado.turno,
    cuerpo: creado.cuerpo,
    texto: creado.texto,
    llamadas: [],
    fragmentos: [],
  }
  mostrarTrabajo()

  try {
    await consumirStream(texto, actual)
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    actual.fila.classList.add("turno--error")
    escribir(actual.texto, `No pude completar el turno: ${detalle}`)
    avisar(`No pude completar el turno: ${detalle}`)
  } finally {
    ocultarTrabajo()
    estado.ocupado = false
    await refrescarSesion()
    dom.entrada.focus()
  }
}

/** Empieza de cero: sesión nueva, conversación vacía y sin pendientes. */
function nuevaSesion() {
  estado.sesion = nuevoIdentificador()
  dom.conversacion.replaceChildren()
  pintarSesion(0)
  ocultarConfirmacion()
  pintarArchivos([])
  dom.entrada.focus()
}

/* ── Interacción ──────────────────────────────────────────────────────────── */

/** Marca de tiempo del último envío, para no enviar dos veces el mismo clic. */
let ultimoEnvio = 0

/**
 * Envía y garantiza que cualquier fallo se vea en pantalla.
 * El `submit` del formulario y el clic del botón pueden dispararse los dos, así
 * que la guarda temporal evita el doble envío.
 */
function enviarSeguro(texto) {
  const ahora = Date.now()
  if (ahora - ultimoEnvio < 500) return
  ultimoEnvio = ahora

  console.info("[front] enviando…")
  void enviar(texto).catch((error) => {
    const detalle = error instanceof Error ? error.message : String(error)
    avisar(`No pude completar el turno: ${detalle}`)
  })
}

/**
 * Un solo manejador para toda la pantalla, en fase de captura.
 * Va en `document` a propósito: si un `querySelector` fallara, los botones
 * seguirían respondiendo. Antes, un fallo así dejaba la interfaz muda y
 * parecía "pegada" sin decir nada.
 */
function alHacerClic(evento) {
  const destino = evento.target
  if (!(destino instanceof Element)) return

  // El botón de enviar se atiende aquí además del `submit` del formulario: si el
  // navegador no dispara el submit (una extensión, un formulario raro), el clic
  // directo sigue funcionando.
  if (destino.closest("#boton-enviar")) {
    evento.preventDefault()
    enviarSeguro(dom.entrada.value)
    return
  }
  if (destino.closest("#boton-confirmar")) {
    enviarSeguro("sí, confirmo")
    return
  }
  if (destino.closest("#boton-rechazar")) {
    enviarSeguro("no, espera")
    return
  }
  if (destino.closest("#boton-nueva-sesion")) {
    nuevaSesion()
  }
}

document.addEventListener(
  "submit",
  (evento) => {
    evento.preventDefault()
    enviarSeguro(dom.entrada.value)
  },
  true,
)

document.addEventListener("click", alHacerClic, true)

// Enter envía; Mayús+Enter deja el salto de línea, que es lo que espera un chat.
dom.entrada.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault()
    enviarSeguro(dom.entrada.value)
  }
})

// Cualquier error se muestra en pantalla, no solo en la consola.
window.addEventListener("error", (evento) => {
  avisar(`Error en la interfaz: ${evento.message}`)
})
window.addEventListener("unhandledrejection", (evento) => {
  const motivo = evento.reason instanceof Error ? evento.reason.message : String(evento.reason)
  avisar(`Error en la interfaz: ${motivo}`)
})

/* ── Arranque ─────────────────────────────────────────────────────────────── */

console.info("[front] app.js cargado · v1 · manejadores listos (submit y clics delegados)")

pintarSugerencias()
pintarSesion(0)
pintarArchivos([])
ocultarConfirmacion()
void consultarSalud()
void refrescarSesion()



