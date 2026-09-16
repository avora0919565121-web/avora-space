import type { ImportedContactCandidate } from "@/lib/contact-candidates";

/**
 * Reading contacts straight off the phone.
 *
 * The Contacts Picker is the only way a web page can see a phone book, and it is deliberately
 * narrow: the operating system draws the list, the person taps who to share, and the page is
 * handed just those entries. We never see the book itself, cannot ask twice without another tap,
 * and nothing is stored — which is exactly the shape this feature should have.
 *
 * Chrome on Android is currently the only place it exists. That is treated as an ordinary fact
 * rather than a failure: where it is absent the button is simply not drawn.
 */

/** One entry as the picker hands it back. Every field is optional — the OS decides. */
type DeviceContact = {
  name?: string[];
  tel?: string[];
  email?: string[];
  /** Some Android builds expose an organisation; when present it hints at a company. */
  organization?: string[];
};

type ContactsManager = {
  getProperties: () => Promise<string[]>;
  select: (
    properties: readonly string[],
    options?: { multiple?: boolean },
  ) => Promise<DeviceContact[]>;
};

/** The properties worth asking for, in the order they matter to us. */
const WANTED = ["name", "tel", "email"] as const;

function manager(): ContactsManager | null {
  // Both halves are required: `navigator.contacts` exists on some older WebViews without the
  // picker behind it, and asking there throws instead of returning nothing.
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  if (!("contacts" in navigator) || !("ContactsManager" in window)) return null;
  return (navigator as Navigator & { contacts: ContactsManager }).contacts;
}

/**
 * Whether to draw the button at all.
 *
 * Absent rather than disabled, the same rule the invite panel follows: a greyed-out button poses
 * a question it cannot answer, while an absent one leaves the routes that do work — and the file
 * import works everywhere.
 */
export function isDeviceContactsSupported(): boolean {
  return manager() !== null;
}

/** Why a device import could not happen, in words the person can act on. */
export class DeviceContactsError extends Error {}

/**
 * The person's own pick from their phone book.
 *
 * `getProperties()` is asked first and the request is narrowed to what it confirms, because
 * asking for a property the device does not support rejects the whole call — a phone book that
 * shares numbers but not emails would otherwise yield nothing at all rather than the numbers.
 *
 * Returns an empty array when the picker was dismissed: choosing nobody is a decision, not an
 * error, and it must not raise an alarm.
 */
export async function pickDeviceContacts(): Promise<ImportedContactCandidate[]> {
  const contacts = manager();
  if (contacts === null) {
    throw new DeviceContactsError(
      "Trình duyệt này không mở được danh bạ máy. Hãy dùng Chrome trên Android, hoặc nhập bằng file.",
    );
  }

  let available: string[];
  try {
    available = await contacts.getProperties();
  } catch (error) {
    console.error("[contact-device] không đọc được danh sách thuộc tính", error);
    throw new DeviceContactsError("Không mở được danh bạ máy. Hãy thử lại.");
  }

  const requested = WANTED.filter((property) => available.includes(property));

  // A name alone is not a contact. Saying so plainly beats opening a picker whose every result
  // would then be silently discarded.
  if (!requested.includes("tel") && !requested.includes("email")) {
    throw new DeviceContactsError(
      "Danh bạ máy này không chia sẻ được số điện thoại/email qua trình duyệt. Hãy nhập bằng file thay vì danh bạ.",
    );
  }

  let picked: DeviceContact[];
  try {
    picked = await contacts.select(requested, { multiple: true });
  } catch (error) {
    // The picker rejects when it is dismissed on some versions, which is not a failure.
    console.error("[contact-device] chọn danh bạ không thành công", error);
    return [];
  }

  return picked.map(toCandidate);
}

/** The first non-empty name the OS gave, or nothing. */
function firstName(entry: DeviceContact): string {
  for (const value of entry.name ?? []) {
    const trimmed = (value ?? "").trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/**
 * One phone-book entry as a candidate.
 *
 * `suggestedType` stays null: a phone book has no notion of a company, so guessing from an
 * organisation field would file a person as a business on the strength of their employer being
 * written down. The preview asks instead — one toggle, off by default.
 */
export function toCandidate(entry: DeviceContact): ImportedContactCandidate {
  return {
    name: firstName(entry),
    phones: (entry.tel ?? []).filter((value) => (value ?? "").trim().length > 0),
    emails: (entry.email ?? []).filter((value) => (value ?? "").trim().length > 0),
    suggestedType: null,
    source: "import_device",
  };
}
