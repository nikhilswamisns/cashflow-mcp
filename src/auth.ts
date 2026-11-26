// OAuth 2.1 in front of the MCP endpoint, the way claude.ai custom connectors expect it:
// protected-resource + authorization-server metadata, dynamic client registration, PKCE (S256), refresh tokens.
// Stateless: codes and tokens are HMAC-signed, so no database. One shared password signs people in.
// Changing CASHFLOW_PASSWORD or CASHFLOW_AUTH_SECRET revokes every code and token at once.
// shortcut: no per-user accounts, no rate limit beyond a delay on a wrong password; add an identity provider when several people need their own logins.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type Fetch = (req: Request) => Promise<Response>;
type Claims = Record<string, unknown>;

export interface AuthOptions {
  authSecret: string; // 32+ chars, signs codes and tokens
  password: string; // 12+ chars, typed on the sign-in page
  publicUrl?: string; // https://host, when the Host header is not the public one
  now?: () => number;
  failDelayMs?: number;
}

const CODE_S = 5 * 60;
const ACCESS_S = 60 * 60;
const REFRESH_S = 30 * 24 * 60 * 60;

// only Claude's callbacks and local tools (Claude Code, MCP Inspector) may receive codes
const REDIRECTS = [/^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/, /^https:\/\/claude\.com\/api\/mcp\/auth_callback$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/[^\s#]*$/];
export const redirectAllowed = (u: unknown): u is string => typeof u === "string" && REDIRECTS.some((r) => r.test(u));

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sha = (s: string) => createHash("sha256").update(s).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function signer(key: Buffer, now: () => number) {
  const mac = (body: string) => b64(createHmac("sha256", key).update(body).digest());
  return {
    sign(typ: string, claims: Claims, ttlS: number): string {
      const body = b64(JSON.stringify({ ...claims, typ, exp: Math.floor(now() / 1000) + ttlS }));
      return `${body}.${mac(body)}`;
    },
    verify(typ: string, token: unknown): Claims | null {
      if (typeof token !== "string") return null;
      const [body, sig, extra] = token.split(".");
      if (!body || !sig || extra !== undefined || !same(Buffer.from(sig), Buffer.from(mac(body)))) return null;
      try {
        const c = JSON.parse(Buffer.from(body, "base64url").toString()) as Claims;
        return c.typ === typ && typeof c.exp === "number" && c.exp > now() / 1000 ? c : null;
      } catch {
        return null;
      }
    },
  };
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

function page(q: Record<string, string>, error = "", status = 200): Response {
  const hidden = Object.entries(q).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Cashflow</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#666;--line:#e5e5e5;--brand:#2f7cf6;--bad:#d93025}
@media(prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--mut:#a1a1a1;--line:#2a2a2a;--brand:#3291ff;--bad:#ff6369}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
form{width:min(360px,calc(100vw - 32px));border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 20px;color:var(--mut)}label{display:block;font-size:13px;margin-bottom:6px}
input[type=password]{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:8px;background:var(--brand);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--bad);font-size:13px;margin:10px 0 0}</style></head>
<body><form method="post" action="authorize"><h1>Connect Claude to Cashflow</h1><p>Claude will be able to read your cash and invoice figures.</p>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}${hidden}<button type="submit">Allow</button></form></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "referrer-policy": "no-referrer" },
  });
}

