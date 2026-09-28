/**
 * Registro de ejecuciones (PRD §7.3 · RN7 y §6.3 · CA4).
 *
 * RN7 fija una línea por ejecución de herramienta en `out/log.jsonl` con
 * `{ ts, herramienta, mensaje_id, ok, resumen }`. La misma información es la que
 * el front pinta como tarjeta de herramienta: este archivo es trazabilidad, no
 * un adorno.
 *
 * Nunca lanza: si no se puede escribir se devuelve el error y la herramienta
 * decide — un fallo de log no debe tumbar el trabajo del usuario.
 */
import type { Escritor } from "./escritor.ts"
import type { Resultado } from "./tipos.ts"

/** Formato de una línea de log. `sesion` es aditivo: permite reconstruir el turno. */
export interface EntradaLog {
  ts: string
  herramienta: string
  mensaje_id: string | null
  ok: boolean
  resumen: string
  sesion: string
}

/** Petición de registro: qué se ejecutó y cómo terminó. */
export interface PeticionLog {
  /** `null` cuando aún no se conoce el mensaje (p. ej. argumentos inválidos). */
  mensaje_id: string | null
  herramienta: string
  ok: boolean
  resumen: string
  sesion: string
}

/** Línea JSON de una entrada (sin salto final). */
export function serializarEntrada(entrada: EntradaLog): string {
  return JSON.stringify(entrada)
}

/** Registra una ejecución en `out/log.jsonl` y devuelve la ruta escrita. */
export function registrar(escritor: Escritor, peticion: PeticionLog): Resultado<string> {
  const entrada: EntradaLog = {
    ts: marcaTiempo(),
    herramienta: peticion.herramienta,
    mensaje_id: peticion.mensaje_id,
    ok: peticion.ok,
    resumen: recortar(peticion.resumen),
    sesion: peticion.sesion,
  }
  return escritor.anexar(serializarEntrada(entrada), "log.jsonl")
}

/** Marca de tiempo ISO de una entrada de log. */
export function marcaTiempo(ahora: Date = new Date()): string {
  return ahora.toISOString()
}

/** Los resúmenes se recortan para que el archivo no crezca sin control. */
function recortar(texto: string, limite = 500): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  return limpio.length <= limite ? limpio : `${limpio.slice(0, limite - 1)}…`
}
