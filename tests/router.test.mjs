// Фон: кому отвечает и что отдаёт.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { EXT_ID, SITE } from './_harness.mjs'

const require = createRequire(import.meta.url)
const { createRouter, ACCOUNT_AFTER_MS } = require('../src/router.js')

const POPUP = `chrome-extension://${EXT_ID}/popup.html`
const ourTab = (over = {}) => ({ id: EXT_ID, tab: { id: 7 }, frameId: 0, url: `${SITE}/order/4bb3d68b`, ...over })
const ourPopup = { id: EXT_ID, url: POPUP }

function make({ origins = [SITE], clock = { t: 1_000_000 }, signedOut = false } = {}) {
  const asked = []
  const reader = {
    account: async (service) => {
      asked.push(['account', service])
      return 'alex•••@example.com'
    },
    // ⚠️ Чтение здесь отдаёт почту и тариф ВСЕГДА, о чём бы его ни просили: что странице они не уходят, решает фон.
    status: async (service, opts) => {
      asked.push(['status', service, opts && opts.account === false ? 'без почты' : 'с почтой'])
      return { signedIn: true, account: 'alex•••@example.com', plan: 'Max' }
    },
    session: async (service) => {
      asked.push(['session', service])
      return signedOut ? { ok: false, code: 'signed_out' } : { ok: true, value: 'SECRET-' + service }
    },
    warm: async (service) => {
      asked.push(['warm', service])
      return { value: 'SECRET-' + service } // что бы чтение ни вернуло, наружу это не выходит
    },
  }
  return { router: createRouter({ reader, selfId: EXT_ID, origins, popupUrl: POPUP, now: () => clock.t }), asked, clock }
}

test('своему скрипту на странице заказа фон отдаёт сессию', async () => {
  const { router } = make()
  assert.deepEqual(await router.handle({ type: 'session', service: 'claude' }, ourTab()), { ok: true, value: 'SECRET-claude' })
})

test('чужому сайту фон не отвечает и сессию даже не читает', async () => {
  const { router, asked } = make()
  for (const sender of [
    ourTab({ url: 'https://evil.example/order/1' }),
    ourTab({ url: 'https://astrum.shop.evil.example/' }),
    ourTab({ id: 'another-extension' }),
    ourTab({ frameId: 2 }),
    { id: EXT_ID, url: `chrome-extension://${EXT_ID}/other.html` },
    undefined,
  ]) {
    assert.equal(await router.handle({ type: 'session', service: 'claude' }, sender), undefined)
    assert.equal(await router.handle({ type: 'status', services: ['claude'] }, sender), undefined)
  }
  assert.deepEqual(asked, [])
})

test('сервис — только из таблицы', async () => {
  const { router, asked } = make()
  assert.deepEqual(await router.handle({ type: 'session', service: 'gmail' }, ourTab()), { ok: false, code: 'unknown_service' })
  assert.deepEqual(await router.handle({ type: 'session' }, ourTab()), { ok: false, code: 'unknown_service' })
  assert.deepEqual(await router.handle({ type: 'status', services: ['claude', 'gmail', 7] }, ourPopup), {
    services: { claude: { signedIn: true, account: 'alex•••@example.com', plan: 'Max' } },
  })
  assert.deepEqual(asked, [['status', 'claude', 'с почтой']])
})

test('почта и тариф аккаунта — только своему окну, странице заказа — «вошли / не вошли»', async () => {
  const { router, asked } = make()
  assert.deepEqual(await router.handle({ type: 'status', services: ['claude'] }, ourTab()), {
    services: { claude: { signedIn: true, account: null, plan: null } },
  })
  // Просьба «дай с почтой» от страницы ничего не меняет: решает, кто спрашивает, а не что он просит.
  assert.deepEqual(await router.handle({ type: 'status', services: ['claude'], account: true }, ourTab()), {
    services: { claude: { signedIn: true, account: null, plan: null } },
  })
  assert.deepEqual(await router.handle({ type: 'status', services: ['claude'] }, ourPopup), {
    services: { claude: { signedIn: true, account: 'alex•••@example.com', plan: 'Max' } },
  })
  // Для страницы чтение и не просят ходить за почтой: лишний запрос к сервису без нажатия человека ни к чему.
  assert.deepEqual(asked.map((a) => a[2]), ['без почты', 'без почты', 'с почтой'])
})

