// Скрипт страницы заказа: когда он кладёт сессию в страницу, а когда молчит.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXT_ID, ORDER_ID, ORDER_NO, SITE, manifestOf, mountContent, plain, settle } from './_harness.mjs'

const SESSION = 'sk-ant-sid01-' + 'B'.repeat(40)
/** Номер версии — из манифеста: его поднимают перед каждой подачей в магазин, тесты за ним не переписываются. */
const VERSION = manifestOf().version

/** Фон, который вошёл в Claude. */
const signedIn = (message) => {
  if (message.type === 'status') return { services: { claude: { signedIn: true, account: 'alex•••@example.com' } } }
  if (message.type === 'session') return { ok: true, value: SESSION }
  if (message.type === 'account') return { account: 'alex•••@example.com' }
  return null
}

const ofType = (page, type) => page.posted.filter((p) => p.data.type === type)

test('страница узнаёт о расширении сразу и получает ответ на рассказ о заказе', async () => {
  const page = mountContent({ background: signedIn })
  assert.equal(ofType(page, 'ready').length, 1)
  // Отметка на корне страницы — по ней окно заказа рисует шаг расширения с первого кадра.
  assert.ok(page.marker().startsWith(VERSION + '/'))
  page.hello({ wants: 'claude', stage: 'need', order: { no: '4BB3D68B', title: 'Claude Max 5x', plan: 'Max 5x' } })
  // «Я здесь» — сразу, не дожидаясь фона: у ChatGPT ответ фона — это запрос в сеть.
  assert.equal(ofType(page, 'here').length, 1)
  assert.equal(ofType(page, 'state').length, 0)
  await settle()
  const state = ofType(page, 'state')[0].data
  assert.deepEqual(plain(state), { astrum: 'astrum-ext', type: 'state', version: VERSION, service: 'claude', signedIn: true })
  // Сообщения уходят только своей странице, а не «всем окнам».
  assert.ok(page.posted.every((p) => p.targetOrigin === SITE))
  // В ответе о состоянии нет ни сессии (её отдаёт только нажатие), ни почты аккаунта (она — только окну расширения).
  assert.equal(JSON.stringify(page.posted).includes(SESSION), false)
  assert.equal(JSON.stringify(page.posted).includes('example.com'), false)
})

test('сервис не ответил — странице «не знаем», а не «не вошли»', async () => {
  const page = mountContent({ background: () => ({ services: { claude: { signedIn: null, account: null } } }) })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  assert.equal(ofType(page, 'state')[0].data.signedIn, null)
})

test('пока фон отвечал, заказ ушёл с экрана — запоздалый ответ странице не нужен', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  page.hello({ wants: null })
  await settle()
  assert.equal(ofType(page, 'state').length, 0)
  assert.equal(ofType(page, 'here').length, 2)
})

test('настоящее нажатие на кнопку передачи кладёт сессию в страницу', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.click({ service: 'claude' })
  await settle()
  assert.deepEqual(plain(page.delivered), [{ service: 'claude', value: SESSION }])
  // Сессия идёт своим событием документа, а не сообщением окна: его слышат все, кто слушает `message`.
  assert.equal(JSON.stringify(page.posted).includes(SESSION), false)
})

test('вслед за сессией страница узнаёт, чей это аккаунт; до нажатия — нет', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  // До нажатия почту у фона даже не спрашиваем.
  assert.equal(page.sent.some((m) => m.type === 'account'), false)
  assert.equal(ofType(page, 'account').length, 0)
  page.click({ service: 'claude' })
  await settle()
  assert.deepEqual(plain(ofType(page, 'account')[0].data), { astrum: 'astrum-ext', type: 'account', service: 'claude', account: 'alex•••@example.com' })
  // Сессия ушла раньше почты и своим событием.
  assert.deepEqual(page.sent.map((m) => m.type).filter((t) => t !== 'status'), ['session', 'account'])
})

test('почту не узнали — странице так и говорим (ей не нужно ждать); сессию не отдали — о почте ни слова', async () => {
  for (const answer of [{ account: null }, { account: '' }, { account: 7 }, null]) {
    const noMail = mountContent({ background: (m) => (m.type === 'session' ? { ok: true, value: SESSION } : m.type === 'account' ? answer : { services: {} }) })
    noMail.hello({ wants: 'claude', stage: 'need' })
    noMail.click({ service: 'claude' })
    await settle()
    assert.equal(noMail.delivered.length, 1)
    // Страница держит на месте почты заготовку — «не узнали» снимает её сразу, а не по истечении ожидания.
    assert.deepEqual(plain(ofType(noMail, 'account').map((p) => p.data)), [{ astrum: 'astrum-ext', type: 'account', service: 'claude', account: null }])
  }
  const out = mountContent({ background: (m) => (m.type === 'session' ? { ok: false, code: 'signed_out' } : { account: 'alex•••@example.com' }) })
  out.hello({ wants: 'claude', stage: 'need' })
  out.click({ service: 'claude' })
  await settle()
  assert.equal(out.sent.some((m) => m.type === 'account'), false)
  assert.equal(ofType(out, 'account').length, 0)
})

