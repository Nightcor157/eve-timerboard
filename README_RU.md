# EVE Online Timerboard

Онлайн-доска таймеров для EVE Online. Все открывают одну ссылку и видят одинаковые таймеры. Отсчёт тикает в браузере каждую секунду. Добавление/удаление доступно через `?admin=1` и админ-ключ.

## Что умеет

- Публичная таблица таймеров.
- Отсчёт каждую секунду.
- Поиск/фильтр по системе, корпорации, альянсу, структуре.
- Экспорт CSV.
- Добавление нескольких таймеров сразу.
- Удаление таймеров в админ-режиме.
- Хранение в Supabase, поэтому другие люди видят те же таймеры онлайн.

## Поддерживаемые форматы ввода

```text
III Hokage > Customs Office* (Yehaba II*) [The Weak And The Scrawny]<br>1,7 а.е.<br>Укрепленный режим до 2026.05.23 10:37:54
```

```text
Alfajack > Hoseen - Miner's bar, striptease attached<br>22,5 а.е.<br>В оборонном режиме до 2026.05.25 14:42:47
```

```text
[12:44:39] Tygarin Kvazovsky > Hakatiz - 7-6<br>8,4 AU<br>Reinforced until 2026.05.22 13:08:10
```

```text
Hakatiz - 7-6
9 149 м
В оборонном режиме до 2026.05.22 13:08:10
```

Время считается как EVE/UTC.

## Быстрый запуск онлайн

### 1. Создай Supabase-проект

1. Открой Supabase и создай новый проект.
2. Перейди в SQL Editor.
3. Открой файл `supabase/schema.sql` из этого проекта.
4. Внизу файла замени `CHANGE_ME_ADMIN_KEY` на свой админ-ключ.
5. Выполни SQL целиком.

Админ-ключ не вставляй в код сайта. Его вводят только на странице `?admin=1`.

Для ручной правки типа структуры и типа таймера через выпадающие меню
выполни в SQL Editor файл `supabase_update_timer_admin_fields.sql`.

### 2. Настрой `js/config.js`

В Supabase открой Project Settings → API и скопируй:

- Project URL;
- anon/public/publishable key.

Вставь их в `js/config.js`:

```js
window.EVE_TIMERBOARD_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseKey: "YOUR-SUPABASE-ANON-OR-PUBLISHABLE-KEY",
  boardId: "main",
  pollEveryMs: 15000
};
```

### 3. Опубликуй на GitHub Pages

1. Создай новый репозиторий на GitHub, например `eve-timerboard`.
2. Загрузи все файлы из этой папки в репозиторий.
3. Открой Settings → Pages.
4. В Source выбери `Deploy from a branch`.
5. В Branch выбери `main` и `/root`.
6. Сохрани.
7. Через минуту сайт будет доступен по ссылке вида:

```text
https://ТВОЙ_НИК.github.io/eve-timerboard/
```

Админка будет здесь:

```text
https://ТВОЙ_НИК.github.io/eve-timerboard/?admin=1
```

## Как пользоваться

Обычным людям даёшь обычную ссылку на сайт. Они видят таблицу и живой отсчёт.

Для добавления таймеров открой ссылку с `?admin=1`, введи админ-ключ, вставь строку из EVE и нажми `Добавить`.

## Если нужно несколько разных досок

Можно сделать несколько boardId, например:

- `main`
- `corp`
- `ally`

Для каждой доски нужно один раз выполнить:

```sql
select public.setup_timerboard('corp', 'ТВОЙ_КЛЮЧ_ДЛЯ_CORP');
```

А потом поменять `boardId` в `js/config.js`.

## Без Supabase

Если Supabase не настроен, сайт запускается в локальном демо-режиме. В этом режиме таймеры сохраняются только в текущем браузере и не видны другим людям.
