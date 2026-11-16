import { useEffect, useState } from "react";
import { disconnectedLine, emptyState, noData, reviewClients, reviewGap, sections } from "./content.js";

function sectionFromHash() {
  const id = window.location.hash.replace(/^#/, "").split("/")[0];
  return sections.some((section) => section.id === id) ? id : sections[0].id;
}

function connectionLine(bitrix) {
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
  if (!section.funnel) return deals;
  const matched = deals.filter((deal) => deal.funnel === section.funnel);
  const classified = deals.some((deal) => deal.funnel === "oformlenie" || deal.funnel === "podderzhka");
  return classified ? matched : deals;
}

function knownLink(deals, organization) {
  const needle = organization.trim().toLowerCase();
  const deal = deals.find((item) => String(item.title || "").trim().toLowerCase() === needle);
  const link = typeof deal?.link === "string" ? deal.link.trim() : "";
  if (!link || link === noData) return noData;
  return link;
}

function checklist(section, deal) {
  return (section.checks || []).map((check) => ({
    code: check.code,
    title: check.title,
    status: deal.marks?.[check.code] || noData,
  }));
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
              <span className="check-title">{check.title}</span>
              <span className={check.status === "Сделано" ? "pill pill-done" : "pill"}>{check.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
    const controller = new AbortController();
    fetch("/api/oformlenie", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        setBitrix({
          connected: body?.connected === true,
          unavailable: body?.unavailable === true,
          deals: Array.isArray(body?.deals) ? body.deals : [],
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setBitrix({ connected: false, unavailable: false, deals: [] });
      });
    return () => controller.abort();
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

          {showReviews ? (
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