test('нажатие услышано — странице сразу «беру», ещё до ответа сервиса', async () => {
  let release
  const page = mountContent({
    background: (m) => (m.type === 'session' ? new Promise((resolve) => (release = () => resolve({ ok: true, value: SESSION }))) : signedIn(m)),
  })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.click({ service: 'claude' })
  // «Беру» ушло в том же нажатии: сессия ещё читается (у ChatGPT это секунды), а страница уже не ждёт вслепую.
  assert.deepEqual(plain(ofType(page, 'taking').map((p) => p.data)), [{ astrum: 'astrum-ext', type: 'taking', service: 'claude' }])
  assert.equal(page.delivered.length, 0)
  release()
  await settle()
  assert.equal(page.delivered.length, 1)
  // Нажатие, которое не принято (скрипт страницы, чужой сервис, мимо кнопки), «беру» не даёт.
  page.hello({ wants: 'claude', stage: 'need' })
  page.click({ service: 'claude', trusted: false })
  page.click({ service: 'grok' })
  page.click({ onButton: false })
  await settle()
  assert.equal(ofType(page, 'taking').length, 1)
  // «Передать сессию» из окна расширения — страница тоже видит, что сессию читают.
  const fromPopup = page.fromExtension({ type: 'handoff', service: 'claude' })
  await settle()
  assert.equal(ofType(page, 'taking').length, 2)
  release()
  assert.deepEqual(plain(await fromPopup), { ok: true })
})

test('«я здесь» говорит, принят ли рассказ о заказе', async () => {
  const order = mountContent({ background: signedIn })
  order.hello({ wants: 'claude', stage: 'need' })
  assert.deepEqual(plain(ofType(order, 'here').at(-1).data), { astrum: 'astrum-ext', type: 'here', version: VERSION, heard: true })
  // Страница считает себя заказом, а расширение — нет (версии разошлись, адрес не тот): живо, но передавать не будет.
  const other = mountContent({ background: signedIn, path: '/checkout' })
  other.hello({ wants: 'claude', stage: 'need' })
  assert.deepEqual(plain(ofType(other, 'here').at(-1).data), { astrum: 'astrum-ext', type: 'here', version: VERSION, heard: false })
  const stranger = mountContent({ background: signedIn })
  stranger.hello({ wants: 'claude', stage: 'need', order: { id: '5bcc256c-3e9f-5002-aec0-7a79364fba47' } })
  assert.equal(ofType(stranger, 'here').at(-1).data.heard, false)
})

test('курсор подошёл к кнопке передачи — фон будим заранее, не чаще раза в 20 секунд и только у ждущего заказа', async () => {
  const clock = { t: 1_000_000 }
  const page = mountContent({ background: signedIn, clock })
  const warms = () => page.sent.filter((m) => m.type === 'warm')
  // Заказа на странице ещё нет — будить незачем.
  page.hover({ service: 'claude' })
  assert.equal(warms().length, 0)
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.hover({ onButton: false })
  page.hover({ service: 'grok' })
  assert.equal(warms().length, 0)
  page.hover({ service: 'claude' })
  page.hover({ service: 'claude' })
  assert.deepEqual(plain(warms()), [{ type: 'warm', service: 'claude' }])
  clock.t += 19_000
  page.hover({ service: 'claude' })
  assert.equal(warms().length, 1)
  clock.t += 2_000
  page.hover({ service: 'claude' })
  assert.equal(warms().length, 2)
  // По наведению странице не уходит ничего: ни сессии, ни «беру», ни почты.
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.equal(ofType(page, 'taking').length + ofType(page, 'account').length, 0)
  // Сессия уже в форме — греть нечего; не страница заказа — тем более.
  page.hello({ wants: 'claude', stage: 'have' })
  clock.t += 60_000
  page.hover({ service: 'claude' })
  assert.equal(warms().length, 2)
  const home = mountContent({ background: signedIn, path: '/', clock })
  home.hello({ wants: 'claude', stage: 'need' })
  home.hover({ service: 'claude' })
  assert.equal(home.sent.length, 0)
})

