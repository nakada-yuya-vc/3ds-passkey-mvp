# Backlog — known gaps vs. W3C SPC review bar

This MVP intentionally trades some spec coverage and production hardening for
implementation speed. The items below are the ones an external reviewer (W3C
WPWG, an issuer security team, or an EMVCo evaluator) is most likely to call
out. Each entry links the W3C SPC issue or spec section it maps to so the
reviewer can see we are tracking the upstream discussion, not unaware of it.

Already fixed in this branch:
- A-1 Dynamic linking — `clientDataJSON.payment` is now matched against the
  issued transaction in `/spc/verify`.
- A-2 `payeeOrigin` — explicit `SPC_PAYEE_ORIGIN` env var; dev coercion now
  logs a warning instead of being silent.
- A-3 CORS — `origin: true` replaced with an env-driven allowlist
  (merchant / ACS / dashboard).
- A-4 Challenge replay — challenges are claimed atomically and burnt even on
  verification failure.
- A-5 UV flag — `authenticationInfo.userVerified` is asserted explicitly on
  both WebAuthn and SPC verify paths.
- A-6 PAN derivation — `sha256(PAN)` replaced with `hmac-sha256(pepper, PAN)`;
  pepper is documented as KMS-backed in production.
- B-2 `spcCapable` (observation half) — credentials are now stored with
  `spcCapable: false` at registration and flipped to `true` only after the
  first successful SPC ceremony. The AAGUID-allowlist half remains open
  (see "P1 — AAGUID allowlist" below).
- C-1 SPC currency — server returns the ISO 4217 alphabetic code so the
  client no longer hard-codes `JPY`.
- C-2 Money formatting — `packages/server/src/services/money.ts` centralises
  the minor-unit exponent table; `/spc/options` returns a pre-formatted
  `total: { currency, value }` that the client passes through verbatim, and
  `/spc/verify` uses the same formatter for dynamic linking.
