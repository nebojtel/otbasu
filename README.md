# ОТБАСЫ — production-сборка витрины и админки

Готово для GitHub + Vercel + Supabase.

## Что внутри

- `/vitrine/` — мобильная витрина. Дизайн от Codex не менялся.
- `/admin/` — защищённая админка ОТБАСЫ.
- `/src/` — логика Supabase, витрины и админки.
- `/api/admin/create-user.js` — защищённая Vercel API-функция для создания пользователей админки.
- `/supabase/schema.sql` — таблицы, роли, RLS-политики, Storage bucket, начальные товары.
- `/public/assets/` — дизайн-ассеты витрины, отдающиеся на сайте как `/assets/...`.

Удалено из production-сборки:

- локальный `server.js`;
- `/__updater`;
- `/__status`;
- все `.bat/.cmd/.sh` запускатели;
- локальные `data/*.json`;
- локальная папка `uploads`;
- тестовые патчи и dev-файлы.

## Роли

- `admin` — полный доступ: товары, категории, аналитика, настройки, пользователи.
- `content_manager` — товары, категории, аналитика. Без управления пользователями и настройками витрины.

## Настройка Supabase

1. Создай проект в Supabase.
2. Открой SQL Editor.
3. Выполни файл:

```sql
supabase/schema.sql
```

4. Создай первого пользователя в Supabase Dashboard → Authentication → Users.
5. Выполни `supabase/promote-admin-template.sql`, заменив `OWNER_EMAIL@example.com` на email первого администратора.

## Environment variables для Vercel

Добавь в Vercel → Project Settings → Environment Variables:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` используется только на серверной Vercel API-функции и не попадает в браузер.

## Локальный запуск

```bash
npm install
npm run dev
```

Открыть:

```text
http://127.0.0.1:5173/vitrine/
http://127.0.0.1:5173/admin/
```

## Деплой

1. Залей проект в GitHub.
2. Подключи репозиторий в Vercel.
3. Vercel сам увидит Vite.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. После деплоя открой `/admin/` и войди через Supabase Auth.

## Что работает

- товары без цен;
- несколько фото на товар;
- порядок фото;
- обложка товара — первое фото;
- галерея по клику на фото;
- Kaspi URL;
- видеообзор;
- метки `Хит / Новинка / Акция`;
- вкладки витрины `Все / Хиты / Новинки / Акции`;
- ручная сортировка товаров перетаскиванием;
- аналитика просмотров, кликов по видео и кликов по Kaspi;
- пользователи админки;
- Supabase RLS.
