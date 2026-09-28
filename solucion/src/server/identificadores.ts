/**
 * Identificadores de sesión.
 *
 * Deben cumplir el patrón que valida `sesion.ts` (letras, dígitos, guion), así
 * que se derivan del reloj en UTC sin separadores.
 */
export function nuevoId(ahora: Date = new Date()): string {
  return `sesion-${ahora.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
}
