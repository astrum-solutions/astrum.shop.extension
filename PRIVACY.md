# Расширение astrum.shop: какие данные оно видит

Последнее изменение: 11 ноября 2026 · [English version](#english-version)

**Коротко.** Расширение передаёт сессию Claude, ChatGPT или Grok в ваш заказ на [astrum.shop](https://astrum.shop) —
только по вашему нажатию. Оно ничего не хранит, своего сервера у него нет, рекламы и счётчиков в нём нет.

### 1. Зачем нужно расширение

1.1. Расширение astrum.shop для браузера передаёт сессию Claude, ChatGPT или Grok в ваш заказ на сайте astrum.shop — чтобы мы включили оплаченную подписку на вашем аккаунте. Сессия — это уже выполненный вход в сервис. Пароль расширение не видит и не спрашивает.

1.2. Другого назначения у расширения нет. В нём нет рекламы, счётчиков посещений и стороннего кода; код из сети оно не загружает. Код расширения открыт и лежит в этом репозитории.

### 2. Что расширение видит

2.1. Расширение работает только на сайтах claude.ai, chatgpt.com, grok.com и astrum.shop. На сайтах сервисов оно видит только то, что относится к вашему входу:

- вошли ли вы в сервис в этом браузере;
- адрес электронной почты и тариф аккаунта — чтобы вы видели, сессию какого аккаунта передаёте. Почту расширение показывает и помнит только в скрытом виде, например alex•••@gmail.com;
- саму сессию сервиса — когда вы нажали «Передать сессию» или «Скопировать».

2.2. Чтобы узнать, вошли ли вы, а также почту и тариф, расширение обращается к самому сервису от вашего имени — так же, как это делает страница сервиса в вашем браузере. Это происходит, когда вы открываете окно расширения или страницу заказа, который ждёт сессию. Сама сессия при этом не сохраняется и никуда не передаётся — до вашего нажатия.

2.3. На странице заказа astrum.shop расширение узнаёт, сессию какого сервиса ждёт заказ, а также номер и название заказа — чтобы показать их в своём окне.

2.4. Другие сайты и историю браузера расширение не видит. Пароли, платёжные данные, переписку и содержимое ваших аккаунтов оно не читает.

### 3. Когда и куда уходит сессия

3.1. Только по вашему нажатию. «Передать сессию» кладёт сессию в форму вашего заказа на странице astrum.shop. «Скопировать» кладёт её в буфер обмена вашего компьютера. Без нажатия сессия никуда не уходит.

3.2. В заказ уходит сессия только того сервиса, которого этот заказ ждёт, и только на страницу этого заказа. Вместе с ней странице сообщается почта аккаунта в скрытом виде — чтобы вы видели, чей аккаунт указали.

3.3. Сайт не может сам запросить сессию у расширения: оно отвечает только на нажатие человека.

3.4. Другим сайтам, сервисам и людям расширение ничего не отправляет. Своего сервера у расширения нет.

### 4. Что расширение хранит

4.1. Сессию расширение не хранит: читает её в момент нажатия и сразу отдаёт.

4.2. Не дольше минуты в памяти браузера остаются: вошли ли вы в сервис, почта в скрытом виде и название тарифа — чтобы окно расширения открывалось сразу. На диск расширение ничего не записывает и журналов не ведёт.

### 5. Что происходит с сессией в заказе

5.1. Сессия попадает в магазин, когда вы нажимаете «Включить» на странице заказа. Она используется только чтобы включить оплаченную подписку на вашем аккаунте: хранится в зашифрованном виде, передаётся техническому исполнителю активации в объёме, необходимом для её проведения, и автоматически удаляется после завершения или отмены активации, а если активация не завершена — через 30 дней без действий по ней.

5.2. Для рекламы, аналитики, оценки платёжеспособности и любых других целей эти данные не используются. Мы их не продаём и не передаём никому, кроме случая из пункта 5.1.

5.3. Подробнее о данных для активации — пункт 2.8 Политики конфиденциальности магазина: https://astrum.shop/privacy.

### 6. Доступы расширения

6.1. Расширение просит у браузера только то, без чего не может работать:

- «Файлы cookie» (cookies) — узнать, вошли ли вы в сервис, и прочитать сессию Claude и Grok;
- доступ к сайтам claude.ai, chatgpt.com и grok.com — узнать почту и тариф аккаунта и прочитать сессию ChatGPT;
- доступ к сайту astrum.shop и «Скрипты» (scripting) — связать расширение со страницей вашего заказа, в том числе во вкладке, которая уже была открыта при установке.

### 7. Как отозвать доступ

7.1. Отключите или удалите расширение в настройках браузера — после этого оно ничего не видит.

7.2. Чтобы переданная раньше сессия перестала действовать, выйдите из аккаунта сервиса и войдите снова.

### 8. Правила магазина расширений

8.1. Использование данных, полученных расширением, соответствует правилам Интернет-магазина Chrome об обращении с данными пользователей (Chrome Web Store User Data Policy), включая требования об ограниченном использовании (Limited Use).

### 9. Вопросы

9.1. Напишите нам в чат на сайте astrum.shop, в Telegram-бот магазина или в Issues этого репозитория.

---

## English version

**In short.** The extension passes your Claude, ChatGPT or Grok session into your order on
[astrum.shop](https://astrum.shop) — only when you click. It stores nothing, has no server of its own, and contains no
ads or analytics.

### 1. What the extension is for

1.1. The astrum.shop browser extension passes your Claude, ChatGPT or Grok session into your order on astrum.shop, so that we can activate the subscription you paid for on your own account. A session is a sign-in you have already completed. The extension never sees or asks for your password.

1.2. The extension has no other purpose. It contains no ads, no analytics and no third-party code, and it does not load code from the network. Its source code is open and lives in this repository.

### 2. What the extension reads

2.1. The extension works only on claude.ai, chatgpt.com, grok.com and astrum.shop. On the service sites it reads only what relates to your sign-in:

- whether you are signed in to the service in this browser;
- the e-mail address and plan of the account — so that you can see which account's session you are about to pass. The e-mail is shown and kept only in masked form, for example alex•••@gmail.com;
- the session itself — when you click «Передать сессию» (Pass the session) or «Скопировать» (Copy).

2.2. To learn whether you are signed in, and your e-mail and plan, the extension sends requests to the service itself on your behalf — the same way the service's own page does in your browser. This happens when you open the extension window or the page of an order that is waiting for a session. The session is not saved and is not passed anywhere until you click.

2.3. On the astrum.shop order page the extension learns which service's session the order is waiting for, and the order's number and title — to show them in its window.

2.4. The extension has no access to other websites or to your browsing history. It does not read passwords, payment details, conversations or the contents of your accounts.

### 3. When and where the session goes

3.1. Only when you click. «Передать сессию» puts the session into the form of your order on the astrum.shop page. «Скопировать» puts it on your computer's clipboard. Without a click the session goes nowhere.

3.2. Only the session of the service your order is waiting for is passed, and only to the page of that order. Together with it the page receives the account e-mail in masked form — so that you can see whose account you provided.

3.3. The website cannot request the session from the extension: the extension responds only to a click made by a person.

3.4. The extension sends nothing to any other website, service or person. The extension has no server of its own.

### 4. What the extension stores

4.1. The extension does not store the session: it reads it at the moment you click and hands it over immediately.

4.2. For no longer than one minute the browser's memory holds: whether you are signed in, the masked e-mail and the plan name — so that the extension window opens instantly. The extension writes nothing to disk and keeps no logs.

### 5. What happens to the session in the order

5.1. The session reaches the shop when you click «Включить» (Activate) on the order page. It is used only to activate the subscription you paid for on your account: it is stored encrypted, passed to the technical provider that performs the activation to the extent necessary for it, and deleted automatically once the activation is completed or cancelled — or after 30 days without activity if it was never completed.

5.2. This data is not used for advertising, analytics, creditworthiness assessment or any other purpose. We do not sell it and do not transfer it to anyone except as described in clause 5.1.

5.3. More about activation data: clause 2.8 of the store's Privacy Policy, https://astrum.shop/privacy.

### 6. Permissions

6.1. The extension asks the browser only for what it cannot work without:

- cookies — to learn whether you are signed in and to read the Claude and Grok session;
- access to claude.ai, chatgpt.com and grok.com — to learn the account e-mail and plan and to read the ChatGPT session;
- access to astrum.shop and scripting — to connect the extension to your order page, including a tab that was already open when the extension was installed.

### 7. How to revoke access

7.1. Disable or remove the extension in your browser settings — after that it reads nothing.

7.2. To invalidate a session you passed earlier, sign out of the service account and sign in again.

### 8. Extension store rules

8.1. The use of information received by the extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

### 9. Questions

9.1. Write to us in the chat on astrum.shop, in the shop's Telegram bot, or in this repository's Issues.
