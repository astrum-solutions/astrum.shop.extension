// Чтение сессии и почты аккаунта у сервисов. Сеть и cookie — снаружи (`createReader({ cookies, fetch })`): фон даёт
// настоящие, тесты — подставные.
//
// ⚠️⚠️ Сессию НЕ храним: ни в памяти между вызовами, ни в хранилище расширения — читаем в момент нажатия и
// сразу отдаём. В памяти минуту живут только «вошёл / не вошёл» у сервиса со страницей сессии, почта под маской и
// название тарифа — чтобы окно открывалось сразу, а не ждало сеть на каждое открытие.
// ⚠️ Запросы идут только на сайты сервисов из таблицы (`services.js`) — своего сервера у расширения нет.
// ⚠️ «Не вошли» и «не смогли прочитать» — РАЗНОЕ: сервис не ответил (нет связи, защита сайта вернула не ту
// страницу) — это «не знаем» (`signedIn: null`, код `unavailable`), а не «выйдите и войдите». Иначе вошедшему
// человеку кнопка говорила бы «Войти в ChatGPT», и он ходил бы по кругу.
;(function (root) {
  'use strict'

  const S = root.AstrumServices || require('./services.js')
  const P = root.AstrumProtocol || require('./protocol.js')

  /** Сколько помним почту под маской, тариф и «вошёл / не вошёл». Вошли или вышли — фон зовёт `forget` раньше срока. */
  const ACCOUNT_TTL_MS = 60 * 1000

  const OUT = { state: 'out' }
  const UNKNOWN = { state: 'unknown' }
  /** Об аккаунте ничего не узнали. */
  const NOBODY = Object.freeze({ account: null, plan: null })

  function createReader(deps) {
    const cookies = deps.cookies
    const fetchFn = deps.fetch
    const now = deps.now || Date.now
    /** service → { at, account, plan } — только почта под маской и название тарифа. */
    const accounts = new Map()
    /** service → { at, signedIn } — только у сервиса со СТРАНИЦЕЙ сессии (у cookie чтение и так мгновенное). */
    const known = new Map()
    /** service → обещание «что известно об аккаунте»: два окна подряд не шлют два запроса. */
    const reading = new Map()

    const fresh = (entry) => Boolean(entry) && now() - entry.at < ACCOUNT_TTL_MS

    async function fetchJson(url) {
      try {
        const res = await fetchFn(url, { credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } })
        if (!res || !res.ok) return null
        const text = (await res.text()).trim()
        return { text, parsed: JSON.parse(text) }
      } catch {
        return null
      }
    }

    /**
     * Запомнить, что узнали об аккаунте: почту под маской и тариф. Не узнали ничего — не запоминаем: попробуем в
     * следующий раз.
     */
    function keepAbout(service, email, planBody) {
      const about = { account: P.maskEmail(email), plan: S.planOf(service, planBody) }
      if (about.account || about.plan) accounts.set(service, { at: now(), account: about.account, plan: about.plan })
      return about
    }

    /**
     * Сессия сервиса сейчас: `{ state: 'in', value, parsed? }` — вошли; `{ state: 'out' }` — точно не вошли;
     * `{ state: 'unknown' }` — прочитать не вышло.
     */
    async function readSession(service) {
      const spec = S.SERVICES[service]
      if (!spec) return UNKNOWN
      if (spec.session.type === 'cookie') {
        let cookie = null
        try {
          cookie = await cookies.get({ url: spec.session.url, name: spec.session.name })
        } catch {
          return UNKNOWN
        }
        const value = cookie && typeof cookie.value === 'string' ? cookie.value.trim() : ''
        if (!value) return OUT
        // Сессия на месте, а сервис отметил выход (cookie-отметка с известным значением) — не вошли: такая сессия
        // уже не работает. Отметку прочитать не вышло или её нет — судим по самой сессии.
        const mark = spec.session.signedOut
        if (mark) {
          try {
            const flag = await cookies.get({ url: spec.session.url, name: mark.name })
            if (flag && typeof flag.value === 'string' && flag.value.trim() === mark.value) return OUT
          } catch {
            /* отметка не прочиталась — остаёмся при сессии */
          }
        }
        return { state: 'in', value }
      }
      // Страница сессии: вошедшему — JSON с признаком входа, невошедшему — JSON без него. Всё прочее (сбой сети,
      // не JSON, отказ) — «не знаем».
      const page = await fetchJson(spec.session.url)
      if (!page || !page.parsed || typeof page.parsed !== 'object') {
        known.delete(service)
        return UNKNOWN
      }
      const signedIn = Boolean(page.parsed[spec.session.signedInField])
      known.set(service, { at: now(), signedIn })
      if (!signedIn) {
        accounts.delete(service)
        return OUT
      }
      // Почта и тариф лежат в той же странице — запоминаем сразу: окну не придётся читать страницу второй раз.
      if (spec.account && spec.account.type === 'session') keepAbout(service, P.dig(page.parsed, spec.account.path), page.parsed)
      return { state: 'in', value: page.text, parsed: page.parsed }
    }

    /**
     * Что известно об аккаунте: `{ account, plan }` — почта под маской и название тарифа (каждое может быть `null`).
     * `session` — уже прочитанная сессия (если есть). У сервиса со страницей сессии всё лежит в ней; у остальных —
     * запросы по адресам из таблицы, разом, каждый адрес один раз.
     */
    async function readAbout(service, session) {
      const spec = S.SERVICES[service]
      if (!spec || (!spec.account && !spec.plan)) return NOBODY
      const cached = accounts.get(service)
      if (fresh(cached)) return { account: cached.account, plan: cached.plan }
      if (reading.has(service)) return reading.get(service)
      const job = (async () => {
        if (spec.account && spec.account.type === 'session') {
          const found = session && session.parsed ? session : await readSession(service)
          return found.state === 'in' ? keepAbout(service, P.dig(found.parsed, spec.account.path), found.parsed) : NOBODY
        }
        const urls = []
        for (const part of [spec.account, spec.plan]) if (part && part.url && !urls.includes(part.url)) urls.push(part.url)
        const bodies = {}
        await Promise.all(
          urls.map(async (url) => {
            const body = await fetchJson(url)
            bodies[url] = body ? body.parsed : null
          })
        )
        const email = spec.account ? P.dig(bodies[spec.account.url], spec.account.path) : null
        return keepAbout(service, email, spec.plan ? bodies[spec.plan.url] : null)
      })()
      reading.set(service, job)
      try {
        return await job
      } finally {
        reading.delete(service)
      }
    }

    /**
     * Для кнопки и подписи: вошёл ли человек (`true` / `false` / `null` — не знаем), под какой почтой и на каком
     * тарифе. Значение сессии наружу не выходит. `opts.account === false` — почту и тариф не отдавать (странице заказа
     * они не нужны).
     */
    async function status(service, opts) {
      const withAccount = !opts || opts.account !== false
      let signedIn
      let session = null
      const remembered = known.get(service)
      if (fresh(remembered)) {
        signedIn = remembered.signedIn
      } else {
        session = await readSession(service)
        signedIn = session.state === 'in' ? true : session.state === 'out' ? false : null
        if (session.state === 'out') accounts.delete(service)
      }
      if (signedIn !== true) return { signedIn, account: null, plan: null }
      // Странице заказа почта не нужна — за ней и не ходим: лишний запрос к сервису без нажатия человека ни к чему.
      if (!withAccount) return { signedIn: true, account: null, plan: null }
      const about = await readAbout(service, session)
      return { signedIn: true, account: about.account, plan: about.plan }
    }

    /**
     * Быстрый взгляд БЕЗ сети — чтобы окно сразу нарисовало верное состояние: вошёл ли человек (по cookie), почта и
     * тариф, если они уже в памяти. `final` — уточнять нечего: полный ответ (`status`) окну можно не ждать.
     * У сервиса со страницей сессии вход угадываем по наличию cookie сессии — проверит и поправит `status`.
     */
    async function peek(service) {
      const spec = S.SERVICES[service]
      if (!spec) return { signedIn: null, account: null, plan: null, final: true }
      const cached = accounts.get(service)
      const about = fresh(cached) ? { account: cached.account, plan: cached.plan } : NOBODY
      /** Об аккаунте уточнять нечего: о нём уже помним либо сервис о нём и не рассказывает. */
      const told = fresh(cached) || (!spec.account && !spec.plan)
      if (spec.session.type === 'cookie') {
        const session = await readSession(service)
        const signedIn = session.state === 'in' ? true : session.state === 'out' ? false : null
        if (session.state === 'out') accounts.delete(service)
        return { signedIn, account: signedIn ? about.account : null, plan: signedIn ? about.plan : null, final: signedIn !== true || told }
      }
      const remembered = known.get(service)
      if (fresh(remembered)) {
        const signedIn = remembered.signedIn
        return { signedIn, account: signedIn ? about.account : null, plan: signedIn ? about.plan : null, final: !signedIn || told }
      }
      let guess = null
      try {
        const all = await cookies.getAll({ url: spec.session.url })
        guess = (all || []).some((c) => c && String(c.name || '').includes(spec.session.watch) && c.value)
      } catch {
        guess = null
      }
      return { signedIn: guess, account: null, plan: null, final: false }
    }

    /**
     * Почта аккаунта под маской (или `null`) — вслед за переданной сессией, странице заказа (`router.js`). Тариф ей не
     * отдаём: он только для окна расширения.
     */
    async function account(service) {
      return (await readAbout(service, null)).account
    }

    /** Сама сессия — только по нажатию человека (сверку делает вызывающий, `protocol.js`). Всегда читается заново. */
    async function session(service) {
      const found = await readSession(service)
      if (found.state === 'in') return { ok: true, value: found.value }
      return { ok: false, code: found.state === 'out' ? 'signed_out' : 'unavailable' }
    }

    /**
     * Разогреть перед нажатием (курсор подошёл к кнопке передачи): у сервиса со страницей сессии — прочитать её
     * заранее, чтобы связь с сайтом уже стояла и само нажатие ждало меньше. ⚠️ Прочитанное НЕ оставляем: по нажатию
     * страница читается заново (сессию не храним). У cookie греть нечего — чтение мгновенное.
     */
    async function warm(service) {
      const spec = S.SERVICES[service]
      if (!spec || spec.session.type !== 'page') return
      await readSession(service)
    }

    /** Вошли или вышли — всё, что помнили про сервис, читаем заново. */
    function forget(service) {
      if (service) {
        accounts.delete(service)
        known.delete(service)
      } else {
        accounts.clear()
        known.clear()
      }
    }

    return { status, peek, account, session, warm, forget }
  }

  const api = { createReader, ACCOUNT_TTL_MS }
  root.AstrumReader = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : self)
