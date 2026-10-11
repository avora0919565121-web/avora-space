import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ImageIcon, Loader2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  FEEDBACK_KINDS,
  amIOps,
  feedbackContext,
  feedbackKeys,
  feedbackKindLabel,
  feedbackStatusLabel,
  fetchFeedback,
  setFeedbackStatus,
  submitFeedback,
  type FeedbackKind,
  type FeedbackRow,
  type FeedbackStatus,
} from "@/lib/feedback";
import {
  COUNTRY_NAME,
  INVITE_COUNTRIES,
  createInviteCode,
  fetchInviteCodes,
  inviteUsage,
  isInviteRequired,
  setInviteCodeActive,
  setInviteRequired,
  type InviteCountry,
} from "@/lib/invites";
import { cn } from "@/lib/utils";

const STATUSES: readonly FeedbackStatus[] = ["moi", "dang_xem", "da_lam", "khong_lam"];

function when(at: string): string {
  return new Date(at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * AVORA-100 · G.1 — Cài đặt › Góp ý cho Avora. The sheet, then my own notes with where they stand
 * (`Đã gửi · Đang xem · Đã làm`). Avora's team (`ops_user_ids`) also gets `?xem=tat-ca`: every note,
 * filters, status, and the invite codes (G.3). The server decides who is on the team.
 */
const SettingsFeedback = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const userId = user?.id ?? "";
  const ops = useQuery({ queryKey: feedbackKeys.ops(userId), queryFn: amIOps, enabled: userId !== "", staleTime: 5 * 60_000 });
  const isTeamView = params.get("xem") === "tat-ca" && ops.data === true;
  const mine = useQuery({ queryKey: feedbackKeys.mine(userId), queryFn: () => fetchFeedback(userId), enabled: userId !== "" && !isTeamView });

  const from = (location.state as { from?: string } | null)?.from ?? location.pathname;

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto" data-settings-feedback={isTeamView ? "team" : "mine"}>
      <div data-under-tabs="" className="mx-auto max-w-2xl animate-rise-in space-y-s-4 px-4 pb-8 pt-4 md:px-10 md:pb-12">
        {isTeamView ? (
          <TeamView />
        ) : (
          <>
            <section aria-labelledby="feedback-heading" className="rounded-card border border-border bg-card p-s-4">
              <h2 id="feedback-heading" className="text-[17px] font-semibold tracking-tight text-foreground">
                Góp ý cho Avora
              </h2>
              <p className="mt-1 text-[14px] text-muted-foreground">Một lỗi, một ý tưởng, một chỗ khó dùng — đội Avora đọc từng góp ý.</p>
              <FeedbackForm
                variant="app"
                className="mt-s-4"
                onSubmit={async (draft) => {
                  await submitFeedback(userId, draft, feedbackContext(from));
                  toast.success("Đã gửi góp ý. Cảm ơn bạn!");
                  await queryClient.invalidateQueries({ queryKey: feedbackKeys.mine(userId) });
                }}
              />
            </section>

            {(mine.data?.length ?? 0) > 0 ? (
              <section aria-labelledby="feedback-mine" className="rounded-card border border-border bg-card px-s-4 py-2">
                <h2 id="feedback-mine" className="py-2 text-[15px] font-semibold text-foreground">
                  Góp ý bạn đã gửi
                </h2>
                <ul className="divide-y divide-border">
                  {(mine.data ?? []).map((row) => (
                    <li key={row.id} className="flex items-start gap-3 py-3" data-feedback-mine={row.status}>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[15px] text-foreground">{row.body}</p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                          {feedbackKindLabel(row.kind)} · {when(row.created_at)}
                        </p>
                      </div>
                      <StatusTag status={row.status} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {ops.data === true ? (
              <Link to="/cai-dat/gop-y?xem=tat-ca" data-feedback-team-link="" className="press flex min-h-12 items-center justify-between rounded-card border border-border bg-card px-s-4 text-[15px] font-medium text-foreground">
                Màn đội Avora · mọi góp ý và mã mời
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

function StatusTag({ status, forTeam = false }: { status: FeedbackStatus; forTeam?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium",
        status === "da_lam" ? "bg-primary/10 text-primary" : status === "dang_xem" ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {feedbackStatusLabel(status, forTeam)}
    </span>
  );
}

function TeamView() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<FeedbackKind | "all">("all");
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const all = useQuery({ queryKey: feedbackKeys.all, queryFn: () => fetchFeedback(null) });
  const shown = useMemo<FeedbackRow[]>(
    () => (all.data ?? []).filter((r) => (kind === "all" || r.kind === kind) && (status === "all" || r.status === status)),
    [all.data, kind, status],
  );
  const change = useMutation({
    mutationFn: ({ id, next }: { id: string; next: FeedbackStatus }) => setFeedbackStatus(id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedbackKeys.all }),
    onError: (err: Error) => toast.error(err.message),
  });

  const openShot = async (path: string): Promise<void> => {
    const { data } = await supabase.storage.from("feedback-shots").createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <>
      <section aria-labelledby="team-feedback" className="rounded-card border border-border bg-card p-s-4" data-team-feedback="">
        <h2 id="team-feedback" className="text-[17px] font-semibold tracking-tight text-foreground">
          Mọi góp ý
        </h2>
        <div className="mt-s-2 flex flex-wrap gap-2">
          <select aria-label="Lọc theo loại" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind | "all")} className="h-11 rounded-control border border-border bg-card px-3 text-[16px] md:text-[15px]">
            <option value="all">Mọi loại</option>
            {FEEDBACK_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <select aria-label="Lọc theo trạng thái" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | "all")} className="h-11 rounded-control border border-border bg-card px-3 text-[16px] md:text-[15px]">
            <option value="all">Mọi trạng thái</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {feedbackStatusLabel(s, true)}
              </option>
            ))}
          </select>
        </div>
        {all.isPending ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-muted-foreground" aria-label="Đang tải" /> : null}
        <ul className="mt-s-2 divide-y divide-border">
          {shown.map((row) => (
            <li key={row.id} className="py-3" data-team-row={row.id}>
              <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-[15px] text-foreground">{row.body}</p>
                <select
                  aria-label="Trạng thái"
                  value={row.status}
                  onChange={(e) => change.mutate({ id: row.id, next: e.target.value as FeedbackStatus })}
                  className="h-10 shrink-0 rounded-control border border-border bg-card px-2 text-[16px] md:text-[14px]"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {feedbackStatusLabel(s, true)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {feedbackKindLabel(row.kind)} · {row.source === "web" ? "/gop-y" : "trong app"} · {when(row.created_at)}
                {row.page ? ` · ${row.page}` : ""}
                {row.device ? ` · ${row.device}` : ""}
                {row.screen ? ` · ${row.screen}` : ""}
                {row.app_version ? ` · ${row.app_version}` : ""}
                {row.email ? ` · ${row.email}` : ""}
              </p>
              {row.attachment_path !== null ? (
                <button type="button" onClick={() => void openShot(row.attachment_path ?? "")} className="press mt-1 inline-flex min-h-10 items-center gap-1.5 text-[13.5px] text-primary">
                  <ImageIcon className="h-4 w-4" aria-hidden="true" /> Xem ảnh màn hình
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {all.data !== undefined && shown.length === 0 ? <p className="py-4 text-[14px] text-muted-foreground">Không có góp ý nào khớp.</p> : null}
      </section>
      <InviteAdmin />
    </>
  );
}

function InviteAdmin() {
  const queryClient = useQueryClient();
  const codes = useQuery({ queryKey: feedbackKeys.invites, queryFn: fetchInviteCodes });
  const required = useQuery({ queryKey: ["invite-required"], queryFn: isInviteRequired });
  const [code, setCode] = useState<string>("");
  const [country, setCountry] = useState<InviteCountry>("VN");
  const [partner, setPartner] = useState<string>("");
  const [wave, setWave] = useState<number>(0);
  const [locale, setLocale] = useState<"vi" | "en">("vi");
  const [maxUses, setMaxUses] = useState<number>(50);
  const usage = useMemo(() => inviteUsage(codes.data ?? []), [codes.data]);

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: feedbackKeys.invites });
  const create = useMutation({
    mutationFn: () => createInviteCode({ code, country, partner, wave, locale, maxUses }),
    onSuccess: () => {
      setCode("");
      setPartner("");
      refresh();
      toast.success("Đã tạo mã mời.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const toggleRequired = useMutation({
    mutationFn: (on: boolean) => setInviteRequired(on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invite-required"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (code.trim() === "") return;
    create.mutate();
  };

  return (
    <section aria-labelledby="team-invites" className="rounded-card border border-border bg-card p-s-4" data-team-invites="">
      <h2 id="team-invites" className="text-[17px] font-semibold tracking-tight text-foreground">
        Mã mời
      </h2>
      <label className="mt-s-2 flex min-h-12 items-center justify-between gap-3">
        <span>
          <span className="block text-[15px] text-foreground">Bắt buộc mã mời khi đăng ký</span>
          <span className="block text-[12.5px] text-muted-foreground">Chỉ áp cho tài khoản tạo sau lúc bật. Tài khoản cũ không bị ảnh hưởng.</span>
        </span>
        <Switch checked={required.data === true} onCheckedChange={(on) => toggleRequired.mutate(on)} aria-label="Bắt buộc mã mời" />
      </label>

      <form onSubmit={submit} className="mt-s-4 grid grid-cols-2 gap-2">
        <input aria-label="Mã" placeholder="AVR-US-01" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="col-span-2 h-11 rounded-control border border-border bg-card px-3 text-[16px] uppercase md:text-[15px]" />
        <select aria-label="Nước" value={country} onChange={(e) => setCountry(e.target.value as InviteCountry)} className="h-11 rounded-control border border-border bg-card px-2 text-[16px] md:text-[15px]">
          {INVITE_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c} · {COUNTRY_NAME[c]}
            </option>
          ))}
        </select>
        <select aria-label="Ngôn ngữ" value={locale} onChange={(e) => setLocale(e.target.value === "en" ? "en" : "vi")} className="h-11 rounded-control border border-border bg-card px-2 text-[16px] md:text-[15px]">
          <option value="vi">Tiếng Việt</option>
          <option value="en">English</option>
        </select>
        <select aria-label="Đợt" value={wave} onChange={(e) => setWave(Number(e.target.value))} className="h-11 rounded-control border border-border bg-card px-2 text-[16px] md:text-[15px]">
          <option value={0}>Đợt 0</option>
          <option value={1}>Đợt 1</option>
          <option value={2}>Đợt 2</option>
        </select>
        <input aria-label="Số lượt" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))} className="h-11 rounded-control border border-border bg-card px-3 text-[16px] md:text-[15px]" />
        <input aria-label="Đối tác" placeholder="Đối tác (không bắt buộc)" value={partner} onChange={(e) => setPartner(e.target.value)} className="col-span-2 h-11 rounded-control border border-border bg-card px-3 text-[16px] md:text-[15px]" />
        <button type="submit" disabled={create.isPending || code.trim() === ""} className="press col-span-2 h-11 rounded-control bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50">
          Tạo mã
        </button>
      </form>

      {usage.length > 0 ? (
        <table className="mt-s-4 w-full text-left text-[14px]" data-invite-usage="">
          <thead className="text-[12.5px] text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Nước</th>
              <th className="py-1 font-medium">Đợt</th>
              <th className="py-1 text-right font-medium">Đã dùng</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u) => (
              <tr key={`${u.country}-${u.wave}`} className="border-t border-border">
                <td className="py-2">{COUNTRY_NAME[u.country]}</td>
                <td className="py-2">{u.wave}</td>
                <td className="py-2 text-right tabular-nums">
                  {u.used} / {u.max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <ul className="mt-s-2 divide-y divide-border">
        {(codes.data ?? []).map((row) => (
          <li key={row.code} className="flex min-h-12 items-center gap-3 py-2" data-invite-code={row.code}>
            <div className="min-w-0 flex-1">
              <p className={cn("font-mono text-[14.5px]", row.active ? "text-foreground" : "text-muted-foreground line-through")}>{row.code}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {COUNTRY_NAME[row.country]} · đợt {row.wave} · {row.locale} · {row.used}/{row.max_uses}
                {row.partner ? ` · ${row.partner}` : ""}
              </p>
            </div>
            <Switch
              checked={row.active}
              aria-label={`Bật mã ${row.code}`}
              onCheckedChange={(on) => void setInviteCodeActive(row.code, on).then(refresh, (err: Error) => toast.error(err.message))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SettingsFeedback;
