import type { Plugin } from "vite";

/**
 * 112-A · 2 — the two-person harness needs two (or more) copies of the app that do not share
 * anything a real second browser would not share: module-level caches, the outbox's memory, the
 * sound player, the Supabase client. Vite keys modules by id, and an id with a different query is a
 * different module, so a file imported as `…/session-app.tsx?avora_session=A` gets its whole
 * `src/` graph copied under `?avora_session=A` (packages from node_modules — React, React Query —
 * stay shared, exactly like a page uses one React).
 *
 * Inside such a graph `@/integrations/supabase/client` is replaced by the session's fake client,
 * registered on `globalThis.__AVORA_SESSIONS__[key]` before the graph is imported. Nothing of
 * this reaches the app build: the plugin is only in `vitest.browser.config.ts`.
 */
export const SESSION_QUERY = "avora_session";

const SESSION_RE = new RegExp(`[?&]${SESSION_QUERY}=([A-Za-z0-9_-]+)`);

function sessionOf(id: string | undefined): string | null {
  if (id === undefined) return null;
  return SESSION_RE.exec(id)?.[1] ?? null;
}

function clean(id: string): string {
  const at = id.indexOf("?");
  return at === -1 ? id : id.slice(0, at);
}

export function sessionGraphs(): Plugin {
  let srcRoot = "";
  return {
    name: "avora:session-graphs",
    enforce: "pre",
    configResolved(config) {
      srcRoot = `${config.root.replace(/\\/g, "/")}/src/`;
    },
    async resolveId(source, importer, options) {
      const key = sessionOf(importer);
      if (key === null || source.includes(`${SESSION_QUERY}=`)) return null;
      const resolved = await this.resolve(source, importer === undefined ? undefined : clean(importer), { ...options, skipSelf: true });
      if (resolved === null || resolved.external) return resolved;
      const file = clean(resolved.id).replace(/\\/g, "/");
      if (!file.startsWith(srcRoot) || !/\.(ts|tsx)$/.test(file) || resolved.id.includes("?")) return resolved;
      return { ...resolved, id: `${file}?${SESSION_QUERY}=${key}` };
    },
    load(id) {
      const key = sessionOf(id);
      if (key === null) return null;
      if (!clean(id).replace(/\\/g, "/").endsWith("/src/integrations/supabase/client.ts")) return null;
      return [
        `const sessions = globalThis.__AVORA_SESSIONS__ ?? {};`,
        `const entry = sessions[${JSON.stringify(key)}];`,
        `if (entry === undefined) throw new Error("avora session ${key} is not registered");`,
        `export const supabase = entry.client;`,
      ].join("\n");
    },
  };
}
