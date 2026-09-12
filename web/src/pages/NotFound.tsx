import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

import { HOME_ROUTE } from "@/lib/navigation";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404: route không tồn tại:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="paper flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <span className="wordmark text-[16px] text-muted-foreground">AVORA</span>
        <h1 className="mt-8 text-[34px] font-semibold tracking-tight text-foreground">Không tìm thấy trang</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">
          Đường dẫn bạn mở không tồn tại hoặc đã được chuyển đi.
        </p>
        <Link
          to={HOME_ROUTE}
          className="press mt-8 inline-flex rounded-md bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
        >
          Về Avora Space
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