- C-4 Attestation (verify-and-record half) — registration requests
  `attestation: 'direct'`; SimpleWebAuthn cryptographically verifies the
  statement; `fmt` is stored on `WebAuthnCredential.attestationFormat` and
  logged alongside the AAGUID. Acceptance is **not** yet gated on the
  attestation result — that policy half is in P1 (see "AAGUID allowlist /
  attestation policy" below).
- C-5 Unit test coverage (partial) — `pnpm test` runs vitest against
  `packages/server/src/services/{money,spc-linking}.test.ts` with golden
  vectors for `formatMoneyForSpc` / `currencyAlphaFromNumeric` and one
  failing case per dynamic-linking invariant in `verifySpcPaymentClientData`
  (type, payment missing, rpId, payeeOrigin, value, currency, malformed
  base64, mismatch ordering). DB-level (`claimChallenge` race, prisma route
  glue) and W3C WPT subset coverage remain open.
- C-6 Rate limiting — `@fastify/rate-limit` is registered globally
  (60 req/min/IP) with 10 req/min/IP on every verify endpoint.
- Logging — `credentialId` / `aaguid` are redacted by pino before serialization.

---

## P1 — should land before any external review

### B-1. Browser Bound Key (BBK) positioning / support
**Refs:** [#321](https://github.com/w3c/secure-payment-confirmation/issues/321),
[#290](https://github.com/w3c/secure-payment-confirmation/issues/290),
[#288](https://github.com/w3c/secure-payment-confirmation/issues/288),
[#287](https://github.com/w3c/secure-payment-confirmation/issues/287),
[#315](https://github.com/w3c/secure-payment-confirmation/issues/315).

BBK is still an active W3C discussion area: its role in device possession,
availability detection, storage properties, and requiredness are not settled
across all stakeholders. This MVP therefore stays neutral: it verifies the
SPC/WebAuthn assertion and transaction-confirmation data, but does not claim
full PSD2 SCA or EMVCo compliance based on BBK.

Before an external review, keep this stance explicit and decide whether the
next milestone should:
1. Accept and verify BBK outputs where browsers provide them,
2. Treat BBK as an optional signal and document the trust level, or
3. Keep BBK out of scope and frame the repository as an SPC / 3DS UX integration
   prototype.

### P1 — AAGUID allowlist / attestation policy (the policy half of B-2 + C-4)
**Refs:** [#273](https://github.com/w3c/secure-payment-confirmation/issues/273),
[packages/server/src/routes/webauthn.ts](packages/server/src/routes/webauthn.ts).

Two adjacent verify-and-record steps have landed:
- B-2 observational half — `spcCapable` starts false, flips on first SPC success.
- C-4 verify-and-record half — `attestation: 'direct'` is requested,
  SimpleWebAuthn verifies the statement, and `fmt` + AAGUID are stored.

What is still open is the **policy half**: at registration time, before any
SPC ceremony has happened and before we have any direct signal that the
authenticator persists the third-party payment bit, which authenticators do
we trust enough to accept? Concretely we have to choose between roughly:
1. **MDS3-backed allowlist** — load FIDO MDS3 metadata and accept only
   AAGUIDs with a current entry that meets a certification floor
   (e.g. `FIDO_CERTIFIED_L1` or higher). Rejects everything iCloud Keychain
   returns today (anonymous attestation, zero AAGUID).
2. **Hand-curated platform allowlist** — accept the well-known platform
   authenticator AAGUIDs (Windows Hello, Touch ID, Android Platform) plus
   "anonymous Apple" as a special case. Cheap, but goes stale.
3. **Accept-all-but-record** — the current state. Accepts everything,
   logs `fmt` and AAGUID for forensic review. No enforcement.

The decision affects coverage (option 1 rejects synced passkeys broadly,
which hurts adoption) and audit posture (option 3 cannot demonstrate that
we ever rejected anything). It needs explicit sign-off; not something the
MVP should silently pick.

When this lands, the enforcement point is `webauthn.ts` registration verify
(reject before `prisma.webAuthnCredential.create`). The data it needs
(`fmt`, `aaguid`) is already captured.

### C-7. Re-registration / recovery flow
`excludeCredentials` is correct, but there is no path for "lost device, want
to enroll a new authenticator." Step-up auth (OTP fallback that then triggers
a fresh WebAuthn registration) needs to be designed and tested.

---

## P2 — track upstream, document position before review

### B-3. Restrict SPC to passkeys with the payment bit?
**Ref:** [#299](https://github.com/w3c/secure-payment-confirmation/issues/299).
Chrome currently surfaces synced passkeys without the payment bit as SPC
candidates. The server should decide whether to reject them or accept them
with a degraded trust level, and write the policy down.

### B-4. Line items in the SPC dialog
**Ref:** [#313](https://github.com/w3c/secure-payment-confirmation/issues/313).
Spec proposal; not in v1. Track and re-evaluate when Chrome ships an OT.

### B-5. Double-authentication when BBK is absent
**Refs:** [#315](https://github.com/w3c/secure-payment-confirmation/issues/315),
[#317](https://github.com/w3c/secure-payment-confirmation/issues/317).
Today we fall back to OTP, which avoids the double-auth UX but leaves the
SCA claim ambiguous. Tied to B-1.

### B-6. Immediate mediation for frictionless SPC
**Ref:** [#319](https://github.com/w3c/secure-payment-confirmation/issues/319).
Chrome origin trial. The challenge UI today requires a button click; an
`mediation: "immediate"` path inside the ACS iframe is on the roadmap.

### B-7. UX guidelines compliance
**Refs:** [#309](https://github.com/w3c/secure-payment-confirmation/issues/309),
[#266](https://github.com/w3c/secure-payment-confirmation/issues/266),
[#269](https://github.com/w3c/secure-payment-confirmation/issues/269).
Audit `displayName` length, multi-language behavior, icon resolution. The
icon today is an inline 1x1 PNG placeholder.

### B-8. Icon URL hosting (`https` / `data` only)
**Ref:** [#300](https://github.com/w3c/secure-payment-confirmation/issues/300).
We use `data:`. Document the prod plan to host icons on an `https://` CDN.

### C-3. RP_ID / RP_ORIGIN / payeeOrigin architecture diagram
The three-role separation (issuer ACS = RP, merchant = payee, browser =
client) is exactly what SPC exists to make safe. Today the README has only
a port-level diagram; redraw it in terms of the SPC roles so a W3C reviewer
can see we got the topology right.

### C-5. Conformance test coverage (remaining)
The pure-function half (money formatting, dynamic-linking checks) is
covered — see "completed" section above. Still open:
- **Atomic-claim race test for `claimChallenge`** — needs an integration
  test that spins up a real Postgres (or `pg-mem`) and fires two concurrent
  verify calls against the same challenge to prove exactly one wins.
- **Route-level integration tests** — Fastify `inject()` against
  `/spc/options` → `/spc/verify` and `/webauthn/*` with a fixture DB,
  asserting the HTTP status codes / response shapes a reviewer would
  expect.
- **W3C Web Platform Tests SPC subset** — at minimum document which WPT
  tests this implementation passes; ideally run the relevant subset in CI.

### C-8. AAGUID label sync from FIDO MDS3
[packages/server/src/routes/webauthn.ts](packages/server/src/routes/webauthn.ts)
ships a hard-coded label table. Replace with a weekly sync from
`mds.fidoalliance.org` so new authenticators are not labelled "Unknown".

### RBA service is a scaffold
`packages/server/src/services/rba.ts` is a stub. A real risk engine (amount
× device history × velocity × merchant category) is out of scope for the
MVP; the file exists to make the integration point obvious.

---

## P3 — documentation deliverables for review

These are not code changes but are typically asked for at WPWG review:

- **SECURITY.md** — threat model, trust boundaries, what the MVP claims and
  what it explicitly does not claim.
- **CONFORMANCE.md** — a matrix mapping each normative MUST in the SPC spec
  to "implemented / partial / intentionally out of scope" with rationale.
- **W3C issue tracking table** — README section listing the upstream issues
  we are watching (B-1 through B-8 above).
- **Demo scenarios** — record `demo.gif` for the non-golden paths too: SPC
  failure → OTP fallback, second-device first use, unknown PAN first
  enrollment.
