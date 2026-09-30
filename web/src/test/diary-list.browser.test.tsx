import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { DiaryList } from "@/components/chat/DiaryViews";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderList(isWide: boolean, journalId: string | null = "j1") {
  return render(
    <MemoryRouter initialEntries={["/tin-nhan"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <DiaryList
                journalId={journalId}
                active={isWide ? "journal" : null}
                counts={{ journal: null, notes: 2, files: 3, links: 1, sources: 0 }}
                isWide={isWide}
                onPaste={() => undefined}
                isPasting={false}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

test("the Nhật ký tab lists its five readings as rows, with counts (AVORA-44)", async () => {
  const screen = await renderList(false);
  await expect.element(screen.getByRole("link", { name: /Nhật ký của tôi/ })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: /File của tôi\s*\(3\)/ })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: /Ghi chép\s*\(2\)/ })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: /Liên kết\s*\(1\)/ })).toBeVisible();
  await expect.element(screen.getByRole("link", { name: /Nguồn tạo việc\s*\(0\)/ })).toBeVisible();
  // AVORA-49 · chặng 5: "from what was copied" lives only in Nguồn tạo việc, not under this list.
  expect(screen.container.querySelector("button")).toBeNull();
});

test("a row opens its reading of the journal", async () => {
  const screen = await renderList(false);
  await userEvent.click(screen.getByRole("link", { name: /File của tôi/ }));
  await expect.element(screen.getByTestId("where")).toHaveTextContent("/tin-nhan/j1?xem=file");
});

test("on a computer the open reading is marked beside the list", async () => {
  const screen = await renderList(true);
  await expect
    .element(screen.getByRole("link", { name: /Nhật ký của tôi/ }))
    .toHaveAttribute("aria-current", "page");
});

test("while the journal is still being created the rows wait instead of linking nowhere", async () => {
  const screen = await renderList(false, null);
  expect(screen.container.querySelectorAll("a").length).toBe(0);
});
