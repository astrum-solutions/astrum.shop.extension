// Скрипт на страницах нашего сайта: мост между страницей заказа и расширением.
//
// Страница говорит «этот заказ ждёт сессию Claude» → скрипт отвечает «расширение стоит, в Claude вошли» → человек
// нажимает кнопку передачи → скрипт читает сессию через фон и кладёт её в страницу. Дальше сессия идёт тем же
// путём, что вставленная руками: проверка формата и отправка — у формы заказа.
//
// ⚠️⚠️ Сессию кладём в страницу ТОЛЬКО по настоящему нажатию человека (`handoffTarget`, `isTrusted`) или
// по кнопке «Передать сессию» в окне расширения — и только того сервиса, которого ждёт заказ (`mayHandoff`).
// Сам скрипт страницы ничего не решает и ничего не помнит.
// ⚠️⚠️ Что перед нами страница заказа, решает не страница, а её адрес (`protocol.heard`, `current`): рассказ о
// «заказе» с любой другой страницы сайта не слушаем, и ушедшему со страницы заказу сессию не кладём.
// ⚠️ Общение со страницей — `window.postMessage` на свой же адрес: чужим окнам сообщение не уходит. Сама сессия —
// отдельным событием документа (`SESSION_EVENT`): сообщение окна слышат все его слушатели, а секрету это ни к чему.
// ⚠️ До нажатия странице — только «вошли / не вошли». Почта аккаунта (под маской) уходит ей лишь вслед за сессией
// (`router.js` сверяет, что сессию этой вкладке только что отдали).
;(function (root) {
  'use strict'

  const api = root.browser || root.chrome
  const P = root.AstrumProtocol

  /**
   * Жив ли этот экземпляр. Расширение обновили или удалили при открытой странице — связь с фоном у старого скрипта
   * рвётся навсегда (`runtime.id` пропадает), а его слушатели остаются висеть на странице.
   */
  function alive() {
    try {
      return Boolean(api.runtime && api.runtime.id)
    } catch {
      return false
    }
  }

  // Подключили второй раз в ту же страницу (манифест и подключение после установки) — работает первый, пока он жив.
  const prev = root.__astrumExtContent
  if (prev && typeof prev.alive === 'function' && prev.alive()) return
  const me = { alive }
  root.__astrumExtContent = me

  const version = api.runtime.getManifest().version
  /**
   * Своя метка в отметке на странице. После обновления новая версия приходит в НОВУЮ область имён (переменных
   * старого скрипта она не видит) и ставит свою метку поверх — по ней старый скрипт понимает, что его сменили, и
   * уходит молча, а не объявляет странице «расширения больше нет».
   */
  const token = version + '/' + Math.random().toString(36).slice(2, 10)

  /** Что страница заказа рассказала о заказе (`protocol.heard`): сервис, который он ждёт, этап и подписи для окна. */
  let told = P.NO_ORDER

  /**
   * Заказ, о котором рассказала страница, — пока мы на ЕГО странице. Сайт меняет страницы без перезагрузки: ушли с
   * заказа — прежний рассказ больше не действует, даже если страница забыла об этом сказать.
   */
  function current() {
    return told.id && P.orderIdOf(window.location.pathname) === told.id ? told : P.NO_ORDER
  }

  function post(message) {
    window.postMessage(Object.assign({ astrum: P.MARK_EXT }, message), window.location.origin)
  }

  /** Отметка «расширение стоит» на корне страницы — по ней окно заказа рисует нужный шаг с первого кадра. */
  function mark() {
    const el = document.documentElement
    if (el) el.setAttribute(P.MARKER_ATTR, token)
    return Boolean(el)
  }

  /** Этот экземпляр умер: снимаем слушателей. Никто его не сменил (расширение удалили) — говорим странице. */
  function retire() {
    window.removeEventListener('message', onPageMessage)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerover', onHover, true)
    if (root.__astrumExtContent === me) root.__astrumExtContent = null
    const el = document.documentElement
    if (!el || el.getAttribute(P.MARKER_ATTR) !== token) return
    el.removeAttribute(P.MARKER_ATTR)
    post({ type: 'gone' })
  }

  async function ask(message) {
    try {
      return await api.runtime.sendMessage(message)
    } catch {
      return null
    }
  }

  async function sendState() {
    const service = current().wants
    if (!service) return
    const answer = await ask({ type: 'status', services: [service] })
    const status = answer && answer.services ? answer.services[service] || null : null
    // Пока ждали фон, страница назвала другой сервис (или заказ ушёл с экрана) — прежний ответ ей не нужен.
    if (service !== current().wants) return
    post({ type: 'state', version, service, signedIn: status && typeof status.signedIn === 'boolean' ? status.signedIn : null })
  }

  /** Сессия — странице: событием документа со своим именем, а не сообщением окна (его слышат все, кто слушает `message`). */
  function deliver(service, value) {
    document.dispatchEvent(new CustomEvent(P.SESSION_EVENT, { detail: JSON.stringify({ service, value }) }))
  }

  /** Заказ на этой странице ждёт сессию этого сервиса — прямо сейчас. */
  function waitsFor(service) {
    const now = current()
    return P.mayHandoff(service, now.wants, now.stage)
  }

  /** Передать: `{ ok: true }` или `{ ok: false, code }` — код окну расширения (странице отказ уходит сообщением). */
  async function handoff(service) {
    // Сразу — «беру»: страница знает, что нажатие услышано и сессия читается. Без этого слова она ждала бы вслепую
    // до двенадцати секунд — и когда читаем долго (ChatGPT), и когда нажатие не услышал никто (расширение обновили
    // при открытой странице): кнопка вставала и не двигалась.
    post({ type: 'taking', service })
    const answer = await ask({ type: 'session', service })
    if (!answer || !answer.ok) {
      const code = (answer && answer.code) || 'unavailable'
      post({ type: 'fail', service, code })
      return { ok: false, code }
    }
    // Пока читали сессию (у ChatGPT это запрос к его сайту), заказ ушёл с экрана — класть её уже некуда.
    if (!waitsFor(service)) return { ok: false, code: 'not_waiting' }
    deliver(service, answer.value)
    // Вслед за сессией — почта её аккаунта под маской: страница пишет «сессия получена · alex•••@gmail.com», и
    // человек видит, чей это аккаунт. Сессию ради почты не задерживаем: почта у части сервисов — запрос к сайту.
    // ⚠️ Отвечаем ВСЕГДА, и когда почту не узнали (`account: null`): страница держит на её месте заготовку и должна
    // знать, что ждать больше нечего.
    void ask({ type: 'account', service }).then((found) => {
      if (service !== current().wants) return
      post({ type: 'account', service, account: found && typeof found.account === 'string' && found.account ? found.account : null })
    })
    return { ok: true }
  }

  /** Как часто будим фон по наведению на кнопку передачи. */
  const WARM_GAP_MS = 20 * 1000
  let warmedAt = 0

  /**
   * Курсор подошёл к кнопке передачи — будим фон и связь с сервисом заранее: фон между нажатиями спит, а у ChatGPT
   * сессия — запрос к его сайту. Сессию это не трогает: странице по наведению не уходит ничего.
   */
  function onHover(event) {
    const target = event && event.target
    const el = target && typeof target.closest === 'function' ? target.closest('[' + P.HANDOFF_ATTR + ']') : null
    const service = el ? P.serviceOrNull(el.getAttribute(P.HANDOFF_ATTR)) : null
    if (!service || !waitsFor(service) || !alive()) return
    const now = Date.now()
    if (now - warmedAt < WARM_GAP_MS) return
    warmedAt = now
    void ask({ type: 'warm', service })
  }

  function onPageMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data
    if (!data || data.astrum !== P.MARK_PAGE || data.type !== 'hello') return
    if (!alive()) {
      retire()
      return
    }
    told = P.heard(data, window.location.pathname)
    mark() // страницу могли перерисовать с нуля — отметка на месте
    // Сразу — «я здесь»: чтобы понять, что расширение стоит, странице не нужно ждать сеть. Следом — вошли ли в сервис.
    // `heard` — принят ли рассказ о заказе: «нет» значит, что эту страницу расширение заказом не считает (версии
    // страницы и расширения разошлись), и кнопка передачи здесь не сработает — страница уйдёт на прежние шаги.
    post({ type: 'here', version, heard: Boolean(told.wants) })
    void sendState()
  }

  function onClick(event) {
    const service = P.handoffTarget(event)
    if (!service || !waitsFor(service)) return
    if (!alive()) {
      retire()
      return
    }
    void handoff(service)
  }

  window.addEventListener('message', onPageMessage)
  // Нажатие ловим на подъёме к документу раньше обработчиков страницы: кнопка может смениться, пока идёт запрос.
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerover', onHover, true)

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== api.runtime.id || !message) return undefined
    if (message.type === 'order?') {
      const now = current()
      sendResponse({ wants: now.wants, stage: now.stage, order: now.order })
      return undefined
    }
    if (message.type === 'changed') {
      void sendState()
      return undefined
    }
    // «Передать сессию» в окне расширения: нажатие было там.
    if (message.type === 'handoff') {
      if (!waitsFor(message.service)) {
        sendResponse({ ok: false, code: 'not_waiting' })
        return undefined
      }
      handoff(message.service).then(sendResponse)
      return true
    }
    return undefined
  })

  // Скрипт стартует до разбора страницы (`document_start`): корня может ещё не быть — отметим, когда появится.
  if (!mark()) document.addEventListener('DOMContentLoaded', mark, { once: true })
  post({ type: 'ready', version })
})(typeof globalThis !== 'undefined' ? globalThis : self)
