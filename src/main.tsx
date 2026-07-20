import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import App from "./App";
import "./index.css";
import { StartupErrorScreen } from "./components/startup/StartupErrorScreen";
import { setupStartupSmokeCapture } from "./startup-smoke-capture";
import { bootstrapServiceModeCutover } from "./services/service-mode-bootstrap";

function formatBootstrapError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

async function main(): Promise<void> {
  await setupStartupSmokeCapture();
  try {
    await bootstrapServiceModeCutover();
  } catch (error) {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <StartupErrorScreen message={formatBootstrapError(error)} />
      </React.StrictMode>,
    );
    return;
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void main();
