// Чтение сессии и почты: откуда берём, что отдаём, чего не храним.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { createReader, ACCOUNT_TTL_MS } = require('../src/reader.js')

const S = require('../src/services.js')

const SESSION_KEY = 'sk-ant-sid01-' + 'A'.repeat(40)
const CHATGPT_PAGE = JSON.stringify({ user: { id: 'user-1', email: 'alexander@example.com' }, accessToken: 'eyJ.x.y', expires: '2026-12-01' })

/** Подставной браузер: `jar` — cookie по «адрес|имя», `pages` — ответы сайтов по адресу. */
function world({ jar = {}, pages = {}, clock = { t: 1_000_000 } } = {}) {
  const calls = { cookies: [], fetch: [] }
  const reader = createReader({
    now: () => clock.t,
    cookies: {
      get: async (query) => {
        calls.cookies.push(query)
        if (jar.broken) throw new Error('cookies unavailable')
        // Cookie с путём (`paths`: «сайт|имя» → путь) браузер отдаёт только адресам под этим путём.
        const asked = new URL(query.url)
        const scoped = (jar.paths || {})[`${asked.origin}|${query.name}`]
        if (scoped) {
          const fits = asked.pathname === scoped.path || asked.pathname.startsWith(scoped.path + '/')
          return fits ? { name: query.name, value: scoped.value } : null
        }
        const value = jar[`${query.url}|${query.name}`] ?? jar[`${asked.origin}|${query.name}`]
        return value === undefined ? null : { name: query.name, value }
      },
      // Все cookie сайта — так окно смотрит, есть ли вообще cookie сессии у сервиса со страницей сессии.
      getAll: async (query) => {
        calls.cookies.push(query)
        if (jar.broken) throw new Error('cookies unavailable')
        // Браузер отдаёт cookie, которые ушли бы на этот адрес, — подставной сверяет сайт адреса.
        const site = new URL(query.url).origin
        return Object.entries(jar)
          .filter(([key]) => key.startsWith(site + '|'))
          .map(([key, value]) => ({ name: key.slice(site.length + 1), value }))
      },
    },
    fetch: async (url, init) => {
      calls.fetch.push({ url, init })
      const body = pages[url]
      if (body === undefined) return { ok: false, text: async () => '' }
      return { ok: true, text: async () => body }
    },
  })
  return { reader, calls, jar, pages, clock }
}

test('Claude: сессия — cookie sessionKey на claude.ai, почта — с /api/account под маской', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY },
    pages: { 'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com', full_name: 'A' }) },
  })
  assert.deepEqual(await w.reader.session('claude'), { ok: true, value: SESSION_KEY })
  assert.deepEqual(w.calls.cookies[0], { url: 'https://claude.ai', name: 'sessionKey' })
  assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: 'alex•••@example.com', plan: null })
})

const GROK_PAGE = JSON.stringify({ status: 'authenticated', session: { sessionId: 's-1', userId: 'u-1', email: 'alexander@example.com', givenName: 'A' } })

test('Grok: сессия — cookie sso на grok.com, почта — со страницы сессии под маской', async () => {
  const w = world({ jar: { 'https://grok.com|sso': 'eyJ0eXAi.abc.def' }, pages: { 'https://grok.com/api/auth/session': GROK_PAGE } })
  assert.deepEqual(await w.reader.session('grok'), { ok: true, value: 'eyJ0eXAi.abc.def' })
  assert.deepEqual(w.calls.cookies[0], { url: 'https://grok.com', name: 'sso' })
  // Сама сессия — cookie: ради неё в сеть не ходим.
  assert.equal(w.calls.fetch.length, 0)
  assert.deepEqual(await w.reader.status('grok'), { signedIn: true, account: 'alex•••@example.com', plan: null })
  // Почта — со страницы сессии, тариф — со страницы тарифа: два запроса, оба на grok.com, каждый один раз.
  assert.deepEqual(w.calls.fetch.map((c) => c.url).sort(), ['https://grok.com/api/auth/session', 'https://grok.com/rest/plan/profile'])
  // Страница сессии ответила «не вошли» или не тем — показываем без почты.
  const none = world({ jar: { 'https://grok.com|sso': 'eyJ0eXAi.abc.def' }, pages: { 'https://grok.com/api/auth/session': '{"status":"unauthenticated"}' } })
  assert.deepEqual(await none.reader.status('grok'), { signedIn: true, account: null, plan: null })
})

