/** AVORA-E0: only with `VITE_E2EE_SPIKE=1`, or signed in + `?spike=e2ee`. Otherwise the page does not exist. */
export function isSpikeAllowed(flag: string | undefined, signedIn: boolean, search: string): boolean {
  if (flag === "1") return true;
  return signedIn && new URLSearchParams(search).get("spike") === "e2ee";
}
