import { createRoot } from "react-dom/client";

import { registerServiceWorker } from "@/lib/register-sw";

import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

registerServiceWorker();
