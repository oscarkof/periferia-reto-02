# Puesta en marcha del repositorio Git — Reto 02

> Periferia IT Group · Equipo Perxia 2.0
> Guía ejecutable de **F0 (setup)**. Los comandos de §3 ya se ejecutaron y su resultado está verificado
> en §4; si clonas el repositorio, no necesitas hacer nada.

---

## 0. Dos decisiones heredadas del reto 01 (y re-verificadas aquí)

### 0.1 Un repositorio por reto

No es una suposición: está en el PRD de **este** reto.

| Evidencia (PRD de reto-02) | Qué implica |
|---|---|
| §9.5 — «Repositorio Git con historial de commits, o `reto-02-<apellido>.zip`» | La entrega se empaqueta por reto |
| §7.1 — los datos viven en `fixtures/reto-02/…` | Los paths embeben el número del reto |
| §9.4 — el bonus pide `modulo/skill/registro-contratos/` y `modulo/tools/contratos.ts` | El módulo es propio de este reto |
| §0 — «agente conversacional completo e **independiente**» | No comparte código con otro reto |

**Conclusión:** la raíz del repositorio es `reto-02/`. Un monorepo con los tres retos obligaría a tallar
el `.zip` y dejaría código de otro reto dentro de «su» entrega.

### 0.2 Raíz en `reto-02/`, no en `reto-02/solucion/`

| Opción | Raíz | Ventajas | Costos |
|---|---|---|---|
| **A (elegida)** | `reto-02/` | Los fixtures quedan en su sitio y **no se duplican** (el PRD prohíbe modificarlos); el `.zip` es exactamente esta carpeta | La app vive en `solucion/`, así que resuelve los datos con una constante documentada: `FIXTURES_DIR`, por defecto `../fixtures/reto-02` |
| B | `reto-02/solucion/` | Estructura plana como la del PRD §6.5 (`fixtures/` junto a `src/`) | Hay que **copiar** los 14 fixtures dentro y mantenerlos sincronizados: dos fuentes de verdad |

Es la misma decisión del reto 01, y por la misma razón: **la ruta se resuelve una sola vez en código**
(`src/core/rutas.ts`) y se declara como supuesto en `SOLUCION.md`. En Docker se resuelve igual sin tocar
nada: el contexto de build es `reto-02/` y los fixtures quedan en `/fixtures/reto-02`, que es
exactamente lo que espera `../fixtures/reto-02` respecto a `/app`.

---

## 1. Archivos de control de versiones

| Archivo | Responsabilidad |
|---|---|
| `reto-02/.gitignore` | **Raíz del repo**: reglas de todo el árbol — secretos, dependencias, `out/*`, builds y cachés, logs y `*.jsonl`, cobertura, basura de SO/IDE, tooling de agentes, salida de archify, modelos locales y `*.zip` |
| `solucion/.gitignore` | **Portabilidad de la app**: solo lo mínimo para reutilizar `solucion/` como base de otro reto sin arrastrar basura. **No dupliques aquí las reglas del repo** |
| `solucion/out/.gitkeep` | Git no versiona carpetas vacías; conserva `out/` sin versionar su contenido |

### Lo que este reto añade respecto al reto 01 (y por qué)

| Regla | Motivo |
|---|---|
| `*.jsonl` ignorado | `historial.jsonl` y `log.jsonl` son salidas (PRD §7.3 RN7). Comprobado: **ningún** fixture es `.jsonl` |
| **NO** se ignora `*.csv` | ⚠️ `fixtures/reto-02/maestro-contratos.csv` es **entregable**: ignorarlo lo sacaría de la entrega |
| **NO** se ignora `*.json` | Los fixtures son `correo.json` y `comerciales.json` |
| **NO** se ignora `*.txt` | Los contratos de los fixtures son `.txt` |
| **NO** se ignora `*.md` | `README.md`, `SOLUCION.md`, `alertas.md`… el entregable es documental |

Esa tentación —«ignora todos los CSV, que el maestro se genera»— es el error clásico aquí: el maestro
**del fixture** es la fuente que hay que versionar, porque el que se genera vive en `out/` y ya está
cubierto por `out/*`.

---

