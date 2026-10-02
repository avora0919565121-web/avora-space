import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { POLICY_DOCS, POLICY_DRAFT_NOTE, POLICY_VERSION, type PolicyDoc, type PolicyItem, type PolicySection } from "@/lib/policy-content";
import { cn } from "@/lib/utils";

/** `Đã thực hiện` (✓, bold) · `Sắp có` (muted) — small words at the end of the line, no new colours. */
function Status({ item }: { item: PolicyItem }) {
  if (item.status === "done") {
    return (
      <span className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap text-[12px] font-semibold text-foreground" data-status="done">
        <Check className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
        Đã thực hiện
      </span>
    );
  }
  if (item.status === "soon") return <span className="ml-1.5 whitespace-nowrap text-[12px] text-muted-foreground/80" data-status="soon">Sắp có</span>;
  return null;
}

/** Backticks mark UI words (`Khoá thiết bị`) — shown in bold, never as code. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function Section({ section, openTech }: { section: PolicySection; openTech: boolean }) {
  const [isTech, setIsTech] = useState<boolean>(openTech);
  useEffect(() => setIsTech(openTech), [openTech]);
  return (
    <section id={section.id} className="scroll-mt-28 border-t border-border pt-6 first:border-t-0 first:pt-0" data-policy-section={section.id}>
      <h3 className="text-[17px] font-semibold tracking-tight text-foreground">{section.title}</h3>
      <ul className="mt-3 space-y-2.5">
        {section.items.map((item) => (
          <li key={item.id} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground">
            <span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
            <span>
              <Words text={item.text} />
              <Status item={item} />
            </span>
          </li>
        ))}
      </ul>
      {section.table !== undefined ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-left text-[13.5px]">
            <thead className="bg-secondary/50">
              <tr>{section.table.head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {section.table.rows.map((row) => (
                <tr key={row[0]}>{row.map((cell, i) => <td key={i} className={cn("px-3 py-2 align-top", i === 0 && "font-medium")}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {section.readyNote !== undefined ? (
        <p className="mt-4 rounded-lg bg-secondary/50 px-4 py-3 text-[14px] leading-relaxed text-foreground" data-ready-note="">
          <strong className="font-semibold">Dùng khi bạn sẵn sàng:</strong> {section.readyNote}
        </p>
      ) : null}
      {section.technical !== undefined ? (
        <div className="mt-3">
          <button type="button" onClick={() => setIsTech((v) => !v)} aria-expanded={isTech} className="press inline-flex min-h-10 items-center gap-1 text-[13.5px] font-medium text-muted-foreground hover:text-foreground">
            Xem chi tiết kỹ thuật
            <ChevronDown className={cn("h-4 w-4 transition-transform", isTech && "rotate-180")} aria-hidden="true" />
          </button>
          {isTech ? (
            <ul className="mt-1 space-y-1.5 border-l-2 border-border pl-4" data-policy-tech={section.id}>
              {section.technical.map((line) => (
                <li key={line} className="text-[13.5px] leading-relaxed text-muted-foreground"><Words text={line} /></li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * AVORA-66 (ADR-040) — the policy set. One component for Cài đặt › Chính sách and the public
 * `/chinh-sach`. Desktop: a contents column on the left; phone: a sliding row of chips. Anchors
 * (`#ket-sat`) open the right document and scroll there; `?chi-tiet=1` opens every technical layer.
 */
export function PolicyView({ isPublic = false }: { isPublic?: boolean }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const hash = location.hash.replace("#", "");
  const docOfHash = POLICY_DOCS.find((d) => d.id === hash || d.sections.some((s) => s.id === hash));
  const [docId, setDocId] = useState<string>(docOfHash?.id ?? POLICY_DOCS[0].id);
  const doc: PolicyDoc = POLICY_DOCS.find((d) => d.id === docId) ?? POLICY_DOCS[0];
  const openTech = params.get("chi-tiet") === "1";

  useEffect(() => {
    if (docOfHash !== undefined) setDocId(docOfHash.id);
    if (hash === "") return;
    const timer = window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 60);
    return () => window.clearTimeout(timer);
    // Only when the address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const jump = (id: string): void => {
    window.history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className={cn("paper min-h-0 flex-1 overflow-y-auto", isPublic && "min-h-[100dvh]")} data-policy-view={isPublic ? "public" : "settings"}>
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 md:px-10 md:pt-10">
        {isPublic ? <span className="wordmark text-[15px] text-muted-foreground">AVORA</span> : null}
        <h1 className={cn("text-[26px] font-semibold tracking-tight text-foreground", isPublic && "mt-4")}>Chính sách</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Cập nhật lần cuối: {POLICY_VERSION} · {POLICY_DRAFT_NOTE}</p>

        <div role="tablist" aria-label="Bộ chính sách" className="mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {POLICY_DOCS.map((d) => (
            <button key={d.id} type="button" role="tab" aria-selected={d.id === doc.id} onClick={() => { setDocId(d.id); window.history.replaceState(null, "", `${location.pathname}${location.search}#${d.id}`); }} className={cn("press h-10 shrink-0 rounded-full border px-4 text-[13.5px] font-medium", d.id === doc.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground")}>
              {d.title}
            </button>
          ))}
        </div>

        <div className="mt-6 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
          {doc.sections.length > 1 ? (
            <>
              <nav aria-label="Mục lục" className="sticky top-0 hidden self-start md:block">
                <ul className="space-y-0.5 border-l border-border">
                  {doc.sections.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => jump(s.id)} className={cn("press -ml-px block w-full border-l-2 py-1.5 pl-3 text-left text-[13.5px]", hash === s.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="-mx-5 mb-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:hidden" data-policy-chips="">
                {doc.sections.map((s) => (
                  <button key={s.id} type="button" onClick={() => jump(s.id)} className="press h-9 shrink-0 rounded-full bg-secondary/70 px-3.5 text-[13px] text-foreground">
                    {s.title.replace(/^[A-I]\.\s/, "")}
                  </button>
                ))}
              </div>
            </>
          ) : <div className="hidden md:block" />}
          <div className="space-y-6">
            {doc.sections.map((s) => <Section key={s.id} section={s} openTech={openTech} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
