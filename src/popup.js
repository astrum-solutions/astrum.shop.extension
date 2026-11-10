// Окно расширения — «Пропуск».
//
// Что показать, окно решает само (`protocol.pickOrder`): открыт заказ, которому нужна сессия, — пропуск его сервиса;
// заказа нет — список сервисов. Подписи «заказа нет» у окна нет: появится заказ — оно сменится.
// ⚠️ Статус — чипом («готова», «не вошли», «в заказе»); в списке чипов нет: кнопка справа и так говорит, что можно
// сделать («Скопировать» — вошли, «Войти» — нет). Под названием — почта аккаунта под маской.
// ⚠️ Всё, что пришло со страницы и от сервисов (название заказа, почта), — только текстом через `esc`.
// ⚠️⚠️ Окно само сессию не держит: «Передать сессию» просит скрипт страницы заказа положить её в форму,
// «Скопировать» читает её через фон в момент нажатия и кладёт в буфер.
//
// Как окно открывается. Первая версия сначала рисовала список, потом пропуск «не вошли» и только после ответа
// сервиса — «готова»: три кадра, два из них неправда, и окно на глазах «прогружалось». Теперь:
//  1. пока неизвестно, что показывать, окно пустое — того же размера, что пропуск (не прыгает);
//  2. какой заказ открыт и вошёл ли человек (по cookie, без сети — `peek`), узнаём разом, за десятки миллисекунд, и
//     рисуем сразу верный вид;
//  3. почту аккаунта (у ChatGPT и Claude это запрос к сайту) дочитываем следом: на её месте полоска-заготовка, а
//     приехавшая почта подменяет только свою строку, без перерисовки окна (`data-slot`).
// ⚠️ «Как это устроено» — одна ссылка внизу; второго входа туда (значка «?» в шапке) нет.
// ⚠️ У пропуска шапки нет вовсе: логотип магазина стоит на самом пропуске. Шапка с логотипом осталась у списка
// сервисов — там пропуска нет.
//
// Список сервисов: картинка сервиса идёт на всю строку и уходит в тёмное, разделителя нет, «Скопировать» — отдельная
// кнопка внутри строки; тариф аккаунта — словом после названия через точку, серым («Claude · Max»), без рамки.
// «Скопировать» отвечает движением (галочка рисуется, кнопка и кромка зеленеют, по картинке проходит блик); пустого
// места под списком нет.
//
// «Передать сессию» в окне: сессию в форму заказа кладёт скрипт страницы заказа. Получилось — пропуск тут же говорит
// «в заказе», и через мгновение окно уступает место странице заказа (там «Включить»). Первая версия закрывала окно
// сразу, без единого слова, — это выглядело как сбой. Сессия уже в заказе — кнопки «Передать сессию» нет вовсе.
;(function (root) {
  'use strict'

  const api = root.browser || root.chrome
  const P = root.AstrumProtocol
  const S = root.AstrumServices

  const manifest = api.runtime.getManifest()
  const content = (manifest.content_scripts && manifest.content_scripts[0]) || null
  const MATCHES = content ? content.matches : []
  const SITE = P.originsOf(MATCHES)[0] || 'https://astrum.shop'
  /** Где лежит открытый код расширения — адрес из манифеста (`homepage_url`); в самом коде чужих адресов нет. */
  const REPO = manifest.homepage_url || SITE
  const rootEl = document.getElementById('root')
  // Быстрый взгляд «вошёл ли человек» окно делает САМО, по cookie: фон расширения между нажатиями спит, и его
  // пробуждение стоило окну до полусекунды пустоты при первом открытии (замер 10.11.2026). Саму сессию окно так не
  // читает — она по-прежнему идёт через фон и только по нажатию.
  const local = root.AstrumReader.createReader({ cookies: api.cookies, fetch: (url, init) => fetch(url, init) })

  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

  const svg = (paths, size, width) =>
    `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  const CHECK = (size, width) => svg('<path d="M20 6 9 17l-5-5"/>', size, width || 3)
  /** Галочка «скопировано» — рисуется штрихом (`popup.css`, `.draw`). */
  const DRAWN_CHECK = `<svg class="ic draw" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength="1"/></svg>`
  const COPY = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 13)
  const OUT = (size, width) => svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', size, width)
  const BACK = svg('<path d="m15 18-6-6 6-6"/>', 18, 2.2)

  function mark(service, size, color) {
    const m = S.SERVICES[service].mark
    return `<svg class="ic" width="${size}" height="${size}" viewBox="${m.vb}" fill="none" style="overflow:visible;color:${color}" aria-hidden="true"><path d="${m.d}" fill="currentColor" fill-rule="evenodd"/></svg>`
  }

  /** Свечение под пропуском — светлый тон сервиса, разбелённый на четверть (как у карточек товаров на сайте). */
  function glow(service, alpha) {
    const hex = S.SERVICES[service].tint[0]
    const mix = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.75 + 255 * 0.25)
    return `rgba(${mix(1)},${mix(3)},${mix(5)},${alpha})`
  }

  // Логотип магазина целиком («Astrum Shop», тот же вектор, что в шапке сайта), а не плитка с подписью.
  // Нажатие открывает сайт. У списка сервисов он в шапке, у пропуска — на самом пропуске.
  const LOGO = `<button type="button" class="lg" data-act="site" aria-label="Открыть astrum.shop"><img src="img/logo.svg" alt="Astrum Shop"></button>`
  const LIST_HEAD = `<div class="hd">${LOGO}</div>`
  const HOW_LINK = `<span class="link" data-act="how" role="button" tabindex="0">Как это устроено ›</span>`
  /**
   * Открытый код расширения: там же `PRIVACY.md` — то же, что «Как это устроено», подробно, и те же слова, что
   * заявлены магазину расширений. ⚠️ Строки «Как это устроено» ниже, `PRIVACY.md` и ответы магазину — про одно и то
   * же: расширение стало видеть или хранить что-то ещё — правятся все три разом.
   */
  const ABOUT_LINK = `<span class="link" data-act="about" role="button" tabindex="0">Открытый код ›</span>`
  /** Полоска-заготовка на месте того, что ещё читается. */
  const sk = (width, height) => `<span class="sk" style="width:${width}px;height:${height || 10}px"></span>`

  /**
   * Точки линии отрыва — ровно между `from` и `to`, с одинаковым шагом и по центру отрезка. Рисуются кругами, а не
   * пунктиром линии: у пунктира последняя точка обрезалась, и ряд выглядел кривым и сдвинутым.
   * `along` — ось, вдоль которой идёт ряд; `at` — координата на другой оси.
   */
  function dots(along, from, to, at, step) {
    const count = Math.max(2, Math.round((to - from) / step) + 1)
    const gap = (to - from) / (count - 1)
    let out = ''
    for (let i = 0; i < count; i++) {
      const pos = (from + gap * i).toFixed(2)
      out += along === 'x' ? `<circle class="pf" style="--i:${i}" cx="${pos}" cy="${at}" r="1.05"/>` : `<circle class="pf" style="--i:${i}" cx="${at}" cy="${pos}" r="1.05"/>`
    }
    return out
  }

  /** Тариф аккаунта («Max», «Plus», «Premium») — словом после названия сервиса, через точку. Тарифа не знаем — нет. */
  const planChip = (plan) => (plan ? `<span class="pl">${esc(plan)}</span>` : '')

  // ───── Пропуск ─────
  let uid = 0

  /** Вид пропуска (`protocol.passState`): пока полного ответа нет и вход неизвестен — `wait`, заготовка. */
  function stateOf(pick, status) {
    return P.passState(pick.stage, status ? status.signedIn : null, !(status && status.final))
  }

  function ticket(o) {
    const { service, state, order, status, busy } = o
    const spec = S.SERVICES[service]
    const name = spec.title
    const account = status ? status.account : null
    const plan = status && status.signedIn ? status.plan : null
    // Почта ещё читается (у ChatGPT и Claude — запрос к сайту): на её месте заготовка, а не «вы вошли в этом браузере»,
    // которое через полсекунды сменилось бы почтой.
    const reading = Boolean(spec.account) && !(status && status.final)
    const w = 348
    const ny = 150
    const h = 284
    const R = 20
    const r = 9
    const id = 'tk' + ++uid
    const dim = state === 'off' || state === 'wait'
    const path = `M${R},0H${w - R}A${R},${R} 0 0 1 ${w},${R}V${ny - r}A${r},${r} 0 0 0 ${w},${ny + r}V${h - R}A${R},${R} 0 0 1 ${w - R},${h}H${R}A${R},${R} 0 0 1 0,${h - R}V${ny + r}A${r},${r} 0 0 0 0,${ny - r}V${R}A${R},${R} 0 0 1 ${R},0Z`
    const shape = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="filter:drop-shadow(0 16px 22px rgba(0,0,0,.5)) drop-shadow(0 8px 34px ${dim ? 'rgba(0,0,0,0)' : glow(service, 0.2)})"><defs><clipPath id="${id}"><path d="${path}"/></clipPath><linearGradient id="${id}h" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="${id}s" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#07080b" stop-opacity=".78"/><stop offset=".58" stop-color="#07080b" stop-opacity=".22"/><stop offset="1" stop-color="#07080b" stop-opacity="0"/></linearGradient><linearGradient id="${id}b" x1="0" x2="0" y1="0" y2="1"><stop offset=".45" stop-color="#07080b" stop-opacity="0"/><stop offset="1" stop-color="#07080b" stop-opacity=".5"/></linearGradient></defs><g clip-path="url(#${id})"><image class="au" href="img/${service}.jpg" x="-12" y="-6" width="${w + 24}" height="${ny + 12}" preserveAspectRatio="xMidYMid slice" style="${dim ? 'filter:grayscale(1) brightness(.42)' : ''}"/><rect width="${w}" height="${ny}" fill="url(#${id}s)"/><rect width="${w}" height="${ny}" fill="url(#${id}b)"/><rect y="${ny}" width="${w}" height="${h - ny}" fill="#181a21"/></g><path d="${path}" fill="none" stroke="rgba(255,255,255,${dim ? '.2' : '.13'})" stroke-width="1" ${dim ? 'stroke-dasharray="4 5"' : ''}/>${dots('x', r + 10, w - r - 10, ny, 7.5)}${dim ? '' : `<rect x="${R + 20}" y="0.5" width="${w - 2 * R - 40}" height="1" fill="url(#${id}h)"/>`}</svg>`

    const chip =
      state === 'wait'
        ? `<span class="chip">${sk(52, 8)}</span>`
        : state === 'ready'
          ? `<span class="chip"><i class="dot ok"></i>готова</span>`
          : state === 'off'
            ? `<span class="chip"><i class="dot no"></i>не вошли</span>`
            : `<span class="chip"><span class="tick">${CHECK(11)}</span>в заказе</span>`
    // Чей аккаунт открыт в этом браузере. У «готова» и «в заказе» строка ОДНА и та же: передали сессию — меняются
    // чип и кнопка, а подпись стоит на месте. ⚠️ «В заказе» про аккаунт заказа не говорит: окно знает только, под
    // кем человек вошёл сейчас, — и «сессия уже в заказе» под чипом «в заказе» было бы тем же фактом дважды.
    const who = account
      ? `вы вошли как ${esc(account)}`
      : reading
        ? sk(168)
        : status && status.signedIn
          ? 'вы вошли в этом браузере'
          : ''
    const line =
      state === 'wait'
        ? sk(150)
        : state === 'off'
          ? 'появится, когда войдёте'
          : state === 'running'
            ? account
              ? `включаем на ${esc(account)}`
              : 'дальше мы сами'
            : who

    const title = esc(order.title || name)
    const num = order.no ? `<span class="num">№${esc(order.no)}</span>` : ''
    let stub
    if (state === 'running') {
      const eta = order.eta ? esc(order.eta) + '. ' : ''
      stub = `<div class="r1"><span class="mlab">Включаем</span>${num}</div><div class="ttl">${title}</div><div class="bar"><i></i></div><div class="hint">${eta}Обновлять не нужно — на странице заказа всё появится само.</div>`
    } else {
      const button =
        state === 'wait'
          ? `<div class="white ghost-btn" aria-hidden="true">${sk(132, 10)}</div>`
          : state === 'off'
            ? `<button type="button" class="white" data-act="login" data-service="${service}">Войти в ${esc(name)} ${OUT(15, 2.2)}</button>`
            : state === 'have'
              ? `<button type="button" class="white" data-act="open">Открыть заказ</button>`
              : `<button type="button" class="white${busy ? ' busy' : ''}" data-act="handoff"${busy ? ' aria-busy="true"' : ''}>Передать сессию</button>`
      stub = `<div class="r1"><span class="mlab">В заказ</span>${num}</div><div class="ttl">${title}</div>${button}`
    }
    return `<div class="tk${dim ? ' dim' : ''}" style="width:${w}px;height:${h}px">${shape}<div class="cv" style="height:${ny}px"><span class="ghost">${mark(service, 176, '#fff')}</span><div class="top">${LOGO}<span data-slot="chip">${chip}</span></div><div class="who"><div class="nm">${mark(service, 26, dim ? 'rgba(255,255,255,.62)' : '#fff')}${esc(name)}<span data-slot="plan">${planChip(plan)}</span></div><div class="ln" data-slot="line">${line}</div></div></div><div class="stub" data-slot="stub">${stub}</div></div>`
  }

  function passView(pick, status, busy, flop) {
    const state = stateOf(pick, status)
    const order = pick.order || { no: '', title: '', plan: '', eta: '' }
    const note =
      flop && (state === 'ready' || state === 'off')
        ? `<span class="warn">Не получилось прочитать сессию — попробуйте ещё раз</span>`
        : state === 'ready'
          ? `Уйдёт только в этот заказ · ${HOW_LINK}`
          : state === 'have'
            ? `Осталось нажать «Включить${order.plan ? ' ' + esc(order.plan) : ''}» на странице заказа`
            : state === 'wait'
              ? '&nbsp;'
              : HOW_LINK
    // Ключ вида — сервис и «живой или погашенный» пропуск: между «готова», «в заказе» и «включаем» картинка та же,
    // меняются только свои места (`data-slot`) — передали сессию, и пропуск не мигает, а переписывает чип и кнопку.
    const dim = state === 'off' || state === 'wait'
    return {
      key: `pass:${pick.wants}:${dim ? 'dim' : 'lit'}`,
      head: '',
      html: `${ticket({ service: pick.wants, state, order, status, busy })}<div class="note" data-slot="note">${note}</div>`,
    }
  }

  // ───── Список сервисов ─────
  /**
   * Строка списка: картинка сервиса на всю строку (справа уходит в тёмное), слева знак, название с тарифом и почта,
   * справа — отдельная кнопка. `act` — что сейчас с копированием этого сервиса: `null`, `'reading'` (читаем сессию),
   * `'done'`, `'fail'`.
   */
  function row(service, status, act) {
    const spec = S.SERVICES[service]
    const w = 348
    const h = 60
    const R = 14
    const id = 'mt' + ++uid
    const known = Boolean(status) && (status.signedIn != null || status.final)
    const inside = Boolean(status && status.signedIn)
    const dim = !inside
    const reading = inside && (Boolean(spec.account) || Boolean(spec.plan)) && !status.final && !status.account
    const shape = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><clipPath id="${id}"><rect width="${w}" height="${h}" rx="${R}"/></clipPath><linearGradient id="${id}s" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#07080b" stop-opacity=".72"/><stop offset=".45" stop-color="#07080b" stop-opacity=".34"/><stop offset=".62" stop-color="#101116" stop-opacity=".7"/><stop offset="1" stop-color="#14151b" stop-opacity=".96"/></linearGradient><linearGradient id="${id}w" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#${id})"><image href="img/${service}.jpg" x="0" y="-20" width="${w}" height="100" preserveAspectRatio="xMidYMid slice" style="${dim ? 'filter:grayscale(1) brightness(.4)' : ''}"/><rect width="${w}" height="${h}" fill="url(#${id}s)"/><rect class="sweep" x="-90" y="-10" width="90" height="${h + 20}" fill="url(#${id}w)" transform="skewX(-18)"/></g><rect class="edge${dim ? ' dash' : ''}" x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${R - 0.5}"/></svg>`
    const under = inside && status.account ? `<div class="ml">${esc(status.account)}</div>` : reading ? `<div class="ml">${sk(112, 8)}</div>` : ''
    const who = `<div><div class="n">${esc(spec.title)}${inside ? planChip(status.plan) : ''}</div>${under}</div>`
    const right = !known
      ? `<span class="r wait">${sk(74, 8)}</span>`
      : !inside
        ? `<button type="button" class="r go" data-act="login" data-service="${service}"><span class="in">Войти${OUT(13)}</span></button>`
        : act === 'done'
          ? `<span class="r ok" role="status"><span class="in">${DRAWN_CHECK}Скопировано</span></span>`
          : act === 'fail'
            ? `<span class="r fail" role="status"><span class="in">Не вышло</span></span>`
            : act === 'reading'
              ? `<span class="r wait" aria-busy="true"><span class="in">${COPY}Читаем…</span></span>`
              : `<button type="button" class="r" data-act="copy" data-service="${service}"><span class="in">${COPY}Скопировать</span></button>`
    return {
      look: `${service}:${known ? (inside ? 'in' : 'out') : 'wait'}`,
      html: `<div class="mt${dim ? ' dim' : ''}" data-row="${service}" style="height:${h}px">${shape}<div class="l">${mark(service, 21, dim ? 'rgba(255,255,255,.55)' : '#fff')}<span data-slot="who-${service}">${who}</span></div><span data-slot="act-${service}">${right}</span></div>`,
    }
  }

  function listView(statuses, copy) {
    // Сначала сервисы, где сессия есть: за ними сюда и пришли.
    const ids = S.ORDER.slice().sort((a, b) => Number(Boolean(statuses[b] && statuses[b].signedIn)) - Number(Boolean(statuses[a] && statuses[a].signedIn)))
    const orders = MATCHES.length ? `<span class="link" data-act="orders" role="button" tabindex="0">Мои заказы ›</span>` : ''
    const rows = ids.map((id) => row(id, statuses[id] || null, (copy && copy[id]) || null))
    return {
      key: 'list:' + rows.map((r) => r.look).join(','),
      head: LIST_HEAD,
      html: `<div class="hb"><div class="h2">Сессии в этом браузере</div>${orders}</div><div class="mlist">${rows.map((r) => r.html).join('')}</div><div class="note">Расширение видит только сайты этих сервисов и само ничего не отправляет · ${HOW_LINK}</div>`,
    }
  }

  // ───── Как это устроено ─────
  const HOW = [
    ['<path d="M9 11V6a2 2 0 1 1 4 0v5"/><path d="M13 10.5a2 2 0 1 1 4 0V12"/><path d="M17 11.5a2 2 0 1 1 4 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5.2-3L5 15.5a2 2 0 0 1 3.4-2L9 14"/>', 'Только по вашему нажатию', 'Пока вы не нажали «Передать сессию» или «Скопировать», сессия никуда не уходит: расширение только смотрит, вошли ли вы.'],
    ['<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>', 'Сессия — это уже выполненный вход', 'Пароль мы не узнаём.'],
    ['<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>', 'Уходит только в ваш заказ', 'Расширение ничего не хранит и больше никуда не отправляет. По сессии мы только включим подписку — потом её данные удалятся.'],
    ['<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>', 'Видит только сессию, почту и тариф аккаунта', 'На сайтах этих сервисов. Другие сайты, историю и пароли — нет.'],
  ]
  function howView() {
    const items = HOW.map(([icon, title, text]) => `<div class="it"><span class="ib">${svg(icon, 16)}</span><div><div class="t">${title}</div><div class="d">${text}</div></div></div>`).join('')
    return {
      key: 'how',
      head: `<div class="hd"><button type="button" class="back" data-act="back" aria-label="Назад">${BACK}</button><b>Как это устроено</b></div>`,
      html: `<div class="how">${items}</div><div class="note">После включения можно выйти из аккаунта и войти снова — старая сессия перестанет работать · ${ABOUT_LINK}</div>`,
    }
  }

  /** Пока читаем дольше обычного (фон только проснулся) — заготовка пропуска, а не пустое окно. Шапки нет: ещё
   *  неизвестно, пропуск будет (у него её нет) или список. */
  function loadView(slow) {
    return { key: slow ? 'load:slow' : 'load', head: '', html: slow ? `<div class="tk-sk">${sk(96, 9)}${sk(180, 20)}${sk(140)}</div>` : '' }
  }

  // ───── Состояние и действия ─────
  /**
   * `copy` — что сейчас с копированием у КАЖДОГО сервиса списка: `{ claude: 'reading' | 'done' | 'fail' }`.
   * ⚠️ У строки своё состояние и свой отсчёт. Прежде состояние было одно на список: нажали «Скопировать» у двух строк
   * подряд — отсчёт первой видел чужое состояние и уходил, не погасив её зелёную кромку, и она горела, пока окно не
   * закроют.
   */
  const model = { ready: false, slow: false, pick: null, statuses: {}, copy: {}, how: false, busy: false, flop: false }
  /** Отсчёты возврата строк к «Скопировать» — по сервисам. */
  const copyTimers = {}
  /** Что сейчас на экране: вид (по нему решаем, перерисовывать ли целиком) и шапка. */
  const shown = { key: null, head: null }

  function view() {
    if (model.how) return howView()
    if (!model.ready) return loadView(model.slow)
    if (model.pick) return passView(model.pick, model.statuses[model.pick.wants] || null, model.busy, model.flop)
    return listView(model.statuses, model.copy)
  }

  /**
   * Нарисовать. Вид сменился (список → пропуск, «готова» → «не вошли») — рисуем заново, с плавным появлением.
   * Вид тот же, приехали подробности (почта, «Скопировано») — меняем только свои места (`data-slot`): окно не мигает и
   * картинка пропуска не перечитывается.
   */
  function render() {
    uid = 0
    const next = view()
    const head = next.head
    if (shown.key === null) {
      rootEl.innerHTML = `<div class="pop"><div data-part="head">${head}</div><div class="vw" data-part="body">${next.html}</div></div>`
    } else {
      const headEl = rootEl.querySelector('[data-part="head"]')
      const bodyEl = rootEl.querySelector('[data-part="body"]')
      if (shown.head !== head) headEl.innerHTML = head
      if (shown.key !== next.key) {
        bodyEl.innerHTML = next.html
        // Появление заново: класс снимаем и ставим на следующем кадре.
        bodyEl.classList.remove('vw')
        void bodyEl.offsetWidth
        bodyEl.classList.add('vw')
      } else {
        const fresh = document.createElement('div')
        fresh.innerHTML = next.html
        for (const slot of fresh.querySelectorAll('[data-slot]')) {
          const live = bodyEl.querySelector(`[data-slot="${slot.dataset.slot}"]`)
          if (!live || live.innerHTML === slot.innerHTML) continue
          live.innerHTML = slot.innerHTML
          live.classList.remove('slot-in')
          void live.offsetWidth
          live.classList.add('slot-in')
        }
      }
    }
    shown.key = next.key
    shown.head = head
    syncRows()
  }

  /**
   * Подсветка строк списка («скопировано» — зелёная кромка и блик, «не вышло» — тёплая) — всегда по состоянию, после
   * каждой отрисовки: класс, оставшийся от прошлого состояния, на строке не задержится.
   */
  function syncRows() {
    for (const id of S.ORDER) {
      const el = rootEl.querySelector(`[data-row="${id}"]`)
      if (!el) continue
      el.classList.toggle('copied', model.copy[id] === 'done')
      el.classList.toggle('failed', model.copy[id] === 'fail')
    }
  }

  async function ask(message) {
    try {
      return await api.runtime.sendMessage(message)
    } catch {
      return null
    }
  }

  /** Заказ, которому нужна сессия, — среди открытых вкладок сайта (или `null`). */
  async function findOrder() {
    let tabs = []
    if (MATCHES.length) {
      try {
        tabs = await api.tabs.query({ url: MATCHES })
      } catch {
        tabs = []
      }
    }
    let frontId = null
    try {
      const front = await api.tabs.query({ active: true, lastFocusedWindow: true })
      frontId = front[0] ? front[0].id : null
    } catch {
      frontId = null
    }
    const answers = await Promise.all(
      tabs.map(async (tab) => {
        try {
          const answer = await api.tabs.sendMessage(tab.id, { type: 'order?' })
          return answer ? Object.assign({ tabId: tab.id, windowId: tab.windowId, active: tab.id === frontId }, answer) : null
        } catch {
          return null // на вкладке нет нашего скрипта (страница ещё грузится)
        }
      })
    )
    return P.pickOrder(answers)
  }

  /** Вошёл ли человек в каждый сервис — по cookie, без сети и без фона (`reader.peek`). */
  async function peekAll() {
    const out = {}
    await Promise.all(
      S.ORDER.map(async (id) => {
        try {
          out[id] = await local.peek(id)
        } catch {
          out[id] = { signedIn: null, account: null, plan: null, final: false }
        }
      })
    )
    return out
  }

  /** Сколько ждём, прежде чем показать заготовку: обычно всё известно раньше, и заготовка только мигнула бы. */
  const SLOW_MS = 220
  /** Сколько пропуск показывает «в заказе» после передачи, прежде чем окно уступит место странице заказа. */
  const DONE_MS = 1100

  async function load() {
    const slow = setTimeout(() => {
      if (model.ready) return
      model.slow = true
      render()
    }, SLOW_MS)
    // Какой заказ открыт и вошёл ли человек (по cookie, без сети) — разом: первый же кадр верный.
    const [pick, quick] = await Promise.all([findOrder(), peekAll()])
    clearTimeout(slow)
    model.pick = pick
    model.statuses = quick
    model.ready = true
    render()
    // Что не дочитано без сети (вошли ли в ChatGPT на самом деле, почта аккаунта) — следом и только по своим местам.
    const need = (pick ? [pick.wants] : S.ORDER).filter((id) => !(model.statuses[id] && model.statuses[id].final))
    if (!need.length) return
    const full = await ask({ type: 'status', services: need })
    for (const id of need) {
      const found = full && full.services ? full.services[id] : null
      model.statuses[id] = { signedIn: found ? found.signedIn : null, account: found ? found.account : null, plan: found ? found.plan : null, final: true }
    }
    render()
  }

  async function focusOrder() {
    const pick = model.pick
    if (!pick) return
    try {
      await api.tabs.update(pick.tabId, { active: true })
      await api.windows.update(pick.windowId, { focused: true })
    } catch {
      /* вкладку закрыли */
    }
  }

  const actions = {
    how() {
      model.how = true
      render()
    },
    back() {
      model.how = false
      render()
    },
    site() {
      api.tabs.create({ url: SITE + '/' })
      window.close()
    },
    orders() {
      api.tabs.create({ url: SITE + '/orders' })
      window.close()
    },
    about() {
      api.tabs.create({ url: REPO })
      window.close()
    },
    login(target) {
      const spec = S.SERVICES[P.serviceOrNull(target.dataset.service)]
      if (!spec) return
      api.tabs.create({ url: spec.login })
      window.close()
    },
    async open() {
      await focusOrder()
      window.close()
    },
    /**
     * «Передать сессию»: кладёт её в форму заказа скрипт страницы. Получилось — пропуск тут же говорит «в заказе»
     * (тот же вид, что при следующем открытии окна), и через мгновение показываем страницу заказа: там «Включить».
     * Не получилось — окно остаётся и показывает, как есть.
     */
    async handoff() {
      const pick = model.pick
      if (!pick || model.busy) return
      model.busy = true
      model.flop = false
      render()
      let answer = null
      try {
        answer = await api.tabs.sendMessage(pick.tabId, { type: 'handoff', service: pick.wants })
      } catch {
        answer = null // вкладку заказа закрыли
      }
      model.busy = false
      if (answer && answer.ok) {
        model.pick = Object.assign({}, pick, { stage: 'have' })
        render()
        setTimeout(() => void actions.open(), DONE_MS)
        return
      }
      // Сервис не дал прочитать сессию — скажем об этом. Вышли из сервиса, заказ ушёл дальше или его вкладку закрыли —
      // слов не нужно: окно перечитает и покажет, как есть («Войти», «в заказе», список).
      model.flop = Boolean(answer && answer.code === 'unavailable')
      await load()
    },
    /**
     * «Скопировать»: читаем в момент нажатия и кладём в буфер — в окне сессия не остаётся.
     * ⚠️ Запись в буфер начинаем В САМОМ нажатии, а сессию отдаём ей обещанием: чтение у ChatGPT идёт секунды, и
     * запись, начатая после него, могла бы остаться без «жеста пользователя» — браузер молча отказал бы.
     */
    async copy(target) {
      const service = P.serviceOrNull(target.dataset.service)
      if (!service || model.copy[service] === 'reading') return
      const text = ask({ type: 'session', service }).then((answer) => {
        if (!answer || !answer.ok) throw new Error('no session')
        return answer.value
      })
      text.catch(() => undefined) // отказ разбираем ниже — без «необработанной ошибки» в консоли
      clearTimeout(copyTimers[service])
      model.copy[service] = 'reading'
      render()
      let done = false
      if (typeof ClipboardItem === 'function' && navigator.clipboard && typeof navigator.clipboard.write === 'function') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })) })])
          done = true
        } catch {
          done = false
        }
      }
      if (!done) {
        try {
          await navigator.clipboard.writeText(await text)
          done = true
        } catch {
          done = false
        }
      }
      settleCopy(service, done ? 'done' : 'fail')
      // Не прочиталось — возможно, из сервиса вышли: перечитаем и покажем как есть («Войти»).
      if (!done) void load()
    },
  }

  /** Сколько строка показывает итог копирования, прежде чем вернуться к «Скопировать». */
  const COPY_DONE_MS = 1600
  const COPY_FAIL_MS = 2200

  /** Итог копирования: строка отвечает движением (`.copied` / `.failed` — `popup.css`) и через паузу возвращается. */
  function settleCopy(service, state) {
    // Повторное нажатие по той же строке — движение начинается заново, а не «доигрывает» прежнее.
    const rowEl = rootEl.querySelector(`[data-row="${service}"]`)
    if (rowEl) {
      rowEl.classList.remove('copied', 'failed')
      void rowEl.offsetWidth
    }
    model.copy[service] = state
    render()
    clearTimeout(copyTimers[service])
    copyTimers[service] = setTimeout(() => {
      delete copyTimers[service]
      delete model.copy[service]
      render()
    }, state === 'done' ? COPY_DONE_MS : COPY_FAIL_MS)
  }

  function onAct(event) {
    const target = event.target && event.target.closest ? event.target.closest('[data-act]') : null
    if (!target) return
    const action = actions[target.dataset.act]
    if (action) void action(target)
  }
  rootEl.addEventListener('click', onAct)
  rootEl.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.matches && event.target.matches('span[data-act]')) {
      event.preventDefault()
      onAct(event)
    }
  })

  render()
  void load()
})(typeof globalThis !== 'undefined' ? globalThis : self)
