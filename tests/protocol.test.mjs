// Правила «кому и когда можно отдать сессию» и то, что окно показывает.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { EXT_ID, ORDER_ID, ORDER_NO, ORDER_PATH, SITE } from './_harness.mjs'

const require = createRequire(import.meta.url)
const P = require('../src/protocol.js')

const POPUP = `chrome-extension://${EXT_ID}/popup.html`
const ORIGINS = [SITE]
const ourTab = (over = {}) => ({ id: EXT_ID, tab: { id: 7 }, frameId: 0, url: `${SITE}/order/4bb3d68b`, ...over })

test('фон отвечает своему скрипту на странице нашего сайта и своему окну', () => {
  assert.equal(P.mayServe(ourTab(), EXT_ID, ORIGINS, POPUP), true)
  assert.equal(P.mayServe({ id: EXT_ID, url: POPUP }, EXT_ID, ORIGINS, POPUP), true)
  assert.equal(P.mayServe({ id: EXT_ID, url: POPUP + '?x=1' }, EXT_ID, ORIGINS, POPUP), true)
})

test('чужому сайту, чужому расширению и вложенному кадру фон не отвечает', () => {
  assert.equal(P.mayServe(ourTab({ url: 'https://evil.example/order/1' }), EXT_ID, ORIGINS, POPUP), false)
  // Похожий адрес — не наш: сверяем адрес целиком, а не началом строки.
  assert.equal(P.mayServe(ourTab({ url: 'https://astrum.shop.evil.example/order/1' }), EXT_ID, ORIGINS, POPUP), false)
  assert.equal(P.mayServe(ourTab({ url: 'http://astrum.shop/order/1' }), EXT_ID, ORIGINS, POPUP), false)
  assert.equal(P.mayServe(ourTab({ id: 'someoneelse' }), EXT_ID, ORIGINS, POPUP), false)
  assert.equal(P.mayServe(ourTab({ frameId: 3 }), EXT_ID, ORIGINS, POPUP), false)
  assert.equal(P.mayServe(ourTab({ url: 'not a url' }), EXT_ID, ORIGINS, POPUP), false)
  assert.equal(P.mayServe({ id: EXT_ID, url: `chrome-extension://${EXT_ID}/other.html` }, EXT_ID, ORIGINS, POPUP), false)
  assert.equal(P.mayServe(null, EXT_ID, ORIGINS, POPUP), false)
})

test('фон различает, кто спрашивает: своё окно или скрипт страницы', () => {
  assert.equal(P.senderKind(ourTab(), EXT_ID, ORIGINS, POPUP), 'page')
  assert.equal(P.senderKind({ id: EXT_ID, url: POPUP }, EXT_ID, ORIGINS, POPUP), 'popup')
  // Окно, открытое вкладкой, — всё равно окно: адрес расширения странице сайта не достанется.
  assert.equal(P.senderKind({ id: EXT_ID, url: POPUP, tab: { id: 3 }, frameId: 0 }, EXT_ID, ORIGINS, POPUP), 'popup')
  assert.equal(P.senderKind(ourTab({ url: 'https://evil.example/' }), EXT_ID, ORIGINS, POPUP), null)
})

test('сборка «только Скопировать» странице не отвечает вовсе', () => {
  assert.equal(P.mayServe(ourTab(), EXT_ID, [], POPUP), false)
  assert.equal(P.mayServe({ id: EXT_ID, url: POPUP }, EXT_ID, [], POPUP), true)
})

const clickOn = (service, trusted = true) => ({
  isTrusted: trusted,
  target: { closest: (selector) => (selector === '[data-astrum-handoff]' ? { getAttribute: () => service } : null) },
})

