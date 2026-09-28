/**
 * Contrato de herramienta del PRD (§6.2).
 *
 * Cada herramienta es un objeto con tres miembros:
 *   · `description` — una frase: es lo único que el modelo lee para decidir
 *     cuándo llamarla;
 *   · `args`        — esquemas `zod` con `.describe()` en cada campo;
 *   · `execute`     — recibe `(args, ctx)` y devuelve **siempre** un string JSON
 *     con `{ ok: true, data }` o `{ ok: false, error }`. **Nunca lanza.**
 *
 * El nombre que ve el modelo es `<archivo>_<export>`, de ahí `contratos_leer_buzon`.
 */
import type { z } from "zod"
import type { Resultado } from "../core/tipos.ts"

/** Contexto que recibe toda herramienta (PRD §6.2). */
export interface ContextoHerramienta {
  /** Raíz del proyecto: las rutas se resuelven desde aquí, nunca en absoluto. */
  directory: string
  /** Identificador de la sesión de chat, para poder trazar el log. */
  sessionId: string
}

/** Herramienta tipada: `args` se valida con zod antes de ejecutar. */
export interface Herramienta<Esquema extends z.ZodTypeAny> {
  description: string
  args: Esquema
  execute(args: z.infer<Esquema>, ctx: ContextoHerramienta): Promise<string>
}

/**
 * Vista genérica de una herramienta: es la que usa el backend para ejecutar
 * cualquiera de ellas de forma uniforme, sin conocer su esquema concreto.
 */
export type HerramientaGenerica = Herramienta<z.ZodTypeAny>

/**
 * Nombre visible para el modelo, derivado de archivo y export (PRD §6.2).
 * Devuelve un tipo literal (`"contratos_validar"`) para que el nombre no pueda
 * escribirse mal en el registro de herramientas.
 */
export function nombreHerramienta<Archivo extends string, Nombre extends string>(
  archivo: Archivo,
  nombreExport: Nombre,
): `${Archivo}_${Nombre}` {
  return `${archivo}_${nombreExport}`
}

/** Respuesta correcta serializada, tal como exige el contrato. */
export function exito<T>(data: T): string {
  return JSON.stringify({ ok: true, data })
}

/** Respuesta de error serializada, tal como exige el contrato. */
export function fallo(error: string): string {
  return JSON.stringify({ ok: false, error })
}

/** Convierte un `Resultado` en la respuesta JSON del contrato. */
export function responder<T>(resultado: Resultado<T>): string {
  return resultado.ok ? exito(resultado.data) : fallo(resultado.error)
}

/**
 * Valida los argumentos antes de ejecutar y devuelve el error al modelo si no
 * cumplen (PRD §6.2). Es el punto de entrada que usa el backend en F3; `demo.ts`
 * llama a `execute` directamente.
 *
 * Deja constancia en el log cuando la validación falla, para que el fallo del
 * modelo no sea invisible (CA5: un error se muestra, la sesión no muere).
 */
export async function ejecutarValidando<Esquema extends z.ZodTypeAny>(
  herramienta: Herramienta<Esquema>,
  nombre: string,
  argsBrutos: unknown,
  ctx: ContextoHerramienta,
  registrarFallo?: (herramienta: string, error: string, ctx: ContextoHerramienta) => void,
): Promise<string> {
  const validado = herramienta.args.safeParse(argsBrutos)
  if (!validado.success) {
    const detalle = validado.error.issues
      .map((problema) => `${problema.path.join(".") || "args"}: ${problema.message}`)
      .join("; ")
    const error = `argumentos inválidos para ${nombre} → ${detalle}`
    registrarFallo?.(nombre, error, ctx)
    return fallo(error)
  }

  try {
    return await herramienta.execute(validado.data, ctx)
  } catch {
    // Regla dura del PRD: `execute` no debe lanzar. Si ocurre, se convierte en
    // un error legible en vez de tumbar la sesión (CA5).
    return fallo(`error interno ejecutando ${nombre}: revisa el log de la sesión`)
  }
}
