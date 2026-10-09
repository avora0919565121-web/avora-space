import { APP_HOST, movedUrl } from "@/lib/app-origin";

/**
 * KHỐI 0 — on an old address the app does not start: no sign-in, no data, one way forward.
 * Rendered instead of <App/> (see main.tsx), so nothing on this address can drift from the real one.
 */
export function MovedScreen() {
  const target = movedUrl(window.location);
  return (
    <main className="paper flex min-h-[100dvh] items-center justify-center px-6 py-[max(env(safe-area-inset-top),24px)]">
      <div className="w-full max-w-sm text-center" data-moved-screen="">
        <img src="/icon.png" alt="" className="mx-auto h-16 w-16 rounded-2xl" />
        <h1 className="mt-6 text-[22px] font-semibold tracking-tight text-foreground">Avora đã chuyển sang {APP_HOST}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Từ nay Avora chỉ dùng một địa chỉ. Ở địa chỉ mới, máy này cần đặt lại làm máy chính (mật khẩu + mã email) và mở Két sắt
          bằng Mật khẩu Két sắt một lần.
        </p>
        <a
          href={target}
          className="press mt-7 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground"
        >
          Mở địa chỉ mới
        </a>
        <p className="mt-4 text-[13px] text-muted-foreground">
          Đã cài Avora lên Màn hình chính? Xoá biểu tượng cũ rồi cài lại từ {APP_HOST}.
        </p>
      </div>
    </main>
  );
}