test('передачу запускает только настоящее нажатие человека на кнопку передачи', () => {
  assert.equal(P.handoffTarget(clickOn('claude')), 'claude')
  assert.equal(P.handoffTarget(clickOn('grok')), 'grok')
  // Нажатие, созданное скриптом страницы: `isTrusted` у него нет — сессию не отдаём.
  assert.equal(P.handoffTarget(clickOn('claude', false)), null)
  assert.equal(P.handoffTarget({ target: clickOn('claude').target }), null)
  // Нажатие мимо кнопки и кнопка с незнакомым сервисом.
  assert.equal(P.handoffTarget({ isTrusted: true, target: { closest: () => null } }), null)
  assert.equal(P.handoffTarget(clickOn('gmail')), null)
  assert.equal(P.handoffTarget(null), null)
})

test('отдаём сессию только того сервиса, который ждёт заказ, и только пока он её ждёт', () => {
  assert.equal(P.mayHandoff('claude', 'claude', 'need'), true)
  assert.equal(P.mayHandoff('chatgpt', 'claude', 'need'), false)
  assert.equal(P.mayHandoff('claude', null, 'need'), false)
  assert.equal(P.mayHandoff('gmail', 'gmail', 'need'), false)
  // Сессия уже в форме заказа или идёт включение — второй раз класть её некуда.
  assert.equal(P.mayHandoff('claude', 'claude', 'have'), false)
  assert.equal(P.mayHandoff('claude', 'claude', 'running'), false)
  assert.equal(P.mayHandoff('claude', 'claude', null), false)
  assert.equal(P.mayHandoff('claude', 'claude'), false)
})

test('страница заказа — по адресу: заказ и его номер расширение читает само', () => {
  assert.equal(P.orderIdOf(ORDER_PATH), ORDER_ID)
  assert.equal(P.orderIdOf('/order/5BCC256C-3E9F-5002-AEC0-7A79364FBA47'), '5bcc256c-3e9f-5002-aec0-7a79364fba47')
  assert.equal(P.orderIdOf(ORDER_PATH + '/'), ORDER_ID)
  // Главная (с примером «Как это работает»), каталог, список заказов, оформление, кабинет, админка — не заказ.
  for (const path of ['/', '/product/claude-pro', '/orders', '/checkout', '/order/continue', '/account', `/admin/orders/${ORDER_ID}`]) {
    assert.equal(P.orderIdOf(path), null, path)
  }
  // Похожее на заказ, но не он: короткий номер, лишний хвост, чужой путь перед ним.
  assert.equal(P.orderIdOf('/order/4bb3d68b'), null)
  assert.equal(P.orderIdOf(ORDER_PATH + '/x'), null)
  assert.equal(P.orderIdOf('/x' + ORDER_PATH), null)
  assert.equal(P.orderIdOf(undefined), null)
  assert.equal(P.orderIdOf({ toString: () => ORDER_PATH }), null)
  // Номер — каким его видит покупатель на странице заказа.
  assert.equal(P.orderNoOf(ORDER_ID), ORDER_NO)
  assert.equal(P.orderNoOf('5bcc256c-3e9f-5002-aec0-7a79364fba47'), '5BCC256C')
  assert.equal(P.orderNoOf(null), '')
})

