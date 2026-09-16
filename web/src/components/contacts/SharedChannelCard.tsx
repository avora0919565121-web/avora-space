import { Building2, Check, Mail, Phone, Trash2, UserRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  canAssignToBusiness,
  channelKindLabel,
  type SharedChannelChoice,
  type SharedChannelGroup,
} from "@/lib/contact-channels";
import { cn } from "@/lib/utils";

/**
 * One number, several people — the other kind of thing nobody has sorted out yet.
 *
 * The review screen's first list asks "which of this person's three numbers is real?". This asks
 * the reverse: a single number is written on three different contacts, which normally means a
 * shared office line, a number typed onto the wrong row, or a company saved as a person as well.
 * Only the reader knows which, so all three answers are offered plainly and none is pre-selected.
 *
 * Nothing happens on picking an answer — it takes a second press to act. Every choice here
 * deletes something from a contact, which is exactly where friction is worth its cost.
 */
export function SharedChannelCard({
  group,
  isWorking,
  onApply,
  onOpenContact,
}: {
  group: SharedChannelGroup;
  isWorking: boolean;
  onApply: (choice: SharedChannelChoice) => void;
  onOpenContact: (contactId: string) => void;
}) {
  const [choice, setChoice] = useState<SharedChannelChoice | null>(null);
  const Icon = group.kind === "phone" ? Phone : Mail;
  const offerBusiness = canAssignToBusiness(group);

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/70">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-foreground">
            {group.value}
          </span>
          <span className="block text-[12.5px] text-muted-foreground">
            {channelKindLabel(group.kind)} này đang gắn với {group.holders.length} liên hệ
          </span>
        </span>
      </div>

      {/* Named so it is obvious who would lose the value, before anything is chosen. */}
      <ul className="border-b border-border">
        {group.holders.map((holder) => {
          const isKept = choice?.kind === "keep-one" && choice.contactId === holder.contact.id;
          const isOwner =
            choice?.kind === "assign-business" && choice.contactId === holder.contact.id;
          const willLose = choice !== null && !isKept && !isOwner;

          return (
            <li
              key={holder.contact.id}
              className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  holder.contact.contactType === "business"
                    ? "bg-accent/60 text-accent-foreground"
                    : "bg-secondary text-foreground/70",
                )}
              >
                {holder.contact.contactType === "business" ? (
                  <Building2 className="h-[15px] w-[15px]" strokeWidth={1.7} aria-hidden="true" />
                ) : (
                  <UserRound className="h-[15px] w-[15px]" strokeWidth={1.7} aria-hidden="true" />
                )}
              </span>

              <button
                type="button"
                onClick={() => onOpenContact(holder.contact.id)}
                className="press min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[14px] text-foreground">
                  {holder.contact.name}
                </span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {holder.isPrimary ? "Đang dùng làm kênh chính" : "Kênh phụ"}
                  {holder.value !== group.value ? ` · ghi là ${holder.value}` : ""}
                </span>
              </button>

              {isKept || isOwner ? (
                <span className="shrink-0 text-[12px] font-medium text-money-in">Giữ lại</span>
              ) : willLose ? (
                <span className="shrink-0 text-[12px] text-muted-foreground">Sẽ bỏ</span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2.5 px-5 py-4">
        <p className="text-[13px] text-muted-foreground">
          {group.kind === "phone" ? "Số này" : "Email này"} thật sự là của ai?
        </p>

        <div className="flex flex-wrap gap-1.5">
          {group.holders.map((holder) => (
            <Chip
              key={holder.contact.id}
              isActive={choice?.kind === "keep-one" && choice.contactId === holder.contact.id}
              label={`Chỉ của ${holder.contact.name}`}
              onClick={() => setChoice({ kind: "keep-one", contactId: holder.contact.id })}
            />
          ))}
          <Chip
            isActive={choice?.kind === "remove-all"}
            label="Không của ai — bỏ khỏi tất cả"
            onClick={() => setChoice({ kind: "remove-all" })}
          />
        </div>

        {/* Offered only when a company is already among them: otherwise the choice would mean
            picking a company out of the whole address book, a bigger question than this one. */}
        {offerBusiness ? (
          <div className="rounded-lg border border-border bg-secondary/40 px-3.5 py-3">
            <p className="text-[12.5px] text-muted-foreground">
              Đây là thông tin của một doanh nghiệp?
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.businesses.map((business) => (
                <Chip
                  key={business.id}
                  isActive={choice?.kind === "assign-business" && choice.contactId === business.id}
                  label={`Của ${business.name}`}
                  onClick={() => setChoice({ kind: "assign-business", contactId: business.id })}
                />
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              Kênh sẽ thuộc về doanh nghiệp, và được bỏ khỏi những liên hệ cá nhân đang giữ nó.
            </p>
          </div>
        ) : null}

        {choice !== null ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              className="press h-9 gap-1.5 px-4 text-[13px]"
              disabled={isWorking}
              onClick={() => {
                onApply(choice);
                setChoice(null);
              }}
            >
              {choice.kind === "remove-all" ? (
                <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              )}
              {choice.kind === "remove-all" ? "Bỏ khỏi tất cả" : "Áp dụng"}
            </Button>
            <Button
              variant="ghost"
              className="press h-9 px-3 text-[13px] text-muted-foreground"
              disabled={isWorking}
              onClick={() => setChoice(null)}
            >
              Thôi
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Chip({
  isActive,
  label,
  onClick,
}: {
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "press rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        isActive
          ? "border-primary/60 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
