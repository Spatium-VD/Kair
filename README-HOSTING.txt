Сайт «Синержи — Моя зарплата» (статический фронт)
================================================

Что залить на хостинг (в корень сайта, одна папка):
  index.html, dashboard.html
  script.js, style.css, config.js
  logo.png
  Копия-Креатив-без-названия-_2_.ico  (фавикон)

Список менеджеров (ФИО, PIN, проекты, города) — в Google Таблице ФОТ, лист «managers»;
на хостинг файл managers.csv больше не нужен.

Перед публикацией:
  1) В config.js укажите URL Web App (getPayments, getBonusProjects, getManagers).
  2) В Apps Script задеплойте Code.gs с action getManagers.
  3) Нужен HTTPS (иначе часть браузеров режет запросы к script.google.com).
  4) Bootstrap грузится с CDN — нужен интернет у пользователя.

Точка входа для пользователей: index.html