test('почту аккаунта страница получает только вслед за сессией — этого сервиса, этой вкладке и недолго', async () => {
  const { router, asked, clock } = make()
  const NONE = { account: null }
  // До нажатия: сессию вкладке не отдавали — почты нет, и сервис даже не спрашивали.
  assert.deepEqual(await router.handle({ type: 'account', service: 'claude' }, ourTab()), NONE)
  assert.deepEqual(asked, [])
  // Нажали: сессия ушла вкладке 7 — теперь ей можно назвать, чей это аккаунт.
  await router.handle({ type: 'session', service: 'claude' }, ourTab())
  assert.deepEqual(await router.handle({ type: 'account', service: 'claude' }, ourTab()), { account: 'alex•••@example.com' })
  // Другой сервис, другая вкладка, незнакомый сервис — нет.
  assert.deepEqual(await router.handle({ type: 'account', service: 'chatgpt' }, ourTab()), NONE)
  assert.deepEqual(await router.handle({ type: 'account', service: 'claude' }, ourTab({ tab: { id: 8 } })), NONE)
  assert.deepEqual(await router.handle({ type: 'account', service: 'gmail' }, ourTab()), NONE)
  // Прошло время — окно закрылось.
  clock.t += ACCOUNT_AFTER_MS + 1
  assert.deepEqual(await router.handle({ type: 'account', service: 'claude' }, ourTab()), NONE)
  // Своему окну — всегда; чужому сайту — тишина.
  assert.deepEqual(await router.handle({ type: 'account', service: 'grok' }, ourPopup), { account: 'alex•••@example.com' })
  assert.equal(await router.handle({ type: 'account', service: 'claude' }, ourTab({ url: 'https://evil.example/' })), undefined)
})

test('сессию не отдали (вышли из сервиса) — и почту странице не называем', async () => {
  const { router } = make({ signedOut: true })
  await router.handle({ type: 'session', service: 'claude' }, ourTab())
  assert.deepEqual(await router.handle({ type: 'account', service: 'claude' }, ourTab()), { account: null })
})

test('окно спрашивает о всех сервисах разом, а не по очереди', async () => {
  const order = []
  const gates = {}
  const reader = {
    status: (service) =>
      new Promise((resolve) => {
        order.push('start ' + service)
        gates[service] = () => resolve({ signedIn: true, account: null })
      }),
    session: async () => ({ ok: false, code: 'signed_out' }),
  }
  const router = createRouter({ reader, selfId: EXT_ID, origins: [SITE], popupUrl: POPUP })
  const pending = router.handle({ type: 'status', services: ['claude', 'chatgpt', 'grok'] }, ourPopup)
  await new Promise((resolve) => setImmediate(resolve))
  // Все три чтения начались, хотя ни одно ещё не ответило.
  assert.deepEqual(order, ['start claude', 'start chatgpt', 'start grok'])
  gates.grok()
  gates.chatgpt()
  gates.claude()
  assert.deepEqual(Object.keys((await pending).services), ['claude', 'chatgpt', 'grok'])
})

test('статус значения сессии не содержит', async () => {
  const { router } = make()
  const answer = await router.handle({ type: 'status', services: ['claude', 'chatgpt', 'grok'] }, ourPopup)
  assert.equal(JSON.stringify(answer).includes('SECRET'), false)
})

test('сборка «только Скопировать»: странице — тишина, своему окну — сессия для буфера', async () => {
  const { router, asked } = make({ origins: [] })
  assert.equal(await router.handle({ type: 'session', service: 'claude' }, ourTab()), undefined)
  assert.equal(await router.handle({ type: 'status', services: ['claude'] }, ourTab()), undefined)
  assert.deepEqual(asked, [])
  assert.deepEqual(await router.handle({ type: 'session', service: 'grok' }, ourPopup), { ok: true, value: 'SECRET-grok' })
})

test('разогрев перед нажатием: фон будит связь с сервисом и не отдаёт ничего, кроме «принято»', async () => {
  const { router, asked } = make()
  assert.deepEqual(await router.handle({ type: 'warm', service: 'chatgpt' }, ourTab()), { ok: true })
  assert.deepEqual(await router.handle({ type: 'warm', service: 'gmail' }, ourTab()), { ok: false })
  assert.deepEqual(asked, [['warm', 'chatgpt']])
  // Чужому — тишина, как на любое сообщение.
  assert.equal(await router.handle({ type: 'warm', service: 'chatgpt' }, ourTab({ url: 'https://evil.example/' })), undefined)
  assert.equal(asked.length, 1)
})

test('незнакомое сообщение остаётся без ответа', async () => {
  const { router } = make()
  assert.equal(await router.handle({ type: 'dump-everything' }, ourTab()), undefined)
  assert.equal(await router.handle(null, ourTab()), undefined)
})
