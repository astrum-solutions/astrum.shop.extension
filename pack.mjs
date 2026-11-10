// Сборка расширения: `node pack.mjs [chrome|firefox] [--dev] [--copy-only] [--zip]`.
//
// Исходники (`src/`) работают как есть — сборка только кладёт их рядом с нужным манифестом в `dist/<браузер>/`.
//  • `--dev` — добавляет локальный сайт разработчика (localhost:3000) к адресам сайта: папку подключают в браузере
//    «распакованной».
//    ⚠️ В магазин — только сборка БЕЗ `--dev`: лишний адрес в доступах — лишний вопрос модерации.
//  • `--copy-only` — запасная версия без передачи: расширение только копирует сессию в буфер. Скрипта страницы,
//    доступа к astrum.shop и права `scripting` в ней нет совсем (на случай, если магазин расширений не пропустит
//    версию с передачей).
//  • `--zip` — архив для загрузки в магазин. ⚠️ Сначала прогоняются тесты (`tests/`): красные — архива нет. Сторож
//    стоит здесь, на единственном пути в магазин.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const DEV_SITE = 'http://localhost:3000/*'
const SITE = 'https://astrum.shop/*'

/** Манифест сборки из исходного: чистая функция, её же зовут тесты. */
export function buildManifest(source, { dev = false, copyOnly = false } = {}) {
  const manifest = JSON.parse(JSON.stringify(source))
  if (copyOnly) {
    delete manifest.content_scripts
    manifest.permissions = manifest.permissions.filter((p) => p !== 'scripting')
    manifest.host_permissions = manifest.host_permissions.filter((h) => h !== SITE)
    return manifest
  }
  if (dev) {
    manifest.name += ' (dev)'
    manifest.host_permissions = [...manifest.host_permissions, DEV_SITE]
    manifest.content_scripts = manifest.content_scripts.map((cs) => ({ ...cs, matches: [...cs.matches, DEV_SITE] }))
  }
  return manifest
}

/**
 * Сторож архива для магазина: из сборки для разработки архив не собирается, а тесты прогоняются ДО сборки —
 * `runTests` бросает исключение на красных, и до архива дело не доходит. Без `--zip` ничего не делает.
 */
export function preflight({ dev = false, zip = false } = {}, runTests) {
  if (!zip) return
  if (dev) throw new Error('архив для магазина — только без --dev: локальный адрес в доступах модерация не пропустит')
  runTests()
}

function main(argv) {
  const target = argv.find((a) => a === 'chrome' || a === 'firefox') ?? 'chrome'
  const flags = { dev: argv.includes('--dev'), copyOnly: argv.includes('--copy-only') }
  preflight({ dev: flags.dev, zip: argv.includes('--zip') }, () =>
    execFileSync(process.execPath, ['--test', join(here, 'tests') + '/'], { stdio: 'inherit' })
  )
  const out = join(here, 'dist', target + (flags.copyOnly ? '-copy-only' : flags.dev ? '-dev' : ''))
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(join(here, 'src'), out, { recursive: true })
  if (flags.copyOnly) rmSync(join(out, 'content.js'), { force: true })
  const manifest = buildManifest(JSON.parse(readFileSync(join(here, `manifest.${target}.json`), 'utf8')), flags)
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${target}${flags.dev ? ' dev' : ''}${flags.copyOnly ? ' copy-only' : ''} → ${out} (v${manifest.version})`)
  if (argv.includes('--zip')) {
    const zip = `${out}-${manifest.version}.zip`
    rmSync(zip, { force: true })
    execFileSync('zip', ['-qr', zip, '.'], { cwd: out })
    console.log(`архив → ${zip}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