const HF_CLIENT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImNsaWVudF90ZXN0In0.c2lnbmF0dXJl'
const HF_PAGE = JSON.stringify({ response: { sessions: [{ status: 'active', user: { email_addresses: [{ email_address: 'alexander@example.com' }] } }] }, client: null })

test('Higgsfield: сессия — cookie __client на higgsfield.ai, почта — из ответа о текущем входе под маской', async () => {
  const w = world({
    // Как в настоящем браузере: сессия лежит под путём `/_clerk`, отметка входа — на весь сайт.
    jar: { paths: { 'https://higgsfield.ai|__client': { path: '/_clerk', value: HF_CLIENT } }, 'https://higgsfield.ai|__client_uat': '1794398200' },
    pages: { 'https://higgsfield.ai/_clerk/v1/client': HF_PAGE },
  })
  assert.deepEqual(await w.reader.session('higgsfield'), { ok: true, value: HF_CLIENT })
  assert.deepEqual(w.calls.cookies[0], { url: 'https://higgsfield.ai/_clerk/v1/client', name: '__client' })
  assert.deepEqual(await w.reader.status('higgsfield'), { signedIn: true, account: 'alex•••@example.com', plan: null })
})

test('Higgsfield: сессия осталась в браузере, а сервис отметил выход — «не вошли», и отдавать нечего', async () => {
  // Cookie сессии переживает выход из аккаунта: без отметки выхода окно показало бы «вошли» и передало бы в заказ
  // сессию, которая уже не работает.
  const out = world({ jar: { paths: { 'https://higgsfield.ai|__client': { path: '/_clerk', value: HF_CLIENT } }, 'https://higgsfield.ai|__client_uat': '0' } })
  assert.deepEqual(await out.reader.status('higgsfield'), { signedIn: false, account: null, plan: null })
  assert.equal((await out.reader.peek('higgsfield')).signedIn, false)
  assert.equal((await out.reader.session('higgsfield')).ok, false)
  assert.equal(out.calls.fetch.length, 0)
  // Отметки нет вовсе — судим по самой сессии.
  const bare = world({ jar: { paths: { 'https://higgsfield.ai|__client': { path: '/_clerk', value: HF_CLIENT } } } })
  assert.equal((await bare.reader.peek('higgsfield')).signedIn, true)
  // У остальных сервисов отметки выхода нет — лишних чтений cookie у них не появилось.
  const claude = world({ jar: { 'https://claude.ai|sessionKey': SESSION_KEY } })
  await claude.reader.peek('claude')
  assert.deepEqual(claude.calls.cookies, [{ url: 'https://claude.ai', name: 'sessionKey' }])
})

test('ChatGPT: сессия — текст страницы сессии целиком, почта из неё же без второго запроса', async () => {
  const w = world({ pages: { 'https://chatgpt.com/api/auth/session': CHATGPT_PAGE + '\n' } })
  assert.deepEqual(await w.reader.session('chatgpt'), { ok: true, value: CHATGPT_PAGE })
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: true, account: 'alex•••@example.com', plan: null })
  assert.ok(w.calls.fetch.every((c) => c.url === 'https://chatgpt.com/api/auth/session'))
  // Запрос идёт с cookie сайта — иначе страница сессии ответит «не вошли».
  assert.equal(w.calls.fetch[0].init.credentials, 'include')
})

test('не вошли — сессии нет, и это не ошибка', async () => {
  const w = world({ pages: { 'https://chatgpt.com/api/auth/session': '{"WARNING_BANNER":"не делитесь этим"}' } })
  assert.deepEqual(await w.reader.session('claude'), { ok: false, code: 'signed_out' })
  assert.deepEqual(await w.reader.status('claude'), { signedIn: false, account: null, plan: null })
  assert.deepEqual(await w.reader.session('chatgpt'), { ok: false, code: 'signed_out' })
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: false, account: null, plan: null })
  assert.deepEqual(await w.reader.status('grok'), { signedIn: false, account: null, plan: null })
})