/** Wraps the MCP fetch handler: /mcp needs a bearer token, the OAuth endpoints hand them out. `path` lets a rewrite pass the original path. */
export function withOAuth(mcp: Fetch, o: AuthOptions) {
  if (o.authSecret.length < 32) throw new Error("CASHFLOW_AUTH_SECRET must be at least 32 characters");
  if (o.password.length < 12) throw new Error("CASHFLOW_PASSWORD must be at least 12 characters");
  const now = o.now ?? Date.now;
  const pw = sha(o.password);
  // the password is part of the key, so changing it revokes every token
  const t = signer(createHmac("sha256", o.authSecret).update("cashflow-oauth-v1").update(pw).digest(), now);
  const failDelay = o.failDelayMs ?? 800;

  const baseOf = (req: Request) => {
    if (o.publicUrl) return o.publicUrl.replace(/\/$/, "");
    const u = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || u.protocol.slice(0, -1);
    return `${proto}://${req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || u.host}`;
  };

  const tokens = (cid: unknown, aud: unknown) =>
    json({ access_token: t.sign("access", { cid, aud }, ACCESS_S), token_type: "Bearer", expires_in: ACCESS_S, refresh_token: t.sign("refresh", { cid, aud }, REFRESH_S) });

  return async (req: Request, path = new URL(req.url).pathname): Promise<Response> => {
    const base = baseOf(req);
    const mcpUrl = `${base}/mcp`;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/mcp") {
      const claims = t.verify("access", req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]);
      if (!claims || (claims.aud !== undefined && claims.aud !== mcpUrl)) {
        return json({ error: "invalid_token" }, 401, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      }
      return mcp(req);
    }

    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      return json({ resource: mcpUrl, authorization_servers: [base], bearer_methods_supported: ["header"] });
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }

    if (path === "/register" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
      const uris = body?.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || !uris.every(redirectAllowed)) return oauthError("invalid_redirect_uri", "Only Claude's callback URLs can connect");
      return json(
        {
          client_id: `c_${randomBytes(12).toString("base64url")}`,
          client_id_issued_at: Math.floor(now() / 1000),
          client_name: typeof body?.client_name === "string" ? body.client_name : undefined,
          redirect_uris: uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        201,
      );
    }

    if (path === "/authorize" && (req.method === "GET" || req.method === "POST")) {
      const p = req.method === "POST" ? new URLSearchParams(await req.text()) : new URL(req.url).searchParams;
      const q: Record<string, string> = {};
      for (const k of ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "resource"]) {
        const v = p.get(k);
        if (v !== null) q[k] = v;
      }
      // never redirect to a URL we do not trust, not even with an error
      if (!redirectAllowed(q.redirect_uri)) return new Response("This sign-in link is not from Claude.", { status: 400, headers: { "content-type": "text/plain" } });
      const back = (params: Record<string, string>) => {
        const u = new URL(q.redirect_uri);
        for (const [k, v] of Object.entries({ ...params, ...(q.state !== undefined ? { state: q.state } : {}) })) u.searchParams.set(k, v);
        return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } });
      };
      if (q.response_type !== "code" || !q.client_id || !q.code_challenge || q.code_challenge_method !== "S256") {
        return back({ error: "invalid_request", error_description: "response_type=code, client_id and an S256 code_challenge are required" });
      }
      if (q.resource !== undefined && q.resource !== mcpUrl) return back({ error: "invalid_target", error_description: `resource must be ${mcpUrl}` });
      if (req.method === "GET") return page(q);
      if (!same(sha(p.get("password") ?? ""), pw)) {
        await new Promise((r) => setTimeout(r, failDelay)); // slows guessing; the password length floor does the rest
        return page(q, "Wrong password.", 401);
      }
      return back({ code: t.sign("code", { cid: q.client_id, ru: q.redirect_uri, cc: q.code_challenge, aud: q.resource }, CODE_S) });
    }

    if (path === "/token" && req.method === "POST") {
      const p = new URLSearchParams(await req.text());
      const grant = p.get("grant_type");
      if (grant === "authorization_code") {
        const c = t.verify("code", p.get("code"));
        const verifier = p.get("code_verifier") ?? "";
        // shortcut: a stateless code can be replayed within its 5 minutes; PKCE means only the holder of the verifier can use it
        if (!c || c.ru !== p.get("redirect_uri") || c.cid !== p.get("client_id") || b64(sha(verifier)) !== c.cc) return oauthError("invalid_grant", "Code is invalid, expired or does not match");
        return tokens(c.cid, c.aud);
      }
      if (grant === "refresh_token") {
        const c = t.verify("refresh", p.get("refresh_token"));
        const cid = p.get("client_id");
        if (!c || (cid !== null && cid !== c.cid)) return oauthError("invalid_grant", "Refresh token is invalid or expired");
        return tokens(c.cid, c.aud);
      }
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
    }

    if (path === "/" && req.method === "GET") return new Response(`cashflow-mcp. Connector URL: ${mcpUrl}\n`, { headers: { "content-type": "text/plain" } });
    return new Response(null, { status: 404 });
  };
}
