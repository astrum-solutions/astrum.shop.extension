// Разбор сообщений, приходящих в фон: кто спрашивает и что ему можно ответить. Чистая логика — фон только
// подключает её к браузеру, тесты зовут напрямую.
//
// ⚠️⚠️ Первым делом — `senderKind`: чужому отправителю не отвечаем вовсе (ни «нет», ни ошибки — как будто
// расширения нет). Сессию отдаём только по названию сервиса из таблицы; сверку «человек нажал» делает скрипт
// страницы (`content.js`) и окно — до фона добираются только они.
// ⚠️ Почта аккаунта (под маской) — своему окну всегда, странице заказа — ТОЛЬКО вслед за сессией, которую фон ей
// только что отдал по нажатию человека: «сессия получена · alex•••@gmail.com». До нажатия странице хватает
// «вошли / не вошли», и чего ей не нужно, ей не отдаём (на странице живут и чужие скрипты — метрика).
// Тариф аккаунта — только своему окну: странице он не уходит никогда.
;(function (root) {
  'use strict'

  const P = root.AstrumProtocol || require('./protocol.js')

  /**
   * `reader` — `createReader(...)`; `selfId` — id расширения; `origins` — адреса нашего сайта (у сборки «только
   * Скопировать» — пусто: странице она не отвечает); `popupUrl` — адрес своего окна.
   */
  /** Сколько после переданной сессии странице можно спросить почту её аккаунта. */
  const ACCOUNT_AFTER_MS = 30 * 1000

  function createRouter(deps) {
    const { reader, selfId, origins, popupUrl } = deps
    const now = deps.now || Date.now
    /** вкладка → { service, at }: какой странице и чью сессию фон только что отдал. */
    const released = new Map()
    const tabOf = (sender) => (sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null)

    /** Ответ отправителю или `undefined` — «не отвечать». */
    async function handle(message, sender) {
      const who = P.senderKind(sender, selfId, origins, popupUrl)
      if (!who) return undefined
      if (!message || typeof message !== 'object') return undefined

      if (message.type === 'status') {
        const ids = Array.isArray(message.services) ? message.services.map(P.serviceOrNull).filter(Boolean) : []
        const opts = { account: who === 'popup' }
        // Разом, а не по очереди: у ChatGPT это запрос в сеть, и список в окне ждал бы его перед каждой строкой.
        const found = await Promise.all(ids.map((id) => reader.status(id, opts)))
        const services = {}
        ids.forEach((id, i) => {
          const status = found[i] || {}
          // Странице — только «вошли / не вошли», что бы ни вернуло чтение: почту и тариф ей здесь не отдаём.
          services[id] = who === 'popup' ? status : { signedIn: typeof status.signedIn === 'boolean' ? status.signedIn : null, account: null, plan: null }
        })
        return { services }
      }

      if (message.type === 'session') {
        const service = P.serviceOrNull(message.service)
        if (!service) return { ok: false, code: 'unknown_service' }
        const answer = await reader.session(service)
        if (who === 'page' && tabOf(sender) !== null) {
          if (answer && answer.ok) released.set(tabOf(sender), { service, at: now() })
          else released.delete(tabOf(sender))
        }
        return answer
      }

      // Курсор подошёл к кнопке передачи — будим фон и связь с сервисом заранее. В ответе — ничего, кроме «принято».
      if (message.type === 'warm') {
        const service = P.serviceOrNull(message.service)
        if (!service) return { ok: false }
        await reader.warm(service)
        return { ok: true }
      }

      // Почта аккаунта под маской. Странице — только вслед за сессией ЭТОГО сервиса, отданной ЭТОЙ вкладке.
      if (message.type === 'account') {
        const service = P.serviceOrNull(message.service)
        if (!service) return { account: null }
        if (who === 'page') {
          const last = released.get(tabOf(sender))
          if (!last || last.service !== service || now() - last.at > ACCOUNT_AFTER_MS) return { account: null }
        }
        return { account: await reader.account(service) }
      }

      return undefined
    }

    return { handle }
  }

  const api = { createRouter, ACCOUNT_AFTER_MS }
  root.AstrumRouter = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : self)
