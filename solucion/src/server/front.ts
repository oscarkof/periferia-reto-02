/**
 * Localización del front que sirve el backend (PRD §6.1).
 *
 * Se prefiere un build (`web/dist`) si existe y, si no, se sirven tal cual los
 * estáticos de `web/`. El front no necesita bundler —el PRD §0 admite HTML
 * plano— así que clonar el repositorio y arrancar no debe exigir un paso de
 * build. Si algún día se migra a React o Svelte, el build entra en `web/dist` y
 * este archivo lo prefiere sin tocar nada más.
 */
import fs from "node:fs"
import path from "node:path"

/** Ruta absoluta de la carpeta del front, o `null` si no hay ninguna. */
export function raizFront(directorio: string): string | null {
  const construido = path.join(directorio, "web", "dist")
  if (fs.existsSync(path.join(construido, "index.html"))) return construido

  const fuente = path.join(directorio, "web")
  if (fs.existsSync(path.join(fuente, "index.html"))) return fuente

  return null
}