test('сервис не ответил — это «не знаем», а не «не вошли»', async () => {
  // Вошедшему человеку нельзя говорить «Войти в ChatGPT» из-за того, что сайт вернул страницу проверки или упал.
  for (const pages of [
    { 'https://chatgpt.com/api/auth/session': '<html>Just a moment…</html>' }, // не JSON
    { 'https://chatgpt.com/api/auth/session': '"строка"' }, // JSON, но не объект
    {}, // отказ (не 2xx)
  ]) {
    const w = world({ pages })
    assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: null, account: null, plan: null })
    assert.deepEqual(await w.reader.session('chatgpt'), { ok: false, code: 'unavailable' })
  }
  const offline = world()
  offline.reader = createReader({
    cookies: { get: async () => null },
    fetch: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  assert.deepEqual(await offline.reader.status('chatgpt'), { signedIn: null, account: null, plan: null })
  // Браузер не дал прочитать cookie — тоже «не знаем».
  const broken = world({ jar: { broken: true } })
  assert.deepEqual(await broken.reader.status('claude'), { signedIn: null, account: null, plan: null })
  assert.deepEqual(await broken.reader.session('claude'), { ok: false, code: 'unavailable' })
  // Незнакомый сервис до чтения не доходит (его отсекает фон) — и здесь сессии не будет.
  assert.deepEqual(await broken.reader.session('gmail'), { ok: false, code: 'unavailable' })
})

test('странице заказа почта не нужна — за ней и не ходим', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY },
    pages: { 'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com' }) },
  })
  assert.deepEqual(await w.reader.status('claude', { account: false }), { signedIn: true, account: null, plan: null })
  assert.equal(w.calls.fetch.length, 0)
  // Окну — с почтой; и запомненную почту странице всё равно не отдаём.
  assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: 'alex•••@example.com', plan: null })
  assert.deepEqual(await w.reader.status('claude', { account: false }), { signedIn: true, account: null, plan: null })
})

test('сессию не храним: вышли из сервиса — отдать уже нечего', async () => {
  const w = world({ jar: { 'https://claude.ai|sessionKey': SESSION_KEY } })
  assert.equal((await w.reader.session('claude')).ok, true)
  delete w.jar['https://claude.ai|sessionKey']
  assert.deepEqual(await w.reader.session('claude'), { ok: false, code: 'signed_out' })
  assert.deepEqual(await w.reader.status('claude'), { signedIn: false, account: null, plan: null })
})

test('почту помним минуту и забываем по сигналу «вошли / вышли»', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY },
    pages: { 'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com' }) },
  })
  await w.reader.status('claude')
  await w.reader.status('claude')
  assert.equal(w.calls.fetch.length, 1)
  w.clock.t += ACCOUNT_TTL_MS + 1
  await w.reader.status('claude')
  assert.equal(w.calls.fetch.length, 2)
  // Вошли под другой почтой: фон зовёт `forget`, и окно не покажет прежнюю.
  w.pages['https://claude.ai/api/account'] = JSON.stringify({ email_address: 'second@example.org' })
  w.reader.forget('claude')
  assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: 'sec•••@example.org', plan: null })
})

test('почта не прочиталась — показываем без неё и пробуем снова', async () => {
  const w = world({ jar: { 'https://claude.ai|sessionKey': SESSION_KEY } })
  assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: null, plan: null })
  w.pages['https://claude.ai/api/account'] = JSON.stringify({ email_address: 'alexander@example.com' })
  assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: 'alex•••@example.com', plan: null })
})

// ── Быстрый взгляд для окна: первый кадр верный, сеть не ждём ──

