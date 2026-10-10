import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lastShelfOfRow, rememberShelf, roomFromParams, rowOf, shelvesOfRow, ROW_HOME } from "@/lib/room";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
}

describe("AVORA-101C · Kệ | Bàn remembers the last shelf of each row", () => {
  it("first time: wall → kệ 2, desk → kệ 6 (VMT 08/10 23:17)", () => {
    const store = memory();
    expect(lastShelfOfRow("wall", store)).toBe(2);
    expect(lastShelfOfRow("desk", store)).toBe(6);
    expect(ROW_HOME).toEqual({ wall: 2, desk: 6 });
  });
  it("each row keeps its own last shelf", () => {
    const store = memory();
    rememberShelf(3, store);
    rememberShelf(4, store);
    expect(lastShelfOfRow("wall", store)).toBe(3);
    expect(lastShelfOfRow("desk", store)).toBe(4);
    rememberShelf(1, store);
    expect(lastShelfOfRow("wall", store)).toBe(1);
    expect(lastShelfOfRow("desk", store)).toBe(4);
  });
  it("ignores junk and a shelf of the wrong row", () => {
    const store = memory();
    store.setItem("avora-room-last", JSON.stringify({ wall: 5, desk: "x" }));
    expect(lastShelfOfRow("wall", store)).toBe(2);
    expect(lastShelfOfRow("desk", store)).toBe(6);
    store.setItem("avora-room-last", "{not json");
    expect(lastShelfOfRow("wall", store)).toBe(2);
    expect(lastShelfOfRow("wall", null)).toBe(2);
  });
  it("rows hold the same three shelves in a fixed order", () => {
    expect(shelvesOfRow("wall").map((item) => item.id)).toEqual([1, 2, 3]);
    expect(shelvesOfRow("desk").map((item) => item.id)).toEqual([4, 5, 6]);
    expect([1, 2, 3, 4, 5, 6].map((id) => rowOf(id as 1))).toEqual(["wall", "wall", "wall", "desk", "desk", "desk"]);
  });
  it("old addresses still open the right shelf", () => {
    const at = (query: string) => roomFromParams(new URLSearchParams(query))?.shelf ?? null;
    expect(at("ke=mac-dinh")).toBe(4);
    expect(at("ke=hoach-dinh")).toBe(3);
    expect(at("ke=ke-sach")).toBe(5);
    expect(at("ke=nhat-ky")).toBe(5);
    expect(at("ke=6")).toBe(6);
  });
});

describe("AVORA-101C · source rules", () => {
  const src = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
  it("no RoomBar / UpDownPill / MiniMap left", () => {
    const room = src("components/library/PlanRoom.tsx");
    const hub = src("pages/ThinkHub.tsx");
    for (const name of ["RoomBar", "UpDownPill", "MiniMap", "data-room-updown"]) {
      expect(room).not.toContain(name);
      expect(hub).not.toContain(name);
    }
    expect(room).toContain("<SubTabs");
  });
  it("no orange action button on Kế hoạch (orange = logo and badges)", () => {
    const hub = src("pages/ThinkHub.tsx");
    const room = src("components/library/PlanRoom.tsx");
    expect(hub).not.toMatch(/bg-primary [^"]*text-primary-foreground/);
    expect(room).not.toMatch(/bg-primary/);
  });
});
