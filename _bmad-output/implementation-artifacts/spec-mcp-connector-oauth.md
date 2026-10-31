---
title: 'Rentee — remote MCP connector with OAuth 2.1'
type: 'feature'
created: '2026-11-01'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The landlord wants to use Claude (claude.ai custom connectors, Claude Desktop, Claude Code) to ask about and act on Rentee data. That needs a remote MCP server inside Rentee secured with OAuth 2.0/2.1 (human: "create MCP connector code as well, develop OAuth 2.0"; all design decisions delegated).

**Approach:** Add to the existing Next.js 15 app (deployed on Render) a Streamable HTTP MCP endpoint at `/api/mcp` built with the official `@modelcontextprotocol/sdk` (verify its real API from the installed package — do not guess), protected by a built-in OAuth 2.1 authorization server that follows the MCP authorization spec: Protected Resource Metadata (RFC 9728), Authorization Server Metadata (RFC 8414), Dynamic Client Registration (RFC 7591), authorization code + PKCE S256 (mandatory), refresh token rotation, resource indicators (RFC 8707), and a consent screen behind the existing admin login.

**Decisions:**
- **Endpoints:**
  - `GET /.well-known/oauth-protected-resource` (and path-suffixed `/.well-known/oauth-protected-resource/api/mcp`) → `{ resource: <APP_URL>/api/mcp, authorization_servers: [<APP_URL>], scopes_supported, bearer_methods_supported: ["header"] }`.
  - `GET /.well-known/oauth-authorization-server` → issuer, `authorization_endpoint` `/oauth/authorize`, `token_endpoint` `/api/oauth/token`, `registration_endpoint` `/api/oauth/register`, `revocation_endpoint` `/api/oauth/revoke`, `response_types_supported ["code"]`, `grant_types_supported ["authorization_code","refresh_token"]`, `code_challenge_methods_supported ["S256"]`, `token_endpoint_auth_methods_supported ["none","client_secret_post","client_secret_basic"]`, `scopes_supported`.
  - `POST /api/mcp` (Streamable HTTP, stateless JSON responses are fine; GET may return 405). Missing/invalid token → 401 with `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource"` (plus `error="invalid_token"` when a token was sent). Insufficient scope on a write tool → tool error result explaining the missing `rentee:write` scope.
  - Base URL from `APP_URL` (already an env var); fall back to request origin in dev. Issuer/resource values must be consistent and exact.