test('быстрый взгляд: вошёл ли человек — по cookie, без единого запроса в сеть', async () => {
  const w = world({
    jar: {
      'https://claude.ai|sessionKey': SESSION_KEY,
      'https://chatgpt.com|__Secure-next-auth.session-token.0': 'eyJ.part0',
      'https://chatgpt.com|oai-did': 'device',
    },
    pages: { 'https://chatgpt.com/api/auth/session': CHATGPT_PAGE },
  })
  // Claude: cookie есть — вошёл; почту ещё надо дочитать (`final: false`).
  assert.deepEqual(await w.reader.peek('claude'), { signedIn: true, account: null, plan: null, final: false })
  // Grok: cookie нет — не вошёл, уточнять нечего.
  assert.deepEqual(await w.reader.peek('grok'), { signedIn: false, account: null, plan: null, final: true })
  // ChatGPT: по cookie сессии — «похоже, вошёл»; правду скажет полный ответ.
  assert.deepEqual(await w.reader.peek('chatgpt'), { signedIn: true, account: null, plan: null, final: false })
  assert.equal(w.calls.fetch.length, 0)
  // Значение сессии во взгляд не попадает.
  assert.equal(JSON.stringify([await w.reader.peek('claude'), await w.reader.peek('chatgpt')]).includes(SESSION_KEY), false)
})

test('быстрый взгляд: cookie сессии нет — «не вошёл»; чужие cookie сайта не в счёт', async () => {
  const w = world({ jar: { 'https://chatgpt.com|oai-did': 'device', 'https://chatgpt.com|cf_clearance': 'x' } })
  assert.deepEqual(await w.reader.peek('chatgpt'), { signedIn: false, account: null, plan: null, final: false })
  assert.deepEqual(await w.reader.peek('claude'), { signedIn: false, account: null, plan: null, final: true })
  // Cookie прочитать не дали — «не знаем», окно дождётся полного ответа.
  const broken = world({ jar: { broken: true } })
  assert.deepEqual(await broken.reader.peek('chatgpt'), { signedIn: null, account: null, plan: null, final: false })
  assert.deepEqual(await broken.reader.peek('claude'), { signedIn: null, account: null, plan: null, final: true })
  assert.deepEqual(await broken.reader.peek('gmail'), { signedIn: null, account: null, plan: null, final: true })
})

test('быстрый взгляд после полного ответа — сразу с почтой и без уточнений', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY, 'https://grok.com|sso': 'eyJ0eXAi.a.b' },
    pages: {
      'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com' }),
      'https://chatgpt.com/api/auth/session': CHATGPT_PAGE,
    },
  })
  await w.reader.status('claude')
  await w.reader.status('chatgpt')
  const fetched = w.calls.fetch.length
  assert.deepEqual(await w.reader.peek('claude'), { signedIn: true, account: 'alex•••@example.com', plan: null, final: true })
  assert.deepEqual(await w.reader.peek('chatgpt'), { signedIn: true, account: 'alex•••@example.com', plan: null, final: true })
  // Почту Grok ещё не читали — взгляд говорит «вошёл», а почту окно дочитает.
  assert.deepEqual(await w.reader.peek('grok'), { signedIn: true, account: null, plan: null, final: false })
  assert.equal(w.calls.fetch.length, fetched)
})

test('почта отдельно от сессии: её спрашивают вслед за переданной сессией', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY },
    pages: { 'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com' }) },
  })
  assert.equal(await w.reader.account('claude'), 'alex•••@example.com')
  // Значения сессии в ответе нет; незнакомый сервис и сервис без входа — без почты.
  assert.equal(String(await w.reader.account('claude')).includes(SESSION_KEY), false)
  assert.equal(await w.reader.account('gmail'), null)
  assert.equal(await w.reader.account('chatgpt'), null)
})

test('ChatGPT: «вошёл / не вошёл» помним минуту, а саму сессию каждый раз читаем заново', async () => {
  const w = world({ pages: { 'https://chatgpt.com/api/auth/session': CHATGPT_PAGE } })
  const sessionCalls = () => w.calls.fetch.filter((c) => c.url === 'https://chatgpt.com/api/auth/session').length
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: true, account: 'alex•••@example.com', plan: null })
  assert.deepEqual(await w.reader.status('chatgpt', { account: false }), { signedIn: true, account: null, plan: null })
  assert.equal(sessionCalls(), 1)
  // Нажатие — всегда свежая страница сессии: то, что помним, — только «да / нет» и почта под маской.
  assert.deepEqual(await w.reader.session('chatgpt'), { ok: true, value: CHATGPT_PAGE })
  assert.deepEqual(await w.reader.session('chatgpt'), { ok: true, value: CHATGPT_PAGE })
  assert.equal(sessionCalls(), 3)
  // Вышли: фон зовёт `forget` по перемене cookie — следующий вопрос идёт к сервису.
  w.pages['https://chatgpt.com/api/auth/session'] = '{}'
  w.reader.forget('chatgpt')
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: false, account: null, plan: null })
  assert.equal(sessionCalls(), 4)
  // Срок памяти вышел — тоже спрашиваем заново.
  w.pages['https://chatgpt.com/api/auth/session'] = CHATGPT_PAGE
  w.clock.t += ACCOUNT_TTL_MS + 1
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: true, account: 'alex•••@example.com', plan: null })
  assert.equal(sessionCalls(), 5)
})

