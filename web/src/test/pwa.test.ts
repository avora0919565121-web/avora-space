import { describe, expect, it, vi } from "vitest";

import SW_SOURCE from "../../public/sw.js?raw";

/**
 * These tests execute the real public/sw.js, not a copy of its logic, so the
 * two promises AVORA makes about the worker are enforced on the shipped file:
 * no Supabase response is ever cached, and no stale build is ever served.
 */

const ORIGIN = "https://avora.example";
const SUPABASE_ORIGIN = "https://myrubjdysllgucgafqjy.supabase.co";

type FakeResponse = {
  ok: boolean;
  type: string;
  body: string;
  clone: () => FakeResponse;
};

type FakeRequest = {
  url: string;
  method: string;
  mode: string;
  destination: string;
};

type FetchEvent = {
  request: FakeRequest;
  responded: Promise<FakeResponse> | null;
};

function makeResponse(body: string, overrides: Partial<FakeResponse> = {}): FakeResponse {
  const response: FakeResponse = {
    ok: true,
    type: "basic",
    body,
    clone: () => response,
    ...overrides,
  };
  return response;
}

function makeRequest(url: string, overrides: Partial<FakeRequest> = {}): FakeRequest {
  return { url, method: "GET", mode: "cors", destination: "empty", ...overrides };
}

/** Loads the worker into a sandbox that mimics ServiceWorkerGlobalScope. */
function loadWorker(fetchImpl: (request: FakeRequest) => Promise<FakeResponse>) {
  const listeners = new Map<string, (event: unknown) => void>();
  const caches_ = new Map<string, Map<string, FakeResponse>>();
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const fetchSpy = vi.fn(fetchImpl);

  const cacheApi = {
    open: async (name: string) => {
      const existing = caches_.get(name) ?? new Map<string, FakeResponse>();
      caches_.set(name, existing);
      return {
        put: async (request: FakeRequest, response: FakeResponse) => {
          existing.set(request.url, response);
        },
        match: async (request: FakeRequest) => existing.get(request.url),
      };
    },
    keys: async () => [...caches_.keys()],
    delete: async (name: string) => caches_.delete(name),
  };

  const self_ = {
    location: { origin: ORIGIN },
    skipWaiting,
    clients: { claim },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
  };

  const run = new Function("self", "caches", "fetch", SW_SOURCE);
  run(self_, cacheApi, fetchSpy);

  return {
    caches_,
    fetchSpy,
    skipWaiting,
    claim,
    cachedUrls: (): string[] => [...caches_.values()].flatMap((entries) => [...entries.keys()]),
    seedCache: async (cacheName: string, request: FakeRequest, response: FakeResponse) => {
      const entries = caches_.get(cacheName) ?? new Map<string, FakeResponse>();
      entries.set(request.url, response);
      caches_.set(cacheName, entries);
    },
    dispatchFetch: (request: FakeRequest): FetchEvent => {
      const event: FetchEvent = { request, responded: null };
      const handler = listeners.get("fetch");
      if (!handler) throw new Error("the worker registered no fetch handler");
      handler({
        request,
        respondWith: (value: Promise<FakeResponse>) => {
          event.responded = value;
        },
      });
      return event;
    },
    dispatchLifecycle: async (type: "install" | "activate") => {
      const handler = listeners.get(type);
      if (!handler) throw new Error(`the worker registered no ${type} handler`);
      const pending: Promise<unknown>[] = [];
      handler({ waitUntil: (value: Promise<unknown>) => pending.push(value) });
      await Promise.all(pending);
    },
    hasFetchHandler: (): boolean => listeners.has("fetch"),
  };
}

const online = () => loadWorker(async (request) => makeResponse(`fresh:${request.url}`));
const offline = () =>
  loadWorker(async () => {
    throw new TypeError("Failed to fetch");
  });

describe("the service worker", () => {
  it("registers a fetch handler, which is what makes the app installable", () => {
    expect(online().hasFetchHandler()).toBe(true);
  });

  it("takes over immediately on install instead of waiting for every tab to close", async () => {
    const worker = online();
    await worker.dispatchLifecycle("install");
    expect(worker.skipWaiting).toHaveBeenCalled();
  });

  it("claims open pages and drops caches from older versions on activate", async () => {
    const worker = online();
    await worker.seedCache("avora-static-v0", makeRequest(`${ORIGIN}/old.js`), makeResponse("old"));
    await worker.seedCache("avora-static-v1", makeRequest(`${ORIGIN}/new.js`), makeResponse("new"));

    await worker.dispatchLifecycle("activate");

    expect([...worker.caches_.keys()]).toEqual(["avora-static-v1"]);
    expect(worker.claim).toHaveBeenCalled();
  });
});