test('нажатие, созданное скриптом страницы, сессию не даёт', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.click({ service: 'claude', trusted: false })
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.equal(page.sent.some((m) => m.type === 'session'), false)
})

test('нажатие мимо кнопки и кнопка другого сервиса сессию не дают', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.click({ onButton: false })
  page.click({ service: 'chatgpt' })
  page.click({ service: 'gmail' })
  await settle()
  assert.equal(page.sent.some((m) => m.type === 'session'), false)
})

test('пока страница не рассказала о заказе, нажатие ничего не даёт', async () => {
  const page = mountContent({ background: signedIn })
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.sent.length, 0)
  // Заказ ушёл со страницы (сессию приняли, окно данных закрылось) — кнопка больше не работает.
  page.hello({ wants: 'claude', stage: 'need' })
  page.hello({ wants: null })
  await settle()
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.sent.some((m) => m.type === 'session'), false)
})

test('сообщения чужих окон и чужих скриптов скрипт не слушает', async () => {
  // ⚠️ Рассказ — полный, с заказом этой страницы: иначе его отсекла бы сверка заказа, а не сверка отправителя, и тест
  // ничего бы не сторожил (так и было час после правки 10.11.2026 — проверка «слушать чужое окно» ничего не ловила).
  const hello = { astrum: 'astrum-page', type: 'hello', wants: 'claude', stage: 'need', order: { id: ORDER_ID } }
  const page = mountContent({ background: signedIn })
  // Другое окно (вкладка-открыватель, вложенный кадр) и чужой адрес.
  page.rawMessage({ source: {}, data: hello })
  page.rawMessage({ origin: 'https://evil.example', data: hello })
  // Своё окно, но не наша метка.
  page.rawMessage({ data: { ...hello, astrum: undefined } })
  page.rawMessage({ data: { ...hello, astrum: 'astrum-ext' } })
  await settle()
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.sent.length, 0)
  // Тот же рассказ от своей страницы — слушаем: отказ выше — именно из-за отправителя.
  page.rawMessage({ data: hello })
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 1)
})

test('не вошли в сервис — странице приходит отказ, а не пустая сессия', async () => {
  const page = mountContent({
    background: (message) => (message.type === 'session' ? { ok: false, code: 'signed_out' } : { services: { claude: { signedIn: false, account: null } } }),
  })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.deepEqual(plain(ofType(page, 'fail')[0].data), { astrum: 'astrum-ext', type: 'fail', service: 'claude', code: 'signed_out' })
})

test('окно расширения: «Передать сессию» работает только для сервиса, который ждёт заказ', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need', order: { no: 'FFFFFFFF', title: 'Claude Max 5x' } })
  await settle()
  // Номер заказа окну — по адресу страницы, а не со слов страницы.
  assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), {
    wants: 'claude',
    stage: 'need',
    order: { no: ORDER_NO, title: 'Claude Max 5x', plan: '', eta: '' },
  })
  assert.deepEqual(plain(await page.fromExtension({ type: 'handoff', service: 'grok' })), { ok: false, code: 'not_waiting' })
  assert.equal(page.delivered.length, 0)
  assert.deepEqual(plain(await page.fromExtension({ type: 'handoff', service: 'claude' })), { ok: true })
  assert.equal(page.delivered.length, 1)
  // То же сообщение от чужого расширения — без ответа и без сессии.
  assert.equal(await page.fromExtension({ type: 'handoff', service: 'claude' }, { id: 'another-extension' }), undefined)
  assert.equal(page.delivered.length, 1)
})

test('окно расширения узнаёт, почему передать не вышло', async () => {
  const out = mountContent({ background: (m) => (m.type === 'session' ? { ok: false, code: 'signed_out' } : { services: {} }) })
  out.hello({ wants: 'claude', stage: 'need' })
  assert.deepEqual(plain(await out.fromExtension({ type: 'handoff', service: 'claude' })), { ok: false, code: 'signed_out' })
  const down = mountContent({ background: (m) => (m.type === 'session' ? null : { services: {} }) })
  down.hello({ wants: 'claude', stage: 'need' })
  assert.deepEqual(plain(await down.fromExtension({ type: 'handoff', service: 'claude' })), { ok: false, code: 'unavailable' })
  assert.equal(out.delivered.length + down.delivered.length, 0)
})

// ───── Страница заказа — по адресу, а не со слов страницы ─────
// ⚠️⚠️ Случай 10.11.2026 (до публикации): пример «Как это работает» на главной рисует ту же форму заказа, рассказал
// расширению о «заказе», и «Передать сессию» в окне расширения положила настоящую сессию в пример и увела на главную.

