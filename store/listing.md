# Карточка расширения в Chrome Web Store

Что вписано в кабинете разработчика магазина — поле за полем.

⚠️ Магазин сверяет три вещи: что написано здесь (и в кабинете), что написано в [PRIVACY.md](../PRIVACY.md) и что
расширение делает на самом деле. Расхождение магазин считает нарушением своих правил о данных. Поменялось расширение —
новый сервис, новый доступ, что-то стало храниться или уходить иначе — правятся этот файл, `PRIVACY.md` и ответы в
кабинете, одним заходом. Что `PRIVACY.md` называет все сайты и доступы манифеста, сторожит `tests/build.test.mjs`.

Архив для магазина: `node pack.mjs chrome --zip` → `dist/chrome-<версия>.zip` (сначала прогоняются тесты).

---

## 1. Описание в магазине (Store listing)

| Поле | Что вписать |
| --- | --- |
| Название | из манифеста: `astrum.shop` |
| Краткое описание | из манифеста: «Передаёт сессию Claude, ChatGPT, Grok или Higgsfield в ваш заказ на astrum.shop — только по вашему нажатию.» |
| Язык | русский |
| Категория | Инструменты (Tools) |
| Значок 128×128 | из архива (`icons/icon-128.png`) |
| Снимки 1280×800 | `screens/screen-1.png` … `screen-5.png`, в этом порядке |
| Малая промо-плитка 440×280 | `screens/promo-440x280.png` |
| Большая промо-плитка 1400×560 (по желанию) | `screens/promo-1400x560.png` |
| Проморолик | не нужен |
| Сайт (Homepage URL) | https://github.com/astrum-solutions/astrum.shop.extension |
| Поддержка (Support URL) | https://astrum.shop |
| Контент для взрослых | нет |

### Подробное описание

```text
Расширение магазина astrum.shop передаёт сессию Claude, ChatGPT, Grok или Higgsfield в ваш заказ на сайте astrum.shop — одним нажатием, без поиска cookie в настройках браузера.

ДЛЯ ЧЕГО
Вы купили на astrum.shop подписку на нейросеть с активацией на вашем аккаунте. Чтобы её включить, магазину нужна сессия — уже выполненный вход в сервис. Пароль при этом не нужен, и расширение его не видит.

КАК ЭТО РАБОТАЕТ
1. Откройте свой заказ на astrum.shop.
2. Войдите в Claude, ChatGPT, Grok или Higgsfield в этом же браузере — если ещё не вошли.
3. Нажмите «Передать сессию» — на странице заказа или в окне расширения.
4. Нажмите «Включить» на странице заказа.

В окне расширения видно, в какие сервисы вы вошли, под какой почтой и на каком тарифе. Кнопка «Скопировать» кладёт сессию в буфер обмена — если нужно вставить её вручную.

ЧТО РАСШИРЕНИЕ ДЕЛАЕТ С ДАННЫМИ
• Сессия уходит только по вашему нажатию и только в ваш заказ на astrum.shop.
• Расширение ничего не хранит и ничего не отправляет другим сайтам. Своего сервера у него нет.
• Оно работает только на сайтах claude.ai, chatgpt.com, grok.com, higgsfield.ai и astrum.shop. Другие сайты, историю браузера и пароли не видит.
• В нём нет рекламы и счётчиков.
• Сессия нужна только чтобы включить оплаченную подписку; после активации она удаляется.

Код расширения открыт: https://github.com/astrum-solutions/astrum.shop.extension
Что расширение видит, по пунктам: https://github.com/astrum-solutions/astrum.shop.extension/blob/main/PRIVACY.md

Расширение — часть магазина astrum.shop. Оно не является продуктом Anthropic, OpenAI или xAI и не связано с ними.

IN ENGLISH
The astrum.shop extension lets a customer of the astrum.shop store pass the sign-in session of their own Claude, ChatGPT, Grok or Higgsfield account into their own order on astrum.shop with one click, so the store can activate the subscription they paid for. The session is passed only when you click, only to your order page; the extension stores nothing and has no server of its own. Open source: https://github.com/astrum-solutions/astrum.shop.extension
```

### Снимки

Снимки собраны из настоящего окна расширения и настоящей страницы заказа. Аккаунт на них выдуманный
(`alex•••@gmail.com`), ответы сервисов подставлены, заказ пробный.

| Файл | Подпись на снимке | Что показано |
| --- | --- | --- |
| `screen-1.png` | Сессия в заказ — одним нажатием | окно расширения над заказом: «готова», «Передать сессию» |
| `screen-2.png` | Кнопка — прямо на странице заказа | шаг на странице заказа: «Передать сессию Claude» |
| `screen-3.png` | Остаётся нажать «Включить» | страница заказа после передачи |
| `screen-4.png` | Видно, чей аккаунт передаёте | список сервисов: почта под маской, тариф, «Скопировать», «Войти» |
| `screen-5.png` | Как это устроено — на одном экране | окно «Как это устроено» |

