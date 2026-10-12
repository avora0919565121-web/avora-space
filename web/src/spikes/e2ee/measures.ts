/**
 * AVORA-E0 — the measurements M1…M7. Made-up data only, nothing leaves the device, no product data
 * is read. Each returns rows for the result table; thresholds are the spec's starting points and are
 * never lowered here.
 */
import { argon2, DEFAULT_KDF, type KdfParams } from "@/lib/vault-crypto";

import { aad, newAesKey, open, seal, type Sealed } from "./aes";
import { fakeMessages, SAMPLE_QUERIES } from "./fake-data";
import { idbGet, idbPut } from "./idb";
import { foldVi, InvertedIndex, linearSearch } from "./normalize";

type MiniSearchCtor = typeof import("minisearch").default;

export type Row = { id: string; name: string; pass: boolean | null; detail: string };
export type Progress = (label: string, fraction: number) => void;

const CONV = "spike-conversation";
const now = (): number => performance.now();
const ms = (value: number): string => `${Math.round(value)} ms`;
const yieldFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Longest main-thread block seen while `run` was going (PerformanceObserver longtask). */
export async function watchLongTasks<T>(run: () => Promise<T>): Promise<{ value: T; longest: number; supported: boolean }> {
  let longest = 0;
  let supported = false;
  let observer: PerformanceObserver | null = null;
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      supported = true;
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
    }
  } catch {
    supported = false;
  }
  try {
    const value = await run();
    await yieldFrame();
    return { value, longest, supported };
  } finally {
    observer?.disconnect();
  }
}

function heapMb(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory === undefined ? "không đo được" : `${Math.round(memory.usedJSHeapSize / 1_048_576)} MB`;
}

export function deviceInfo(): string[] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return [
    `Máy: ${navigator.userAgent}`,
    `RAM: ${nav.deviceMemory === undefined ? "không rõ" : `${nav.deviceMemory} GB`}`,
    `Chế độ: ${standalone ? "PWA đã cài (standalone)" : "tab trình duyệt"}`,
    `Ngữ cảnh an toàn: ${window.isSecureContext ? "có" : "không"}`,
    `Lúc chạy: ${new Date().toISOString()}`,
  ];
}

// ------------------------------------------------------------------ M1
export async function m1(): Promise<Row[]> {
  const subtle = crypto.subtle;
  const checks: [string, () => Promise<void>][] = [
    ["crypto.subtle", async () => {
      if (subtle === undefined) throw new Error("không có");
    }],
    ["ECDH P-256 (generateKey, deriveBits)", async () => {
      const a = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      const b = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      await subtle.deriveBits({ name: "ECDH", public: b.publicKey }, a.privateKey, 256);
    }],
    ["HKDF", async () => {
      const base = await subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), "HKDF", false, ["deriveBits"]);
      await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(16), info: new Uint8Array(1) }, base, 256);
    }],
    ["AES-GCM 256", async () => {
      const key = await newAesKey();
      await seal(key, "thử", aad(CONV, 1));
    }],
    ["AES-KW", async () => {
      const kw = await subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
      const inner = await newAesKey(true);
      await subtle.wrapKey("raw", inner, kw, "AES-KW");
    }],
    ["ECDSA P-256", async () => {
      const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const data = new TextEncoder().encode("thử");
      const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data);
      if (!(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, data))) throw new Error("verify sai");
    }],
  ];
  const rows: Row[] = [];
  for (const [name, run] of checks) {
    try {
      await run();
      rows.push({ id: "M1", name, pass: true, detail: "chạy" });
    } catch (error) {
      rows.push({ id: "M1", name, pass: false, detail: `${(error as Error).name}: ${(error as Error).message}` });
    }
  }
  return rows;
}

// ------------------------------------------------------------------ M2
type KeyLogEntry = { at: string; mode: string; directOk: boolean; wrappedOk: boolean; checkOk: boolean; note: string };

async function deriveWith(privateKey: CryptoKey): Promise<void> {
  const other = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  await crypto.subtle.deriveBits({ name: "ECDH", public: other.publicKey }, privateKey, 256);
}

