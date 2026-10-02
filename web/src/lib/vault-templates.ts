import type { VaultSection } from "@/lib/vault-crypto";

/**
 * AVORA-68 · 4.4 — the kinds of paper in each compartment and their fields. Adding a kind needs no
 * migration: everything here lives inside the ciphertext.
 */
export type FieldKind = "text" | "date" | "number" | "note";
export type FieldDef = { key: string; label: string; kind: FieldKind; expiry?: boolean; remember?: boolean };
export type TemplateDef = { type: string; label: string; group: string; fields: readonly FieldDef[]; leadDays: number };

const number: FieldDef = { key: "number", label: "Số hiệu", kind: "text" };
const issued: FieldDef = { key: "issued_on", label: "Ngày cấp", kind: "date" };
const issuer: FieldDef = { key: "issuer", label: "Nơi cấp", kind: "text" };
const expiry: FieldDef = { key: "expires_on", label: "Ngày hết hạn", kind: "date", expiry: true };
const remember: FieldDef = { key: "remember_on", label: "Ngày cần nhớ", kind: "date", remember: true };

export const VAULT_TEMPLATES: Readonly<Record<VaultSection, readonly TemplateDef[]>> = {
  certificates: [
    { type: "cccd", label: "Căn cước công dân", group: "Giấy tờ tuỳ thân", fields: [number, issued, issuer, expiry], leadDays: 90 },
    { type: "passport", label: "Hộ chiếu", group: "Giấy tờ tuỳ thân", fields: [number, issued, issuer, expiry], leadDays: 90 },
    { type: "driving", label: "Giấy phép lái xe", group: "Giấy tờ tuỳ thân", fields: [number, { key: "class", label: "Hạng", kind: "text" }, issued, expiry], leadDays: 30 },
    { type: "birth", label: "Giấy khai sinh", group: "Giấy tờ tuỳ thân", fields: [number, issued, issuer], leadDays: 30 },
    { type: "degree", label: "Bằng cấp", group: "Học vấn & nghề", fields: [{ key: "school", label: "Trường", kind: "text" }, { key: "major", label: "Ngành", kind: "text" }, issued, number], leadDays: 30 },
    { type: "language", label: "Chứng chỉ ngoại ngữ", group: "Học vấn & nghề", fields: [{ key: "score", label: "Điểm / bậc", kind: "text" }, issued, expiry, number], leadDays: 30 },
    { type: "license", label: "Chứng chỉ hành nghề", group: "Học vấn & nghề", fields: [number, issued, issuer, expiry], leadDays: 30 },
    { type: "insurance", label: "Thẻ bảo hiểm", group: "Bảo hiểm", fields: [number, { key: "provider", label: "Nơi đăng ký", kind: "text" }, expiry], leadDays: 30 },
    { type: "other-cert", label: "Giấy tờ khác", group: "Khác", fields: [number, issued, expiry], leadDays: 30 },
  ],
  documents: [
    { type: "contract", label: "Hợp đồng", group: "Hợp đồng", fields: [{ key: "party", label: "Bên kia", kind: "text" }, { key: "signed_on", label: "Ngày ký", kind: "date" }, remember], leadDays: 0 },
    { type: "land", label: "Giấy tờ nhà đất", group: "Nhà đất", fields: [number, { key: "address", label: "Địa chỉ", kind: "text" }, issued], leadDays: 0 },
    { type: "warranty", label: "Hoá đơn · bảo hành", group: "Mua sắm", fields: [{ key: "seller", label: "Nơi bán", kind: "text" }, { key: "bought_on", label: "Ngày mua", kind: "date" }, remember], leadDays: 0 },
    { type: "medical", label: "Hồ sơ y tế", group: "Sức khoẻ", fields: [{ key: "place", label: "Nơi khám", kind: "text" }, { key: "visit_on", label: "Ngày khám", kind: "date" }, remember], leadDays: 0 },
    { type: "other-doc", label: "Tài liệu khác", group: "Khác", fields: [remember], leadDays: 0 },
  ],
  assets: [
    { type: "property", label: "Bất động sản", group: "Nhà đất", fields: [{ key: "address", label: "Địa chỉ", kind: "text" }, { key: "value", label: "Giá trị ước tính (₫)", kind: "number" }, { key: "bought_on", label: "Ngày mua", kind: "date" }], leadDays: 30 },
    { type: "vehicle", label: "Xe", group: "Phương tiện", fields: [{ key: "plate", label: "Biển số", kind: "text" }, { key: "inspection_until", label: "Đăng kiểm đến", kind: "date", expiry: true }, { key: "value", label: "Giá trị ước tính (₫)", kind: "number" }], leadDays: 30 },
    { type: "gold", label: "Vàng · trang sức", group: "Tài sản quý", fields: [{ key: "weight", label: "Trọng lượng", kind: "text" }, { key: "value", label: "Giá trị ước tính (₫)", kind: "number" }, { key: "kept_at", label: "Cất ở đâu", kind: "text" }], leadDays: 30 },
    { type: "device", label: "Thiết bị", group: "Tài sản quý", fields: [{ key: "serial", label: "Số máy", kind: "text" }, { key: "bought_on", label: "Ngày mua", kind: "date" }, { key: "warranty_until", label: "Bảo hành đến", kind: "date", expiry: true }], leadDays: 30 },
    { type: "other-asset", label: "Tài sản khác", group: "Khác", fields: [{ key: "value", label: "Giá trị ước tính (₫)", kind: "number" }], leadDays: 30 },
  ],
};

