import { createRoot } from "react-dom/client";

import { MovedScreen } from "@/components/MovedScreen";
import { hostRoleOf, movedUrl } from "@/lib/app-origin";
import { registerServiceWorker, unregisterServiceWorkers } from "@/lib/register-sw";

import App from "./App.tsx";
import "./index.css";

// KHỐI 0: one address. Rork serves every host from the same build, so the move happens here,
// before anything signs in: www. goes straight on; an old address only shows "Avora đã chuyển".
const role = hostRoleOf(window.location.hostname);
const root = createRoot(document.getElementById("root")!);

if (role === "alias") {
  window.location.replace(movedUrl(window.location));
} else if (role === "retired") {
  root.render(<MovedScreen />);
  void unregisterServiceWorkers();
} else {
  root.render(<App />);
  registerServiceWorker();
}
