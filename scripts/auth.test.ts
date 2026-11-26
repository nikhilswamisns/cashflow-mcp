// OAuth tests: the full claude.ai flow, then each way in that must stay shut. No network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { withOAuth } from "../src/auth.js";

const BASE = "https://cash.example.com";
const CB = "https://claude.ai/api/mcp/auth_callback";
const PASSWORD = "correct horse battery";
let clock = Date.parse("2026-11-25T12:00:00Z");
const opts = { authSecret: "s".repeat(40), password: PASSWORD, now: () => clock, failDelayMs: 0 };
const app = withOAuth(async () => new Response("mcp ok"), opts);

const get = (path: string, headers: Record<string, string> = {}) => app(new Request(BASE + path, { headers }));
const form = (path: string, body: Record<string, string>) =>
  app(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
const mcp = (token?: string) => app(new Request(`${BASE}/mcp`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }));

const verifier = "v".repeat(50);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authq = { response_type: "code", client_id: "c_1", redirect_uri: CB, state: "st8", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp` };

// 1. no token: 401 pointing at the metadata
let r = await mcp();
assert.equal(r.status, 401);
assert.match(r.headers.get("www-authenticate")!, /resource_metadata="https:\/\/cash\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/);

// 2. metadata
const prm = await (await get("/.well-known/oauth-protected-resource/mcp")).json();
assert.deepEqual(prm.authorization_servers, [BASE]);
assert.equal(prm.resource, `${BASE}/mcp`);
const asm = await (await get("/.well-known/oauth-authorization-server")).json();
assert.equal(asm.token_endpoint, `${BASE}/token`);
assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);

// 3. registration: Claude's callback yes, anything else no
r = await app(new Request(`${BASE}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: [CB], client_name: "Claude" }) }));
assert.equal(r.status, 201);
assert.match((await r.json()).client_id, /^c_/);
r = await app(new Request(`${BASE}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) }));
assert.equal(r.status, 400);
r = await app(new Request(`${BASE}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.ai.evil.example/api/mcp/auth_callback"] }) }));
assert.equal(r.status, 400, "look-alike host rejected");

// 4. sign-in page; untrusted redirect never redirected to; missing PKCE refused
r = await get(`/authorize?${new URLSearchParams(authq)}`);
assert.equal(r.status, 200);
const html = await r.text();
assert.ok(html.includes('type="password"') && html.includes('value="st8"'));
assert.equal(r.headers.get("x-frame-options"), "DENY");
r = await get(`/authorize?${new URLSearchParams({ ...authq, redirect_uri: "https://evil.example/cb" })}`);
assert.equal(r.status, 400);
assert.equal(r.headers.get("location"), null);
r = await get(`/authorize?${new URLSearchParams({ ...authq, code_challenge_method: "plain" })}`);
assert.equal(new URL(r.headers.get("location")!).searchParams.get("error"), "invalid_request");
r = await get(`/authorize?${new URLSearchParams({ ...authq, resource: "https://other.example/mcp" })}`);
assert.equal(new URL(r.headers.get("location")!).searchParams.get("error"), "invalid_target");
r = await get(`/authorize?${new URLSearchParams({ ...authq, state: '"><script>x</script>' })}`);
assert.ok(!(await r.text()).includes("<script>x"), "state is escaped");

// 5. wrong password: page again, no code
r = await form("/authorize", { ...authq, password: "wrong password!!" });
assert.equal(r.status, 401);
assert.equal(r.headers.get("location"), null);

// 6. right password: code back to Claude with state
r = await form("/authorize", { ...authq, password: PASSWORD });
assert.equal(r.status, 302);
const loc = new URL(r.headers.get("location")!);
assert.equal(loc.origin + loc.pathname, CB);
assert.equal(loc.searchParams.get("state"), "st8");
const code = loc.searchParams.get("code")!;

// 7. token exchange: wrong verifier, wrong redirect, wrong client all fail
const tok = (extra: Record<string, string>) => form("/token", { grant_type: "authorization_code", code, redirect_uri: CB, client_id: "c_1", code_verifier: verifier, ...extra });
assert.equal((await tok({ code_verifier: "x".repeat(50) })).status, 400);
assert.equal((await tok({ redirect_uri: "http://localhost:1/cb" })).status, 400);
assert.equal((await tok({ client_id: "c_2" })).status, 400);
r = await tok({});
assert.equal(r.status, 200);
const t = await r.json();
assert.equal(t.token_type, "Bearer");

// 8. the token opens /mcp; a tampered or swapped token does not
assert.equal(await (await mcp(t.access_token)).text(), "mcp ok");
const [body, sig] = t.access_token.split(".");
assert.equal((await mcp(`${body}x.${sig}`)).status, 401);
assert.equal((await mcp(t.refresh_token)).status, 401, "refresh token is not an access token");
assert.equal((await mcp(code)).status, 401, "code is not an access token");

// 9. refresh works; expiry, a new password and a new secret all lock out
r = await form("/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: "c_1" });
assert.equal(r.status, 200);
assert.equal((await form("/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: "c_9" })).status, 400);
assert.equal((await withOAuth(async () => new Response("x"), { ...opts, password: "another password" })(new Request(`${BASE}/mcp`, { headers: { authorization: `Bearer ${t.access_token}` } }))).status, 401);
assert.equal((await withOAuth(async () => new Response("x"), { ...opts, authSecret: "z".repeat(40) })(new Request(`${BASE}/mcp`, { headers: { authorization: `Bearer ${t.access_token}` } }))).status, 401);
clock += 61 * 60 * 1000;
assert.equal((await mcp(t.access_token)).status, 401, "access token expires after an hour");
clock += 6 * 60 * 1000;
assert.equal((await tok({})).status, 400, "code expires after 5 minutes");

// 10. weak settings refuse to start
assert.throws(() => withOAuth(async () => new Response(), { ...opts, password: "short" }), /12 characters/);
assert.throws(() => withOAuth(async () => new Response(), { ...opts, authSecret: "short" }), /32 characters/);

// 11. behind a proxy the public host comes from x-forwarded-*
const prox = await (await get("/.well-known/oauth-protected-resource", { "x-forwarded-proto": "https", "x-forwarded-host": "abc.trycloudflare.com" })).json();
assert.equal(prox.resource, "https://abc.trycloudflare.com/mcp");

console.log("auth OK");
