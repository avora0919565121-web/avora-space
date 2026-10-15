/**
 * 112-C · LOI-01: a translated error keeps the server's own words beside the Vietnamese sentence, so code that
 * must decide (the outbox: retry or stop?) reads `avora_…` codes and never a translation that may change.
 */
export type ServerDetailError = Error & { serverCode?: string; serverMessage?: string };

export function withServerDetail(error: Error, code: string | undefined, message: string): ServerDetailError {
  return Object.assign(error, { serverCode: code, serverMessage: message });
}

/** The server's message when the error carries one, else the error's own message. */
export function serverText(error: unknown): string {
  if (error instanceof Error) {
    const detail = (error as ServerDetailError).serverMessage;
    return detail !== undefined && detail !== "" ? detail : error.message;
  }
  return String(error);
}
