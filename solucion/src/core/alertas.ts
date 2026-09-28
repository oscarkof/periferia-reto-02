/**
 * Alertas de vencimiento y de pólizas (HU-5).
 *
 * Las tres secciones que pide el PRD y una cuarta que el propio trabajo justifica:
 * el maestro que entregó Periferia **ya trae contratos vencidos** porque el
 * proceso estuvo muerto varios meses. Esos no entran en «vencen» (ya vencieron),
 * pero se declaran como contexto: son la prueba de que este reporte hacía falta.
 *
 * La fecha de referencia entra como argumento (`hoy`), nunca se lee del reloj:
 * así el reporte es reproducible y comparable entre corridas (PRD §8).
 */
import { escribirAtomico } from "./csv.ts"
import { diasEntre } from "./normalizacion.ts"
import type { FilaMaestro, ReporteAlertas, Resultado, Vencimiento } from "./tipos.ts"

/** Fecha en que quedó congelado el maestro entregado (PRD §2.1). */
export const CORTE_MAESTRO = "2026-05-30"

/** Ventana de aviso: vencen dentro de estos días (objetivo O4). */
export const VENTANA_DIAS = 60

/** Convierte una fila en su cálculo de vencimiento, o `null` si la fecha no sirve. */
function aVencimiento(fila: FilaMaestro, hoy: string): Vencimiento | null {
  const dias = diasEntre(hoy, fila.fecha_fin)
  if (dias === null) return null
  return {
    id_contrato: fila.id_contrato,
    cliente: fila.cliente,
    fecha_fin: fila.fecha_fin,
    dias_restantes: dias,
    requiere_poliza: fila.requiere_poliza,
    estado_poliza: fila.estado_poliza,
  }
}

/**
 * Calcula el reporte completo. Función pura: no lee ni escribe archivos, para que
 * las pruebas de los bordes (el contrato que vence en 60 días frente al que vence
 * en 61) no necesiten disco.
 */
export function generarAlertas(filas: readonly FilaMaestro[], hoy: string): ReporteAlertas {
  const calculados = filas
    .map((fila) => aVencimiento(fila, hoy))
    .filter((v): v is Vencimiento => v !== null)

  return {
    ruta: "",
    hoy,
    vencen: calculados
      .filter((v) => v.dias_restantes >= 0 && v.dias_restantes <= VENTANA_DIAS)
      .sort((a, b) => a.dias_restantes - b.dias_restantes),
    polizas_pendientes: filas.filter((f) => f.requiere_poliza && f.estado_poliza !== "vigente"),
    registrados_desde_corte: filas
      .filter((f) => f.fecha_registro >= CORTE_MAESTRO)
      .sort((a, b) => a.fecha_registro.localeCompare(b.fecha_registro)),
    ya_vencidos: calculados
      .filter((v) => v.dias_restantes < 0)
      // De más reciente a más antiguo: lo que acaba de vencer es lo que hay que
      // mirar primero, y el más viejo suele ser el hueco del proceso detenido.
      .sort((a, b) => b.dias_restantes - a.dias_restantes),
  }
}

/** Fila de tabla para un vencimiento. */
function filaVencimiento(v: Vencimiento): string {
  const poliza = v.requiere_poliza ? v.estado_poliza : "no aplica"
  return `| ${v.id_contrato} | ${v.cliente} | ${v.fecha_fin} | ${v.dias_restantes} | ${poliza} |`
}

/** Reporte en Markdown, listo para que lo lea gerencia. */
export function alertasMarkdown(reporte: ReporteAlertas): string {
  const lineas: string[] = [
    "# Alertas del maestro de contratos",
    "",
    `> Fecha de referencia: **${reporte.hoy}** · ventana de aviso: **${VENTANA_DIAS} días** · corte del maestro: **${CORTE_MAESTRO}**`,
    "",
    `## 1. Vencen en los próximos ${VENTANA_DIAS} días`,
    "",
  ]

  if (reporte.vencen.length === 0) {
    lineas.push("Ninguno.")
  } else {
    lineas.push("| Contrato | Cliente | Vence | Días | Póliza |", "|---|---|---|---|---|")
    for (const v of reporte.vencen) lineas.push(filaVencimiento(v))
  }

  lineas.push("", "## 2. Pólizas pendientes", "")
  if (reporte.polizas_pendientes.length === 0) {
    lineas.push("Ninguna.")
  } else {
    lineas.push("| Contrato | Cliente | Tipo | Estado | Vence |", "|---|---|---|---|---|")
    for (const f of reporte.polizas_pendientes) {
      lineas.push(
        `| ${f.id_contrato} | ${f.cliente} | ${f.tipo_poliza === "" ? "—" : f.tipo_poliza} | ${f.estado_poliza} | ${f.fecha_fin} |`,
      )
    }
  }

  lineas.push("", `## 3. Registrados desde el corte (${CORTE_MAESTRO})`, "")
  if (reporte.registrados_desde_corte.length === 0) {
    lineas.push("Ninguno: el maestro no se ha alimentado desde el corte.")
  } else {
    lineas.push("| Contrato | Cliente | Registrado | Fuente |", "|---|---|---|---|")
    for (const f of reporte.registrados_desde_corte) {
      lineas.push(`| ${f.id_contrato} | ${f.cliente} | ${f.fecha_registro} | ${f.fuente} |`)
    }
  }

  lineas.push("", "## Contexto: contratos ya vencidos", "")
  if (reporte.ya_vencidos.length === 0) {
    lineas.push("Ninguno.")
  } else {
    lineas.push(
      "El proceso estuvo detenido, así que el maestro arrastra contratos vencidos. No se borran: se listan.",
      "",
      "| Contrato | Cliente | Venció | Días | Póliza |",
      "|---|---|---|---|---|",
    )
    for (const v of reporte.ya_vencidos) lineas.push(filaVencimiento(v))
  }

  lineas.push(
    "",
    "---",
    "",
    "_Generado por el agente de registro de contratos. La fecha de referencia se pasa como argumento para que el reporte sea reproducible._",
    "",
  )
  return lineas.join("\n")
}

/** Escribe `out/alertas.md` y devuelve la ruta. */
export function escribirAlertas(reporte: ReporteAlertas, ruta: string): Resultado<string> {
  const escrito = escribirAtomico(ruta, alertasMarkdown(reporte))
  if (!escrito.ok) return escrito
  return { ok: true, data: ruta }
}
