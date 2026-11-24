import { useEffect, useState } from "react";
import { adsNote, disconnectedLine, doneLabel, emptyState, events, noData, overdueItems, reviewClients, reviewSource, sections, trends } from "./content.js";

function sectionFromHash() {
  const id = window.location.hash.replace(/^#/, "").split("/")[0];
  return sections.some((section) => section.id === id) ? id : sections[0].id;
}

function connectionLine(bitrix) {
  if (bitrix.pending) return "Читаем Битрикс…";
  if (bitrix.connected) return "Битрикс подключён.";
  if (bitrix.unavailable) return "Битрикс не ответил.";
  return disconnectedLine;
}

function dealLink(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === noData) return noData;
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return <a className="deal-link" href={url.href} rel="noopener noreferrer">{text}</a>;
    }
  } catch {
    // Plain text stays text.
  }
  return text;
}

function dealKey(deal, index) {
  return deal.id || `deal-${index}`;
}

function readStage(key) {
  try {
    return localStorage.getItem(key) === "review" ? "review" : "work";
  } catch {
    return "work";
  }
}

function keepStage(key, stage) {
  try {
    localStorage.setItem(key, stage);
  } catch {
    // The button still switches the open card.
  }
}

function dealsForSection(section, deals) {
  if (section.id === "reklama" || section.id === "otzyvy" || section.id === "tendentsii" || section.id === "meropriyatiya") return [];
  if (section.funnel) return deals.filter((deal) => deal.funnel === section.funnel);
  return deals;
}

function safeShot(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\//i.test(text) || text.toLowerCase().includes("/rest/")) return "";
  return text;
}

const pilotSteps = [
  { code: "AM-D0-2", title: "Приветствие" },
  { code: "AM-D0-3", title: "Бриф" },
  { code: "AM-D0-4", title: "Где общаться" },
  { code: "AM-W1-1", title: "Доступ или новая точка" },
  { code: "AM-W1-4", title: "Материалы и ТЗ дизайнеру" },
];

function checklist(section, deal) {
  const steps = [...(section.checks || [])];
  if (deal.pilot) {
    for (const step of pilotSteps) {
      if (!steps.some((item) => item.code === step.code)) steps.push(step);
    }
  }
  return steps.map((check) => {
    const mark = deal.marks?.[check.code];
    const proof = mark && typeof mark === "object" ? String(mark.proof || "").trim() : "";
    const image = mark && typeof mark === "object" ? safeShot(mark.image) : "";
    const done = Boolean(proof || image);
    return {
      code: check.code,
      title: check.title,
      status: done ? "Сделано" : noData,
      proof: done ? proof : "",
      image: done ? image : "",
    };
  });
}