test('ChatGPT: нажатие, на котором оказалось «не вошли», поправляет и то, что помнили', async () => {
  const w = world({ pages: { 'https://chatgpt.com/api/auth/session': CHATGPT_PAGE } })
  assert.equal((await w.reader.status('chatgpt')).signedIn, true)
  w.pages['https://chatgpt.com/api/auth/session'] = '{}'
  assert.deepEqual(await w.reader.session('chatgpt'), { ok: false, code: 'signed_out' })
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: false, account: null, plan: null })
})

test('«не знаем» не запоминаем: сервис ожил — следующий вопрос это увидит', async () => {
  const w = world({ pages: {} })
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: null, account: null, plan: null })
  w.pages['https://chatgpt.com/api/auth/session'] = CHATGPT_PAGE
  assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: true, account: 'alex•••@example.com', plan: null })
})

test('два окна подряд не шлют два запроса за одной почтой', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY },
    pages: { 'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com' }) },
  })
  const both = await Promise.all([w.reader.status('claude'), w.reader.status('claude')])
  assert.deepEqual(both, [
    { signedIn: true, account: 'alex•••@example.com', plan: null },
    { signedIn: true, account: 'alex•••@example.com', plan: null },
  ])
  assert.equal(w.calls.fetch.length, 1)
})

// ── Тариф аккаунта: названием самого сервиса и только по тому, что замерено ──

/** Ответ `claude.ai/api/account` — по форме настоящих ответов сервиса (почта и организация с тарифом). */
const claudeAccount = (capabilities, tier, extra = {}) =>
  JSON.stringify({ email_address: 'alexander@example.com', memberships: [{ organization: { capabilities, rate_limit_tier: tier, billing_type: 'stripe_subscription', ...extra }, role: 'admin' }] })
/** Ответ `grok.com/rest/plan/profile` — по форме замера 10.11.2026: код тарифа и прежнее имя для показа рядом. */
const grokProfile = (plan, display = 'SuperGrok') => JSON.stringify({ profile: { dominantPlan: plan, plans: [plan], surfaceNames: { SURFACE_DISPLAY: display, SURFACE_KAFKA: 'SUBSCRIPTION_TIER_GROK_PRO' }, capabilityAvailability: { 'subscription.paid': true } } })

test('тариф Claude — из того же ответа, что почта: второго запроса нет', async () => {
  const cases = [
    [['chat', 'claude_max'], 'default_claude_max_20x', 'Ultra'],
    [['chat', 'claude_max'], 'default_claude_max_5x', 'Max'],
    [['chat', 'claude_pro'], 'default_claude_ai', 'Pro'],
    [['chat'], 'default_claude_ai', 'Free'],
    // Max, а уровень не понять (тир незнакомый) и рабочее пространство — «не знаем»: чипа нет, тариф не выдумываем.
    [['chat', 'claude_max'], 'default_claude_max_50x', null],
    [['chat', 'raven'], 'default_raven', null],
  ]
  for (const [capabilities, tier, plan] of cases) {
    const w = world({ jar: { 'https://claude.ai|sessionKey': SESSION_KEY }, pages: { 'https://claude.ai/api/account': claudeAccount(capabilities, tier) } })
    assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: 'alex•••@example.com', plan }, String(plan))
    assert.deepEqual(w.calls.fetch.map((c) => c.url), ['https://claude.ai/api/account'])
  }
})