Меняется окно расширения или шаг на странице заказа — снимки переснять: магазин ждёт на них настоящий вид.

---

## 2. Конфиденциальность (Privacy practices)

Ответы — по-английски: их читают проверяющие.

### Единственное назначение (Single purpose)

```text
The extension lets a customer of the astrum.shop store pass the sign-in session of their own Claude, ChatGPT, Grok or Higgsfield account into their own order on astrum.shop with one click. The store uses the session only to activate the subscription the customer has paid for on that account. Nothing is read from other sites, nothing is stored, and the session is passed only when the user clicks «Передать сессию» (Pass the session) or «Скопировать» (Copy). The source code is open: https://github.com/astrum-solutions/astrum.shop.extension
```

### Обоснование доступа `cookies`

```text
1) To know whether the user is signed in to claude.ai, chatgpt.com, grok.com or higgsfield.ai, so that the popup and the order page show the right state and the right button. 2) To read the session cookie of claude.ai (sessionKey), grok.com (sso) and higgsfield.ai (__client) at the moment the user clicks «Передать сессию» (Pass the session) or «Скопировать» (Copy). cookies.onChanged is used only to refresh the signed-in state when the user signs in or out. Cookies of any other site are not accessible to the extension.
```

### Обоснование доступа `scripting`

```text
Used only in runtime.onInstalled (install and update) to inject the extension's own bundled content script (protocol.js, content.js) into astrum.shop tabs that are already open, so that the order page the user came from starts working without a reload. No remote code is executed and no other sites are scripted.
```

### Обоснование доступа к сайтам (Host permissions)

```text
claude.ai, chatgpt.com, grok.com and higgsfield.ai are the four services whose subscriptions the store activates. The extension requests the user's own account e-mail and plan name from the service — they are shown to the user in the popup (the e-mail only in masked form) so that the user can see which account's session they are passing — and, for ChatGPT, reads the session from the service's session endpoint when the user clicks. astrum.shop is the store's own site: the content script runs only there, tells the popup which order is open and which service's session it is waiting for, and puts the session into the order form when the user clicks. No wildcard hosts and no other sites are requested.
```

### Удалённый код (Remote code)

«Нет, я не использую удалённый код» (No, I am not using remote code).

### Какие данные обрабатывает расширение (Data usage)

Отмечены два пункта:

- **Personally identifiable information** — адрес почты аккаунта (показывается в окне под маской);
- **Authentication information** — сессия сервиса (уходит в заказ по нажатию).

Не отмечены: Health, Financial and payment, Personal communications, Location, Web history, User activity, Website
content.

Три подтверждения отмечены все: данные не продаются и не передаются третьим лицам вне разрешённых случаев; не
используются для целей, не связанных с единственным назначением; не используются для оценки платёжеспособности.

Передача сессии техническому исполнителю активации — разрешённый случай («необходимо для единственного назначения»);
она названа в `PRIVACY.md`, п. 5.1.

### Политика конфиденциальности (Privacy policy URL)

https://github.com/astrum-solutions/astrum.shop.extension/blob/main/PRIVACY.md

---

## 3. Распространение (Distribution)

Регионы — все. Видимость — «не в поиске» (по ссылке со страницы заказа) или «для всех»; проверку магазин проводит
одинаковую в обоих случаях.

---

## 4. Инструкции для проверки (Test instructions)

Второй абзац — только если для проверяющих заведён пробный заказ: вместо `<ссылка>` — его адрес.

```text
Without an order: click the extension icon. The popup lists Claude, ChatGPT, Grok and Higgsfield and shows whether you are signed in to each of them in this browser. For a signed-in service «Скопировать» (Copy) puts the session on the clipboard; for the others «Войти» (Sign in) opens the service's sign-in page.

With an order (a demo order, nothing is charged): <ссылка>. Sign in to claude.ai in the same browser, open the link and click «Передать сессию Claude» (Pass the Claude session). The session is placed into the order form and the tile shows the masked account e-mail. You do not need to press «Включить» (Activate).
```

---

## 5. Перед подачей новой версии

1. `PRIVACY.md` и этот файл соответствуют тому, что расширение делает сейчас.
2. Архив собран командой `node pack.mjs chrome --zip` (тесты зелёные), номер версии новый.
3. Снимки соответствуют тому, как расширение выглядит сейчас.

Если магазин не пропустит версию с передачей — запасная сборка `node pack.mjs chrome --copy-only --zip` (только
«Скопировать»): у неё нет скрипта страницы и доступа к astrum.shop; описание и `PRIVACY.md` под неё сокращаются.
