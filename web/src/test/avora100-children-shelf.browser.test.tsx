import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { vi } from "vitest";

import "@/index.css";

/* AVORA-100 · S.2 §4.4 — Tủ sách tuổi thơ (84.15 · 84.17). Catalogue rows are fixed; no network. */
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/use-book-covers", () => ({ useShelfCatalog: () => new Map() }));
vi.mock("@/lib/book-catalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/book-catalog")>();
  const book = (source: "gutenberg" | "wikisource" | "gdl", sourceId: string, title: string, titleVi: string | null, language: "en" | "vi", authors: string) => ({
    source, sourceId, title, titleVi, titleViKind: titleVi === null ? null : ("xuat_ban" as const), authors, language, category: "thieu_nhi" as const, epubUrl: null, coverPath: null, access: "read" as const,
    credits: source === "gdl" ? { license: "CC-BY-4.0", link: null, publisher: "Room to Read", authors: ["Alisha Berger"], illustrators: ["Godwin Chipenya"], translators: [] } : null,
  });
  return {
    ...real,
    fetchChildrenShelf: async () => ({
      thieu_nhi: [
        book("wikisource", "Thơ ngụ ngôn La Fontaine (1951)", "Thơ ngụ ngôn La Fontaine", "Thơ ngụ ngôn La Fontaine", "vi", "Jean de La Fontaine; Nguyễn Văn Vĩnh (dịch)"),
        book("wikisource", "Chuyện trẻ con", "Chuyện trẻ con", "Chuyện trẻ con", "vi", "Charles Perrault; Nguyễn Văn Vĩnh (dịch)"),
        book("gutenberg", "11", "Alice's Adventures in Wonderland", "Alice ở xứ sở thần tiên", "en", "Lewis Carroll"),
        book("gutenberg", "16", "Peter Pan", null, "en", "J. M. Barrie"),
        book("gutenberg", "55", "The Wonderful Wizard of Oz", "Phù thủy xứ Oz", "en", "L. Frank Baum"),
      ],
      thieu_nien: [
        book("wikisource", "Nam Hải dị nhân liệt truyện", "Nam Hải dị nhân liệt truyện", "Nam Hải dị nhân liệt truyện", "vi", "Phan Kế Bính"),
        book("gutenberg", "113", "The Secret Garden", "Khu vườn bí mật", "en", "Frances Hodgson Burnett"),
        book("gutenberg", "120", "Treasure Island", "Đảo giấu vàng", "en", "Robert Louis Stevenson"),
        book("gutenberg", "164", "Twenty Thousand Leagues under the Sea", "Hai vạn dặm dưới biển", "en", "Jules Verne"),
      ],
      tranh: [book("gdl", "17591", "Ai có thể giúp mình nhỉ?", "Ai có thể giúp mình nhỉ?", "vi", "Komar Rien Komar Cheh")],
    }),
  };
});

import { ChildrenShelf } from "@/components/library/ChildrenShelf";
import { BOOK_CATEGORIES, CHILDREN_SHELF, catalogLink, catalogRefOf, creditLines, parseCredits } from "@/lib/book-catalog";

const OUT = "../../../docs/screens/2026-10-11";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <div className="paper min-h-[100dvh] px-4 py-4 md:px-10">{children}</div>
    </QueryClientProvider>
  );
}

const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("chip `Thiếu nhi · Thiếu niên`; tủ sách không có Hoàng tử bé; mọi tựa có nguồn rõ", () => {
  expect(BOOK_CATEGORIES.find((c) => c.id === "thieu_nhi")?.label).toBe("Thiếu nhi · Thiếu niên");
  expect(CHILDREN_SHELF.some((e) => /prince|hoàng tử bé/i.test(e.key))).toBe(false);
  expect(CHILDREN_SHELF.every((e) => /^(gutenberg:\d+|wikisource:.+)$/.test(e.key))).toBe(true);
  // A picture book's link reads back to the same book; credits carry every name the licence asks for.
  expect(catalogRefOf(catalogLink({ source: "gdl", sourceId: "17591" }))).toEqual({ source: "gdl", sourceId: "17591" });
  const credits = parseCredits({ license: "CC-BY-4.0", link: "x", publisher: "Room to Read", authors: ["A"], illustrators: ["B"], translators: ["C"] });
  expect(credits === null ? [] : creditLines(credits)).toEqual(["Tác giả: A", "Hoạ sĩ: B", "Dịch: C", "Nhà xuất bản: Room to Read", "Nguồn: Global Digital Library", "Giấy phép: CC BY 4.0"]);
});

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  test(`84.15 · Tủ sách tuổi thơ: hai hàng (+ sách tranh), tựa Việt là dòng chính · ${w}`, async () => {
    await page.viewport(w, h);
    const screen = await render(
      <Frame>
        <ChildrenShelf onShelf={new Set(["gutenberg:16"])} onAdd={async () => undefined} />
      </Frame>,
    );
    await expect.element(screen.getByRole("heading", { name: "Tủ sách tuổi thơ" })).toBeInTheDocument();
    await settle();
    const rows = Array.from(document.querySelectorAll("[data-children-row]")).map((r) => r.getAttribute("data-children-row"));
    expect(rows).toEqual(["thieu_nhi", "thieu_nien", "tranh"]);
    const alice = document.querySelector("[data-children-book='gutenberg:11']");
    expect(alice?.querySelector("[data-title-main]")?.textContent).toBe("Alice ở xứ sở thần tiên");
    expect(alice?.querySelector("[data-title-original]")?.textContent).toBe("Alice's Adventures in Wonderland");
    // Inside the column: no row pushes the page sideways.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    // Nothing counted or scored.
    expect(document.body.textContent ?? "").not.toMatch(/điểm|huy hiệu|chuỗi/i);
    await page.screenshot({ path: `${OUT}/84-15-tu-sach-tuoi-tho-${w}.png` });
    await userEvent.click(document.querySelector("[data-children-age='thieu_nien']") as HTMLElement);
    await settle(200);
    expect(Array.from(document.querySelectorAll("[data-children-row]")).map((r) => r.getAttribute("data-children-row"))).toEqual(["thieu_nien"]);
  });
}