for (const path of ['/', '/orders', '/checkout', '/order/continue', '/product/chatgpt-plus']) {
  test(`не страница заказа (${path}): рассказ о «заказе» не слушаем — ни нажатию, ни окну расширения сессии нет`, async () => {
    const page = mountContent({ background: signedIn, path })
    // Пример на главной заказа не называет вовсе; на всякий случай — и «заказ» с настоящим id отсюда тоже не слушаем.
    page.hello({ wants: 'claude', stage: 'need', order: { id: '', title: 'Claude Max 5x', plan: 'Max 5x' } })
    page.hello({ wants: 'claude', stage: 'need', order: { id: ORDER_ID, title: 'Claude Max 5x', plan: 'Max 5x' } })
    await settle()
    // Окну расширения показать нечего: заказа на этой странице нет.
    assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), { wants: null, stage: null, order: null })
    // «Передать сессию» из окна и настоящее нажатие на странице — без сессии.
    assert.deepEqual(plain(await page.fromExtension({ type: 'handoff', service: 'claude' })), { ok: false, code: 'not_waiting' })
    page.click({ service: 'claude' })
    await settle()
    assert.equal(page.delivered.length, 0)
    // Фон о сессии даже не спрашивали — и о том, вошёл ли человек, тоже: странице без заказа это знать незачем.
    assert.equal(page.sent.length, 0)
    assert.equal(ofType(page, 'state').length, 0)
  })
}

test('страница заказа рассказала о ДРУГОМ заказе или не назвала его — не слушаем', async () => {
  for (const order of [{ id: '5bcc256c-3e9f-5002-aec0-7a79364fba47', title: 'Claude Max 5x' }, { id: undefined, title: 'Claude Max 5x' }, { id: '' }]) {
    const page = mountContent({ background: signedIn })
    page.hello({ wants: 'claude', stage: 'need', order })
    await settle()
    assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), { wants: null, stage: null, order: null })
    assert.deepEqual(plain(await page.fromExtension({ type: 'handoff', service: 'claude' })), { ok: false, code: 'not_waiting' })
    page.click({ service: 'claude' })
    await settle()
    assert.equal(page.delivered.length, 0)
    assert.equal(page.sent.length, 0)
  }
  // Тот же рассказ с id из адреса — слушаем (проверка не вакуумная: отказ выше — именно из-за заказа).
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need', order: { id: ORDER_ID.toUpperCase(), title: 'Claude Max 5x' } })
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 1)
})

test('сайт сменил страницу без перезагрузки: с главной на заказ — слушаем, с заказа — перестаём', async () => {
  const page = mountContent({ background: signedIn, path: '/' })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  assert.equal(page.sent.length, 0)
  // Открыли заказ: страница рассказала о нём уже с его адреса.
  page.go('/order/5bcc256c-3e9f-5002-aec0-7a79364fba47')
  page.hello({ wants: 'claude', stage: 'need', order: { title: 'Claude Max 5x' } })
  await settle()
  assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), { wants: 'claude', stage: 'need', order: { no: '5BCC256C', title: 'Claude Max 5x', plan: '', eta: '' } })
  // Ушли со страницы заказа, а страница об этом не сказала (не успела, сломалась) — прежний рассказ не действует.
  page.go('/orders')
  assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), { wants: null, stage: null, order: null })
  assert.deepEqual(plain(await page.fromExtension({ type: 'handoff', service: 'claude' })), { ok: false, code: 'not_waiting' })
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.equal(page.sent.some((m) => m.type === 'session'), false)
  // Перешли на ДРУГОЙ заказ — рассказ о прежнем к нему не относится.
  page.go('/order/cfecee5e-14b1-56da-a4a4-bc4b59a42a36')
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 0)
})

test('пока читали сессию, заказ ушёл с экрана — сессию в страницу не кладём', async () => {
  let release
  const page = mountContent({
    background: (m) => (m.type === 'session' ? new Promise((resolve) => (release = () => resolve({ ok: true, value: SESSION }))) : signedIn(m)),
  })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  const answer = page.fromExtension({ type: 'handoff', service: 'claude' })
  await settle()
  page.go('/')
  release()
  assert.deepEqual(plain(await answer), { ok: false, code: 'not_waiting' })
  assert.equal(page.delivered.length, 0)
  // И почту аккаунта вслед не спрашиваем.
  assert.equal(page.sent.some((m) => m.type === 'account'), false)
})

