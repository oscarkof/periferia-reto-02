#!/usr/bin/env node
/**
 * Verificación de las herramientas SIN modelo de lenguaje (PRD §6.6).
 *
 *   node demo.ts              recorre el buzón: los seis mensajes del fixture
 *   node demo.ts --confirmar  además, segunda pasada con `confirmado: true`
 *
 * Garantías que exige el PRD §8:
 *   · corre sin ninguna clave de proveedor, sin red y sin descargas;
 *   · limpia `out/` al inicio, así que dos ejecuciones consecutivas dan lo mismo;
 *   · escribe `out/resumen.json` **sin timestamps**, para poder comparar corridas.
 *
 * Lo que demuestra, y es el punto del reto: `msg-006` **no se registra** en la
 * primera pasada porque su valor es indeterminado y su fecha es derivada; solo se
 * registra cuando llega la confirmación humana.
 */
import path from "node:path"
import { crearEntorno } from "./src/core/entorno.ts"
import { interpretar, recorrer, type FilaRecorrido, type ResumenRecorrido } from "./src/demo/recorrido.ts"
import { alertas as toolAlertas } from "./src/tools/contratos.ts"
import type { ContextoHerramienta } from "./src/tools/contrato.ts"
import type { ReporteAlertas } from "./src/core/tipos.ts"

const confirmar = process.argv.includes("--confirmar")

/**
 * Fecha de referencia del recorrido.
 *
 * Por defecto se usa la del prompt de ejemplo del PRD §11 (2026-09-03), no la del
 * reloj: así los seis mensajes dan el resultado que documenta el PRD §7.4 y las
 * alertas son comparables entre corridas. `FECHA_EJECUCION` la cambia.
 */
const FECHA_DE_REFERENCIA = "2026-09-03"
const HOY = process.env["FECHA_EJECUCION"] ?? FECHA_DE_REFERENCIA

/** Etiqueta del estado de un mensaje, para que la salida se lea de un vistazo. */
function marca(fila: FilaRecorrido): string {
  switch (fila.estado) {
    case "registrado":
      return `✔ ${fila.accion ?? "registrado"}`
    case "sin_cambios":
      return "≈ duplicado: no se escribió"
    case "en_revision":
      return "⏳ EN REVISIÓN (no se registró)"
    case "sin_escribir":
      return "— sin escribir"
    default:
      return "✖ error"
  }
}

/** Bloque legible de un mensaje. */
function imprimir(fila: FilaRecorrido): void {
  console.log(`\n━━━ ${fila.mensaje_id} · ${fila.clasificacion ?? "?"} · ${marca(fila)}`)
  if (fila.detalle !== null) console.log(`  ${fila.detalle}`)
  for (const diferencia of fila.diferencias) {
    console.log(`    · ${diferencia.campo}: ${diferencia.antes} → ${diferencia.despues}`)
  }
  if (fila.ruta_archivo !== null) console.log(`  archivo: ${fila.ruta_archivo}`)
  for (const aviso of fila.avisos) console.log(`  aviso: ${aviso}`)
  for (const motivo of fila.motivos) console.log(`  revisar: ${motivo}`)
}

/** Línea de totales del recorrido. */
function totales(resumen: ResumenRecorrido): string {
  const { conteo } = resumen
  return (
    `casos procesados: ${conteo.total}/${conteo.total} · registrados: ${conteo.registrados} · ` +
    `duplicados: ${conteo.sin_cambios} · en revisión: ${conteo.en_revision} · sin escribir: ${conteo.sin_escribir}` +
    (conteo.errores > 0 ? ` · errores: ${conteo.errores}` : "")
  )
}

async function principal(): Promise<void> {
  const raiz = path.resolve(import.meta.dirname)
  const ctx: ContextoHerramienta = { directory: raiz, sessionId: "demo" }

  const entorno = crearEntorno(raiz, { sesion: "demo", hoy: HOY })
  if (!entorno.ok) {
    console.error(`No se pudo preparar el entorno: ${entorno.error}`)
    process.exitCode = 1
    return
  }

  const limpieza = entorno.data.escritor.limpiar()
  console.log(`out/ limpiado al inicio (${limpieza.ok ? limpieza.data : "?"} entradas eliminadas)`)
  console.log(`fecha de referencia: ${HOY}`)

  console.log("\n═══ PRIMERA PASADA · nada confirmado por un humano ═══")
  const primera = await recorrer(ctx, { confirmar: false, conAlertas: false, hoy: HOY })
  for (const fila of primera.filas) imprimir(fila)
  console.log(`\n${totales(primera)}`)

  let segunda: ResumenRecorrido | null = null
  const pendientes = primera.filas.filter((fila) => fila.estado === "en_revision").map((f) => f.mensaje_id)
  if (confirmar && pendientes.length > 0) {
    console.log(`\n═══ SEGUNDA PASADA · confirmado: true para ${pendientes.join(", ")} ═══`)
    segunda = await recorrer(ctx, { confirmar: true, conAlertas: false, hoy: HOY })
    for (const fila of segunda.filas.filter((f) => pendientes.includes(f.mensaje_id))) imprimir(fila)
    const registrados = segunda.filas.filter((fila) => fila.estado === "registrado").length
    console.log(`\nsegunda pasada: ${registrados} registrado(s) de ${segunda.filas.length} pendiente(s)`)
  } else if (pendientes.length > 0) {
    console.log(`\n(queda pendiente de confirmación: ${pendientes.join(", ")} · vuelve a correr con --confirmar)`)
  }

  const reporte = interpretar<ReporteAlertas>(await toolAlertas.execute({ hoy: HOY }, ctx))
  if (reporte.ok) {
    console.log(
      `\nalertas: ${reporte.data.vencen.length} por vencer · ` +
        `${reporte.data.polizas_pendientes.length} póliza(s) pendiente(s) · ` +
        `${reporte.data.registrados_desde_corte.length} registrado(s) desde el corte → ${reporte.data.ruta}`,
    )
  } else {
    console.log(`\nalertas: no se pudieron generar (${reporte.error})`)
  }

  const escritura = entorno.data.escritor.texto(
    `${JSON.stringify(
      {
        hoy: HOY,
        primera: primera.filas,
        segunda: segunda === null ? null : segunda.filas,
        alertas: reporte.ok ? reporte.data : null,
      },
      null,
      2,
    )}\n`,
    "resumen.json",
  )
  console.log(
    `resumen determinista: ${escritura.ok ? path.relative(process.cwd(), escritura.data) : `no se pudo escribir (${escritura.error})`}`,
  )

  if (primera.conteo.errores > 0) process.exitCode = 1
}

await principal()
