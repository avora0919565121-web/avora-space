import { createRoot } from "react-dom/client";

import { MovedScreen } from "@/components/MovedScreen";
import { hostRoleOf, movedUrl } from "@/lib/app-origin";
import { applyFont, currentFont } from "@/lib/font-pref";
import { logError } from "@/lib/log";
import { registerServiceWorker, unregisterServiceWorkers } from "@/lib/register-sw";

import App from "./App.tsx";
import "./index.css";

// KHỐI 0: one address. Rork serves every host from the same build, so the move happens here,
// before anything signs in: www. goes straight on; an old address only shows "Avora đã chuyển".
const role = hostRoleOf(window.location.hostname);
// KHỐI 2E: the one font chosen on this device (index.html painted it already; this fetches its face).
applyFont(currentFont());
// 112-F: a crash outside React (or a forgotten promise) is recorded like any other — name and code only.
window.addEventListener("error", (event) => logError("window", event.error ?? { name: "Error", code: "script_error" }));
window.addEventListener("unhandledrejection", (event) => logError("promise", event.reason));
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
