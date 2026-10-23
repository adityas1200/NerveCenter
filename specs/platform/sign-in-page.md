---
id: SPEC-platform-09
title: Sign-in page (replaces the automatic redirect to the SSO login)
status: implemented
area: platform
owners: []
code:
  - frontend/src/auth.tsx
  - frontend/src/auth-session.ts
  - frontend/src/features/login/LoginPage.tsx
  - backend/src/api/server.mjs
  - backend/src/config.mjs
last_verified: 2026-10-06
---

# Sign-in page

## Purpose
A visitor with no NerveCenter or Microsoft session is thrown straight onto the Microsoft SSO page, with no hint of what they opened. NerveCenter shows its own sign-in page first, in the style of the DataVerse sign-in (`zsnexos/apps/home/src/pages/Login.tsx`): a hero on the left, a card with one "Sign in with SSO" button on the right. The button starts the same SSO flow as today.

## Scope
- In scope: the unauthenticated experience of the browser UI, the sign-in page, returning to the page the person asked for, SSO error display, the light/dark toggle.
- Out of scope: the SSO provider, `/session`, `/login` and `/logout` on `authBase`, backend identity (SPEC-platform-01 FR-1..FR-8), platform auth mode.

## Actors and permissions
Anonymous browser only. The page needs no API call and no role.

## Requirements
- **FR-1** When auth is enabled and `GET {authBase}/session` says the browser is not signed in, the app SHALL render the sign-in page at `/login` instead of redirecting to `{authBase}/login`. This supersedes SPEC-platform-01 FR-9's redirect and S4.
- **FR-2** The page SHALL show NerveCenter's own hero (tag "NerveCenter", headline "The operations harness for data teams.", one line on tickets, pipelines, data quality and Sonic) beside a card holding the ZS logo, "Welcome back", "Sign in with the organization SSO", one **Sign in with SSO** button and "Need access? Contact your administrator", where the link is a `mailto:` to the admin contacts of FR-9 (plain text when there are none).
- **FR-3** The button SHALL send the browser to `{authBase}/login?redirect=<path>` with `<path>` the page originally requested (never `/login` itself), and SHALL show "Signing in..." and disable itself until the browser leaves.
- **FR-4** A signed-in visitor who opens `/login` SHALL be sent to the requested path, or `/`, without seeing the page.
- **FR-5** When the SSO flow returns to `/login?error=<code>` (optionally `error_description`), the card SHALL show the description, or "Authentication failed: <code>", in an error banner above the button.
- **FR-6** The page SHALL default to the light theme, on the same warm paper as Home, and offer a toggle to dark. The choice SHALL NOT change the app theme after sign-in.
- **FR-7** `logout()` SHALL end at the sign-in page, not at the SSO page. Platform auth mode (no login page) is unchanged.
- **FR-8** The page SHALL call no `/api` route except `GET /api/meta` (reachable without identity, SPEC-platform-01 FR-8), and SHALL NOT include the requested path in logs or error text.

## Scenarios
### S1 First visit without a session
- **Given** no NerveCenter or Microsoft session
- **When** the person opens `/tickets/42`
- **Then** they see the sign-in page and the URL is `/login`; pressing the button goes to `{authBase}/login?redirect=/tickets/42`.

### S2 Already signed in
- **Given** a valid session
- **When** the person opens `/login`
- **Then** they land on `/` (or the requested path) with no flash of the sign-in page.

### S3 SSO error
- **Given** the flow returns `/login?error=access_denied&error_description=Not%20registered`
- **Then** the banner reads "Not registered" and the button is enabled.

## Interfaces
- UI: route `/login` outside `AuthGate`; `AuthGate` renders the sign-in page when unauthenticated.
- HTTP: `GET /api/meta` gains `adminContacts: string[]`. No new routes, config keys or storage.


## Decisions (approved 2026-10-06)
- Colours are NerveCenter's: Home's paper background and the logo's blue and violet for accents, never orange.
- Copy is NerveCenter's own. The background is a comet that follows the pointer (thick and bright at the head, tapering at the tail) and nothing else, ordered-dithered with the Home page's Bayer helper in the logo's blue and violet; reduced motion shows no trail.
- **FR-9** `GET /api/meta` SHALL return `adminContacts`: the entries of `OPS_ADMIN_USER_IDS` that look like an email address (never the `admins.json` file, never non-email ids). This deliberately shows admin emails to anonymous callers; they are the people to ask for access.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `frontend/src/auth.tsx` (AuthGate) | `frontend/src/auth.test.tsx` |
| FR-2 | `frontend/src/features/login/LoginPage.tsx`, `frontend/src/api/meta.ts` | `frontend/src/features/login/LoginPage.test.tsx` |
| FR-3 | `frontend/src/auth-session.ts` (`startSso`), `LoginPage.tsx` | `LoginPage.test.tsx`, `auth.test.tsx` |
| FR-4 | `frontend/src/auth.tsx` (AuthGate) | `frontend/src/auth.test.tsx` |
| FR-5 | `LoginPage.tsx` | `LoginPage.test.tsx` |
| FR-6 | `LoginPage.tsx`, `LoginParticles.tsx` | `LoginPage.test.tsx` |
| FR-7 | `frontend/src/auth-session.ts` (`logout`) | `frontend/src/auth.test.tsx` |
| FR-8 | `LoginPage.tsx`, `frontend/src/api/meta.ts` | `LoginPage.test.tsx` |
| FR-9 | `backend/src/config.mjs`, `backend/src/api/server.mjs` | `backend/tests/meta-admin-contacts.test.mjs` |
