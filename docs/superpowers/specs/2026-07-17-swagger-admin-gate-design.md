# Swagger Behind the Admin Session — Design

**Date:** 2026-07-17
**Status:** Approved (option 3 of dev-only / separate docs / in-product gated)

## Problem

Swagger UI is registered only in the Development environment, so on a deployed
(production) instance `/swagger` falls through to the SPA shell. The target
audience — someone who installs the self-hosted product and wants to explore
the API from a browser — never reaches it. docs/api.md remains the offline
reference either way.

## Decision

The Grafana pattern: ship Swagger in every environment, but put `/swagger`
behind the product's own admin session. Anonymous requests get 401 before a
single Swagger byte, viewers get 403, admins get the UI — and because the
session cookie is already in the browser, "Try it out" works.

Explicitly unchanged: the dev-only stack-trace detail in 500 responses stays
keyed to `IsDevelopment` — enabling Swagger does not loosen error responses.

## Changes

1. `Program.cs`: drop the `IsDevelopment` guard around
   `UseSwagger`/`UseSwaggerUI`, and register them AFTER the session auth-gate
   middleware — middleware order is the actual guard; registered before the
   gate, Swagger would serve unauthenticated.
2. `AuthPolicy.RequiresAuthentication`: `/swagger` joins `/api` and `/hubs`
   (session required once auth is enabled).
3. `AuthPolicy.RequiresAdmin`: `/swagger` joins `/api/users` and `/api/admin`
   (admin-only regardless of method).

## Tests

- Production environment (`UseEnvironment("Production")`), auth disabled:
  `/swagger/v1/swagger.json` answers with JSON — the availability this change
  exists for.
- Auth enabled: anonymous 401, viewer 403, admin 200 on the same path.

## Docs

`docs/api.md` SWAGGER section (was "development environment only"),
`docs/architecture.md` Swagger mention, CLAUDE.md command note.

## Out of scope

Redirecting `GET /api` to `/swagger` (keeps the 404 ProblemDetails contract
for API clients), OpenAPI annotations/polish on individual endpoints.