async function passwordKey(salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("mat-khau-gia-cho-thu-nghiem"), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 200_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Creates both keys and the check value (first run), then reads them back and uses them. */
export async function m2(mode: "run" | "recheck"): Promise<Row[]> {
  const rows: Row[] = [];
  const standalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  let created = "";
  if (mode === "run" && (await idbGet("m2:check")) === undefined) {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    await idbPut("m2:direct", pair);
    const exportable = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", exportable.privateKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await passwordKey(salt), pkcs8);
    await idbPut("m2:wrapped", { salt, iv, wrapped });
    const check = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    await idbPut("m2:check", { check, createdAt: new Date().toISOString() });
    created = "vừa tạo khoá + giá trị kiểm";
  }
  let directOk = false;
  let wrappedOk = false;
  let directNote = "";
  let wrappedNote = "";
  try {
    const pair = await idbGet<CryptoKeyPair>("m2:direct");
    if (pair === undefined) throw new Error("không còn trong IndexedDB");
    await deriveWith(pair.privateKey);
    directOk = true;
    directNote = `extractable=${String(pair.privateKey.extractable)}`;
  } catch (error) {
    directNote = `${(error as Error).name}: ${(error as Error).message}`;
  }
  try {
    const stored = await idbGet<{ salt: Uint8Array; iv: Uint8Array; wrapped: ArrayBuffer }>("m2:wrapped");
    if (stored === undefined) throw new Error("không còn trong IndexedDB");
    const pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv as BufferSource }, await passwordKey(stored.salt), stored.wrapped);
    const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    await deriveWith(key);
    wrappedOk = true;
    wrappedNote = "mở bằng mật khẩu giả rồi dùng được";
  } catch (error) {
    wrappedNote = `${(error as Error).name}: ${(error as Error).message}`;
  }
  const check = await idbGet<{ check: string; createdAt: string }>("m2:check");
  const log = (await idbGet<KeyLogEntry[]>("m2:log")) ?? [];
  const entry: KeyLogEntry = {
    at: new Date().toISOString(),
    mode: `${mode === "run" ? "chạy thử" : "kiểm lại"} · ${standalone ? "PWA" : "tab"}`,
    directOk,
    wrappedOk,
    checkOk: check !== undefined,
    note: created,
  };
  log.push(entry);
  await idbPut("m2:log", log.slice(-50));
  rows.push({ id: "M2a", name: "Khoá ECDH extractable:false lưu IndexedDB, đọc lại dùng ngay", pass: directOk, detail: directNote });
  rows.push({ id: "M2b", name: "Khoá riêng đã bọc (AES-GCM, khoá từ mật khẩu giả)", pass: wrappedOk, detail: wrappedNote });
  const since = check === undefined ? "—" : `${Math.round((Date.now() - Date.parse(check.createdAt)) / 60_000)} phút từ lúc tạo`;
  rows.push({
    id: "M2c",
    name: "Nhật ký các lần kiểm (đóng PWA · khoá máy 10 phút · sau 24 giờ)",
    pass: null,
    detail: `${since}; ${log.map((e) => `${e.at.slice(5, 16)} ${e.mode}: a=${e.directOk ? "còn" : "mất"} b=${e.wrappedOk ? "còn" : "mất"} kiểm=${e.checkOk ? "còn" : "mất"}`).join(" | ")}`,
  });
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const asked = persisted ? true : ((await navigator.storage?.persist?.()) ?? false);
    const estimate = await navigator.storage?.estimate?.();
    const mb = (n: number | undefined): string => (n === undefined ? "?" : `${Math.round(n / 1_048_576)} MB`);
    rows.push({ id: "M2d", name: "Lưu bền (persisted / persist / estimate)", pass: asked, detail: `persisted=${String(persisted)} · persist()=${String(asked)} · đã dùng ${mb(estimate?.usage)} / hạn mức ${mb(estimate?.quota)}` });
  } catch (error) {
    rows.push({ id: "M2d", name: "Lưu bền (persisted / persist / estimate)", pass: false, detail: (error as Error).message });
  }
  rows.push({
    id: "M2e",
    name: "Tab Safari thường và PWA đã cài",
    pass: null,
    detail: `Đang chạy: ${standalone ? "PWA đã cài" : "tab trình duyệt"}. Safari có thể xoá dữ liệu của trang không mở trong ~7 ngày ở tab thường; PWA đã cài trên màn hình chính được tính riêng.`,
  });
  return rows;
}

