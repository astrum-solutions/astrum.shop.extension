// Подставной браузер для тестов: исходники расширения грузятся как есть (классические скрипты) в отдельную
// область имён с ненастоящими `chrome`, `window` и `document`.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
export const ROOT = join(SRC, '..')
export const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
export const SITE = 'https://astrum.shop'
/** Заказ, его страница на сайте и номер, каким его видит покупатель (первые восемь знаков id заглавными). */
export const ORDER_ID = '4bb3d68b-0000-4000-8000-000000000000'
export const ORDER_PATH = `/order/${ORDER_ID}`
export const ORDER_NO = '4BB3D68B'

export function manifestOf(target = 'chrome') {
  return JSON.parse(readFileSync(join(ROOT, `manifest.${target}.json`), 'utf8'))
}

/** Выполнить файлы `src/` в области `context` по порядку, как их подключает манифест. */
export function load(context, files) {
  vm.createContext(context)
  for (const file of files) vm.runInContext(readFileSync(join(SRC, file), 'utf8'), context, { filename: file })
  return context
}

/** Событие-заглушка браузера: `addListener` копит слушателей, `fire` зовёт их. */
export function fakeEvent() {
  const listeners = []
  return {
    addListener: (fn) => listeners.push(fn),
    listeners,
    fire: (...args) => listeners.map((fn) => fn(...args)),
  }
}

/** Объект из области расширения — в обычный: у объектов оттуда свой `Object`, и строгое сравнение их не равняет. */
export const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** Дождаться всех отложенных шагов (ответы фона — через промисы). */
export const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Страница нашего сайта со скриптом расширения. `background(message)` — что ответил бы фон.
 * `path` — адрес страницы: по умолчанию страница заказа (о заказе скрипт слушает только её).
 * Возвращает рычаги: `hello` — страница рассказывает о заказе, `click` — нажатие, `fromExtension` — сообщение из
 * окна или фона, `posted` — что скрипт сказал странице сообщениями окна, `delivered` — сессии, положенные в страницу
 * событием документа, `marker` — отметка на корне страницы, `inject` —
 * подключить скрипт ещё раз (как после установки или обновления), `kill` — оборвать связь с фоном (расширение
 * удалили или обновили при открытой странице), `go` — сайт сменил страницу без перезагрузки.
 */
export function mountContent({ background, origin = SITE, path = ORDER_PATH, clock = null } = {}) {
  const posted = []
  /** Сессии, которые скрипт положил в страницу событием документа: `{ service, value }`. */
  const delivered = []
  const sent = []
  const listeners = { window: {}, document: {} }
  const on = (bag) => (type, fn) => (bag[type] = [...(bag[type] || []), fn])
  const off = (bag) => (type, fn) => (bag[type] = (bag[type] || []).filter((x) => x !== fn))
  const emit = (bag, type, event) => (bag[type] || []).slice().forEach((fn) => fn(event))
  const attrs = {}
  const window = {
    location: { origin, pathname: path },
    addEventListener: on(listeners.window),
    removeEventListener: off(listeners.window),
    postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }),
  }
  const document = {
    addEventListener: on(listeners.document),
    removeEventListener: off(listeners.document),
    dispatchEvent: (event) => {
      if (event.type === 'astrum-session') delivered.push(JSON.parse(event.detail))
      emit(listeners.document, event.type, event)
      return true
    },
    documentElement: {
      setAttribute: (name, value) => (attrs[name] = String(value)),
      getAttribute: (name) => (name in attrs ? attrs[name] : null),
      removeAttribute: (name) => delete attrs[name],
    },
  }
  /** Связь с фоном у каждой версии своя: старый скрипт после обновления остаётся с оборванной. */
  const runtimes = []
  const makeRuntime = () => {
    const onMessage = fakeEvent()
    const runtime = {
      id: EXT_ID,
      getManifest: () => manifestOf(),
      sendMessage: async (message) => {
        if (!runtime.id) throw new Error('Extension context invalidated.')
        sent.push(message)
        return background ? background(message) : null
      },
      onMessage,
    }
    runtimes.push(runtime)
    return runtime
  }
  /** Область имён скрипта: страница (окно и документ) общая, переменные и связь с фоном — свои. */
  const makeWorld = () => {
    class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init ? init.detail : null
      }
    }
    const world = { window, document, chrome: { runtime: makeRuntime() }, URL, console, CustomEvent }
    // Свои часы (тест двигает время сам) — скрипту страницы от `Date` нужно только `now`.
    if (clock) world.Date = { now: () => clock.t }
    world.globalThis = world
    return load(world, ['protocol.js', 'content.js'])
  }
  let world = makeWorld()
  return {
    posted,
    delivered,
    sent,
    listeners,
    marker: () => attrs['data-astrum-ext'],
    /**
     * Подключить скрипт ещё раз. По умолчанию — в ту же область имён (манифест и подключение после установки);
     * `newWorld` — в новую, с новой связью: так браузер подключает обновлённую версию; `freshRuntime` — в ту же
     * область, но с новой связью (браузер, который область имён при обновлении не меняет).
     */
    inject: ({ newWorld = false, freshRuntime = false } = {}) => {
      if (newWorld) {
        world = makeWorld()
        return
      }
      if (freshRuntime) world.chrome = { runtime: makeRuntime() }
      vm.runInContext(readFileSync(join(SRC, 'content.js'), 'utf8'), world, { filename: 'content.js' })
    },
    /** Оборвать связь с фоном у всех подключённых до сих пор скриптов. */
    kill: () => runtimes.forEach((runtime) => (runtime.id = undefined)),
    /** Сайт сменил страницу без перезагрузки: адрес другой, скрипт расширения — тот же. */
    go: (next) => {
      window.location.pathname = next
    },
    /**
     * Страница рассказывает о заказе. Как настоящая страница заказа, она называет id заказа из своего адреса; тест
     * задаёт `order.id` сам, когда проверяет расхождение (на не-заказе по умолчанию — `ORDER_ID`).
     */
    hello: (payload) => {
      const here = /^\/order\/([^/]+)$/.exec(window.location.pathname)
      const order = payload.wants && payload.order !== null ? { id: here ? here[1] : ORDER_ID, ...payload.order } : payload.order
      emit(listeners.window, 'message', { source: window, origin, data: { astrum: 'astrum-page', type: 'hello', ...payload, order } })
    },
    rawMessage: (event) => emit(listeners.window, 'message', { source: window, origin, ...event }),
    click: ({ trusted = true, service = 'claude', onButton = true } = {}) =>
      emit(listeners.document, 'click', {
        isTrusted: trusted,
        target: {
          closest: (selector) =>
            onButton && selector === '[data-astrum-handoff]' ? { getAttribute: () => service } : null,
        },
      }),
    /** Курсор подошёл к элементу: `onButton` — внутри обёртки кнопки передачи сервиса `service`. */
    hover: ({ service = 'claude', onButton = true } = {}) =>
      emit(listeners.document, 'pointerover', {
        target: { closest: (selector) => (onButton && selector === '[data-astrum-handoff]' ? { getAttribute: () => service } : null) },
      }),
    fromExtension: (message, sender = { id: EXT_ID }) =>
      new Promise((resolve) => {
        const live = runtimes.filter((runtime) => runtime.id)
        const results = live.flatMap((runtime) => runtime.onMessage.listeners.map((fn) => fn(message, sender, resolve)))
        if (!results.includes(true)) setImmediate(() => resolve(undefined))
      }),
  }
}