describe("what the service worker refuses to touch", () => {
  it("passes Supabase REST calls straight through, uncached", async () => {
    const worker = online();
    const event = worker.dispatchFetch(makeRequest(`${SUPABASE_ORIGIN}/rest/v1/messages?select=*`));

    expect(event.responded).toBeNull();
    expect(worker.fetchSpy).not.toHaveBeenCalled();
    expect(worker.cachedUrls()).toEqual([]);
  });

  it("ignores Supabase storage files even though they look like static assets", async () => {
    const worker = online();
    const event = worker.dispatchFetch(
      makeRequest(`${SUPABASE_ORIGIN}/storage/v1/object/public/avatars/me.png`),
    );

    expect(event.responded).toBeNull();
    expect(worker.cachedUrls()).toEqual([]);
  });

  it("ignores Supabase auth and realtime traffic", async () => {
    const worker = online();
    const auth = worker.dispatchFetch(makeRequest(`${SUPABASE_ORIGIN}/auth/v1/user`));
    const realtime = worker.dispatchFetch(makeRequest(`${SUPABASE_ORIGIN}/realtime/v1/websocket`));

    expect(auth.responded).toBeNull();
    expect(realtime.responded).toBeNull();
    expect(worker.cachedUrls()).toEqual([]);
  });

  it("never handles the HTML document, so a new deploy always loads", async () => {
    const worker = online();
    const event = worker.dispatchFetch(
      makeRequest(`${ORIGIN}/tin-nhan`, { mode: "navigate", destination: "document" }),
    );

    expect(event.responded).toBeNull();
    expect(worker.cachedUrls()).toEqual([]);
  });

  it("leaves writes alone", async () => {
    const worker = online();
    const event = worker.dispatchFetch(
      makeRequest(`${ORIGIN}/assets/app.js`, { method: "POST" }),
    );

    expect(event.responded).toBeNull();
  });

  it("leaves third-party requests alone", async () => {
    const worker = online();
    const event = worker.dispatchFetch(makeRequest("https://fonts.gstatic.com/s/inter.woff2"));

    expect(event.responded).toBeNull();
    expect(worker.cachedUrls()).toEqual([]);
  });

  it("does not cache a failed or non-basic response", async () => {
    const notFound = loadWorker(async () => makeResponse("missing", { ok: false }));
    await notFound.dispatchFetch(makeRequest(`${ORIGIN}/assets/gone.js`)).responded;
    expect(notFound.cachedUrls()).toEqual([]);

    const opaque = loadWorker(async () => makeResponse("opaque", { type: "opaque" }));
    await opaque.dispatchFetch(makeRequest(`${ORIGIN}/assets/opaque.js`)).responded;
    expect(opaque.cachedUrls()).toEqual([]);
  });
});

describe("how the service worker serves build output", () => {
  it("goes to the network first and keeps the fresh copy as a fallback", async () => {
    const worker = online();
    const request = makeRequest(`${ORIGIN}/assets/app-a1b2.js`);

    const response = await worker.dispatchFetch(request).responded;

    expect(worker.fetchSpy).toHaveBeenCalledTimes(1);
    expect(response?.body).toBe(`fresh:${request.url}`);
    expect(worker.cachedUrls()).toEqual([request.url]);
  });

  it("prefers the network even when a cached copy exists, so nobody is stuck on an old build", async () => {
    const worker = online();
    const request = makeRequest(`${ORIGIN}/assets/app-a1b2.js`);
    await worker.seedCache("avora-static-v1", request, makeResponse("stale"));

    const response = await worker.dispatchFetch(request).responded;

    expect(response?.body).toBe(`fresh:${request.url}`);
  });

  it("falls back to the cached copy only when the network is gone", async () => {
    const worker = offline();
    const request = makeRequest(`${ORIGIN}/assets/app-a1b2.js`);
    await worker.seedCache("avora-static-v1", request, makeResponse("stale"));

    const response = await worker.dispatchFetch(request).responded;

    expect(response?.body).toBe("stale");
  });

  it("surfaces the network error when there is nothing cached", async () => {
    const worker = offline();
    const event = worker.dispatchFetch(makeRequest(`${ORIGIN}/assets/app-a1b2.js`));

    await expect(event.responded).rejects.toThrow(/Failed to fetch/);
  });

  it("covers the asset kinds the build emits", async () => {
    const worker = online();
    const assets = [
      `${ORIGIN}/assets/index-1234.css`,
      `${ORIGIN}/icons/icon-512.png`,
      `${ORIGIN}/manifest.webmanifest`,
      `${ORIGIN}/fonts/inter.woff2`,
    ];

    for (const asset of assets) {
      await worker.dispatchFetch(makeRequest(asset)).responded;
    }

    expect(worker.cachedUrls().sort()).toEqual([...assets].sort());
  });

  it("holds no user data after a realistic mix of traffic", async () => {
    const worker = online();
    const traffic = [
      makeRequest(`${ORIGIN}/tin-nhan`, { mode: "navigate", destination: "document" }),
      makeRequest(`${ORIGIN}/assets/app-a1b2.js`),
      makeRequest(`${SUPABASE_ORIGIN}/rest/v1/tasks?select=*`),
      makeRequest(`${SUPABASE_ORIGIN}/rest/v1/rpc/list_group_members`, { method: "POST" }),
      makeRequest(`${SUPABASE_ORIGIN}/storage/v1/object/public/avatars/me.png`),
    ];

    for (const request of traffic) {
      await worker.dispatchFetch(request).responded;
    }

    expect(worker.cachedUrls()).toEqual([`${ORIGIN}/assets/app-a1b2.js`]);
    expect(worker.cachedUrls().some((url) => url.includes("supabase"))).toBe(false);
  });
});
