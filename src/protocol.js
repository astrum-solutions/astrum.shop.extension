// Общий язык «страница заказа ↔ расширение» и правила, кому и когда можно отдать сессию.
//
// Классический скрипт без зависимостей: его грузят фон, скрипт страницы и окно (общая область имён), а тесты —
// через `require`. Здесь только чистые функции: сеть, cookie и DOM — у вызывающих.
//
// ⚠️⚠️ Сессия — это вход в аккаунт покупателя. Правила её выдачи живут ЗДЕСЬ и больше нигде:
//   • `mayServe` — фон отвечает только своему скрипту на странице нашего сайта и своему окну;
//   • `handoffTarget` — скрипт страницы просит сессию только по НАСТОЯЩЕМУ нажатию человека на кнопку передачи;
//   • сервис — только из таблицы и только тот, который ждёт заказ на этой странице (`mayHandoff`);
//   • `heard` — что это страница заказа, расширение решает САМО, по её адресу, а не со слов страницы.
// Ослабить любое из четырёх — и любой скрипт на странице (реклама, метрика, чужая вставка) тихо заберёт вход.
;(function (root) {
  'use strict'

  /** Метки сообщений `window.postMessage`: чьё оно. */
  const MARK_PAGE = 'astrum-page'
  const MARK_EXT = 'astrum-ext'

  /** Кнопка передачи на странице заказа: `data-astrum-handoff="claude"`. */
  const HANDOFF_ATTR = 'data-astrum-handoff'

  /**
   * Событие документа, которым скрипт расширения кладёт сессию в страницу: `detail` — строка JSON `{ service, value }`.
   * ⚠️ Сессия идёт НЕ через `window.postMessage`, как остальные сообщения: сообщение окна получает каждый, кто слушает
   * `message`, — счётчик метрики, скрипты других расширений; событие со своим именем слышит только тот, кто на него
   * подписался (страница заказа).
   */
  const SESSION_EVENT = 'astrum-session'

  /**
   * Отметка «расширение стоит» на корне страницы нашего сайта (`<html data-astrum-ext="0.1.0">`): её ставит скрипт
   * страницы при старте. По ней окно заказа с первого кадра рисует нужный шаг, не дожидаясь ответа на `hello`.
   */
  const MARKER_ATTR = 'data-astrum-ext'

  const SERVICE_IDS = ['claude', 'chatgpt', 'grok']

  /** Этап заказа, как его называет страница: ждёт сессию · сессия уже в форме · активация идёт. */
  const STAGES = ['need', 'have', 'running']

  function serviceOrNull(value) {
    return typeof value === 'string' && SERVICE_IDS.includes(value) ? value : null
  }

  /** Адреса сайта из шаблонов манифеста: `https://astrum.shop/*` → `https://astrum.shop`. Список адресов — один, в
   *  манифесте: сборка для разработки добавляет туда локальный сайт, и здесь его повторять не нужно. */
  function originsOf(matches) {
    const out = []
    for (const pattern of matches || []) {
      const origin = String(pattern).replace(/\/\*$/, '')
      if (/^https?:\/\/[^/*]+$/.test(origin) && !out.includes(origin)) out.push(origin)
    }
    return out
  }

  /**
   * Кто прислал сообщение фону: `'popup'` — своё окно, `'page'` — свой скрипт на странице нашего сайта, `null` —
   * чужой, ему не отвечаем вовсе.
   * `sender` — как его отдаёт браузер (`runtime.onMessage`); `selfId` — id расширения; `origins` — адреса нашего
   * сайта; `popupUrl` — адрес своего окна. Скрипт страницы — только верхний кадр вкладки нашего сайта.
   */
  function senderKind(sender, selfId, origins, popupUrl) {
    if (!sender || typeof sender !== 'object' || sender.id !== selfId) return null
    const url = typeof sender.url === 'string' ? sender.url : ''
    // Своё окно. Его адрес — адрес расширения: странице сайта такой не достанется, и встроить окно в чужую страницу
    // нельзя (в `web_accessible_resources` его нет).
    if (typeof popupUrl === 'string' && popupUrl && url.split(/[?#]/)[0] === popupUrl) return 'popup'
    if (!sender.tab || sender.frameId !== 0) return null
    let origin
    try {
      origin = new URL(url).origin
    } catch {
      return null
    }
    return origins.includes(origin) ? 'page' : null
  }

  /** Можно ли отвечать отправителю сообщения. */
  function mayServe(sender, selfId, origins, popupUrl) {
    return senderKind(sender, selfId, origins, popupUrl) !== null
  }

  /**
   * Сервис, который человек попросил передать этим нажатием, или `null`.
   * ⚠️⚠️ `isTrusted` — главное здесь: у события, созданного скриптом страницы (`el.click()`, `dispatchEvent`), он
   * `false`, и подделать его нельзя. Без этой сверки странице достаточно было бы «нажать» кнопку самой.
   */
  function handoffTarget(event) {
    if (!event || event.isTrusted !== true) return null
    const target = event.target
    const el = target && typeof target.closest === 'function' ? target.closest('[' + HANDOFF_ATTR + ']') : null
    if (!el) return null
    return serviceOrNull(el.getAttribute(HANDOFF_ATTR))
  }

  /**
   * Можно ли передать: сервис назван кнопкой (или окном), это тот самый, которого ждёт заказ на странице, и заказ
   * её именно ЖДЁТ (`need`). Сессия уже в форме или идёт включение — второй раз класть её некуда и незачем.
   */
  function mayHandoff(service, wants, stage) {
    return serviceOrNull(service) !== null && service === wants && stage === 'need'
  }

  /** Адрес страницы заказа на сайте: `/order/<id заказа>`. */
  const ORDER_PATH = /^\/order\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i

  /** Id заказа по адресу его страницы на сайте (строчными); не страница заказа — `null`. */
  function orderIdOf(pathname) {
    const found = typeof pathname === 'string' ? ORDER_PATH.exec(pathname) : null
    return found ? found[1].toLowerCase() : null
  }

  /**
   * Номер заказа, каким его видит покупатель («№5BCC256C»): первые восемь знаков id заглавными.
   * ⚠️ Тот же номер показывает сайт на странице заказа — в окне расширения он обязан совпадать.
   */
  function orderNoOf(id) {
    return typeof id === 'string' ? id.replace(/-/g, '').slice(0, 8).toUpperCase() : ''
  }

  function stageOrNull(value) {
    return typeof value === 'string' && STAGES.includes(value) ? value : null
  }

  /** Подписи заказа для окна — только строки ограниченной длины: это текст, а не разметка. Номер — свой, по адресу. */
  function cleanOrder(order, no) {
    if (!no) return null
    const from = order && typeof order === 'object' ? order : {}
    const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '')
    return { no, title: text(from.title, 60), plan: text(from.plan, 40), eta: text(from.eta, 60) }
  }

  /** Заказа на странице нет: ни сервиса, ни этапа, ни подписей. */
  const NO_ORDER = Object.freeze({ id: null, wants: null, stage: null, order: null })

  /**
   * Что страница рассказала о заказе (`hello`), — как это понимает расширение: `{ id, wants, stage, order }`.
   *
   * ⚠️⚠️ Слушаем рассказ ТОЛЬКО на странице заказа (`/order/<id>`) и только о заказе из её адреса: страница
   * называет id заказа сама, и он обязан совпасть с адресом. Номер для окна считаем по адресу.
   * Со слов страницы «заказом» однажды стал пример «Как это работает» на главной (10.11.2026, до публикации): он
   * рисует ту же форму заказа, рассказал о «заказе» без номера, и «Передать сессию» в окне расширения положила
   * настоящую сессию в этот пример. Расширение обновляется через магазин за дни, страница сайта — за минуты: ошибку
   * страницы оно обязано пережить само.
   * Незнакомый сервис или этап — тоже не заказ: окну нечего показать, кнопке нечего передавать.
   */
  function heard(data, pathname) {
    const id = orderIdOf(pathname)
    const order = id && data && typeof data === 'object' && data.order && typeof data.order === 'object' ? data.order : null
    if (!order || typeof order.id !== 'string' || order.id.toLowerCase() !== id) return NO_ORDER
    const wants = serviceOrNull(data.wants)
    const stage = stageOrNull(data.stage)
    if (!wants || !stage) return NO_ORDER
    return { id, wants, stage, order: cleanOrder(order, orderNoOf(id)) }
  }

  /**
   * Какой заказ показать в окне: `answers` — что ответили открытые вкладки сайта (`{ tabId, active, wants, stage,
   * order }`). Сначала — заказ с вкладки перед глазами, на ЛЮБОМ этапе: окно открыли над ним, про него и говорим
   * («сессия уже в заказе», «включаем»). Иначе — заказ, которому нужна сессия, потом любой. Нет заказа — `null`, и
   * окно показывает список сервисов (подписи «заказа нет» у него нет: появится заказ — окно сменится).
   * ⚠️ Раньше первым шёл заказ, ждущий сессию, с любой вкладки: человек передал сессию, открыл окно над тем же
   * заказом — а оно звало «Передать сессию» в другую вкладку и уводило туда.
   * ⚠️ Заказ — только с номером (его ставит `heard` по адресу страницы): ответ без номера — не заказ.
   */
  function pickOrder(answers) {
    const live = (answers || []).filter((a) => a && serviceOrNull(a.wants) && stageOrNull(a.stage) && a.order && typeof a.order.no === 'string' && a.order.no)
    return live.find((a) => a.active) || live.find((a) => a.stage === 'need') || live[0] || null
  }

  /**
   * Вид пропуска: `ready` — готова к передаче · `off` — не вошли · `have` — сессия в заказе, осталось нажать
   * «Включить» · `running` — активация идёт · `wait` — ещё читаем, вошёл ли человек (`reading`): ни «готова», ни «не
   * вошли» сказать нельзя, окно рисует заготовку. «Не знаем» после полного ответа — как «не вошли»: кнопка ведёт войти.
   */
  function passState(stage, signedIn, reading) {
    if (stage === 'running') return 'running'
    if (stage === 'have') return 'have'
    if (signedIn == null && reading) return 'wait'
    return signedIn ? 'ready' : 'off'
  }

  /** Почта под маской — так же её маскирует сайт на странице заказа. */
  function maskEmail(email) {
    if (typeof email !== 'string' || !email) return null
    const at = email.indexOf('@')
    if (at <= 0) return null
    const local = email.slice(0, at)
    const keep = Math.max(1, Math.min(4, Math.floor(local.length / 2)))
    return local.slice(0, keep) + '•••' + email.slice(at)
  }

  /** Значение по пути в разобранном JSON: `['user', 'email']`. */
  function dig(value, path) {
    let cur = value
    for (const key of path) {
      if (!cur || typeof cur !== 'object') return undefined
      cur = cur[key]
    }
    return cur
  }

  const api = {
    MARK_PAGE,
    MARK_EXT,
    HANDOFF_ATTR,
    MARKER_ATTR,
    SESSION_EVENT,
    SERVICE_IDS,
    STAGES,
    serviceOrNull,
    stageOrNull,
    originsOf,
    senderKind,
    mayServe,
    handoffTarget,
    mayHandoff,
    orderIdOf,
    orderNoOf,
    cleanOrder,
    NO_ORDER,
    heard,
    pickOrder,
    passState,
    maskEmail,
    dig,
  }
  root.AstrumProtocol = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : self)