export const SECTION_LABEL: Readonly<Record<VaultSection, string>> = {
  certificates: "Chứng chỉ",
  documents: "Tài liệu",
  assets: "Tài sản",
};

export const SECTION_PATH: Readonly<Record<VaultSection, string>> = {
  certificates: "/ket-sat/chung-chi",
  documents: "/ket-sat/tai-lieu",
  assets: "/ket-sat/tai-san",
};

export function templateOf(section: VaultSection, type: string): TemplateDef {
  return VAULT_TEMPLATES[section].find((t) => t.type === type) ?? VAULT_TEMPLATES[section][VAULT_TEMPLATES[section].length - 1];
}

/** What a decrypted item holds. Nothing of this reaches the server in clear. */
export type VaultPayload = {
  v: 1;
  type: string;
  title: string;
  owner_label: string;
  owner_contact_id: string | null;
  fields: Record<string, string>;
  tags: string[];
  note: string;
  links: string[];
  show_name_in_reminder: boolean;
};

const DAY = 86_400_000;

/**
 * The reminder date the device computes (68 · 3): an expiry minus the kind's lead (CCCD / hộ chiếu 90
 * days, others 30); Tài liệu on its `Ngày cần nhớ`. Null when there is nothing to remember.
 */
export function remindOnFor(section: VaultSection, payload: Pick<VaultPayload, "type" | "fields">): string | null {
  const template = templateOf(section, payload.type);
  for (const field of template.fields) {
    const value = payload.fields[field.key];
    if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    if (field.remember === true) return value;
    if (field.expiry === true) return new Date(new Date(`${value}T00:00:00Z`).getTime() - template.leadDays * DAY).toISOString().slice(0, 10);
  }
  return null;
}

/** Days until the nearest expiry / reminder date; null without one. */
export function daysLeft(section: VaultSection, payload: Pick<VaultPayload, "type" | "fields">, today = new Date()): number | null {
  const template = templateOf(section, payload.type);
  const dated = template.fields.find((f) => (f.expiry === true || f.remember === true) && /^\d{4}-\d{2}-\d{2}$/.test(payload.fields[f.key] ?? ""));
  if (dated === undefined) return null;
  const target = new Date(`${payload.fields[dated.key]}T00:00:00`).getTime();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / DAY);
}

/**
 * 4.1 · 2 — `Gợi ý một cụm dễ nhớ`: four random unaccented Vietnamese syllables. The list is long on
 * purpose: syllable × syllable combinations give far more than 2,000 entries.
 */
const ONSETS = ["b", "c", "ch", "d", "g", "gi", "h", "k", "kh", "l", "m", "n", "ng", "nh", "ph", "qu", "r", "s", "t", "th", "tr", "v", "x"];
const RIMES = ["a", "ai", "am", "an", "ang", "anh", "ao", "au", "ay", "e", "em", "en", "eo", "i", "im", "in", "inh", "o", "oc", "oi", "om", "on", "ong", "u", "ui", "um", "un", "ung", "uyen", "ua", "uoi", "uong"];

export function suggestPassphrase(count = 4): string {
  const words: string[] = [];
  const pick = (n: number): number => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  while (words.length < count) {
    const word = ONSETS[pick(ONSETS.length)] + RIMES[pick(RIMES.length)] + (pick(3) === 0 ? RIMES[pick(RIMES.length)].slice(0, 1) : "");
    if (word.length >= 3 && !words.includes(word)) words.push(word);
  }
  return words.join(" ");
}

export const SUGGESTION_SPACE = ONSETS.length * RIMES.length;
