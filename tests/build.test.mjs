// Что уходит в магазин: доступы, адреса и запасная сборка «только Скопировать».
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { ROOT, SRC, manifestOf } from './_harness.mjs'
import { buildManifest, preflight } from '../pack.mjs'

const require = createRequire(import.meta.url)
const S = require('../src/services.js')

const SITE = 'https://astrum.shop/*'
const sources = readdirSync(SRC).filter((f) => f.endsWith('.js'))
const code = (file) => readFileSync(join(SRC, file), 'utf8')
const hostOf = (pattern) => new URL(pattern.replace(/\/\*$/, '/')).hostname

for (const target of ['chrome', 'firefox']) {
  test(`${target}: доступы — cookie, сайты сервисов и наш сайт, ничего сверх`, () => {
    const manifest = manifestOf(target)
    assert.deepEqual([...manifest.permissions].sort(), ['cookies', 'scripting'])
    // Сайты из таблицы сервисов и наш — ровно этот набор: лишний сайт — лишний доступ к чужим cookie.
    const wanted = new Set(['astrum.shop'])
    for (const id of S.ORDER) {
      wanted.add(new URL(S.SERVICES[id].session.url).hostname)
      if (S.SERVICES[id].account && S.SERVICES[id].account.url) wanted.add(new URL(S.SERVICES[id].account.url).hostname)
    }
    assert.deepEqual(manifest.host_permissions.map(hostOf).sort(), [...wanted].sort())
    assert.ok(manifest.host_permissions.every((h) => h.startsWith('https://') && !h.includes('*.')))
    // Скрипт страницы — только на нашем сайте.
    assert.deepEqual(manifest.content_scripts.map((cs) => cs.matches), [[SITE]])
    assert.equal(manifest.externally_connectable, undefined)
  })

  test(`${target}: локальный сайт попадает в доступы только в сборке для разработки`, () => {
    const prod = buildManifest(manifestOf(target))
    assert.equal(JSON.stringify(prod).includes('localhost'), false)
    const dev = buildManifest(manifestOf(target), { dev: true })
    assert.ok(dev.host_permissions.includes('http://localhost:3000/*'))
    assert.ok(dev.content_scripts[0].matches.includes('http://localhost:3000/*'))
  })

  test(`${target}: «только Скопировать» — без скрипта страницы и без доступа к нашему сайту`, () => {
    const manifest = buildManifest(manifestOf(target), { copyOnly: true })
    assert.equal(manifest.content_scripts, undefined)
    assert.equal(manifest.host_permissions.includes(SITE), false)
    assert.deepEqual(manifest.permissions, ['cookies'])
    // Флаг разработки ей доступ к сайту не возвращает.
    assert.equal(JSON.stringify(buildManifest(manifestOf(target), { copyOnly: true, dev: true })).includes('localhost'), false)
  })
}

test('архив для магазина: сначала тесты, красные — архива нет; без архива тесты не гоняются', () => {
  let ran = 0
  preflight({ zip: true }, () => (ran += 1))
  assert.equal(ran, 1)
  assert.throws(() => preflight({ zip: true }, () => { throw new Error('тесты красные') }), /тесты красные/)
  preflight({ zip: false }, () => (ran += 1))
  preflight({ dev: true }, () => (ran += 1))
  assert.equal(ran, 1)
  // Из сборки для разработки — отказ ещё до тестов.
  assert.throws(() => preflight({ zip: true, dev: true }, () => (ran += 1)), /только без --dev/)
  assert.equal(ran, 1)
})

test('архив для магазина из сборки для разработки не собирается', () => {
  // Отказ — до тестов и до записи файлов: локальный адрес в доступах — лишний вопрос модерации.
  const run = spawnSync(process.execPath, [join(ROOT, 'pack.mjs'), 'chrome', '--dev', '--zip'], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /только без --dev/)
})

