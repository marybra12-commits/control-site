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

function DealDetail({ section, deal, onBack }) {
  const checks = checklist(section, deal);
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
      </dl>
      {checks.length > 0 ? (
        <ul className="checks">
          {checks.map((check) => (
            <li key={check.code} className="check">
              <span className="check-code">{check.code}</span>
              <span className="check-title">
                {check.title}
                {check.status === "Сделано" && check.proof ? <span className="check-proof">{check.proof}</span> : null}
                {check.status === "Сделано" && check.image ? <img className="check-shot" alt="" src={check.image} /> : null}
              </span>
              <span className={check.status === "Сделано" ? "pill pill-done" : "pill"}>{check.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {deal.finishBy ? <p className="rule">Оформление сдать в течение месяца от старта, до {deal.finishBy}.</p> : null}
      {deal.brief ? <p className="rule">Бриф: {deal.brief}</p> : null}
      <p className="rule">Чеклист обновляется каждый час. Зелёным только шаг, у которого есть текст или снимок.</p>
      <p className="rule">Нет следа в Битриксе — «Нет данных», не «Не сделано».</p>
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

function clientNote(bitrix) {
  if (bitrix.pending) return "Читаем сделки из Битрикса…";
  if (bitrix.connected && bitrix.deals.length === 0) return "Сделок в Битриксе нет.";
  if (bitrix.unavailable) return "Сделки не получены.";
  return emptyState;
}

export default function App() {
  const [currentId, setCurrentId] = useState(sectionFromHash);
  const [openDealId, setOpenDealId] = useState(null);
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
  const openDeal = sectionDeals.find((deal, index) => dealKey(deal, index) === openDealId) ?? null;

  function openSection(id) {
    if (window.location.hash !== `#${id}`) {
      window.location.hash = id;
    }
    setCurrentId(id);
    setOpenDealId(null);
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
            <DealDetail section={section} deal={openDeal} onBack={() => setOpenDealId(null)} />
          ) : showDeals ? (
            <DealCards deals={sectionDeals} onOpen={setOpenDealId} />
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
