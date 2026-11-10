// Значки расширения из знака Astrum: `node art/make-icons.mjs` → `src/icons/icon-*.png`.
//
// Вид — как у значка сайта во вкладке браузера: знак на тёмной плитке со скруглением 28 % стороны, знак — 65 %
// плитки и приподнят на 5,5 % (оптическая центровка треугольника). За скруглением PNG прозрачен: чёрный квадрат с
// острыми углами на панели браузера и на странице расширений выглядел чужим.
// Тонкая светлая кромка по краю плитки — у значка сайта её нет, а здесь нужна: на тёмной панели браузера тёмная
// плитка без неё сливается с фоном.
//  • 16 и 32 — плитка во весь значок: панель браузера (он берёт 16 и 32 под обычный и плотный экран);
//  • 48 — с полем 3 px; 128 — плитка 96 px с полем 16 px, как просит магазин Chrome для своей карточки.
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

// Знак «A» — тот же вектор, что у значка сайта (157 × 126).
const glyph = readFileSync(join(here, 'glyph.svg'), 'utf8')

/** Страница со значком `size` px: плитка `tile` px по центру. */
function page(size, tile) {
  const radius = (tile * 0.28).toFixed(2)
  const w = (tile * 0.65).toFixed(2)
  const lift = (tile * 0.055).toFixed(2)
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
    .c{width:${size}px;height:${size}px;display:grid;place-items:center}
    .t{width:${tile}px;height:${tile}px;border-radius:${radius}px;display:grid;place-items:center;
       background:linear-gradient(135deg,#0b0e17 0%,#140f24 50%,#26123a 100%);
       box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
    .t svg{display:block;width:${w}px;height:auto;margin-bottom:${lift}px}
  </style><div class="c"><div class="t">${glyph}</div></div>`
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
    console.log(`icon-${size}.png — плитка ${tile} px`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
