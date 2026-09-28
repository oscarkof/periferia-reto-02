/**
 * Confirmación humana (PRD §6.3 · CA3 y §7.3 · RN5).
 *
 * La regla es dura: un registro solo se ejecuta si el usuario lo confirmó **en el
 * turno inmediatamente anterior**. Esta detección vive en código, no en el
 * prompt, para que el modelo no pueda saltársela escribiendo "el usuario ya
 * confirmó".
 *
 * Es deliberadamente conservadora: ante la duda, **no** hay confirmación.
 */
import { comparable } from "../core/normalizacion.ts"

/** Respuestas que cuentan como confirmación explícita. */
const AFIRMATIVAS: readonly string[] = [
  "si",
  "sí",
  "ok",
  "okay",
  "dale",
  "confirmo",
  "confirmado",
  "confirmada",
  "registra",
  "registralo",
  "registre",
  "adelante",
  "procede",
  "hazlo",
  "de acuerdo",
  "correcto",
  "yes",
  "registra el contrato",
]

/**
 * Palabras que **desactivan** la confirmación: si aparecen, el usuario está
 * pidiendo tiempo, corrigiendo o negando, aunque empiece con "sí".
 */
const PALABRAS_DE_FRENO: readonly string[] = [
  "no",
  "todavia",
  "aun",
  "antes",
  "espera",
  "esperate",
  "cancela",
  "cancelar",
  "detente",
  "mejor",
  "para",
  "revisa",
  "faltan",
  "falta",
]

/**
 * Normaliza la respuesta del usuario para compararla.
 *
 * Se usa `comparable` (minúsculas, sin acentos) y no `normalizar`, porque el
 * normalizador del motor devuelve **mayúsculas** —está hecho para comparar
 * etiquetas de plantillas— y las listas de abajo se leen en minúsculas. Bug real
 * detectado al probar el ciclo: con `normalizar`, ni «sí» ni «confirmo el valor 0»
 * contaban como confirmación, así que RN5 nunca se satisfacía.
 */
export function normalizarRespuesta(texto: string): string {
  return comparable(texto)
}

/** ¿El usuario negó o pidió esperar? */
export function esNegacion(texto: string): boolean {
  const limpio = normalizarRespuesta(texto)
  if (limpio === "") return false
  return limpio
    .split(" ")
    .some((palabra) => PALABRAS_DE_FRENO.includes(palabra))
}

/**
 * ¿El mensaje del usuario es una confirmación explícita para continuar?
 * Devuelve `false` si hay cualquier palabra de freno.
 */
export function esConfirmacionExplicita(texto: string): boolean {
  const limpio = normalizarRespuesta(texto)
  if (limpio === "") return false

  const alguno = AFIRMATIVAS.some((frase) => limpio === frase || limpio.startsWith(`${frase} `))
  if (!alguno) return false

  return !esNegacion(texto)
}

/** ¿La respuesta es un "no" claro a la acción pendiente? */
export function esRechazo(texto: string): boolean {
  const limpio = normalizarRespuesta(texto)
  if (limpio === "") return false
  if (["no", "no gracias", "cancela", "cancelar", "detente"].includes(limpio)) return true
  return limpio.startsWith("no ") && esNegacion(texto)
}
