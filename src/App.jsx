import { useEffect, useState } from "react";
import { disconnectedLine, emptyState, sections } from "./content.js";

function sectionFromHash() {
  const id = window.location.hash.replace(/^#/, "");
  return sections.some((section) => section.id === id) ? id : sections[0].id;
}

function connectionLine(bitrix) {
  if (bitrix.connected) return "Битрикс подключён.";
  if (bitrix.unavailable) return "Битрикс не ответил.";
  return disconnectedLine;
}

function clientNote(bitrix) {
  if (bitrix.connected && bitrix.deals.length === 0) return "Сделок в Битриксе нет.";
  if (bitrix.unavailable) return "Сделки не получены.";
  return emptyState;
}

export default function App() {
  const [currentId, setCurrentId] = useState(sectionFromHash);
  const [bitrix, setBitrix] = useState({
    connected: false,
    unavailable: false,
    deals: [],
  });

  useEffect(() => {
    const onHashChange = () => setCurrentId(sectionFromHash());
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

  function openSection(id) {
    if (window.location.hash !== `#${id}`) {
      window.location.hash = id;
    }
    setCurrentId(id);
  }

  const showDeals = section.id === "oformlenie" && bitrix.connected && bitrix.deals.length > 0;

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

          {section.checks ? (
            <section className="card" aria-label="С чего начать">
              <h2 className="card-title">С чего начать</h2>
              <ul className="checks">
                {section.checks.map((check) => (
                  <li key={check.code} className="check">
                    <span className="check-code">{check.code}</span>
                    <span className="check-title">{check.title}</span>
                    <span className="pill">Нет данных</span>
                  </li>
                ))}
              </ul>
              <p className="rule">Нет следа в Битриксе — «Нет данных», не «Не сделано».</p>
            </section>
          ) : null}

          {showDeals ? (
            <div className="deals">
              {bitrix.deals.map((deal, index) => (
                <article className="card deal" key={deal.id || `deal-${index}`}>
                  <h2 className="deal-title">{deal.title || "Без названия"}</h2>
                  <dl className="deal-meta">
                    <div>
                      <dt>Стадия</dt>
                      <dd>{deal.stage || "Нет данных"}</dd>
                    </div>
                    <div>
                      <dt>Ответственный</dt>
                      <dd>{deal.assignee || "Нет данных"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <section className="card empty-card">
              <p>{clientNote(section.id === "oformlenie" ? bitrix : { connected: false, deals: [] })}</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
