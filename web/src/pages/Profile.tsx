import { Check, Loader2, LogOut } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { useAuth, useDisplayName } from "@/lib/auth";

/** Signed-in confirmation screen: real profile data from Supabase, scoped by RLS to this user. */
const Profile = () => {
  const { user, profile, profileError, updateDisplayName, signOut } = useAuth();
  const displayName = useDisplayName();
  const navigate = useNavigate();

  const [nameDraft, setNameDraft] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(profile?.display_name ?? "");
  }, [profile?.display_name]);

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setIsSaving(true);
    const result = await updateDisplayName(nameDraft);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    navigate("/dang-nhap", { replace: true });
  };

  const joinedAt = profile?.created_at
    ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
        new Date(profile.created_at),
      )
    : "—";

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl animate-rise-in px-6 py-12 md:px-10">
        <div className="flex items-center gap-4">
          <InitialsAvatar name={displayName} size="lg" online />
          <div className="min-w-0">
            <h1 className="truncate text-[28px] font-semibold tracking-tight text-foreground">
              Xin chào, {displayName}
            </h1>
            <p className="mt-1 truncate text-[15px] text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="text-[17px] font-semibold text-foreground">Hồ sơ của bạn</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Chỉ bạn đọc và sửa được hồ sơ này — được bảo vệ bằng Row Level Security.
          </p>

          {profileError ? (
            <p role="alert" className="mt-4 rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
              {profileError}
            </p>
          ) : null}

          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="profileName" className="block text-[14px] font-medium text-foreground">
                Tên hiển thị
              </label>
              <input
                id="profileName"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Chưa đặt tên"
                className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="press flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Lưu thay đổi
              </button>
              {saved ? (
                <span role="status" className="flex items-center gap-1.5 text-[14px] text-online">
                  <Check className="h-4 w-4" strokeWidth={2} />
                  Đã lưu
                </span>
              ) : null}
            </div>
          </form>

          <dl className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-muted-foreground">Email đăng nhập</dt>
              <dd className="mt-1 truncate text-[15px] text-foreground">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Ngày tạo hồ sơ</dt>
              <dd className="tabular mt-1 text-[15px] text-foreground">{joinedAt}</dd>
            </div>
          </dl>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="press mt-6 flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.6} />
          Đăng xuất
        </button>
      </div>
    </div>
  );
};

export default Profile;