test('пока узнавали почту аккаунта, заказ ушёл с экрана — почту странице не называем', async () => {
  for (const leave of [(page) => page.go('/orders'), (page) => page.hello({ wants: null })]) {
    let release
    const page = mountContent({
      background: (m) => (m.type === 'account' ? new Promise((resolve) => (release = () => resolve({ account: 'alex•••@example.com' }))) : signedIn(m)),
    })
    page.hello({ wants: 'claude', stage: 'need' })
    await settle()
    page.click({ service: 'claude' })
    await settle()
    assert.equal(page.delivered.length, 1)
    leave(page)
    release()
    await settle()
    assert.equal(ofType(page, 'account').length, 0)
  }
})

test('сессия уже в форме заказа или идёт включение — второй раз не кладём', async () => {
  for (const stage of ['have', 'running']) {
    const page = mountContent({ background: signedIn })
    page.hello({ wants: 'claude', stage })
    await settle()
    assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), { wants: 'claude', stage, order: { no: ORDER_NO, title: '', plan: '', eta: '' } })
    assert.deepEqual(plain(await page.fromExtension({ type: 'handoff', service: 'claude' })), { ok: false, code: 'not_waiting' })
    page.click({ service: 'claude' })
    await settle()
    assert.equal(page.delivered.length, 0, stage)
    assert.equal(page.sent.some((m) => m.type === 'session'), false, stage)
  }
})

test('вошли или вышли — страница получает свежее состояние без перезагрузки', async () => {
  let inside = false
  const page = mountContent({
    background: (message) => (message.type === 'status' ? { services: { claude: { signedIn: inside, account: null } } } : null),
  })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  inside = true
  await page.fromExtension({ type: 'changed' })
  await settle()
  assert.deepEqual(
    ofType(page, 'state').map((p) => p.data.signedIn),
    [false, true]
  )
  // Отметку на странице держит живой скрипт.
  assert.ok(page.marker())
})

test('фон не ответил (сбой связи) — скрипт не падает, странице «не знаем»', async () => {
  const page = mountContent({
    background: () => {
      throw new Error('Could not establish connection.')
    },
  })
  page.hello({ wants: 'claude', stage: 'need' })
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.equal(ofType(page, 'state')[0].data.signedIn, null)
  assert.equal(ofType(page, 'fail')[0].data.code, 'unavailable')
  assert.equal(EXT_ID.length, 32)
})

test('скрипт подключили второй раз в ту же страницу — отвечает один', async () => {
  const page = mountContent({ background: signedIn })
  page.inject()
  assert.equal(ofType(page, 'ready').length, 1)
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  assert.equal(ofType(page, 'here').length, 1)
  assert.equal(ofType(page, 'state').length, 1)
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 1)
})

test('расширение удалили при открытой странице — скрипт говорит «меня нет» и больше ничего не делает', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.kill()
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  assert.equal(ofType(page, 'gone').length, 1)
  assert.equal(page.marker(), undefined)
  assert.equal(ofType(page, 'here').length, 1) // только от первого, живого рассказа
  // Слушатели сняты: ни нажатие, ни новый рассказ о заказе ничего не дают.
  page.click({ service: 'claude' })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.equal(ofType(page, 'fail').length, 0)
  assert.equal(ofType(page, 'gone').length, 1)
})

test('нажали кнопку, а расширение уже удалили — сессии нет, странице «меня нет»', async () => {
  const page = mountContent({ background: signedIn })
  page.hello({ wants: 'claude', stage: 'need' })
  await settle()
  page.kill()
  page.click({ service: 'claude' })
  await settle()
  assert.equal(page.delivered.length, 0)
  assert.equal(ofType(page, 'gone').length, 1)
})

for (const how of [{ newWorld: true }, { freshRuntime: true }]) {
  test(`расширение обновили при открытой странице — новая версия сменяет старую молча (${Object.keys(how)[0]})`, async () => {
    const page = mountContent({ background: signedIn })
    const old = page.marker()
    page.hello({ wants: 'claude', stage: 'need' })
    await settle()
    page.kill()
    page.inject(how)
    assert.ok(page.marker() && page.marker() !== old)
    page.hello({ wants: 'claude', stage: 'need' })
    await settle()
    // Старый скрипт ушёл без «меня нет» и отметку новой версии не снял.
    assert.equal(ofType(page, 'gone').length, 0)
    assert.ok(page.marker())
    assert.equal(ofType(page, 'here').length, 2)
    assert.equal(ofType(page, 'state').length, 2)
    page.click({ service: 'claude' })
    await settle()
    assert.equal(page.delivered.length, 1)
    // Окно расширения разговаривает с новой версией.
    assert.deepEqual(plain(await page.fromExtension({ type: 'order?' })), { wants: 'claude', stage: 'need', order: { no: ORDER_NO, title: '', plan: '', eta: '' } })
  })
}
