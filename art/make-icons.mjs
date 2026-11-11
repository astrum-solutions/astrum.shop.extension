// Значки расширения из знака Astrum: `node art/make-icons.mjs` → `src/icons/icon-*.png`.
//
// Вид — сам знак, без плитки и во всю ширину значка, как у большинства значков на панели браузера. Линии знака
// чуть утолщены (обводка тем же градиентом, `BOLD` — в единицах сетки знака 157 × 126): в 16 пикселях линии
// оригинала тоньше пикселя и знак читается как тонкая буква. Утолщение небольшое — форма логотипа та же.
// Фон прозрачен: цветной знак читается и на светлой, и на тёмной панели.
//  • 16 и 32 — знак во всю ширину: панель браузера (он берёт 16 и 32 под обычный и плотный экран);
//  • 48 — с полем 3 px; 128 — знак 96 px с полем 16 px, как просит магазин Chrome для своей карточки.
// Рисует Chrome без окна — chrome-headless-shell (путь — в переменной CHROME, иначе из кэша Playwright).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'src', 'icons')

// ⚠️ Нужен именно chrome-headless-shell: обычный Chrome с `--headless=new --screenshot` снимок делает, но не
// завершается (замер 10.11.2026) — скрипт висел бы вечно.
function chrome() {
  if (process.env.CHROME) return process.env.CHROME
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const dir = readdirSync(cache).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort().pop()
  if (!dir) throw new Error('chrome-headless-shell не найден: укажите путь в переменной CHROME')
  return join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
}

// Знак «A» — тот же вектор, что у значка сайта (157 × 126), с лёгким утолщением линий.
const BOLD = 3
const glyph = readFileSync(join(here, 'glyph.svg'), 'utf8')
  .replace('viewBox="0 0 157 126"', `viewBox="${-BOLD / 2} ${-BOLD / 2} ${157 + BOLD} ${126 + BOLD}"`)
  .replace(/fill="(url\([^"]*\))"/g, (_, paint) => `fill="${paint}" stroke="${paint}" stroke-width="${BOLD}" stroke-linejoin="round"`)

/** Страница со значком `size` px: знак шириной `box` px по центру. */
function page(size, box) {
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
    .c{width:${size}px;height:${size}px;display:grid;place-items:center}
    .c svg{display:block;width:${box}px;height:auto}
  </style><div class="c">${glyph}</div>`
}

const SIZES = [
  [16, 16],
  [32, 32],
  [48, 42],
  [128, 96],
]

const bin = chrome()
const tmp = mkdtempSync(join(tmpdir(), 'astrum-icons-'))
try {
  for (const [size, tile] of SIZES) {
    const html = join(tmp, `icon-${size}.html`)
    writeFileSync(html, page(size, tile))
    const png = join(out, `icon-${size}.png`)
    execFileSync(bin, [
      '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${png}`,
      `--user-data-dir=${join(tmp, 'profile')}`, pathToFileURL(html).href,
    ], { stdio: 'ignore', timeout: 30000 })
    console.log(`icon-${size}.png — знак ${tile} px`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