## 2. Qué se versiona y qué no

| Clase | Ejemplos | ¿Se versiona? |
|---|---|---|
| **Fuente propia** | `solucion/src/`, `web/`, `demo.ts`, `agent/`, `docs/`, `README.md` | Sí |
| **Configuración** | `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example` | Sí (el `lock` **sí**: es la reproducibilidad) |
| **Entregado por Periferia** | `PRD.md`, `fixtures/reto-02/**` (14 archivos) | Sí, **sin modificar** |
| **Generado en ejecución** | `out/**`, `*.jsonl`, `*.log`, `node_modules/`, `.env`, `*.zip` | No (`.gitignore`) |

---

## 3. Los dos commits de F0

Conventional Commits, una intención por commit, para que el historial cuente la historia (PRD §9.5).

```bash
cd reto-02
git init -b main

# 3.a · Baseline: lo que entregó Periferia, sin mezclarlo con el trabajo propio
git add PRD.md fixtures/
git commit -m "chore(baseline): PRD y fixtures entregados por Periferia, sin modificar"

# 3.b · Setup propio: estructura, ignores, arquitectura y README maestro
git add .gitignore solucion/.gitignore solucion/out/.gitkeep solucion/.env.example solucion/docs/ README.md
git commit -m "chore(setup): estructura del reto, .gitignore, arquitectura y README maestro"
```

---

## 4. Verificación tras el commit

```bash
git log --oneline --stat
git ls-files | wc -l                       # inventario versionado
git ls-files | grep -c node_modules        # -> 0
git ls-files | grep -c '/out/'             # -> 1 (solo el marcador solucion/out/.gitkeep)
git status                                 # -> "nothing to commit, working tree clean"

# La prueba fiable de los ignores no es check-ignore, es add --dry-run:
git add -A --dry-run                       # no debe aparecer .env, out/…, node_modules, *.jsonl, *.zip

# Y para saber QUÉ regla cubre un archivo concreto:
git check-ignore -v solucion/.env solucion/out/log.jsonl
```

Un patrón que **empieza por `!`** es una **re-inclusión** (el archivo **sí** se versiona): eso es lo que
hace `!.env.example` y `!out/.gitkeep`, y es lo que permite entregar la documentación de las variables
sin entregar las variables.

---

## 5. Árbol de features: nombre, rama y commit

Una **feature por fase**, con nombre corto y estable. Ese nombre se usa igual en la rama, en el
mensaje de commit y al hablar del entregable en la sustentación.

| Fase | Feature | Rama | Qué es | Commit(s) |
|---|---|---|---|---|
| **F0** | `setup` | *(directo en `main`)* | Repositorio, ignores, arquitectura y README | `chore(baseline)` · `chore(setup)` |
| **F1** | `core` | *(directo en `main`)* | Motor determinista: extracción, confianza, clasificación, archivo y alertas | `feat(core)` ×2 · `docs(readme)` |
| **F2** | `tools` | `f02-tools` | Las cinco herramientas `contratos_*` + `demo.ts` sin modelo | `feat(tools)` |
| **F3** | `agente-llm-api` | `f03-agente-llm` | Ciclo del agente, adaptadores de proveedor y API HTTP con el system prompt | `feat(agent)` · `feat(llm)` |
| **F4** | `web` | `f04-web` | Front de chat: tool-calls visibles y banda de confirmación | `feat(web)` |
| **F5** | `deploy-solucion` | `f05-deploy` | Docker, `SOLUCION.md` (11 secciones + regla de gobierno) y link público | `chore(deploy)` · `docs(solucion)` |
| **F6** | `modulo` *(bonus)* | `f06-modulo` | Agente empaquetado reutilizable + test de paridad con la app | `feat(modulo)` |

Mensajes completos sugeridos:

```
feat(tools): herramientas zod contratos_* + demo.ts reproducible sin modelo
feat(agent): ciclo del agente con topes, sesiones y confirmacion humana
feat(llm): adaptador de proveedor con implementaciones ollama/openai/mock
feat(web): front de chat con tool-calls visibles y banda de confirmacion
chore(deploy): Dockerfile, compose y link de prueba
docs(solucion): SOLUCION.md con arquitectura, decisiones, cobertura y riesgos
feat(modulo): agente empaquetado reutilizable + test de paridad con la app
```

