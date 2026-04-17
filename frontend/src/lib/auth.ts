import {
  PublicClientApplication,
  type Configuration,
  InteractionRequiredAuthError,
  type AccountInfo,
} from "@azure/msal-browser";

export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === "true";

const AUTHORITY_HOST =
  (import.meta.env.VITE_AUTH_AUTHORITY_HOST as string | undefined) ??
  "https://login.microsoftonline.us";

const TENANT_ID =
  (import.meta.env.VITE_AUTH_TENANT_ID as string | undefined) ?? "common";

const CLIENT_ID =
  (import.meta.env.VITE_AUTH_CLIENT_ID as string | undefined) ?? "";

export const REDIRECT_URI =
  (import.meta.env.VITE_AUTH_REDIRECT_URI as string | undefined) ??
  window.location.origin;

export const API_SCOPES: string[] = [
  (import.meta.env.VITE_AUTH_API_SCOPE as string | undefined) ??
    `api://${CLIENT_ID}/user_impersonation`,
];

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `${AUTHORITY_HOST}/${TENANT_ID}`,
    redirectUri: REDIRECT_URI,
    knownAuthorities: [new URL(AUTHORITY_HOST).hostname],
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

/**
 * Acquire a Bearer access token silently. Falls back to redirect if interaction
 * is required. Returns null when AUTH_ENABLED = false (local dev bypass).
 */
export async function acquireToken(): Promise<string | null> {
  if (!AUTH_ENABLED) return null;

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;

  const account: AccountInfo = accounts[0];
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: API_SCOPES, account });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect({ scopes: API_SCOPES, account });
    }
    return null;
  }
}
