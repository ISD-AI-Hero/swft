import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ThemeProvider } from "@hooks/useTheme";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance, AUTH_ENABLED } from "@lib/auth";

async function bootstrap() {
  const rootElement = document.getElementById("root") as HTMLElement;

  if (AUTH_ENABLED) {
    // Initialize MSAL, then explicitly process any pending redirect before first render.
    // Without handleRedirectPromise(), the account may not be set before MsalProvider mounts,
    // causing AuthGuard to loop.
    await msalInstance.initialize();
    try {
      const redirectResult = await msalInstance.handleRedirectPromise();
      if (redirectResult?.account) {
        msalInstance.setActiveAccount(redirectResult.account);
      } else {
        // No redirect response — pick the first cached account if available.
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) msalInstance.setActiveAccount(accounts[0]);
      }
    } catch (err) {
      // Log to console so auth errors are visible during development.
      console.error("[MSAL] Redirect error:", err);
    }
  }

  const content = (
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>
  );

  ReactDOM.createRoot(rootElement).render(
    AUTH_ENABLED ? (
      <MsalProvider instance={msalInstance}>{content}</MsalProvider>
    ) : (
      content
    )
  );
}

void bootstrap();
