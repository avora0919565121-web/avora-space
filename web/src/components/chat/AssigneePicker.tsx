import { Check, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import type { GroupMember } from "@/lib/groups";
import { assignSummary, memberLabel, searchAssignees } from "@/lib/member-search";
import { cn } from "@/lib/utils";

type AssigneePickerProps = {
  id: string;
  members: readonly GroupMember[];
  /** Everyone chosen so far, in the order they were picked. */
  selected: readonly GroupMember[];
  onChange: (next: GroupMember[]) => void;
  /** The person doing the choosing, who is never a candidate for their own shared task. */
  selfId: string | undefined;
};

/**
 * Type a name, pick people — as many as the work actually involves.
 *
 * A dropdown asks you to read the whole group before finding one person, and only lets you
 * name one. Here the list narrows as you type, with or without tone marks, and each person
 * chosen becomes a chip you can take back off before committing. Choosing several people
 * creates several separate tasks: one promise per person, each finished on its own.
 */
export function AssigneePicker({ id, members, selected, onChange, selfId }: AssigneePickerProps) {
  const [query, setQuery] = useState<string>("");
  const [highlight, setHighlight] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedIds = useMemo(() => selected.map((member) => member.userId), [selected]);

  const matches = useMemo(
    () => searchAssignees(members, query, { excludeUserIds: selectedIds, selfId }),
    [members, query, selectedIds, selfId],
  );

  const add = (member: GroupMember): void => {
    onChange([...selected, member]);
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  };

  const remove = (userId: string): void => {
    onChange(selected.filter((member) => member.userId !== userId));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (matches.length === 0 ? 0 : (current + 1) % matches.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length));
      return;
    }
    if (event.key === "Enter") {
      // The picker owns Enter while a suggestion is highlighted, so it never submits the form early.
      const candidate = matches[highlight];
      if (candidate) {
        event.preventDefault();
        add(candidate);
      }
      return;
    }
    // Backspace on an empty box takes back the last chip — the usual shorthand in a tag field.
    if (event.key === "Backspace" && query === "" && selected.length > 0) {
      remove(selected[selected.length - 1].userId);
    }
  };

  const hasCandidates = members.some((member) => member.userId !== selfId);

  if (!hasCandidates) {
    return (
      <p className="rounded-[10px] border border-border bg-secondary/40 px-3 py-2.5 text-[13px] text-muted-foreground">
        Nhóm chưa có thành viên nào khác để giao việc.
      </p>
    );
  }

  return (
    <div>
      <div className="rounded-[10px] border border-input bg-card px-2 py-2">
        {selected.length > 0 ? (
          <ul className="mb-1.5 flex flex-wrap gap-1.5">
            {selected.map((member) => (
              <li key={member.userId}>
                <span className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-1 pl-2 pr-1 text-[13px] text-foreground">
                  {memberLabel(member)}
                  <button
                    type="button"
                    onClick={() => remove(member.userId)}
                    aria-label={`Bỏ ${memberLabel(member)} khỏi danh sách`}
                    className="press flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          id={id}
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? "Gõ tên người đảm trách…" : "Thêm người nữa…"}
          className="h-10 w-full bg-transparent px-1 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <ul id={`${id}-options`} role="listbox" className="mt-1.5 space-y-1">
        {matches.length === 0 ? (
          <li className="px-1 py-1 text-[13px] text-muted-foreground">
            {query.trim() === "" ? "Đã chọn tất cả thành viên." : `Không có ai khớp với “${query.trim()}”.`}
          </li>
        ) : (
          matches.map((member, index) => (
            <li key={member.userId}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => add(member)}
                className={cn(
                  "press flex min-h-12 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors",
                  index === highlight ? "bg-accent/70" : "hover:bg-accent/40",
                )}
              >
                <InitialsAvatar name={memberLabel(member)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span
                    data-member-name=""
                    className="block truncate text-[14px] font-medium text-foreground"
                  >
                    {memberLabel(member)}
                  </span>
                  {member.email !== null ? (
                    <span className="block truncate text-[12px] text-muted-foreground">{member.email}</span>
                  ) : null}
                </span>
                <Check className="h-4 w-4 shrink-0 text-muted-foreground opacity-0" aria-hidden="true" />
              </button>
            </li>
          ))
        )}
      </ul>

      <p className="mt-1.5 text-[12px] text-muted-foreground">{assignSummary(selected.length)}</p>
    </div>
  );
}