// ------------------------------------------------------------------ M3
async function timeArgon(params: KdfParams): Promise<{ took: number; error: string | null }> {
  const start = now();
  try {
    await argon2("mat-khau-gia-cho-thu-nghiem", crypto.getRandomValues(new Uint8Array(16)), params);
    return { took: now() - start, error: null };
  } catch (error) {
    return { took: now() - start, error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

export async function m3(): Promise<Row[]> {
  const light: KdfParams = { alg: "argon2id", v: 19, m: 19456, t: 2, p: 1 };
  const vault = await watchLongTasks(() => timeArgon(DEFAULT_KDF));
  const lighter = await timeArgon(light);
  return [
    {
      id: "M3",
      name: `Argon2id như Két sắt (hash-wasm, m=${DEFAULT_KDF.m} KiB, t=${DEFAULT_KDF.t}, p=1)`,
      pass: vault.value.error === null && vault.value.took <= 3000,
      detail: vault.value.error ?? `${ms(vault.value.took)} · khối dài nhất ${vault.supported ? ms(vault.longest) : "không đo được"}`,
    },
    {
      id: "M3",
      name: `Argon2id nhẹ hơn (chỉ để so: m=${light.m} KiB, t=${light.t})`,
      pass: null,
      detail: lighter.error ?? ms(lighter.took),
    },
  ];
}

// ------------------------------------------------------------------ warm-up
let cachedWorker: Worker | null = null;
let cachedMini: Promise<MiniSearchCtor> | null = null;

function spikeWorker(): Worker {
  if (cachedWorker === null) cachedWorker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return cachedWorker;
}

function loadMiniSearch(): Promise<MiniSearchCtor> {
  if (cachedMini === null) cachedMini = import("minisearch").then((mod) => mod.default);
  return cachedMini;
}

/**
 * Everything the run needs from the server (the worker, MiniSearch, the Argon2 WASM) is fetched when
 * the page opens — so the Network tab stays empty while `Chạy thử` runs.
 */
export async function warmUp(): Promise<void> {
  spikeWorker();
  await Promise.all([loadMiniSearch(), import("hash-wasm")]);
}

// ------------------------------------------------------------------ M4
async function decryptInWorker(raw: ArrayBuffer, sealed: Sealed[]): Promise<number> {
  const worker = spikeWorker();
  {
    const start = now();
    const chunk = 2000;
    for (let offset = 0; offset < sealed.length; offset += chunk) {
      const items = sealed.slice(offset, offset + chunk).map((item, i) => ({ id: offset + i, iv: item.iv, ct: item.ct }));
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = () => resolve();
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ raw, conversationId: CONV, items });
      });
    }
    return now() - start;
  }
}

export async function m4(progress: Progress): Promise<{ rows: Row[]; plain: string[] }> {
  const rows: Row[] = [];
  let plain: string[] = [];
  for (const count of [5000, 50000]) {
    progress(`M4 · ${count.toLocaleString("vi-VN")} tin`, 0);
    const texts = fakeMessages(count);
    const key = await newAesKey(true);
    const raw = await crypto.subtle.exportKey("raw", key);
    const sealed: Sealed[] = [];
    const encrypted = await watchLongTasks(async () => {
      const start = now();
      for (let i = 0; i < texts.length; i += 1) {
        sealed.push(await seal(key, texts[i], aad(CONV, i)));
        if (i % 500 === 0) await yieldFrame();
      }
      return now() - start;
    });
    progress(`M4 · ${count.toLocaleString("vi-VN")} tin · giải mã`, 0.4);
    const sequential = await watchLongTasks(async () => {
      const start = now();
      for (let i = 0; i < sealed.length; i += 1) await open(key, sealed[i], aad(CONV, i));
      return now() - start;
    });
    const batched = await watchLongTasks(async () => {
      const start = now();
      for (let offset = 0; offset < sealed.length; offset += 200) {
        await Promise.all(sealed.slice(offset, offset + 200).map((item, i) => open(key, item, aad(CONV, offset + i))));
        await yieldFrame();
      }
      return now() - start;
    });
    progress(`M4 · ${count.toLocaleString("vi-VN")} tin · Web Worker`, 0.8);
    let workerText = "";
    try {
      workerText = ms(await decryptInWorker(raw, sealed));
    } catch (error) {
      workerText = `lỗi ${(error as Error).message}`;
    }
    const longest = Math.max(encrypted.longest, sequential.longest, batched.longest);
    rows.push({
      id: "M4",
      name: `${count.toLocaleString("vi-VN")} tin giả (~120 ký tự, có dấu, emoji)`,
      pass: count === 5000 ? sequential.value <= 2000 && (!sequential.supported || longest <= 100) : null,
      detail: `mã hoá ${ms(encrypted.value)} · giải mã tuần tự ${ms(sequential.value)} · theo lô 200 ${ms(batched.value)} · Web Worker ${workerText} · khối dài nhất ${sequential.supported ? ms(longest) : "không đo được"} · bộ nhớ ${heapMb()}`,
    });
    if (count === 50000) plain = texts;
  }
  return { rows, plain };
}

