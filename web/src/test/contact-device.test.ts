import { vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  DeviceContactsError,
  isDeviceContactsSupported,
  pickDeviceContacts,
  toCandidate,
} from "@/lib/contact-device";

type Picked = {
  name?: string[];
  tel?: string[];
  email?: string[];
};

/**
 * Stands in for the operating system's picker.
 *
 * `asked` records exactly which properties were requested, which is the point of most of these
 * tests: asking for one the device does not support rejects the whole call, so the request has
 * to be narrowed to what `getProperties()` confirmed.
 */
function installPicker(options: {
  properties: string[];
  result?: Picked[];
  failGetProperties?: boolean;
  failSelect?: boolean;
}): { asked: string[][] } {
  const asked: string[][] = [];

  const contacts = {
    getProperties: async () => {
      if (options.failGetProperties === true) throw new Error("no");
      return options.properties;
    },
    select: async (properties: readonly string[]) => {
      asked.push([...properties]);
      if (options.failSelect === true) throw new Error("dismissed");
      return options.result ?? [];
    },
  };

  vi.stubGlobal("navigator", { contacts });
  vi.stubGlobal("window", { ContactsManager: function ContactsManager() {} });

  return { asked };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whether the phone book can be opened at all", () => {
  it("is available when both halves of the API are present", () => {
    installPicker({ properties: ["name", "tel"] });
    expect(isDeviceContactsSupported()).toBe(true);
  });

  /**
   * Some older WebViews expose `navigator.contacts` with no picker behind it, where asking
   * throws instead of returning nothing — so both halves are required before the button appears.
   */
  it("is unavailable when the manager is missing, even if contacts exists", () => {
    vi.stubGlobal("navigator", { contacts: {} });
    vi.stubGlobal("window", {});
    expect(isDeviceContactsSupported()).toBe(false);
  });

  it("is unavailable on a browser with no phone book at all", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {});
    expect(isDeviceContactsSupported()).toBe(false);
  });

  it("refuses to open rather than throwing something raw", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {});
    await expect(pickDeviceContacts()).rejects.toBeInstanceOf(DeviceContactsError);
  });
});

describe("asking the device only for what it has", () => {
  it("asks for all three when all three are supported", async () => {
    const picker = installPicker({ properties: ["name", "tel", "email", "address"] });
    await pickDeviceContacts();
    expect(picker.asked[0]).toEqual(["name", "tel", "email"]);
  });

  /** Asking for `email` where it is unsupported rejects the call and yields nothing at all. */
  it("leaves out a property the device does not support", async () => {
    const picker = installPicker({ properties: ["name", "tel"] });
    await pickDeviceContacts();
    expect(picker.asked[0]).toEqual(["name", "tel"]);
  });

  it("never asks for a property outside the three it uses", async () => {
    const picker = installPicker({ properties: ["name", "tel", "email", "icon", "address"] });
    await pickDeviceContacts();
    expect(picker.asked[0]).not.toContain("icon");
    expect(picker.asked[0]).not.toContain("address");
  });

  /**
   * A name with no way to reach it is not a contact, so this is said plainly instead of opening
   * a picker whose every result would then be silently discarded.
   */
  it("says so when the device shares neither numbers nor emails", async () => {
    const picker = installPicker({ properties: ["name", "address"] });
    await expect(pickDeviceContacts()).rejects.toThrow(/không chia sẻ được số điện thoại\/email/);
    expect(picker.asked).toHaveLength(0);
  });

  it("reports a failure to read the properties in the reader's own words", async () => {
    installPicker({ properties: [], failGetProperties: true });
    await expect(pickDeviceContacts()).rejects.toBeInstanceOf(DeviceContactsError);
  });

  /** Choosing nobody is a decision, not a failure, and must not raise an alarm. */
  it("treats a dismissed picker as an empty choice", async () => {
    installPicker({ properties: ["name", "tel"], failSelect: true });
    await expect(pickDeviceContacts()).resolves.toEqual([]);
  });
});

describe("one phone book entry as a candidate", () => {
  it("keeps every number and address the entry had", () => {
    const entry = toCandidate({
      name: ["Chị Hoa"],
      tel: ["0912345678", "0987000111"],
      email: ["hoa@example.com"],
    });
    expect(entry.phones).toEqual(["0912345678", "0987000111"]);
    expect(entry.emails).toEqual(["hoa@example.com"]);
  });

  it("takes the first name the system offered", () => {
    expect(toCandidate({ name: ["", "  ", "Chị Hoa"] }).name).toBe("Chị Hoa");
  });

  it("copes with an entry the system gave no fields for", () => {
    const entry = toCandidate({});
    expect(entry.name).toBe("");
    expect(entry.phones).toEqual([]);
    expect(entry.emails).toEqual([]);
  });

  it("drops a blank number rather than carrying an empty channel", () => {
    expect(toCandidate({ tel: ["", "  ", "0912345678"] }).phones).toEqual(["0912345678"]);
  });

  /**
   * A phone book has no notion of a company, and guessing from an organisation field would file
   * a person as a business on the strength of their employer being written down.
   */
  it("never guesses that an entry is a company", () => {
    expect(toCandidate({ name: ["Công ty An Phát"], tel: ["02838220011"] }).suggestedType).toBeNull();
  });

  it("records that it came from the device, so the stored channel says so", () => {
    expect(toCandidate({ name: ["Hoà"], tel: ["0912345678"] }).source).toBe("import_device");
  });

  it("hands back one candidate per entry the person picked", async () => {
    installPicker({
      properties: ["name", "tel", "email"],
      result: [
        { name: ["Hoà"], tel: ["0912345678"] },
        { name: ["Nam"], email: ["nam@example.com"] },
      ],
    });
    const picked = await pickDeviceContacts();
    expect(picked.map((entry) => entry.name)).toEqual(["Hoà", "Nam"]);
  });
});