**F0 y F1 ya están en `main`** (se construyeron antes de tener remoto, y ese historial lineal cuenta la
historia sin ruido). Desde F2 cada fase va en su rama y se cierra con un **PR** —o con `git merge --no-ff`
si se hace en local—, que deja el merge visible: es el mismo flujo que se usó en el reto 01
(`f01-motor-determinista`, `f02-tools`, `f03-cicloagente-llm`, `f03-front-web`).

El nombre de la rama **no** lleva el número del reto: el repositorio ya es del reto, y así el árbol de
ramas se lee igual si algún día se reutiliza esta base.

---

## 6. Remoto (lo ejecuta el candidato)

```bash
git remote add origin git@github.com:<usuario>/periferia-reto-02.git
git push -u origin main
```

El remoto es independiente del **link de prueba** del PRD §9.3: son cosas distintas (uno es el código,
el otro la app corriendo).

### Reparto de responsabilidades con el asistente de IA

El flujo está partido a propósito, y conviene dejarlo escrito porque **es parte del entregable** (el
PRD §0 pide declarar cómo se construyó):

| Acción | Quién |
|---|---|
| `git add` + `git commit` en la rama de trabajo (Conventional Commits, un commit por intención) | **Asistente de IA** |
| Verificación antes de commitear: `git add -A --dry-run`, `git status`, `npm test`, `npm run typecheck` | **Asistente de IA** |
| Crear la rama de la fase | **Candidato** |
| `git fetch`, `git pull`, `git push`, abrir el PR, mezclarlo | **Candidato** |
| Cambiar de rama | **Candidato** |

Motivo: el asistente no tiene —ni debe tener— permiso para escribir en el remoto, y el historial que se
publica es una decisión del candidato. En la práctica esto significa que **el asistente commitea y
para**, y entrega los comandos de Git que le tocan al candidato listos para copiar.

---

## 7. Checklist de seguridad antes de cada push

Lo corre el **asistente antes de commitear** (equivalente) y el **candidato antes de publicar**:

- [ ] `git ls-files | grep -i env` muestra **solo** `.env.example`
- [ ] Ningún diff contiene una clave (`git diff --cached` antes de cada commit)
- [ ] `node_modules/`, `out/`, `.env` y `*.jsonl` no aparecen en `git ls-files`
- [ ] `fixtures/` sin modificaciones (`git status fixtures` → limpio)
- [ ] Ninguna respuesta de la API ni log contiene la clave del modelo (PRD §8)
- [ ] El `.zip` de entrega no incluye `node_modules/`, `out/` ni `.env`

---

## 8. Plan del entregable (lo que la rúbrica va a buscar)

| Entregable | Dónde | Fase |
|---|---|---|
| Las **11 secciones** del PRD §9.1: problema, arquitectura, ciclo, modelo, extracción, **regla de gobierno**, trade-offs, supuestos, cobertura, uso de IA y riesgos | `SOLUCION.md` (raíz) | F5 |
| **Regla de gobierno de una página** (PRD §7.5): canal único, obligación del comercial, acuse automático, excepciones y escalamiento, cierre del *gap* y un indicador mensual | `SOLUCION.md` §6 | F5 |
| `README.md` con el arranque en un comando, las variables, `demo.ts` y el link | `README.md` | F0 → se actualiza hasta F5 |
| **Módulo reutilizable** (bonus §9.4): `agent.md` + `tools/contratos.ts` + `skill/registro-contratos/SKILL.md`, idénticos a lo que usa la app | `modulo/` + `test/paridad-modulo.test.ts` | F6 |
| Link público activo durante la defensa | README §8 | F5 |

---

## 9. Forma de entrega (PRD §9.5)

```bash
cd reto-02
zip -r ../reto-02-<apellido>.zip . -x "*/node_modules/*" -x "*/out/*" -x "*/.env" -x "*/.git/*" -x "*.DS_Store"
```

Antes de generarlo: `git status` limpio, `npm test` en verde y el link activo. `*.zip` está ignorado
por git, así que el artefacto no entra en el propio repositorio.
