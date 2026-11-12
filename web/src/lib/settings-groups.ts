import { SETTINGS_ROUTE, SETTINGS_TABS, type NavEntry } from "@/lib/navigation";

/** KT-07b (CEO 12/11 · 3, QA-02 CC-32): Cài đặt as an iOS-style grouped list, not 8 sideways tabs. */
export const SETTINGS_GROUPS: readonly { title: string; items: readonly string[] }[] = [
  { title: "Tài khoản", items: ["/cai-dat"] },
  { title: "Giao diện & thông báo", items: ["/cai-dat/thiet-lap", "/cai-dat/thong-bao"] },
  { title: "Dữ liệu & dung lượng", items: ["/cai-dat/dung-luong", "/cai-dat/avora-ai"] },
  { title: "Trợ giúp & góp ý", items: ["/cai-dat/huong-dan", "/cai-dat/gop-y", "/cai-dat/chinh-sach"] },
];

/** Profile has its own address too, so the phone's list can lead to it (`/cai-dat` is the list there). */
export const PROFILE_ROUTE = "/cai-dat/ho-so";


/** The groups that still have something visible (a feature switched off hides its row). */
export function settingsGroups(tabs: readonly NavEntry[]): { title: string; items: NavEntry[] }[] {
  const byPath = new Map(tabs.map((tab) => [tab.to, tab]));
  return SETTINGS_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.map((to) => byPath.get(to)).filter((tab): tab is NavEntry => tab !== undefined),
  })).filter((group) => group.items.length > 0);
}

/** KT-08 · QA05-05: the name of the Cài đặt page at `pathname` ("Thông báo"…), or null for the list itself. */
export function settingsPageTitle(pathname: string, tabs: readonly NavEntry[] = SETTINGS_TABS): string | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === SETTINGS_ROUTE) return null;
  if (path === PROFILE_ROUTE) return tabs.find((tab) => tab.to === SETTINGS_ROUTE)?.label ?? "Hồ sơ";
  const found = tabs.find((tab) => tab.to !== SETTINGS_ROUTE && (path === tab.to || path.startsWith(`${tab.to}/`)));
  return found?.label ?? null;
}
