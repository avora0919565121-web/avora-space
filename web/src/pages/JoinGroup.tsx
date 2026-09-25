import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { chatKeys } from "@/lib/chat";
import { joinGroupWithInvite, previewGroupInvite } from "@/lib/groups";

/**
 * The landing page of an invite link: it names the group and asks one question — join or not.
 * Joining is one press; the link makes the caller a plain member either way, so there is no
 * form to fill and no approval to wait for.
 */
export default function JoinGroup() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const previewQuery = useQuery({
    queryKey: ["group-invite-preview", token],
    queryFn: () => previewGroupInvite(token),
    enabled: token.length > 0,
  });

  const joinMutation = useMutation({
    mutationFn: () => joinGroupWithInvite(token),
    onSuccess: (conversationId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      toast.success(`Bạn đã vào nhóm “${previewQuery.data?.groupName ?? "Nhóm"}”.`);
      navigate(`/tin-nhan/${conversationId}`, { replace: true });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="paper flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-12">
      <div className="w-full max-w-sm text-center">
        {previewQuery.isPending ? (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
            <span className="sr-only">Đang tải lời mời</span>
          </>
        ) : previewQuery.isError ? (
          <>
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
              Liên kết mời không còn hiệu lực.
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              Liên kết này đã bị thu hồi hoặc không tồn tại. Hãy xin chủ nhóm một liên kết mới.
            </p>
            <Link
              to="/tin-nhan"
              className="press mt-6 inline-block rounded-md border border-border px-4 py-2 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              Về Tin nhắn
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto flex w-fit items-center justify-center">
              <InitialsAvatar name={previewQuery.data.groupName} size="lg" />
            </div>
            <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              Lời mời tham gia nhóm
            </p>
            <h1 className="mt-1.5 truncate text-[22px] font-semibold tracking-tight text-foreground">
              {previewQuery.data.groupName}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              Tham gia để đọc và nhắn tin cùng mọi người trong nhóm. Bạn sẽ vào với tư cách thành viên
              thường.
            </p>
            <button
              type="button"
              disabled={joinMutation.isPending}
              onClick={() => joinMutation.mutate()}
              className="press mt-7 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {joinMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Đang tham gia…
                </>
              ) : (
                "Tham gia nhóm"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
