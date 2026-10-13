import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const createSignedUrls = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    storage: { from: () => ({ createSignedUrls: (...args: unknown[]) => createSignedUrls(...args) }) },
  },
}));

import {
  AVATAR_SOURCE_MAX_BYTES,
  avatarLook,
  avatarPath,
  checkAvatarFile,
  clampCrop,
  cropRect,
  loadAvatar,
  resetAvatarCacheForTests,
} from "@/lib/avatars";

const FRIEND = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const ME = "be10844c-aefd-4ee9-b7ba-4a4a0f2fe00d";

describe("AVORA-115 · which look an avatar shows", () => {
  it("initials until that exact link has loaded; initials again on a failed load", () => {
    expect(avatarLook({ url: null, loadedUrl: null, failedUrl: null })).toBe("initials");
    expect(avatarLook({ url: "u1", loadedUrl: null, failedUrl: null })).toBe("initials");
    expect(avatarLook({ url: "u1", loadedUrl: "u1", failedUrl: null })).toBe("image");
    expect(avatarLook({ url: "u2", loadedUrl: "u1", failedUrl: null })).toBe("initials");
    expect(avatarLook({ url: "u1", loadedUrl: "u1", failedUrl: "u1" })).toBe("initials");
  });
});

describe("AVORA-115 · crop math", () => {
  const natural = { width: 4000, height: 3000 };

  it("zoom 1, centred: the middle square of the short side", () => {
    expect(cropRect(natural, 260, { zoom: 1, dx: 0, dy: 0 })).toEqual({ x: 500, y: 0, size: 3000 });
  });

  it("zoom 2 halves the square", () => {
    expect(cropRect(natural, 260, { zoom: 2, dx: 0, dy: 0 }).size).toBe(1500);
  });

  it("a drag never uncovers the circle", () => {
    const wild = clampCrop(natural, 260, { zoom: 1, dx: 9999, dy: 9999 });
    expect(wild.dy).toBe(0);
    expect(wild.dx).toBeCloseTo((4000 * (260 / 3000) - 260) / 2, 6);
    const rect = cropRect(natural, 260, { zoom: 1, dx: 9999, dy: 0 });
    expect(rect.x).toBeCloseTo(0, 6);
    const other = cropRect(natural, 260, { zoom: 1, dx: -9999, dy: 0 });
    expect(other.x + other.size).toBeCloseTo(4000, 6);
  });

  it("zoom is kept between 1 and 4", () => {
    expect(clampCrop(natural, 260, { zoom: 0.2, dx: 0, dy: 0 }).zoom).toBe(1);
    expect(clampCrop(natural, 260, { zoom: 9, dx: 0, dy: 0 }).zoom).toBe(4);
  });
});

describe("AVORA-115 · files", () => {
  it("refuses a non-picture and anything over 10 MB, before any work", () => {
    expect(checkAvatarFile({ type: "application/pdf", size: 10 })).toBe("Hãy chọn một tệp ảnh.");
    expect(checkAvatarFile({ type: "image/heic", size: AVATAR_SOURCE_MAX_BYTES + 1 })).toBe("Ảnh lớn hơn 10 MB. Hãy chọn ảnh nhỏ hơn.");
    expect(checkAvatarFile({ type: "image/jpeg", size: 3_000_000 })).toBeNull();
  });

  it("the path is `<user>/<version>.jpg` exactly as the server accepts it", () => {
    const serverRule = new RegExp(`^${ME}/[A-Za-z0-9_-]{1,64}\\.jpg$`);
    for (let i = 0; i < 50; i += 1) expect(avatarPath(ME, 1_760_000_000_000 + i)).toMatch(serverRule);
    expect(avatarPath(ME, 1)).not.toBe(avatarPath(ME, 1));
  });
});

describe("AVORA-115 · loading is batched and asks the server who may be seen", () => {
  beforeEach(() => {
    resetAvatarCacheForTests();
    rpc.mockReset();
    createSignedUrls.mockReset();
  });

  it("three asks in one frame → one avatar_paths, one signing; a stranger gets nothing", async () => {
    rpc.mockResolvedValue({ data: [{ user_id: FRIEND, path: `${FRIEND}/v1.jpg`, version: "2026-10-13T00:00:00Z" }], error: null });
    createSignedUrls.mockResolvedValue({ data: [{ path: `${FRIEND}/v1.jpg`, signedUrl: "https://signed/friend", error: null }], error: null });
    const [friend, stranger, again] = await Promise.all([loadAvatar(FRIEND), loadAvatar(STRANGER), loadAvatar(FRIEND)]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("avatar_paths");
    expect((rpc.mock.calls[0][1] as { p_user_ids: string[] }).p_user_ids.sort()).toEqual([FRIEND, STRANGER].sort());
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0][1]).toBe(300);
    expect(friend?.url).toBe("https://signed/friend");
    expect(again?.url).toBe("https://signed/friend");
    expect(stranger).toBeNull();
  });

  it("a fresh signed link is reused (not signed again) while it has time left", async () => {
    rpc.mockResolvedValue({ data: [{ user_id: FRIEND, path: `${FRIEND}/v1.jpg`, version: null }], error: null });
    createSignedUrls.mockResolvedValue({ data: [{ path: `${FRIEND}/v1.jpg`, signedUrl: "https://signed/a", error: null }], error: null });
    await loadAvatar(FRIEND);
    await loadAvatar(FRIEND);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("not a uuid (a group, a contact without an account) → initials, no call", async () => {
    expect(await loadAvatar("Nhóm thử")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a server error rejects (the avatar stays on initials), it does not pretend to be empty", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(loadAvatar(FRIEND)).rejects.toThrow("avatar_paths_failed");
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : walk(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

describe("AVORA-115 · one avatar component", () => {
  it("nothing imports InitialsAvatar directly except UserAvatar", () => {
    const root = join(__dirname, "..");
    const offenders = walk(root)
      .filter((file) => !file.endsWith("components/UserAvatar.tsx") && !file.endsWith("components/InitialsAvatar.tsx"))
      .filter((file) => /from\s+["']@\/components\/InitialsAvatar["']/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it("the person card no longer draws initials by hand", () => {
    const source = readFileSync(join(__dirname, "../components/PersonCard.tsx"), "utf8");
    expect(source).not.toMatch(/initialsOf\(/);
  });
});
