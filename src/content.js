export const emptyState = "Появится из Битрикса, когда подключится вебхук";

export const disconnectedLine = "Битрикс пока не подключён.";

export const noDeals = "Сделок в Битриксе нет.";

export const noData = "Нет данных";

export const reviewClients = [
  {
    id: "gostevoi-dom-ars",
    organization: "Гостевой дом Арс",
    purchased: noData,
    dates: noData,
    facts: "Maria Litvinenko: 11 отзывов к оплате за прошлую неделю. Кирилл Соколов, 5 звёзд, на модерации.",
    received: "12",
    payment: "5500",
    remainder: noData,
  },
];

export const reviewGap = "Остальные клиенты переписки: нет данных.";

export const adsNote = "Пока не подключено. Объявления появятся из Яндекс Бизнеса.";

export const sections = [
  {
    id: "podderzhka",
    title: "Поддержка",
    line: "Робот покажет исполнителей поддержки Яндекс Карт и проверку сроков и качества по регламенту.",
    funnel: "podderzhka",
    checks: [
      { code: "PM-2", title: "Нагрузка поддержки" },
      { code: "SP-D0-1", title: "Принять карточку" },
      { code: "SP-W-1", title: "Новость недели" },
      { code: "SP-W-4", title: "Цены, товары, акции" },
    ],
  },
  {
    id: "oformlenie",
    title: "Оформление",
    line: "Робот покажет недельный объём оформления и след в Битриксе по каждому обязательному шагу.",
    funnel: "oformlenie",
    checks: [
      { code: "PM-1", title: "Нагрузка аккаунт-менеджеров" },
      { code: "PM-4", title: "Стадия после проверки" },
      { code: "PM-5", title: "Шапка, особенности, реквизиты" },
      { code: "PM-6", title: "Ссылки" },
      { code: "PM-7", title: "Сторис" },
      { code: "PM-8", title: "Фото" },
      { code: "PM-9", title: "Товары и услуги" },
      { code: "PM-12", title: "Вкус и грамотность" },
      { code: "AM-D0-1", title: "Принять карточку" },
      { code: "AM-W1-2", title: "Шапка и особенности" },
      { code: "AM-W1-3", title: "Внешние ссылки" },
      { code: "AM-W1-4", title: "Материалы и ТЗ дизайнеру" },
      { code: "AM-W1-5", title: "Нежелательный контент" },
      { code: "AM-W2-1", title: "Витрина начата" },
      { code: "AM-W2-2", title: "Первая новость" },
      { code: "AM-W2-3", title: "Фото и видео залиты" },
      { code: "AM-W3-1", title: "Макеты клиенту" },
      { code: "AM-W3-2", title: "Вторая новость" },
      { code: "AM-W3-3", title: "Акции" },
      { code: "AM-W3-4", title: "Сдать на проверку" },
      { code: "AM-W4-2", title: "Публикации в потолке" },
      { code: "AM-W4-3", title: "Правки после проверки" },
    ],
  },
  {
    id: "reklama",
    title: "Реклама",
    line: "Робот покажет запуск в Яндекс Бизнесе, актуальность объявлений и что улучшить исполнителю.",
    checks: [
      { code: "PM-11", title: "Рекламные кампании в профиле" },
      { code: "SP-ADS", title: "Реклама по запросу" },
    ],
  },
  {
    id: "obshchenie",
    title: "Общение с клиентом",
    line: "Робот покажет тон и ответы в чате Битрикса и запрос оценки после срока работ.",
    checks: [
      { code: "ALL-1", title: "Ответ клиенту" },
      { code: "ALL-2", title: "Чужой канал и личный номер" },
      { code: "AM-D0-2", title: "Приветствие" },
      { code: "AM-D0-3", title: "Бриф" },
      { code: "AM-D0-4", title: "Где общаться" },
      { code: "AM-W1-1", title: "Доступ или новая точка" },
      { code: "AM-W4-1", title: "Статистика клиенту" },
      { code: "AM-W4-4", title: "Окончание" },
      { code: "SP-D0-2", title: "Приветствие поддержки" },
      { code: "SP-M-1", title: "Месячная статистика" },
    ],
  },
  {
    id: "otzyvy",
    title: "Отзывы",
    line: "Робот покажет по клиенту, сколько отзывов заказано, накручено, осталось и что оплачено.",
    checks: [
      { code: "PM-10", title: "Ответы на отзывы за два года" },
      { code: "AM-W2-4", title: "Отзывы" },
      { code: "AM-W4-5", title: "Оценка" },
      { code: "SP-W-2", title: "Новые отзывы" },
      { code: "SP-W-3", title: "Негатив" },
      { code: "SP-M-2", title: "Оценка за месяц" },
    ],
  },
  {
    id: "dopy",
    title: "Допы",
    line: "Робот покажет, кто какую услугу предложил, какой был ответ и как её продать этому клиенту.",
    checks: [
      { code: "AM-W4-6", title: "Дополнительная услуга" },
      { code: "SP-M-3", title: "Дополнительная услуга за месяц" },
    ],
  },
];
