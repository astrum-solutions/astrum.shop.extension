// Таблица сервисов — ОДНА на фон, окно и скрипт страницы: одно правило — один файл.
//
// ⚠️⚠️ Новый сервис (Gemini, Higgsfield) — строка здесь, сайт сервиса в `host_permissions` обоих манифестов и фон в
// `img/`: окно, фон и страница заказа берут всё отсюда, отдельных списков у них нет.
// ⚠️ Где лежит сессия — то же, что страница заказа без расширения просит достать руками:
// Claude — cookie `sessionKey`, Grok — cookie `sso`, ChatGPT — текст страницы `/api/auth/session` целиком.
// ⚠️ Формат значения здесь НЕ проверяем: его проверяет форма заказа на сайте — вторая копия правила разъехалась бы
// с первой.
// ⚠️ Адреса «Войти» и знаки сервисов — те же, что на сайте astrum.shop.
// ⚠️ Тариф аккаунта (`plan`) — названием, под которым его продаёт САМ сервис («Plus», «Max», «Premium»), и только по тому,
// что замерено живьём. Не узнали — `null`, чипа нет: по тарифу человек решает, тот ли это аккаунт, выдумывать нельзя.
;(function (root) {
  'use strict'

  /** Значение по пути в разобранном JSON. */
  function at(value, path) {
    let cur = value
    for (const key of path) {
      if (!cur || typeof cur !== 'object') return undefined
      cur = cur[key]
    }
    return cur
  }

  /**
   * Claude: `GET /api/account` → `memberships[].organization` (та же страница, что отдаёт почту — второго запроса нет).
   * По замерам ответов сервиса (октябрь–ноябрь 2026): 20x — `rate_limit_tier: default_claude_max_20x`,
   * 5x — `default_claude_max_5x` (оба с `claude_max` в `capabilities`), Pro — `claude_pro`, бесплатный — только `chat`.
   * Имена — нынешние Anthropic: 20x — Ultra, 5x — Max.
   * ⚠️ Max без известного уровня и организация с незнакомой возможностью (рабочее пространство, API) — «не знаем».
   */
  const CLAUDE_TIERS = { default_claude_max_20x: 'Ultra', default_claude_max_5x: 'Max' }
  const CLAUDE_RANK = ['Free', 'Pro', 'Max', 'Ultra']
  function claudeOrgPlan(org) {
    const caps = org && Array.isArray(org.capabilities) ? org.capabilities : null
    if (!caps || !caps.includes('chat')) return undefined // не чат (организация API) — не про тариф Claude
    if (caps.includes('claude_max')) return CLAUDE_TIERS[org.rate_limit_tier] || null
    if (caps.includes('claude_pro')) return 'Pro'
    return caps.length === 1 ? 'Free' : null
  }
  function claudePlan(body) {
    const memberships = body && Array.isArray(body.memberships) ? body.memberships : []
    const plans = memberships.map((m) => claudeOrgPlan(m && m.organization)).filter((plan) => plan !== undefined)
    // Хоть одну организацию с чатом не поняли — тариф не называем: «Free» при рабочем пространстве был бы неправдой.
    if (!plans.length || plans.includes(null)) return null
    return plans.sort((a, b) => CLAUDE_RANK.indexOf(b) - CLAUDE_RANK.indexOf(a))[0]
  }

  /**
   * ChatGPT: `account.planType` страницы сессии. Коды — по замерам ответов сервиса (`free | go | plus | prolite |
   * pro | promax`) и рабочие пространства. Незнакомый код — «не знаем».
   */
  const CHATGPT_PLANS = { free: 'Free', go: 'Go', plus: 'Plus', prolite: 'Pro Lite', pro: 'Pro', promax: 'Pro Max', team: 'Team', enterprise: 'Enterprise', edu: 'Edu' }
  function chatgptPlan(body) {
    const code = at(body, ['account', 'planType'])
    return (typeof code === 'string' && CHATGPT_PLANS[code.trim().toLowerCase()]) || null
  }

  /**
   * Grok: `GET /rest/plan/profile` → `profile.dominantPlan` — код тарифа; имя — как на grok.com/plans.
   * ⚠️ `surfaceNames.SURFACE_DISPLAY` из того же ответа НЕ годится: там прежние имена («SuperGrok», «SuperGrok Heavy»),
   * а человек знает свой тариф по странице тарифов — Plus, Premium, Super, Ultra.
   * Соответствие кодов и имён сверено 10.11.2026 (реестр `/rest/plan/surfaces` против страницы тарифов):
   * цепочка апгрейда lite → supergrok → plus → heavy; объём 1× / 4× / 15× / 50×, как на странице;
   * Grok Bot появляется с Premium, видео 1080p — с Super, «самые мощные модели» — у Ultra. Незнакомый код — «не знаем».
   */
  const GROK_PLANS = {
    free: 'Free',
    'supergrok.lite': 'Plus',
    supergrok: 'Premium',
    'supergrok.plus': 'Super',
    'supergrok.heavy': 'Ultra',
    'x.basic': 'X Basic',
    'x.premium.standard': 'X Premium',
    'x.premium': 'X Premium+',
  }
  function grokPlan(body) {
    const code = at(body, ['profile', 'dominantPlan']) || at(body, ['dominantPlan'])
    // Код, совпавший с именем встроенного свойства объекта («constructor»), строкой не окажется — его отсеет `planLabel`.
    return (typeof code === 'string' && GROK_PLANS[code]) || null
  }

  /** Название тарифа для окна: короткая строка из букв, цифр, пробела и «+ . -»; иное — `null` (это подпись, а не данные). */
  function planLabel(value) {
    const text = typeof value === 'string' ? value.trim() : ''
    return /^[\p{L}\p{N}][\p{L}\p{N} +.\-]{0,23}$/u.test(text) ? text : null
  }

  const SERVICES = {
    claude: {
      title: 'Claude',
      login: 'https://claude.ai/login',
      session: { type: 'cookie', url: 'https://claude.ai', name: 'sessionKey' },
      // Почта аккаунта — `GET /api/account` → `email_address`.
      account: { type: 'json', url: 'https://claude.ai/api/account', path: ['email_address'] },
      // Тариф — из того же ответа (`memberships`).
      plan: { type: 'json', url: 'https://claude.ai/api/account', read: claudePlan },
      tint: ['#E58A6B', '#B9532F'],
      mark: { vb: "0 0 24 24", d: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" },
    },
    chatgpt: {
      title: 'ChatGPT',
      login: 'https://auth.openai.com/log-in-or-create-account',
      // Страница сессии: вошедшему отдаёт JSON с `accessToken`, невошедшему — пустой объект.
      // `watch` — по какой cookie видно «вошёл / вышел»: остальные cookie сайта меняются постоянно, и страница заказа
      // дёргала бы страницу сессии на каждое их изменение.
      session: { type: 'page', url: 'https://chatgpt.com/api/auth/session', signedInField: 'accessToken', watch: 'session-token' },
      // Почта — в той же странице сессии (`user.email`): второго запроса не нужно.
      account: { type: 'session', path: ['user', 'email'] },
      // Тариф — там же (`account.planType`).
      plan: { type: 'session', read: chatgptPlan },
      tint: ['#17B08A', '#0A6B52'],
      mark: { vb: "0 0 24 24", d: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" },
    },
    grok: {
      title: 'Grok',
      // `?mwbv=true` — «открыть в браузере»: без него на телефоне адрес перехватывает приложение Grok.
      login: 'https://grok.com/sign-in?mwbv=true',
      session: { type: 'cookie', url: 'https://grok.com', name: 'sso' },
      // Почта — на странице сессии Grok (`session.email`). Без входа она отвечает `{"status":"unauthenticated"}`.
      account: { type: 'json', url: 'https://grok.com/api/auth/session', path: ['session', 'email'] },
      // Тариф — отдельной страницей.
      plan: { type: 'json', url: 'https://grok.com/rest/plan/profile', read: grokPlan },
      tint: ['#5B6B7C', '#161A1F'],
      mark: { vb: "67.7647 67.7647 376.471 376.471", d: "M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677 " },
    },
  }

  /** Порядок показа в списке окна. */
  const ORDER = ['claude', 'chatgpt', 'grok']

  /**
   * Чья это cookie сессии: сервис, у которого изменение cookie `name` на сайте `domain` значит «вошёл / вышел», или
   * `null`. По нему фон сообщает открытой странице заказа о перемене.
   */
  function serviceOfCookie(domain, name) {
    const bare = String(domain || '').replace(/^\./, '')
    for (const id of ORDER) {
      const session = SERVICES[id].session
      const host = new URL(session.url).hostname
      if (bare !== host && !bare.endsWith('.' + host)) continue
      const hit = session.type === 'cookie' ? name === session.name : String(name || '').includes(session.watch)
      if (hit) return id
    }
    return null
  }

  /** Тариф аккаунта по разобранному ответу сервиса — названием для окна или `null`. */
  function planOf(service, body) {
    const spec = SERVICES[service] && SERVICES[service].plan
    if (!spec || !body || typeof body !== 'object') return null
    try {
      return planLabel(spec.read(body))
    } catch {
      return null
    }
  }

  const api = { SERVICES, ORDER, serviceOfCookie, planOf, planLabel }
  root.AstrumServices = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : self)
