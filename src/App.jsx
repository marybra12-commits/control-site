import { useEffect, useState } from "react";
import { adsNote, disconnectedLine, emptyState, noData, reviewClients, reviewGap, sections } from "./content.js";

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

function dealsForSection(section, deals) {
  if (section.id === "reklama" || section.id === "otzyvy") return [];
  if (section.funnel) return deals.filter((deal) => deal.funnel === section.funnel);
  return deals;
}

function knownLink(deals, organization) {
  const needle = organization.trim().toLowerCase();
  const deal = deals.find((item) => String(item.title || "").trim().toLowerCase() === needle);
  const link = typeof deal?.link === "string" ? deal.link.trim() : "";
  if (!link || link === noData) return noData;
  return link;
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

function ReviewsTable({ deals }) {
  return (
    <section className="card reviews-card" aria-label="Отзывы">
      <div className="reviews-scroll">
        <table className="reviews">
          <thead>
            <tr>
              <th>Организация</th>
              <th>Ссылка на профиль</th>
              <th>Заказано</th>
              <th>Даты</th>
              <th>Скриншот</th>
              <th>Получено</th>
              <th>Оплата</th>
              <th>Остаток</th>
            </tr>
          </thead>
          <tbody>
            {reviewClients.map((client) => (
              <tr key={client.id}>
                <td>{client.organization}</td>
                <td>{dealLink(knownLink(deals, client.organization))}</td>
                <td>{client.purchased}</td>
                <td>{client.dates}</td>
                <td className="reviews-facts">{client.facts}</td>
                <td>{client.received}</td>
                <td>{client.payment}</td>
                <td>{client.remainder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="reviews-note">{reviewGap}</p>
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

  return (
    <article className="card deal">
      <button type="button" className="back" onClick={onBack}>К списку</button>
      <h2 className="deal-title">{deal.title || "Без названия"}</h2>
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
      {report ? (
        <div className="table-scroll">
          <table className="work-table">
            <caption>Что страдает по регламенту. Сверка каждый час: сделка, Карты и переписка.</caption>
            <thead>
              <tr>
                <th>Где застряло</th>
                <th>Сделано</th>
                <th>Чего нет</th>
                <th>Что сказать менеджеру</th>
                <th>Почему отстали</th>
              </tr>
            </thead>
            <tbody>
              {report.map((item) => {
                const key = `report:${item.title}`;
                const opened = openProof === key;
                const proven = item.status === "Сделано" && item.proof;
                return (
                  <tr key={item.title}>
                    <td>{item.stuck || noData}</td>
                    <td className="done-cell">
                      {item.state ? <Mark closed={item.state === "closed"} /> : null}
                      {proven ? (
                        <button
                          type="button"
                          className="done-button"
                          aria-expanded={opened}
                          onClick={() => setOpenProof(opened ? "" : key)}
                        >
                          Сделано
                        </button>
                      ) : null}
                      {opened ? <p className="proof-line">{item.proof}</p> : null}
                    </td>
                    <td>{item.missing || noData}</td>
                    <td>{item.say || noData}</td>
                    <td>{item.why || noData}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {stageNote && report ? <p className="stage-line">{stageNote}</p> : null}
      {report && talk.length > 0 ? (
        <section className="panel" aria-label="Переписка">
          <h3>Переписка</h3>
          <dl className="panel-rows">
            {talk.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
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

          {section.id === "reklama" ? (
            <section className="card empty-card">
              <p>{adsNote}</p>
            </section>
          ) : showReviews ? (
            <ReviewsTable deals={bitrix.deals} />
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