function Events() {
  return (
    <ul className="trends">
      {events.map((event) => (
        <li key={event.href} className="card trend">
          <p className="trend-date">{event.city} · {event.date}</p>
          <h2 className="trend-title">{event.title}</h2>
          <p className="trend-summary">{event.summary}</p>
          <a className="trend-source" href={event.href} target="_blank" rel="noreferrer">
            {event.source}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Trends() {
  return (
    <ul className="trends">
      {trends.map((article) => (
        <li key={article.href} className="card trend">
          <p className="trend-date">{article.date}</p>
          <h2 className="trend-title">{article.title}</h2>
          <p className="trend-summary">{article.summary}</p>
          <a className="trend-source" href={article.href} target="_blank" rel="noreferrer">
            {article.source}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ShotList({ shots }) {
  if (!Array.isArray(shots) || shots.length === 0) return noData;
  return (
    <ul className="shot-list">
      {shots.map((shot) => (
        <li key={`${shot.account}:${shot.received}:${shot.date}`}>
          <p><span>Дата</span> {shot.date || noData}</p>
          <p><span>Аккаунт</span> {shot.account || noData}</p>
          <p><span>Получено</span> {shot.received || noData}</p>
          {shot.note ? <p>{shot.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function ReviewsTable({ clients, error, pending, truncated }) {
  const rows = clients.length > 0 ? clients : reviewClients;
  const note = [
    pending ? "Читаем переписку «Максим Отзывы»…" : "",
    error || "",
    truncated ? "Показана не вся переписка." : "",
    reviewSource,
  ].filter(Boolean).join(" ");
  return (
    <section className="card reviews-card" aria-label="Отзывы">
      <div className="reviews-scroll">
        <table className="reviews">
          <thead>
            <tr>
              <th>Организация</th>
              <th>Ссылка</th>
              <th>Заказано</th>
              <th>Скриншоты</th>
              <th>Остаток</th>
              <th>Оплата</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => (
              <tr key={client.id}>
                <td>{client.organization}</td>
                <td>{dealLink(client.link || noData)}</td>
                <td>{client.purchased || noData}</td>
                <td className="reviews-facts"><ShotList shots={client.shots} /></td>
                <td>{client.remainder || noData}</td>
                <td className="reviews-pay">
                  <p>{client.payment || noData}</p>
                  {client.paymentNote ? <p className="reviews-sub">{client.paymentNote}</p> : null}
                </td>
                <td>{client.status || noData}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="reviews-note">{note}</p>
    </section>
  );
}

function Mark({ closed }) {
  return (
    <span className={closed ? "mark mark-done" : "mark"} aria-label={closed ? "Закрыт" : "Открыт"}>
      {closed ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.2 8.2 6.4 11.3 12.8 4.7" />
        </svg>
      ) : null}
    </span>
  );
}

function CheckList({ items, openProof, setOpenProof }) {
  return (
    <ul className="status-checks">
      {items.map((item) => {
        const key = `${item.title}:${item.doneOn || ""}`;
        const opened = openProof === key;
        const proven = item.status === "Сделано" && item.proof;
        return (
          <li key={key}>
            <Mark closed={item.status === "Сделано"} />
            <span className="check-title">{item.title}</span>
            {proven ? (
              <button
                type="button"
                className="done-button"
                aria-expanded={opened}
                onClick={() => setOpenProof(opened ? "" : key)}
              >
                {doneLabel(item)}
              </button>
            ) : null}
            {item.status === "Не сделано" ? <span className="miss-button">Не сделано</span> : null}
            {!proven && item.status !== "Не сделано" ? <span className="pill">{noData}</span> : null}
            {item.doneOn ? <p className="check-note">{item.doneOn}</p> : null}
            {item.firstNews ? <p className="check-note">Первая новость: «{item.firstNews}»</p> : null}
            {opened ? <p className="proof-line">{item.proof}</p> : null}
            {item.status === "Не сделано" && item.missing ? <p className="check-note">{item.missing}</p> : null}
            {item.overdue && item.due ? <p className="check-note">Просрочено, срок был {item.due}.</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function WeekPlan({ plan, openProof, setOpenProof }) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const rest = Array.isArray(plan?.rest) ? plan.rest : [];
  return (
    <section className="panel week-plan" aria-label="План месяца">
      <h3>План месяца</h3>
      <p className="week-anchor">{plan?.anchorNote || noData}</p>
      {weeks.map((week) => (
        <section key={week.week} className="week-block" aria-label={week.title}>
          <h4>{week.title}{week.due ? ` · срок ${week.due}` : ""}</h4>
          <CheckList items={week.steps || []} openProof={openProof} setOpenProof={setOpenProof} />
        </section>
      ))}
      {rest.length > 0 ? (
        <section className="week-block" aria-label="Без недели в регламенте">
          <h4>Без недели в регламенте</h4>
          <CheckList items={rest} openProof={openProof} setOpenProof={setOpenProof} />
        </section>
      ) : null}
    </section>
  );
}

function stageProblem(deal) {
  const fit = deal.stageFit;
  if (!fit || fit.state === "right") return "";
  const expected = fit.expected || "взято в работу";
  if (fit.state === "missing" || !fit.stage) return `Стадия не указана. Для этого срока нужна «${expected}».`;
  return `Стадия «${fit.stage}». Для этого срока нужна «${expected}».`;
}

function DealDetail({ section, deal, onBack }) {
  const checks = checklist(section, deal);
  const [openProof, setOpenProof] = useState("");
  const stageKey = `control-stage:${deal.id || deal.title || "deal"}`;
  const [workStage, setWorkStage] = useState(() => readStage(stageKey));
  useEffect(() => {
    setWorkStage(readStage(stageKey));
  }, [stageKey]);
  const oformlenie = deal.funnel === "oformlenie" || section?.funnel === "oformlenie";
  const review = Array.isArray(deal.review) ? deal.review : [];
  const late = deal.pilot && deal.late && typeof deal.late === "object" ? deal.late : {};
  const rows = checks.map((check) => ({
    ...check,
    due: typeof late[check.code] === "string" ? late[check.code] : "",
    behind: Boolean(late[check.code]) && check.status !== "Сделано",
  }));
  const stageNote = deal.pilot ? stageProblem(deal) : "";
  const behind = rows.filter((check) => check.behind);
  const checklistItems = Array.isArray(deal.checklist) ? deal.checklist : null;
  const report = Array.isArray(deal.report) ? deal.report : null;
  const talk = [
    ["Тон клиента", deal.dialog?.clientTone],
    ["Как отвечает", deal.dialog?.replies],
    ["Тон менеджера", deal.dialog?.managerTone],
  ].filter(([, value]) => value && value !== noData);
  const dialogRows = [
    ["О чём говорили", deal.dialog?.about],
    ["Тон менеджера", deal.dialog?.managerTone],
    ["Вопрос без ответа", deal.dialog?.unanswered],
  ].filter(([, value]) => value && value !== noData);
  const offer = deal.offer === "/kp-rakovy-dvor.html" ? deal.offer : "";

  return (
    <article className="card deal">
      <button type="button" className="back" onClick={onBack}>К списку</button>
      <h2 className="deal-title">{deal.title || "Без названия"}</h2>
      {oformlenie ? (
        <div className="stage-switch" role="group" aria-label="Стадия сделки">
          <button
            type="button"
            aria-pressed={workStage === "work"}
            onClick={() => {
              setWorkStage("work");
              keepStage(stageKey, "work");
            }}
          >
            Работа ведётся
          </button>
          <button
            type="button"
            aria-pressed={workStage === "review"}
            onClick={() => {
              setWorkStage("review");
              keepStage(stageKey, "review");
            }}
          >
            Перешёл на проверку
          </button>
        </div>
      ) : null}
      {oformlenie && workStage === "review" ? (
        <section className="panel review-panel" aria-label="Проверка">
          <h3>Проверка</h3>
          {review.length > 0 ? (
            <ol className="review-thread">
              {review.map((item) => (
                <li key={`${item.place}:${item.wrong || item.change}`}>
                  <p className="review-place">{item.place}</p>
                  {item.wrong ? <p className="review-change">Сейчас: {item.wrong}</p> : null}
                  <p className="review-change">{item.late ? "Позже плана: " : "Замените: "}{item.change}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="review-change">По этой карточке список правок пуст.</p>
          )}
        </section>
      ) : null}
      <dl className="deal-meta">
        <div>
          <dt>Период</dt>
          <dd>{deal.period || noData}</dd>
        </div>
        <div>
          <dt>Ссылка</dt>
          <dd>{dealLink(deal.link)}</dd>
        </div>
        <div>
          <dt>Адрес</dt>
          <dd>{deal.address || noData}</dd>
        </div>
        <div>
          <dt>Ответственная</dt>
          <dd>{deal.assignee || noData}</dd>
        </div>
        <div>
          <dt>Стадия</dt>
          <dd>{deal.stage || noData}</dd>
        </div>
        {deal.pipeline ? (
          <div>
            <dt>Воронка</dt>
            <dd>{deal.pipeline}</dd>
          </div>
        ) : null}
      </dl>
      {offer ? (
        <p className="offer-line">
          <a className="offer-link" href={offer} download="Коммерческое-предложение-Раковый-двор.html">Скачать коммерческое предложение</a>
        </p>
      ) : null}
      {report ? (
        <>
          {report.length > 0 && report.every((item) => item.status === "Сделано") ? (
            <p className="stuck-banner ready-banner">Карточка готова к проверке.</p>
          ) : overdueItems(report).length > 0 ? (
            <div className="stuck-banner">
              <p>Застряло</p>
              <ul className="stuck-list">
                {overdueItems(report).map((item) => (
                  <li key={item.title}>{item.say || item.missing || item.title}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="stuck-banner stuck-clear">Застрявших пунктов нет.</p>
          )}
          {talk.length > 0 ? (
            <p className="talk-line">{talk.map(([label, value]) => `${label}: ${value}`).join(". ")}.</p>
          ) : null}
          {deal.plan?.weeks?.length ? (
            <WeekPlan plan={deal.plan} openProof={openProof} setOpenProof={setOpenProof} />
          ) : (
            <section className="panel" aria-label="Чек-лист">
              <h3>Чек-лист</h3>
              <CheckList items={report} openProof={openProof} setOpenProof={setOpenProof} />
            </section>
          )}
        </>
      ) : null}
      {stageNote && report ? <p className="stage-line">{stageNote}</p> : null}
      {report && (dialogRows.length > 0 || talk.length > 0) ? (
        <section className="panel" aria-label="Переписка">
          <h3>Переписка</h3>
          <dl className="panel-rows dialog-rows">
            {(dialogRows.length > 0 ? dialogRows : talk).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            {dialogRows.length > 0 ? talk.filter(([label]) => !dialogRows.some(([name]) => name === label)).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            )) : null}
          </dl>
        </section>
      ) : null}
      {deal.pilot && !report ? (
        <>
          <section className="panel" aria-label="Статус">
            <h3>Статус</h3>
            <dl className="panel-rows">
              <div>
                <dt>Ответственная</dt>
                <dd>{deal.assignee || noData}</dd>
              </div>
              <div>
                <dt>Стадия</dt>
                <dd>{deal.stage || noData}</dd>
              </div>
              <div>
                <dt>Для срока</dt>
                <dd>
                  {deal.stageFit?.state === "right"
                    ? `Подходит. Ориентир: «${deal.stageFit.expected}».`
                    : stageNote || noData}
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel" aria-label="Чек-лист">
            <h3>Чек-лист</h3>
            {checklistItems === null ? <p className="panel-empty">{noData}</p> : null}
            {checklistItems && checklistItems.length === 0 ? <p className="panel-empty">Чек-листов в Битриксе нет.</p> : null}
            {checklistItems && checklistItems.length > 0 ? (
              <ul className="bitrix-checks">
                {checklistItems.map((item) => (
                  <li key={`${item.title}-${item.state}`}>
                    <Mark closed={item.state === "closed"} />
                    <span className="check-title">{item.title || "Пункт"}</span>
                    <span className="row-person">{item.assignee || noData}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section className="panel" aria-label="Переписка">
            <h3>Переписка</h3>
            <dl className="panel-rows">
              <div>
                <dt>Тон клиента</dt>
                <dd>{deal.dialog?.clientTone || noData}</dd>
              </div>
              <div>
                <dt>Как отвечает</dt>
                <dd>{deal.dialog?.replies || noData}</dd>
              </div>
              <div>
                <dt>Тон менеджера</dt>
                <dd>{deal.dialog?.managerTone || noData}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : null}
      {!report && (behind.length > 0 || stageNote) ? (
        <section className="behind" aria-label="Где клиент отстаёт">
          <h3>Где клиент отстаёт</h3>
          <ul>
            {behind.map((check) => (
              <li key={check.code}>{check.code}. {check.title}. Срок был {check.due}. {noData}</li>
            ))}
            {stageNote ? <li>{stageNote}</li> : null}
          </ul>
        </section>
      ) : null}
      {!report && rows.length > 0 ? (
        <ul className="checks">
          {rows.map((check) => {
            const opened = openProof === check.code;
            return (
              <li key={check.code} className={check.behind ? "check check-late" : "check"}>
                <span className="check-code">{check.code}</span>
                <span className="check-title">
                  {check.title}
                  {check.behind ? <span className="late-tag">Просрочено, срок был {check.due}</span> : null}
                </span>
                {check.status === "Сделано" ? (
                  <button
                    type="button"
                    className="done-button"
                    aria-expanded={opened}
                    onClick={() => setOpenProof(opened ? "" : check.code)}
                  >
                    Сделано
                  </button>
                ) : (
                  <span className="pill">{noData}</span>
                )}
                {opened ? (
                  <div className="proof-panel">
                    {check.proof ? <p>{check.proof}</p> : null}
                    {check.image ? <img className="check-shot" alt="" src={check.image} /> : null}
                    {!check.proof && !check.image ? <p>{noData}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {deal.finishBy && deal.finishBy !== noData ? <p className="rule">Сдать до {deal.finishBy}.</p> : null}
      {deal.brief && deal.brief !== noData ? <p className="rule">Бриф: {deal.brief}</p> : null}
      {report ? null : <p className="rule">Нет следа в Битриксе — «Нет данных». Кнопка «Сделано» есть только там, где след есть.</p>}
    </article>
  );
}

function DealCards({ deals, onOpen }) {
  return (
    <div className="deals">
      {deals.map((deal, index) => (
        <article className="card deal" key={dealKey(deal, index)}>
          <button type="button" className="deal-open" onClick={() => onOpen(dealKey(deal, index))}>
            <span className="deal-title">{deal.title || "Без названия"}</span>
            {Array.isArray(deal.report) ? (
              <span className="suffering">Страдает: {deal.report.filter((item) => item.stuck && item.stuck !== "Нет" && item.stuck !== noData).length}</span>
            ) : null}
            <span className="deal-open-label">Открыть</span>
          </button>
          <dl className="deal-meta">
            <div>
              <dt>Период</dt>
              <dd>{deal.period || noData}</dd>
            </div>
            <div>
              <dt>Ссылка</dt>
              <dd>{dealLink(deal.link)}</dd>
            </div>
            <div>
              <dt>Адрес</dt>
              <dd>{deal.address || noData}</dd>
            </div>
            <div>
              <dt>Ответственная</dt>
              <dd>{deal.assignee || noData}</dd>
            </div>
            <div>
              <dt>Стадия</dt>
              <dd>{deal.stage || noData}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function foldText(value) {
  return String(value || "").toLocaleLowerCase("ru").replaceAll("ё", "е").trim();
}

function DealTools({ query, manager, managers, onQuery, onManager }) {
  return (
    <div className="deal-tools">
      <label className="tool">
        <span>Поиск</span>
        <input
          type="search"
          value={query}
          placeholder="Название сделки"
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <label className="tool">
        <span>Менеджер</span>
        <select value={manager} onChange={(event) => onManager(event.target.value)}>
          <option value="">Все</option>
          {managers.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function clientNote(bitrix) {
  if (bitrix.pending) return "Читаем сделки из Битрикса…";
  if (bitrix.connected && bitrix.deals.length === 0) return "Сделок в Битриксе нет.";
  if (bitrix.unavailable) return "Сделки не получены.";
  return emptyState;
}

export default function App() {
  const [currentId, setCurrentId] = useState(sectionFromHash);
  const [openDealId, setOpenDealId] = useState(null);
  const [query, setQuery] = useState("");
  const [manager, setManager] = useState("");
  const [bitrix, setBitrix] = useState({
    connected: false,
    unavailable: false,
    pending: true,
    deals: [],
  });
  const [reviews, setReviews] = useState({
    pending: false,
    error: "",
    clients: [],
    truncated: false,
  });

  useEffect(() => {
    const onHashChange = () => {
      setCurrentId(sectionFromHash());
      setOpenDealId(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let ignore = false;
    const load = () => {
      fetch("/api/oformlenie", { cache: "no-store", headers: { accept: "application/json" } })
        .then(async (response) => {
          const type = response.headers.get("content-type") || "";
          if (!response.ok || !type.includes("json")) throw new Error("unavailable");
          return response.json();
        })
        .then((body) => {
          if (ignore) return;
          setBitrix({
            connected: body?.connected === true,
            unavailable: body?.unavailable === true,
            pending: false,
            deals: Array.isArray(body?.deals) ? body.deals : [],
          });
        })
        .catch(() => {
          if (ignore) return;
          setBitrix({ connected: false, unavailable: true, pending: false, deals: [] });
        });
    };
    load();
    const timer = window.setInterval(load, 60 * 60 * 1000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (currentId !== "otzyvy") return undefined;
    let ignore = false;
    setReviews((current) => ({ ...current, pending: true }));
    fetch("/api/otzyvy", { cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const type = response.headers.get("content-type") || "";
        if (!response.ok || !type.includes("json")) throw new Error("unavailable");
        return response.json();
      })
      .then((body) => {
        if (ignore) return;
        const error = typeof body?.error === "string" ? body.error.replace(/https?:\/\/\S+/gi, "").trim() : "";
        setReviews({
          pending: false,
          error,
          clients: Array.isArray(body?.clients) ? body.clients : [],
          truncated: body?.truncated === true,
        });
      })
      .catch(() => {
        if (ignore) return;
        setReviews({ pending: false, error: "Bitrix не ответил", clients: [], truncated: false });
      });
    return () => {
      ignore = true;
    };
  }, [currentId]);

  const section = sections.find((item) => item.id === currentId) ?? sections[0];
  const sectionDeals = dealsForSection(section, bitrix.deals);
  const managers = [...new Set(sectionDeals.map((deal) => deal.assignee).filter((name) => name && name !== noData))]
    .sort((left, right) => left.localeCompare(right, "ru"));
  const needle = foldText(query);
  const visibleDeals = sectionDeals.filter((deal) => {
    if (needle && !foldText(deal.title).includes(needle)) return false;
    if (manager && deal.assignee !== manager) return false;
    return true;
  });
  const openDeal = visibleDeals.find((deal, index) => dealKey(deal, index) === openDealId)
    ?? sectionDeals.find((deal, index) => dealKey(deal, index) === openDealId)
    ?? null;

  function openSection(id) {
    if (window.location.hash !== `#${id}`) {
      window.location.hash = id;
    }
    setCurrentId(id);
    setOpenDealId(null);
    setQuery("");
    setManager("");
  }

  const showReviews = section.id === "otzyvy";
  const showDetail = !showReviews && Boolean(openDeal);
  const showDeals = !showReviews && !showDetail && bitrix.connected && sectionDeals.length > 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="site-title">Система контроля</p>
          <p className="connection">{connectionLine(bitrix)}</p>
        </div>
        <nav className="tabs" aria-label="Разделы">
          {sections.map((item) => {
            const selected = item.id === section.id;
            return (
              <button
                key={item.id}
                type="button"
                className="tab"
                aria-current={selected ? "page" : undefined}
                onClick={() => openSection(item.id)}
              >
                {item.title}
              </button>
            );
          })}
        </nav>
        <p className="wordmark">Meta Group</p>
      </aside>

      <main className="main">
        <div className="content">
          <header className="page-head">
            <h1 className="section-title">{section.title}</h1>
            <p className="line">{section.line}</p>
          </header>

          {section.id === "tendentsii" ? (
            <Trends />
          ) : section.id === "meropriyatiya" ? (
            <Events />
          ) : section.id === "reklama" ? (
            <section className="card empty-card">
              <p>{adsNote}</p>
            </section>
          ) : showReviews ? (
            <ReviewsTable
              clients={reviews.clients}
              error={reviews.error}
              pending={reviews.pending}
              truncated={reviews.truncated}
            />
          ) : showDetail ? (
            <DealDetail key={openDealId} section={section} deal={openDeal} onBack={() => setOpenDealId(null)} />
          ) : showDeals ? (
            <>
              <DealTools
                query={query}
                manager={managers.includes(manager) ? manager : ""}
                managers={managers}
                onQuery={setQuery}
                onManager={setManager}
              />
              {visibleDeals.length > 0 ? (
                <DealCards deals={visibleDeals} onOpen={setOpenDealId} />
              ) : (
                <section className="card empty-card">
                  <p>Таких сделок нет.</p>
                </section>
              )}
            </>
          ) : (
            <section className="card empty-card">
              <p>{sectionDeals.length === 0 && bitrix.connected ? "Сделок в Битриксе нет." : clientNote(bitrix)}</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