- **Clients (DCR):** `POST /api/oauth/register` accepts `client_name`, `redirect_uris` (required; each must be `https://…`, or `http://localhost|127.0.0.1[:port]/…` for local clients like Claude Code), `grant_types`, `token_endpoint_auth_method`. Public clients (`none`) get no secret; confidential get a secret (stored hashed). Rate-limited (e.g. 20 registrations/hour/IP) and capped (e.g. 200 clients total; oldest unused pruned). Known Claude callbacks `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` work via normal registration.
- **Authorize:** `/oauth/authorize` page (Rentee-branded) validates `client_id`, exact `redirect_uri` match, `response_type=code`, `code_challenge` + `code_challenge_method=S256` (required), optional `state`, `scope`, `resource` (must equal the MCP resource URL if present). Not signed in → redirect to `/login?next=…` and back. Shows client name, redirect host, and requested access: **Read** (always) and an unchecked-by-default checkbox **"Also allow changes (record payments, add enquiries…)"** → `rentee:write`. Approve → auth code (random 32 bytes, stored hashed, single use, 60 s expiry, bound to client, redirect_uri, PKCE challenge, scopes, resource, user) → redirect with `code` and `state`. Deny → `error=access_denied`. Invalid client/redirect → error page, never redirect to an unvalidated URI. Consent form protected by the session plus a CSRF token (server action is fine).
- **Token:** `POST /api/oauth/token` (form-encoded). `authorization_code`: verify code (unused, unexpired, same client & redirect_uri), PKCE verifier S256, resource; issue opaque access token (random, 1 h) + refresh token (random, 30 days); both stored only as SHA-256 hashes. `refresh_token`: rotate (old refresh token invalidated; reuse of a rotated token revokes the whole grant family). Scopes can only narrow. Standard JSON errors (`invalid_grant`, `invalid_client`, `invalid_request`, `unsupported_grant_type`), `Cache-Control: no-store`. CORS allowed on well-known, register, token, revoke, and mcp endpoints (Claude clients may call from browsers); the authorize page is not CORS.
- **Revoke:** RFC 7009 `POST /api/oauth/revoke`. **Settings → Connected apps** lists grants (client name, scopes, created, last used) with **Revoke** (deletes the grant family's tokens).
- **Scopes:** `rentee:read` (always granted), `rentee:write` (opt-in). Tokens are tied to the admin user who approved; if that user is deleted, tokens stop working.
- **Middleware:** `/.well-known/`, `/api/oauth/`, `/api/mcp` must bypass the session-cookie middleware (they do their own auth); `/oauth/authorize` uses the normal admin session (redirect to login).
- **Tools** (all with clear descriptions, zod input schemas, `readOnlyHint`/`destructiveHint` annotations; money shown formatted in INR and also as integer paise; dates ISO). Reuse existing data loaders (`loadRentals`, `loadDeposit`, report builders, enquiries data) — no duplicate business logic.
  - Read: `get_dashboard` (occupancy, collected this month, overdue total + list, due soon, open maintenance, moving out, deposit balances, agreements expiring, open enquiries), `list_properties`, `get_property`, `list_tenants` (search), `get_tenant` (no ID number, no documents), `list_rentals` (filters: status, property, tenant), `get_rental` (rent schedule, charges, rent changes, deposit status), `list_overdue_rent`, `list_payments` (date range / rental), `list_expenses` (FY / property), `get_profit_report` (FY), `list_enquiries` (status filter), `get_enquiry` (with timeline), `list_maintenance`, `list_notifications` (unread only by default), `list_agreements_expiring`.
  - Write (require `rentee:write`): `record_rent_payment` (rental, forMonth, amount, paidOn, method, note — same validation as the UI incl. payable months), `add_deposit_payment` (same balance rule), `create_enquiry`, `add_enquiry_note`, `create_maintenance_request`, `update_maintenance_status`. No delete tools at all.
  - Never expose: tenant ID numbers, tenant documents or document files, photos, password hashes, tokens, settings secrets, other apps' collections.
- **Audit:** each tool call by an OAuth token updates the grant's `lastUsedAt`; write tools log to a small `McpAuditLog` collection (tool, args summary, user, client, time) shown under Connected apps (last 20).
- **Storage:** Mongoose models `OAuthClient`, `OAuthCode`, `OAuthToken` (access + refresh with family id; TTL indexes for expiry), `McpAuditLog`; explicit collection names prefixed `rentee_` (the database is shared with another app).
- **Docs:** README section "Connect Rentee to Claude": add custom connector with URL `<APP_URL>/api/mcp` in claude.ai (Settings → Connectors → Add custom connector), Claude Desktop, and Claude Code (`claude mcp add --transport http rentee <APP_URL>/api/mcp`), the consent step, how to revoke; note APP_URL must be set on Render.

**Always:** HTTPS-only redirect URIs except localhost; exact redirect URI matching; PKCE S256 mandatory; hashed tokens/codes/secrets; constant-time comparisons; short-lived single-use codes; all tool queries scoped by zod validation; responses never include secrets.

**Never:** implicit grant, password grant, plain PKCE, wildcard redirect URIs, tokens in query strings, JWTs signed with AUTH_SECRET reused as access tokens (use opaque random tokens), delete tools, touching the user's real database during development.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Discovery | GET `/.well-known/oauth-protected-resource` | JSON with resource `<APP_URL>/api/mcp` and authorization server | N/A |
| No token | POST `/api/mcp` without Authorization | 401 + `WWW-Authenticate: Bearer resource_metadata="…"` | N/A |
| Register | DCR with `redirect_uris:["https://claude.ai/api/mcp/auth_callback"]`, method none | 201 with `client_id`, no secret | `http://evil.com/cb` → 400 `invalid_redirect_uri`; localhost http allowed |
| Authorize w/o PKCE | missing code_challenge | error page / `invalid_request` | never issues code |
| Wrong redirect | redirect_uri not registered | error page, no redirect | N/A |
| Code exchange | valid code + correct verifier | 200 access+refresh, `token_type` Bearer, `expires_in` 3600, scope | wrong verifier → `invalid_grant`; reused code → `invalid_grant` and revoke tokens from that code |
| Expired code | code older than 60 s | `invalid_grant` | N/A |
| Refresh rotation | valid refresh token | new pair; old refresh rejected | reuse of rotated refresh → `invalid_grant` + whole family revoked |
| Read-only token calls write tool | scope `rentee:read` → `record_rent_payment` | tool error "requires rentee:write" | no data changed |
| Revoked grant | revoke in Settings, then call `/api/mcp` | 401 | N/A |
| Tool validation | `record_rent_payment` amount 0 or month outside rental | tool error with message | no data changed |
| Privacy | `get_tenant` | no `idNumber`, no documents | N/A |

</frozen-after-approval>

## Code Map

- `src/middleware.ts` -- add public exclusions for `/.well-known/`, `/api/oauth/`, `/api/mcp`.
- `src/lib/auth.ts`, `src/app/login/actions.ts` (`safeNext`) -- login + return-to for `/oauth/authorize?…` (ensure safeNext allows it).
- `src/lib/data.ts` (`loadRentals`), `src/lib/deposit-store.ts`, `src/lib/reports*.ts`, `src/lib/profit.ts`, `src/lib/enquiry-data.ts`, `src/lib/notification-sync.ts` (`notificationFeed`), `src/lib/agreement-data.ts`, `src/app/(admin)/payments/actions.ts` (payment validation/creation logic to extract into a shared lib function if needed), `src/lib/validation.ts` -- reuse.
- `src/lib/login-throttle.ts` pattern -- reuse for DCR rate limit.
- `src/app/(admin)/settings/page.tsx` -- add Connected apps card (separate component).
- New: `src/lib/oauth/*` (pure: PKCE verify, redirect URI validation, scope logic, token hashing; store), `src/models/OAuth*.ts`, `src/models/McpAuditLog.ts`, `src/app/.well-known/*/route.ts`, `src/app/api/oauth/{register,token,revoke}/route.ts`, `src/app/oauth/authorize/page.tsx` (+ action), `src/app/api/mcp/route.ts`, `src/lib/mcp/tools/*.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] OAuth pure helpers + tests (every matrix row that is pure: PKCE, redirect validation, scope narrowing, rotation/reuse logic)
- [ ] models, DCR, authorize (consent UI), token, revoke, metadata endpoints, middleware
- [ ] MCP endpoint (SDK, Streamable HTTP) + bearer auth + read tools + write tools with scope check + audit
- [ ] Connected apps settings card; README

**Acceptance Criteria:**
- Given a fresh client, when it performs discovery → DCR → authorize (with login + consent) → token → `tools/list` → `tools/call get_dashboard`, then it receives the dashboard data (end-to-end script against a throwaway DB).
- Given the MCP Inspector or an SDK client with OAuth support, when connecting to `<base>/api/mcp`, then it completes auth and lists tools.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)

**Manual checks:**
- Scripted end-to-end OAuth + MCP flow (using the SDK client) on a throwaway MongoDB and `next start` on a spare port.