// ------------------------------------------------------------------ M5

export async function m5(plain: string[], progress: Progress): Promise<Row[]> {
  const rows: Row[] = [];
  const texts = plain.length > 0 ? plain : fakeMessages(50000);
  const target = "có phải";
  const hasTarget = texts.findIndex((t) => t.includes(target));
  const timeQueries = (search: (q: string) => number[]): { avg: number; max: number; findsCoPhai: boolean } => {
    let total = 0;
    let max = 0;
    for (const q of SAMPLE_QUERIES) {
      const start = now();
      search(q);
      const took = now() - start;
      total += took;
      max = Math.max(max, took);
    }
    return { avg: total / SAMPLE_QUERIES.length, max, findsCoPhai: hasTarget >= 0 && search("co phai").includes(hasTarget) };
  };

  // 1. hand-written inverted index
  progress("M5 · chỉ mục tự viết", 0.1);
  let start = now();
  const index = new InvertedIndex();
  texts.forEach((text, id) => index.add(id, text));
  const buildOwn = now() - start;
  const own = timeQueries((q) => index.search(q));
  start = now();
  const ownJson = JSON.stringify(index);
  const serialize = now() - start;
  start = now();
  await idbPut("m5:index", ownJson);
  const storeOwn = now() - start;
  rows.push({
    id: "M5.1",
    name: "Chỉ mục ngược tự viết (NFD, bỏ dấu, đ→d, tiền tố)",
    pass: own.max <= 100,
    detail: `dựng ${ms(buildOwn)} · 20 truy vấn: TB ${own.avg.toFixed(1)} ms, chậm nhất ${ms(own.max)} · ${index.termCount.toLocaleString("vi-VN")} từ · lưu IndexedDB ${Math.round(ownJson.length / 1024)} KB (${ms(serialize + storeOwn)}) · "co phai" → "có phải": ${own.findsCoPhai ? "có" : "KHÔNG"} · bộ nhớ ${heapMb()}`,
  });

  // 2. MiniSearch (lazy, only on this page)
  progress("M5 · MiniSearch", 0.4);
  try {
    const MiniSearch: MiniSearchCtor = await loadMiniSearch();
    start = now();
    const mini = new MiniSearch<{ id: number; t: string }>({
      fields: ["t"],
      processTerm: (term) => foldVi(term),
      searchOptions: { prefix: true, combineWith: "AND", processTerm: (term) => foldVi(term) },
    });
    mini.addAll(texts.map((t, id) => ({ id, t })));
    const buildMini = now() - start;
    const res = timeQueries((q) => mini.search(q).map((r) => Number(r.id)));
    const miniJson = JSON.stringify(mini);
    rows.push({
      id: "M5.2",
      name: "MiniSearch 7 (≈ 7–8 KB gzip, chỉ nạp ở trang thử)",
      pass: res.max <= 100,
      detail: `dựng ${ms(buildMini)} · 20 truy vấn: TB ${res.avg.toFixed(1)} ms, chậm nhất ${ms(res.max)} · lưu ${Math.round(miniJson.length / 1024)} KB · "co phai" → "có phải": ${res.findsCoPhai ? "có" : "KHÔNG"} · bộ nhớ ${heapMb()}`,
    });
  } catch (error) {
    rows.push({ id: "M5.2", name: "MiniSearch", pass: false, detail: (error as Error).message });
  }

  // 3. linear scan over folded text
  progress("M5 · quét tuyến tính", 0.7);
  start = now();
  const folded = texts.map((t) => foldVi(t));
  const buildLinear = now() - start;
  const lin = timeQueries((q) => linearSearch(folded, q));
  rows.push({
    id: "M5.3",
    name: "Quét tuyến tính `includes` (đường cơ sở)",
    pass: lin.max <= 100,
    detail: `chuẩn hoá ${ms(buildLinear)} · 20 truy vấn: TB ${lin.avg.toFixed(1)} ms, chậm nhất ${ms(lin.max)} · "co phai" → "có phải": ${lin.findsCoPhai ? "có" : "KHÔNG"}`,
  });

  // Encrypting the stored index (it holds plain tokens).
  progress("M5 · mã hoá chỉ mục khi lưu", 0.9);
  const indexKey = await newAesKey();
  start = now();
  const sealedIndex = await seal(indexKey, ownJson, aad("index", 0));
  const sealTook = now() - start;
  await idbPut("m5:index-sealed", sealedIndex);
  start = now();
  const reopened = await idbGet<Sealed>("m5:index-sealed");
  const text = reopened === undefined ? "" : await open(indexKey, reopened, aad("index", 0));
  JSON.parse(text);
  const openTook = now() - start;
  rows.push({
    id: "M5.4",
    name: "Chỉ mục lưu trên máy có mã hoá (AES-GCM)",
    pass: null,
    detail: `mã hoá ${ms(sealTook)} · mở lại (đọc + giải mã + parse) ${ms(openTook)} · ${Math.round(sealedIndex.ct.byteLength / 1024)} KB`,
  });
  return rows;
}

