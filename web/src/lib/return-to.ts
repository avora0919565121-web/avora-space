/**
 * The way back (AVORA-39 / Phần 1 · Nhóm 0).
 *
 * An installed PWA has no browser Back button and the AVORA logo goes home rather than back,
 * so any tap that leaves one place to work in another Hub carries where it came from: `tu` is
 * the in-app path (with its query), `tu_ten` the label the return chip shows.
 */
export const RETURN_PATH_PARAM = "tu";
export const RETURN_LABEL_PARAM = "tu_ten";

export type ReturnTarget = { path: string; label: string };

type ParamsLike = { get: (name: string) => string | null };

/** Only same-app absolute paths; anything that could leave AVORA (`//host`, `scheme://`, `javascript:`) is refused. */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  if (typeof path !== "string" || path.length === 0) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (path.includes("://")) return false;
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) < 0x20) return false;
  }
  return true;
}

/** The return target in an address, or null when absent or not safe. */
export function readReturn(searchParams: ParamsLike): ReturnTarget | null {
  const path = searchParams.get(RETURN_PATH_PARAM);
  if (!isSafeReturnPath(path)) return null;
  const label = (searchParams.get(RETURN_LABEL_PARAM) ?? "").trim();
  return { path, label: label.length > 0 ? label.slice(0, 60) : "Quay lại" };
}

/** Removes `tu`/`tu_ten` from a path+query, so a way back never stacks another way back inside it. */
export function stripReturn(pathWithQuery: string): string {
  const hashAt = pathWithQuery.indexOf("#");
  const hash = hashAt === -1 ? "" : pathWithQuery.slice(hashAt);
  const beforeHash = hashAt === -1 ? pathWithQuery : pathWithQuery.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return pathWithQuery;
  const path = beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(beforeHash.slice(queryAt + 1));
  params.delete(RETURN_PATH_PARAM);
  params.delete(RETURN_LABEL_PARAM);
  const query = params.toString();
  return `${path}${query.length > 0 ? `?${query}` : ""}${hash}`;
}

/** Attaches the way back to a link. An unsafe origin is dropped rather than carried along. */
export function withReturn(href: string, from: ReturnTarget): string {
  const path = stripReturn(from.path);
  if (!isSafeReturnPath(path)) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : beforeHash.slice(queryAt + 1));
  params.set(RETURN_PATH_PARAM, path);
  params.set(RETURN_LABEL_PARAM, from.label);
  return `${base}?${params.toString()}${hash}`;
}

/** Where the viewer is standing now, ready to hand to `withReturn`. */
export function hereFrom(location: { pathname: string; search: string }, label: string): ReturnTarget {
  return { path: stripReturn(`${location.pathname}${location.search}`), label };
}

/** Copies `tu`/`tu_ten` from one set of params onto a freshly built one. */
export function carryReturn(from: ParamsLike, into: URLSearchParams): URLSearchParams {
  const target = readReturn(from);
  if (target !== null) {
    into.set(RETURN_PATH_PARAM, target.path);
    into.set(RETURN_LABEL_PARAM, target.label);
  }
  return into;
}
