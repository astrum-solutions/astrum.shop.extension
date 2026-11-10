// Фон расширения: читает сессию у сервиса и отвечает скрипту страницы заказа и своему окну.
//
// Что он делает и чего не делает:
//  • отвечает ТОЛЬКО своему скрипту на странице нашего сайта и своему окну (`router.js`);
//  • сессию не хранит и в сеть не отправляет — запросы идут лишь на сайты сервисов из таблицы;
//  • после установки возвращает человека на вкладку заказа и подключает к ней скрипт без перезагрузки (после
//    обновления — только подключает: старый скрипт на открытой странице связь с фоном теряет);
//  • вошёл или вышел из сервиса — сообщает открытым страницам заказа, чтобы кнопка сменилась сама.
//
// В Chrome это service worker (соседние файлы — через `importScripts`), в Firefox — фоновая страница, где их
// подключает манифест.
/* global importScripts */
if (typeof importScripts === 'function') importScripts('protocol.js', 'services.js', 'reader.js', 'router.js')
;(function (root) {
  'use strict'

  const api = root.browser || root.chrome
  const P = root.AstrumProtocol
  const S = root.AstrumServices

  const manifest = api.runtime.getManifest()
  const content = (manifest.content_scripts && manifest.content_scripts[0]) || null
  /** Шаблоны адресов нашего сайта — из манифеста: список один, сборка для разработки добавляет туда локальный сайт. */
  const MATCHES = content ? content.matches : []
  const CONTENT_FILES = content ? content.js : []
  const ORIGINS = P.originsOf(MATCHES)
  const POPUP_URL = api.runtime.getURL(manifest.action.default_popup)

  const reader = root.AstrumReader.createReader({
    cookies: api.cookies,
    fetch: (url, init) => fetch(url, init),
  })
  const router = root.AstrumRouter.createRouter({ reader, selfId: api.runtime.id, origins: ORIGINS, popupUrl: POPUP_URL })

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    router.handle(message, sender).then(
      (answer) => {
        if (answer !== undefined) sendResponse(answer)
      },
      () => sendResponse({ ok: false, code: 'unavailable' })
    )
    return true // ответ придёт позже
  })

  /** Открытые вкладки нашего сайта. Адреса вкладок браузер отдаёт по доступу к сайту — отдельного «tabs» не нужно. */
  async function siteTabs() {
    if (!MATCHES.length) return []
    try {
      return await api.tabs.query({ url: MATCHES })
    } catch {
      return []
    }
  }

  // Вошли или вышли — страница заказа узнаёт сразу, а не по возврату на вкладку.
  let notifyTimer = null
  api.cookies.onChanged.addListener((change) => {
    const cookie = change.cookie || {}
    const service = S.serviceOfCookie(cookie.domain, cookie.name)
    if (!service) return
    reader.forget(service)
    // Вход меняет пачку cookie разом — странице говорим один раз.
    if (notifyTimer) clearTimeout(notifyTimer)
    notifyTimer = setTimeout(async () => {
      notifyTimer = null
      for (const tab of await siteTabs()) api.tabs.sendMessage(tab.id, { type: 'changed' }).catch(() => undefined)
    }, 400)
  })

  // Установили или обновили — подключаем скрипт к уже открытым страницам сайта: без этого страница заказа не узнала
  // бы о расширении до перезагрузки, а после обновления осталась бы со старым скриптом, у которого связь с фоном
  // оборвана. После установки ещё и возвращаем человека на вкладку заказа: из магазина он попал бы на неё не сразу.
  api.runtime.onInstalled.addListener(async (details) => {
    const installed = details.reason === 'install'
    if ((!installed && details.reason !== 'update') || !CONTENT_FILES.length) return
    const tabs = await siteTabs()
    for (const tab of tabs) {
      try {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES })
      } catch {
        /* вкладка закрыта или ещё грузится — её подключит манифест при следующей загрузке */
      }
    }
    if (!installed) return
    const order = tabs.find((tab) => {
      try {
        return new URL(tab.url).pathname.startsWith('/order/')
      } catch {
        return false
      }
    })
    if (!order) return
    try {
      await api.tabs.update(order.id, { active: true })
      await api.windows.update(order.windowId, { focused: true })
    } catch {
      /* вкладку успели закрыть */
    }
  })
})(typeof globalThis !== 'undefined' ? globalThis : self)