// ------------------------------------------------------------------ M6
export async function m6(progress: Progress): Promise<Row[]> {
  const rows: Row[] = [];
  const sender = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const groupKey = await newAesKey(true);
  for (const n of [10, 100, 500]) {
    progress(`M6 · ${n} thành viên`, n / 600);
    const members: CryptoKey[] = [];
    for (let i = 0; i < n; i += 1) members.push((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])).publicKey);
    const measured = await watchLongTasks(async () => {
      const start = now();
      for (const pub of members) {
        const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, sender.privateKey, 256);
        const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
        const kw = await crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(16), info: new TextEncoder().encode("avora-group-key-v0") },
          base,
          { name: "AES-KW", length: 256 },
          false,
          ["wrapKey"],
        );
        await crypto.subtle.wrapKey("raw", groupKey, kw, "AES-KW");
      }
      return now() - start;
    });
    rows.push({
      id: "M6",
      name: `Bọc khoá nhóm cho ${n} thành viên (ECDH + HKDF + AES-KW)`,
      pass: n === 100 ? measured.value <= 1000 : null,
      detail: `${ms(measured.value)} · khối dài nhất ${measured.supported ? ms(measured.longest) : "không đo được"}`,
    });
  }
  return rows;
}

// ------------------------------------------------------------------ M7
const MB = 1_048_576;

/** Writes `megabytes` of made-up bytes in 1 MB records; any IndexedDB error is reported by name. */
export async function m7(step: "first" | "after-switch", megabytes = step === "first" ? 20 : 2): Promise<Row> {
  const start = now();
  const errors: string[] = [];
  let written = 0;
  for (let i = 0; i < megabytes; i += 1) {
    try {
      const chunk = new Uint8Array(MB);
      for (let offset = 0; offset < MB; offset += 65536) crypto.getRandomValues(chunk.subarray(offset, offset + 65536));
      await idbPut(`m7:${step}:${i}`, chunk);
      written += 1;
    } catch (error) {
      errors.push(`${(error as Error).name}: ${(error as Error).message}`);
      break;
    }
  }
  return {
    id: step === "first" ? "M7a" : "M7b",
    name: step === "first" ? "Ghi 20 MB dữ liệu giả vào IndexedDB" : "Ghi tiếp sau khi chuyển app 30 giây",
    pass: errors.length === 0,
    detail: `${written} MB trong ${ms(now() - start)}${errors.length > 0 ? ` · lỗi ${errors.join("; ")}` : ""}`,
  };
}

/** The table as plain text, for `Chép kết quả`. */
export function resultsText(rows: readonly Row[]): string {
  const mark = (pass: boolean | null): string => (pass === null ? "·" : pass ? "ĐẠT" : "KHÔNG ĐẠT");
  return [
    "AVORA-E0 · kết quả thử nghiệm",
    ...deviceInfo(),
    "",
    ...rows.map((row) => `${row.id} | ${mark(row.pass)} | ${row.name} | ${row.detail}`),
  ].join("\n");
}
