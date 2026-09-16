import { NoteField, TextField } from "@/components/contacts/fields";
import { EmployerPicker } from "@/components/contacts/EmployerPicker";
import {
  RELATIONSHIP_SUGGESTIONS,
  type BusinessDraft,
  type Contact,
  type IndividualDraft,
} from "@/lib/contacts";

const RELATIONSHIP_LIST_ID = "contact-relationship-suggestions";

/**
 * The fields of a person.
 *
 * Name first, then the two ways to reach them — the pair the rule is about, so they sit side by
 * side and a missing one is visible rather than discovered on save. Birthday and relationship
 * come after: things worth recording, never things required.
 *
 * The employer field only appears when editing. On creation the company may not exist yet, and
 * a picker offering an empty list is a question with no answers.
 */
export function IndividualFields({
  draft,
  onChange,
  contacts,
  showEmployer = false,
  excludeId = null,
}: {
  draft: IndividualDraft;
  onChange: (next: IndividualDraft) => void;
  contacts?: readonly Contact[];
  showEmployer?: boolean;
  excludeId?: string | null;
}) {
  return (
    <div className="space-y-4">
      <TextField
        id="individual-name"
        label="Tên"
        required
        autoFocus
        value={draft.name}
        placeholder="Nguyễn Văn A"
        onChange={(name) => onChange({ ...draft, name })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="individual-phone"
          label="Điện thoại"
          type="tel"
          inputMode="tel"
          value={draft.phone}
          placeholder="0900 000 000"
          onChange={(phone) => onChange({ ...draft, phone })}
        />
        <TextField
          id="individual-email"
          label="Email"
          type="email"
          inputMode="email"
          value={draft.email}
          placeholder="ten@vidu.com"
          onChange={(email) => onChange({ ...draft, email })}
        />
      </div>
      <p className="-mt-1 text-[12.5px] text-muted-foreground">Cần ít nhất một trong hai.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="individual-dob"
          label="Ngày sinh"
          type="date"
          value={draft.dateOfBirth}
          onChange={(dateOfBirth) => onChange({ ...draft, dateOfBirth })}
        />
        <div>
          <TextField
            id="individual-relationship"
            label="Quan hệ"
            value={draft.relationshipTag}
            list={RELATIONSHIP_LIST_ID}
            placeholder="Gia đình, Bạn bè, Đối tác…"
            onChange={(relationshipTag) => onChange({ ...draft, relationshipTag })}
          />
          <datalist id={RELATIONSHIP_LIST_ID}>
            {RELATIONSHIP_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>
      </div>

      {showEmployer && contacts !== undefined ? (
        <EmployerPicker
          contacts={contacts}
          excludeId={excludeId}
          value={draft.employerContactId}
          onChange={(employerContactId) => onChange({ ...draft, employerContactId })}
        />
      ) : null}

      <NoteField id="individual-note" value={draft.note} onChange={(note) => onChange({ ...draft, note })} />
    </div>
  );
}

/**
 * The fields of a company.
 *
 * Grouped as the company itself, then the person who answers for it: a tax code identifies the
 * entity, a representative is who you actually call. The four channels are deliberately drawn
 * as two pairs so "at least one of these four" is a rule about a visible block rather than a
 * sentence about fields scattered down the form.
 */
export function BusinessFields({
  draft,
  onChange,
}: {
  draft: BusinessDraft;
  onChange: (next: BusinessDraft) => void;
}) {
  return (
    <div className="space-y-4">
      <TextField
        id="business-name"
        label="Tên công ty"
        required
        autoFocus
        value={draft.name}
        placeholder="Công ty TNHH ABC"
        onChange={(name) => onChange({ ...draft, name })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="business-tax-code"
          label="Mã số thuế"
          required
          inputMode="numeric"
          value={draft.taxCode}
          placeholder="0101234567"
          onChange={(taxCode) => onChange({ ...draft, taxCode })}
        />
        <TextField
          id="business-industry"
          label="Ngành nghề"
          value={draft.industry}
          placeholder="Xây dựng, Bán lẻ…"
          onChange={(industry) => onChange({ ...draft, industry })}
        />
      </div>

      <TextField
        id="business-address"
        label="Địa chỉ"
        value={draft.businessAddress}
        placeholder="Số nhà, đường, phường, tỉnh/thành"
        onChange={(businessAddress) => onChange({ ...draft, businessAddress })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="business-phone"
          label="Điện thoại công ty"
          type="tel"
          inputMode="tel"
          value={draft.phone}
          placeholder="028 0000 0000"
          onChange={(phone) => onChange({ ...draft, phone })}
        />
        <TextField
          id="business-email"
          label="Email công ty"
          type="email"
          inputMode="email"
          value={draft.email}
          placeholder="lienhe@congty.com"
          onChange={(email) => onChange({ ...draft, email })}
        />
      </div>

      <div className="rounded-lg border border-border bg-accent/20 p-4">
        <p className="text-[13px] font-semibold text-foreground">Người đại diện</p>
        <div className="mt-3 space-y-4">
          <TextField
            id="business-rep-name"
            label="Họ tên"
            required
            value={draft.representativeName}
            placeholder="Nguyễn Văn B"
            onChange={(representativeName) => onChange({ ...draft, representativeName })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="business-rep-phone"
              label="Điện thoại"
              type="tel"
              inputMode="tel"
              value={draft.representativePhone}
              placeholder="0900 000 000"
              onChange={(representativePhone) => onChange({ ...draft, representativePhone })}
            />
            <TextField
              id="business-rep-email"
              label="Email"
              type="email"
              inputMode="email"
              value={draft.representativeEmail}
              placeholder="ten@congty.com"
              onChange={(representativeEmail) => onChange({ ...draft, representativeEmail })}
            />
          </div>
        </div>
      </div>

      <p className="-mt-1 text-[12.5px] text-muted-foreground">
        Cần ít nhất một số điện thoại hoặc email — của công ty hoặc của người đại diện.
      </p>

      <NoteField id="business-note" value={draft.note} onChange={(note) => onChange({ ...draft, note })} />
    </div>
  );
}