test('значки и логотип из манифеста и окна лежат в сборке, окно подключает чтение cookie раньше себя', () => {
  for (const target of ['chrome', 'firefox']) {
    const manifest = manifestOf(target)
    for (const file of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
      assert.ok(readFileSync(join(SRC, file)).length > 300, `нет значка ${file}`)
    }
  }
  assert.ok(code('popup.js').includes('img/logo.svg'))
  assert.ok(readFileSync(join(SRC, 'img', 'logo.svg'), 'utf8').includes('<svg'))
  // Быстрый взгляд окно делает само (`reader.peek`): без `reader.js` перед `popup.js` оно упало бы на старте.
  const scripts = [...readFileSync(join(SRC, 'popup.html'), 'utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(scripts, ['protocol.js', 'services.js', 'reader.js', 'popup.js'])
})

test('скрипт страницы стартует до разбора страницы — отметка стоит к первому кадру окна заказа', () => {
  for (const target of ['chrome', 'firefox']) assert.equal(manifestOf(target).content_scripts[0].run_at, 'document_start')
})

test('сессию не сохраняем: хранилищем расширения код не пользуется вовсе', () => {
  for (const file of sources) {
    assert.equal(/\bstorage\b/.test(code(file).replace(/\/\/.*$/gm, '')), false, `${file} обращается к хранилищу`)
    assert.equal(/localStorage|sessionStorage|indexedDB/.test(code(file)), false, `${file} пишет в хранилище страницы`)
  }
  for (const target of ['chrome', 'firefox']) assert.equal(manifestOf(target).permissions.includes('storage'), false)
})

test('адреса в коде — только сайты сервисов и наш', () => {
  const allowed = new Set(['astrum.shop', 'claude.ai', 'chatgpt.com', 'auth.openai.com', 'grok.com'])
  for (const file of sources) {
    const urls = code(file).replace(/\/\/ .*$/gm, '').match(/https?:\/\/[a-z0-9.-]+/gi) || []
    for (const url of urls) assert.ok(allowed.has(new URL(url).hostname), `${file}: ${url}`)
  }
})

test('у каждого сервиса названо, где сессия и куда вести «Войти»', () => {
  assert.deepEqual(S.ORDER, Object.keys(S.SERVICES))
  assert.deepEqual(S.SERVICES.claude.session, { type: 'cookie', url: 'https://claude.ai', name: 'sessionKey' })
  assert.deepEqual(S.SERVICES.grok.session, { type: 'cookie', url: 'https://grok.com', name: 'sso' })
  assert.equal(S.SERVICES.chatgpt.session.url, 'https://chatgpt.com/api/auth/session')
  for (const id of S.ORDER) {
    const spec = S.SERVICES[id]
    assert.ok(spec.title && spec.login.startsWith('https://') && spec.mark.d && spec.tint.length === 2, id)
    assert.ok(readdirSync(join(SRC, 'img')).includes(`${id}.jpg`), `нет фона ${id}`)
  }
})

test('перемену «вошёл / вышел» видим по cookie сессии, а не по любой cookie сайта', () => {
  assert.equal(S.serviceOfCookie('.claude.ai', 'sessionKey'), 'claude')
  assert.equal(S.serviceOfCookie('claude.ai', 'cf_clearance'), null)
  assert.equal(S.serviceOfCookie('.chatgpt.com', '__Secure-next-auth.session-token.0'), 'chatgpt')
  assert.equal(S.serviceOfCookie('.chatgpt.com', 'oai-sc'), null)
  assert.equal(S.serviceOfCookie('.grok.com', 'sso'), 'grok')
  assert.equal(S.serviceOfCookie('evilgrok.com', 'sso'), null)
})

// ⚠️⚠️ `PRIVACY.md` стоит в карточке магазина расширений как политика конфиденциальности. Магазин сверяет три вещи:
// что написано в этом файле, что заявлено в кабинете разработчика и что расширение делает на самом деле; расхождение —
// нарушение его правил (расширение снимают). Добавили сервис или доступ в манифест, а файл не поправили — тест красный.
test('PRIVACY.md называет все сайты, доступы и сервисы расширения — по-русски и по-английски', () => {
  const privacy = readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8')
  const cut = privacy.indexOf('## English version')
  assert.ok(cut > 0, 'в PRIVACY.md нет английской части')
  const texts = { ru: privacy.slice(0, cut), en: privacy.slice(cut) }
  const manifest = manifestOf('chrome')
  assert.deepEqual(manifestOf('firefox').host_permissions.map(hostOf).sort(), manifest.host_permissions.map(hostOf).sort())
  for (const [lang, text] of Object.entries(texts)) {
    for (const host of manifest.host_permissions.map(hostOf)) assert.ok(text.includes(host), `${lang}: сайт ${host} не назван`)
    for (const permission of manifest.permissions) assert.ok(text.includes(permission), `${lang}: доступ ${permission} не назван`)
    for (const id of S.ORDER) assert.ok(text.includes(S.SERVICES[id].title), `${lang}: сервис ${S.SERVICES[id].title} не назван`)
    // Заявление об ограниченном использовании данных магазин Chrome требует от каждого расширения — оно в обоих текстах.
    assert.ok(text.includes('Chrome Web Store User Data Policy') && text.includes('Limited Use'), `${lang}: нет заявления магазину`)
  }
  // Английский текст — двойник русского: те же пункты, в том же порядке.
  const clauses = (text) => [...text.matchAll(/^(\d\.\d)\. /gm)].map((m) => m[1])
  assert.deepEqual(clauses(texts.en), clauses(texts.ru))
  assert.ok(clauses(texts.ru).length >= 15)
  // «Ничего не хранит» — правда, пока хранилищем расширение не пользуется вовсе.
  for (const file of sources) assert.equal(/\bstorage\b/.test(code(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), false, `${file}: расширение обратилось к хранилищу`)
  // Открытый код: адрес репозитория в манифесте — тот, куда ведёт окно расширения.
  assert.match(manifest.homepage_url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/)
})