test('рассказ о заказе расширение слушает только на странице заказа и только о заказе из её адреса', () => {
  const hello = { wants: 'chatgpt', stage: 'need', order: { id: ORDER_ID, no: 'FFFFFFFF', title: 'ChatGPT Plus', plan: 'Plus', eta: '' } }
  // Номер — по адресу, а не со слов страницы.
  const order = { no: ORDER_NO, title: 'ChatGPT Plus', plan: 'Plus', eta: '' }
  assert.deepEqual(P.heard(hello, ORDER_PATH), { id: ORDER_ID, wants: 'chatgpt', stage: 'need', order })
  assert.deepEqual(P.heard({ ...hello, order: { ...hello.order, id: ORDER_ID.toUpperCase() } }, ORDER_PATH), { id: ORDER_ID, wants: 'chatgpt', stage: 'need', order })
  // Так настоящая сессия однажды ушла в пример на главной (10.11.2026, до публикации): та же форма заказа, но страница — не заказ.
  assert.equal(P.heard(hello, '/'), P.NO_ORDER)
  assert.equal(P.heard({ ...hello, order: { title: 'ChatGPT Plus', plan: 'Plus' } }, '/'), P.NO_ORDER)
  assert.equal(P.heard(hello, '/orders'), P.NO_ORDER)
  // Страница заказа, но рассказ — о другом заказе или без заказа вовсе: не слушаем.
  assert.equal(P.heard({ ...hello, order: { ...hello.order, id: '5bcc256c-3e9f-5002-aec0-7a79364fba47' } }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard({ ...hello, order: { title: 'ChatGPT Plus' } }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard({ ...hello, order: { ...hello.order, id: 7 } }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard({ ...hello, order: null }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard({ ...hello, order: ORDER_ID }, ORDER_PATH), P.NO_ORDER)
  // Незнакомый сервис, непонятный этап, «заказ ушёл с экрана», мусор — не заказ и на странице заказа.
  assert.equal(P.heard({ ...hello, wants: 'gmail' }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard({ ...hello, stage: 'paid' }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard({ wants: null, stage: null, order: null }, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard(null, ORDER_PATH), P.NO_ORDER)
  assert.equal(P.heard('chatgpt', ORDER_PATH), P.NO_ORDER)
  assert.deepEqual({ ...P.NO_ORDER }, { id: null, wants: null, stage: null, order: null })
  // Подписей страница не дала — заказ всё равно заказ: номер у него есть.
  assert.deepEqual(P.heard({ wants: 'claude', stage: 'running', order: { id: ORDER_ID } }, ORDER_PATH), {
    id: ORDER_ID,
    wants: 'claude',
    stage: 'running',
    order: { no: ORDER_NO, title: '', plan: '', eta: '' },
  })
})

test('адреса сайта берутся из манифеста', () => {
  assert.deepEqual(P.originsOf(['https://astrum.shop/*', 'http://localhost:3000/*']), ['https://astrum.shop', 'http://localhost:3000'])
  // Шаблон «все сайты» адресом не становится.
  assert.deepEqual(P.originsOf(['<all_urls>', 'https://*/*', '*://astrum.shop/*']), [])
  assert.deepEqual(P.originsOf(undefined), [])
})

test('о заказе страница рассказывает только короткими строками, номер — свой', () => {
  assert.deepEqual(P.cleanOrder({ no: 'FFFFFFFF', title: 'Claude Max 5x', plan: 'Max 5x', eta: 'Обычно 15–20 минут' }, ORDER_NO), {
    no: ORDER_NO,
    title: 'Claude Max 5x',
    plan: 'Max 5x',
    eta: 'Обычно 15–20 минут',
  })
  const long = P.cleanOrder({ title: 'a\nb' + 'c'.repeat(200), plan: 7, eta: 'e'.repeat(99) }, ORDER_NO)
  assert.equal(long.title.length, 60)
  assert.equal(long.title.includes('\n'), false)
  assert.equal(long.plan, '')
  assert.equal(long.eta.length, 60)
  // Подписей нет или они не объект — заказ остаётся заказом, с пустыми подписями.
  assert.deepEqual(P.cleanOrder(null, ORDER_NO), { no: ORDER_NO, title: '', plan: '', eta: '' })
  assert.deepEqual(P.cleanOrder('Claude', ORDER_NO), { no: ORDER_NO, title: '', plan: '', eta: '' })
  // Номера нет (страница — не заказ) — и заказа нет, что бы страница ни рассказала.
  assert.equal(P.cleanOrder({ no: '4BB3D68B', title: 'Claude Max 5x' }, null), null)
  assert.equal(P.cleanOrder({ no: '4BB3D68B', title: 'Claude Max 5x' }), null)
})

test('окно показывает заказ с вкладки перед глазами; иначе — тот, которому нужна сессия', () => {
  const order = (no) => ({ no, title: '', plan: '', eta: '' })
  const need = { tabId: 1, wants: 'claude', stage: 'need', active: false, order: order('AAAAAAAA') }
  const front = { tabId: 2, wants: 'grok', stage: 'need', active: true, order: order('BBBBBBBB') }
  const running = { tabId: 3, wants: 'chatgpt', stage: 'running', active: false, order: order('CCCCCCCC') }
  const have = { tabId: 4, wants: 'chatgpt', stage: 'have', active: true, order: order('DDDDDDDD') }
  assert.equal(P.pickOrder([need, front]), front)
  // Перед глазами заказ, в который сессию уже передали, а в другой вкладке её ждут: окно говорит про заказ перед
  // глазами («сессия в заказе»), а не зовёт «Передать сессию» в другую вкладку и не уводит с заказа.
  assert.equal(P.pickOrder([need, have]), have)
  assert.equal(P.pickOrder([have, need]), have)
  // Перед глазами не заказ: сначала тот, которому нужна сессия, потом любой.
  assert.equal(P.pickOrder([running, need]), need)
  assert.equal(P.pickOrder([running]), running)
  // Страница без заказа и ответ с незнакомым сервисом — не заказ: окно покажет список.
  assert.equal(P.pickOrder([{ tabId: 5, wants: null, stage: null, order: null }, { tabId: 6, wants: 'gmail', stage: 'need', order: order('EEEEEEEE') }, null]), null)
  // «Заказ» без номера — не заказ, даже с вкладки перед глазами (так в окно попал пример с главной).
  assert.equal(P.pickOrder([{ tabId: 7, wants: 'chatgpt', stage: 'need', active: true, order: order('') }]), null)
  assert.equal(P.pickOrder([{ tabId: 7, wants: 'chatgpt', stage: 'need', active: true, order: null }, running]), running)
  assert.equal(P.pickOrder([{ tabId: 7, wants: 'chatgpt', stage: 'need', active: true }]), null)
  assert.equal(P.pickOrder([]), null)
})

test('вид пропуска — по этапу заказа и по тому, вошёл ли человек', () => {
  assert.equal(P.passState('need', true), 'ready')
  assert.equal(P.passState('need', false), 'off')
  assert.equal(P.passState('have', false), 'have')
  assert.equal(P.passState('running', true), 'running')
})

test('пока читаем, вошёл ли человек, окно не говорит ни «готова», ни «не вошли»', () => {
  // Так окно раньше и «залипало»: на полсекунды показывало «не вошли» и «Войти», а потом — «готова».
  assert.equal(P.passState('need', null, true), 'wait')
  assert.equal(P.passState('need', undefined, true), 'wait')
  // Быстрый взгляд уже дал ответ — рисуем его сразу, полного ответа не ждём.
  assert.equal(P.passState('need', true, true), 'ready')
  assert.equal(P.passState('need', false, true), 'off')
  // Полный ответ пришёл, а вход так и неизвестен — как «не вошли»: кнопка ведёт войти.
  assert.equal(P.passState('need', null, false), 'off')
  // Сессия уже в заказе или идёт включение — читать вход незачем.
  assert.equal(P.passState('have', null, true), 'have')
  assert.equal(P.passState('running', null, true), 'running')
})

test('почта под маской — как на странице заказа', () => {
  // Так же маскирует почту сайт: половина имени, но не больше четырёх знаков и не меньше одного.
  assert.equal(P.maskEmail('alexander@example.com'), 'alex•••@example.com')
  // Длинное имя — на потолке: половина была бы восемь знаков, показываем четыре.
  assert.equal(P.maskEmail('alexander.petrov@example.com'), 'alex•••@example.com')
  assert.equal(P.maskEmail('demo123@astrum.test'), 'dem•••@astrum.test')
  assert.equal(P.maskEmail('ab@x.io'), 'a•••@x.io')
  assert.equal(P.maskEmail('a@x.io'), 'a•••@x.io')
  assert.equal(P.maskEmail('no-at-sign'), null)
  assert.equal(P.maskEmail(''), null)
  assert.equal(P.maskEmail(undefined), null)
})
