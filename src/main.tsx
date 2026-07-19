import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import App from "./App";
import "./index.css";
import { setupStartupSmokeCapture } from "./startup-smoke-capture";
import { bootstrapServiceModeCutover } from "./services/service-mode-bootstrap";

async function main(): Promise<void> {
  await setupStartupSmokeCapture();
  await bootstrapServiceModeCutover();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void main();
