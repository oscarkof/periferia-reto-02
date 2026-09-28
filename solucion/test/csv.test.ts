/**
 * Pruebas del maestro en CSV (PRD §7.2 · RN6).
 *
 * Lo que se fija aquí: el formato que espera SharePoint (comillas solo cuando
 * hacen falta), que el ida y vuelta no pierda ni una columna, y que la escritura
 * atómica no deje el archivo a medias.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  COLUMNAS,
  ENCABEZADO,
  analizarCsv,
  analizarLinea,
  escribirAtomico,
  filaDesdeCrudo,
  serializarCampo,
  serializarCsv,
} from "../src/core/csv.ts"
import type { FilaMaestro } from "../src/core/tipos.ts"

/** Carpeta temporal por prueba: el `out/` del repositorio no se toca nunca. */
function carpetaTemporal(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reto02-csv-"))
}

test("el encabezado tiene las 16 columnas del PRD, en orden", () => {
  assert.equal(COLUMNAS.length, 16)
  assert.equal(COLUMNAS[0], "id_contrato")
  assert.equal(COLUMNAS[15], "fuente")
  assert.equal(ENCABEZADO.split(",").length, 16)
})

test("un campo normal se escribe sin comillas", () => {
  assert.equal(serializarCampo("CT-2026-015"), "CT-2026-015")
  assert.equal(serializarCampo("COP"), "COP")
})

test("un campo con coma, comilla o salto se entrecomilla y dobla la comilla", () => {
  assert.equal(serializarCampo("Soporte, mantenimiento"), '"Soporte, mantenimiento"')
  assert.equal(serializarCampo('Póliza "todo riesgo"'), '"Póliza ""todo riesgo"""')
  assert.equal(serializarCampo("dos\nlíneas"), '"dos\nlíneas"')
})

test("analizarLinea respeta las comillas", () => {
  assert.deepEqual(analizarLinea("a,b,c"), ["a", "b", "c"])
  assert.deepEqual(analizarLinea('"a,1",b,"c ""x"""'), ["a,1", "b", 'c "x"'])
})

test("analizarCsv separa encabezado y filas, y tolera CRLF", () => {
  const texto = "a,b\r\n1,2\r\n3,4\r\n"
  const resultado = analizarCsv(texto)
  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.deepEqual(resultado.data.encabezados, ["a", "b"])
  assert.deepEqual(resultado.data.filas, [
    ["1", "2"],
    ["3", "4"],
  ])
})

test("analizarCsv no parte una fila por un salto dentro de comillas", () => {
  const texto = 'a,b\n"linea1\nlinea2",x\n'
  const resultado = analizarCsv(texto)
  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.equal(resultado.data.filas.length, 1)
  assert.equal(resultado.data.filas[0]?.[0], "linea1\nlinea2")
})

test("analizarCsv devuelve error legible con un CSV vacío", () => {
  const resultado = analizarCsv("")
  assert.equal(resultado.ok, false)
  if (resultado.ok) return
  assert.match(resultado.error, /vacío/)
})

test("filaDesdeCrudo convierte tipos y detecta filas mal formadas", () => {
  const crudo = [
    "CT-2026-015",
    "Industrias Delta S.A.S.",
    "890900111",
    "CO",
    "Implementación CRM",
    "265000000",
    "COP",
    "2026-08-01",
    "2027-07-31",
    "true",
    "cumplimiento",
    "pendiente",
    "Laura Gómez Restrepo",
    "Contratos/2026/industrias-delta/CT-2026-015.pdf",
    "2026-09-01",
    "buzon",
  ]
  const fila = filaDesdeCrudo(crudo, 1)
  assert.equal(fila.ok, true)
  if (!fila.ok) return
  assert.equal(fila.data.valor, 265000000)
  assert.equal(fila.data.requiere_poliza, true)
  assert.equal(fila.data.estado_poliza, "pendiente")

  const corta = filaDesdeCrudo(crudo.slice(0, 8), 2)
  assert.equal(corta.ok, false)
  if (corta.ok) return
  assert.match(corta.error, /se esperan 16/)

  const malValor = filaDesdeCrudo([...crudo.slice(0, 5), "no-es-numero", ...crudo.slice(6)], 3)
  assert.equal(malValor.ok, false)
})

test("el maestro sobrevive a un ida y vuelta completo", () => {
  const fila: FilaMaestro = {
    id_contrato: "CT-2026-016",
    cliente: "Corporación Andina de Servicios S.A.",
    nit_cliente: "1790012345001",
    pais: "EC",
    objeto: "Fábrica de software, célula dedicada",
    valor: 120000,
    moneda: "USD",
    fecha_inicio: "2026-08-15",
    fecha_fin: "2027-08-14",
    requiere_poliza: false,
    tipo_poliza: "",
    estado_poliza: "no_aplica",
    comercial: "Carlos Ruiz Medina",
    ruta_sharepoint: "Contratos/2026/corporacion-andina-de-servicios/CT-2026-016.txt",
    fecha_registro: "2026-09-01",
    fuente: "buzon",
  }
  const texto = serializarCsv([fila])
  const resultado = analizarCsv(texto)
  assert.equal(resultado.ok, true)
  if (!resultado.ok) return
  assert.deepEqual(resultado.data.encabezados, [...COLUMNAS])
  assert.equal(resultado.data.filas.length, 1)
  const vuelta = filaDesdeCrudo(resultado.data.filas[0] ?? [], 1)
  assert.equal(vuelta.ok, true)
  if (!vuelta.ok) return
  // El objeto lleva coma: va entrecomillado y vuelve entero.
  assert.equal(vuelta.data.objeto, "Fábrica de software, célula dedicada")
  assert.deepEqual(vuelta.data, fila)
})

test("escribirAtomico deja el archivo completo y sin temporales", () => {
  const carpeta = carpetaTemporal()
  const destino = path.join(carpeta, "sharepoint", "maestro-contratos.csv")
  const resultado = escribirAtomico(destino, `${ENCABEZADO}\n`)
  assert.equal(resultado.ok, true)
  assert.equal(fs.readFileSync(destino, "utf8"), `${ENCABEZADO}\n`)
  const restos = fs.readdirSync(path.dirname(destino)).filter((f) => f.endsWith(".tmp"))
  assert.deepEqual(restos, [])
  fs.rmSync(carpeta, { recursive: true, force: true })
})

test("escribirAtomico no corrompe el archivo anterior si falla la escritura", () => {
  const carpeta = carpetaTemporal()
  const destino = path.join(carpeta, "maestro-contratos.csv")
  fs.writeFileSync(destino, "CONTENIDO PREVIO\n", "utf8")
  // Un directorio en lugar del `.tmp` hace fallar la escritura de forma limpia.
  fs.mkdirSync(`${destino}.tmp`)
  const resultado = escribirAtomico(destino, "CONTENIDO NUEVO\n")
  assert.equal(resultado.ok, false)
  assert.equal(fs.readFileSync(destino, "utf8"), "CONTENIDO PREVIO\n")
  fs.rmSync(carpeta, { recursive: true, force: true })
})