test('тариф Claude: организация API рядом не мешает, а непонятая организация с чатом — «не знаем»', () => {
  const body = (...orgs) => ({ memberships: orgs.map((organization) => ({ organization })) })
  const max = { capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_5x' }
  const free = { capabilities: ['chat'], rate_limit_tier: 'default_claude_ai' }
  const api = { capabilities: ['api'], rate_limit_tier: 'auto_api_evaluation', billing_type: 'prepaid' }
  const team = { capabilities: ['chat', 'raven'], raven_type: 'team' }
  assert.equal(S.planOf('claude', body(api, max)), 'Max')
  assert.equal(S.planOf('claude', body(free, max)), 'Max')
  // Личный бесплатный и рабочее пространство: «Free» было бы неправдой — человек может работать в пространстве.
  assert.equal(S.planOf('claude', body(free, team)), null)
  assert.equal(S.planOf('claude', body(api)), null)
  assert.equal(S.planOf('claude', body()), null)
  assert.equal(S.planOf('claude', { email_address: 'a@example.com' }), null)
  assert.equal(S.planOf('claude', null), null)
})

test('тариф ChatGPT — из страницы сессии, кодом сервиса; незнакомый код — «не знаем»', async () => {
  const page = (planType) => JSON.stringify({ user: { email: 'alexander@example.com' }, account: { id: 'acc-1', planType }, accessToken: 'eyJ.x.y' })
  for (const [code, plan] of [['free', 'Free'], ['go', 'Go'], ['plus', 'Plus'], ['prolite', 'Pro Lite'], ['pro', 'Pro'], ['promax', 'Pro Max'], ['team', 'Team'], ['PLUS', 'Plus'], ['ultra-new', null], [7, null]]) {
    const w = world({ pages: { 'https://chatgpt.com/api/auth/session': page(code) } })
    assert.deepEqual(await w.reader.status('chatgpt'), { signedIn: true, account: 'alex•••@example.com', plan }, String(code))
    // Одна страница на всё: и «вошёл», и почта, и тариф.
    assert.equal(w.calls.fetch.length, 1)
  }
})

test('тариф Grok — именем со страницы тарифов (Plus, Premium, Super, Ultra), а не прежним «SuperGrok» из ответа', async () => {
  // Коды — из реестра тарифов Grok, имена — с grok.com/plans (сверено 10.11.2026): «SuperGrok» из ответа сервиса на
  // странице тарифов не значится, человек такого тарифа не узнает.
  const cases = [
    ['free', 'Free'],
    ['supergrok.lite', 'Plus'],
    ['supergrok', 'Premium'],
    ['supergrok.plus', 'Super'],
    ['supergrok.heavy', 'Ultra'],
    ['x.basic', 'X Basic'],
    ['x.premium.standard', 'X Premium'],
    ['x.premium', 'X Premium+'],
    // Незнакомый код, не строка, имя свойства объекта — «не знаем»: прежнее имя из ответа за тариф не выдаём.
    ['supergrok.mega', null],
    ['', null],
    [7, null],
    ['constructor', null],
    ['__proto__', null],
  ]
  for (const [code, plan] of cases) {
    const w = world({
      jar: { 'https://grok.com|sso': 'eyJ0eXAi.abc.def' },
      pages: { 'https://grok.com/api/auth/session': GROK_PAGE, 'https://grok.com/rest/plan/profile': grokProfile(code) },
    })
    assert.deepEqual(await w.reader.status('grok'), { signedIn: true, account: 'alex•••@example.com', plan }, JSON.stringify(code))
  }
  // Страница тарифа не ответила — почта остаётся; страница сессии не ответила — остаётся тариф.
  const noPlan = world({ jar: { 'https://grok.com|sso': 'eyJ0eXAi.abc.def' }, pages: { 'https://grok.com/api/auth/session': GROK_PAGE } })
  assert.deepEqual(await noPlan.reader.status('grok'), { signedIn: true, account: 'alex•••@example.com', plan: null })
  const noMail = world({ jar: { 'https://grok.com|sso': 'eyJ0eXAi.abc.def' }, pages: { 'https://grok.com/rest/plan/profile': grokProfile('supergrok') } })
  assert.deepEqual(await noMail.reader.status('grok'), { signedIn: true, account: null, plan: 'Premium' })
})

test('тариф помним вместе с почтой: быстрый взгляд отдаёт его без сети; странице заказа он не идёт', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY },
    pages: { 'https://claude.ai/api/account': claudeAccount(['chat', 'claude_max'], 'default_claude_max_5x') },
  })
  // Странице заказа — только «вошли / не вошли»: ни почты, ни тарифа, и запроса за ними нет.
  assert.deepEqual(await w.reader.status('claude', { account: false }), { signedIn: true, account: null, plan: null })
  assert.equal(w.calls.fetch.length, 0)
  assert.deepEqual(await w.reader.peek('claude'), { signedIn: true, account: null, plan: null, final: false })
  assert.deepEqual(await w.reader.status('claude'), { signedIn: true, account: 'alex•••@example.com', plan: 'Max' })
  assert.deepEqual(await w.reader.peek('claude'), { signedIn: true, account: 'alex•••@example.com', plan: 'Max', final: true })
  assert.deepEqual(await w.reader.status('claude', { account: false }), { signedIn: true, account: null, plan: null })
  // Вслед за сессией странице называем почту — и только её: строкой, без тарифа.
  assert.equal(await w.reader.account('claude'), 'alex•••@example.com')
  assert.equal(w.calls.fetch.length, 1)
  // Вышли — тарифа и почты прежнего аккаунта во взгляде нет.
  delete w.jar['https://claude.ai|sessionKey']
  assert.deepEqual(await w.reader.peek('claude'), { signedIn: false, account: null, plan: null, final: true })
})

