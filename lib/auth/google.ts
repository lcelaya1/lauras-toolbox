// "Sign in with Google" for the Toolbox itself (identity only: openid email).
// Uses its own OAuth client (GOOGLE_LOGIN_CLIENT_ID) so personal Gmail accounts can sign in;
// the Gmail-reading client lives in an Internal Workspace project.

// In-flight login, kept in a signed cookie between /login and /callback.
export interface GoogleLoginState {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function credentials() {
  const id = process.env.GOOGLE_LOGIN_CLIENT_ID;
  const secret = process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET not set");
  return { id, secret };
}

export function googleAuthUrl(p: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: credentials().id,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

// Exchanges the code and returns the verified email. The ID token comes straight from
// Google's token endpoint over TLS with client authentication, so per OIDC Core §3.1.3.7
// its claims are checked without a separate signature verification.
export async function exchangeGoogleCode(p: {
  code: string; redirectUri: string; codeVerifier: string; nonce: string;
}): Promise<string> {
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.code,
      client_id: id,
      client_secret: secret,
      redirect_uri: p.redirectUri,
      grant_type: "authorization_code",
      code_verifier: p.codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google did not return an ID token");

  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString()) as {
    iss?: string; aud?: string; exp?: number; nonce?: string; email?: string; email_verified?: boolean;
  };
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("Bad issuer");
  if (claims.aud !== id) throw new Error("Bad audience");
  if (!claims.exp || claims.exp < Date.now() / 1000) throw new Error("ID token expired");
  if (claims.nonce !== p.nonce) throw new Error("Bad nonce");
  if (!claims.email || claims.email_verified !== true) throw new Error("Email not verified");
  return claims.email.toLowerCase();
}