test('название тарифа — короткая подпись, а не данные', () => {
  for (const good of ['Free', 'Pro Lite', 'X Premium+', 'SuperGrok Heavy', 'Max', 'Плюс']) assert.equal(S.planLabel(good), good)
  assert.equal(S.planLabel('  Plus  '), 'Plus')
  for (const bad of ['', ' ', '<b>Plus</b>', 'Plus\nPro', 'x'.repeat(25), '+Plus', null, undefined, 5, {}]) assert.equal(S.planLabel(bad), null, JSON.stringify(bad))
  // Читалка тарифа упала на странной форме ответа — тарифа нет, окно не падает.
  assert.equal(S.planOf('grok', { profile: 'строка' }), null)
  assert.equal(S.planOf('grok', { dominantPlan: 'supergrok.heavy' }), 'Ultra')
  assert.equal(S.planOf('chatgpt', { account: null }), null)
  assert.equal(S.planOf('gmail', { account: { planType: 'plus' } }), null)
})

test('разогрев: у ChatGPT страница сессии читается заранее, но сессия не остаётся — по нажатию читаем заново', async () => {
  const w = world({ jar: { 'https://claude.ai|sessionKey': SESSION_KEY }, pages: { 'https://chatgpt.com/api/auth/session': CHATGPT_PAGE } })
  assert.equal(await w.reader.warm('chatgpt'), undefined)
  assert.equal(w.calls.fetch.length, 1)
  // Нажатие после разогрева — свежая страница сессии, а не запомненная.
  assert.deepEqual(await w.reader.session('chatgpt'), { ok: true, value: CHATGPT_PAGE })
  assert.equal(w.calls.fetch.length, 2)
  // У cookie греть нечего: ни запроса, ни чтения cookie.
  const before = w.calls.cookies.length
  assert.equal(await w.reader.warm('claude'), undefined)
  assert.equal(await w.reader.warm('gmail'), undefined)
  assert.equal(w.calls.fetch.length, 2)
  assert.equal(w.calls.cookies.length, before)
})

test('запросы уходят только на сайты сервисов', async () => {
  const w = world({
    jar: { 'https://claude.ai|sessionKey': SESSION_KEY, 'https://grok.com|sso': 'eyJ.a.b' },
    pages: {
      'https://claude.ai/api/account': JSON.stringify({ email_address: 'alexander@example.com' }),
      'https://chatgpt.com/api/auth/session': CHATGPT_PAGE,
    },
  })
  for (const id of ['claude', 'chatgpt', 'grok']) {
    await w.reader.status(id)
    await w.reader.session(id)
  }
  const hosts = new Set(w.calls.fetch.map((c) => new URL(c.url).hostname))
  assert.deepEqual([...hosts].sort(), ['chatgpt.com', 'claude.ai', 'grok.com'])
})
