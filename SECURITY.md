# Security Posture

This repository is a prototype for evaluating Secure Payment Confirmation (SPC)
inside an EMV 3-D Secure challenge flow. It is suitable for local demos and
technical discussion, but it is not a production ACS, issuer system, or EMVCo /
PSD2 compliance implementation.

## What This MVP Claims

- WebAuthn registration and authentication are verified server-side.
- SPC assertions are verified as `payment.get` responses.
- User Verification is required and checked on WebAuthn and SPC verify paths.
- Challenges are short-lived and consumed atomically before assertion
  verification to reduce replay risk.
- The SPC `clientDataJSON.payment` payload is checked against the issued
  transaction for `rpId`, `payeeOrigin`, amount, currency, and instrument
  identity.
- PAN-derived join keys use HMAC-SHA-256 with a server-side pepper instead of
  plain SHA-256.
- Credential IDs and AAGUIDs are redacted from structured logs.

## What This MVP Does Not Claim

- It does not implement Browser Bound Key (BBK) storage or signature
  verification.
- It does not claim full PSD2 SCA possession-factor coverage.
- It does not claim EMVCo certification or full EMV 3DS protocol conformance.
- It does not enforce an AAGUID or attestation allowlist.
- It does not connect to card networks, issuers, schemes, SMS providers, or FIDO
  Metadata Service.
- It does not provide production-grade account recovery, device re-enrollment,
  monitoring, key management, or fraud/risk scoring.

## Trust Boundaries

- The merchant UI is a test storefront that chooses the auth flow per product.
- The challenge UI represents an ACS iframe for demo purposes.
- The Fastify server is the relying party verifier for WebAuthn and SPC.
- PostgreSQL stores demo users, credentials, challenges, OTP sessions, and
  transaction metrics.

In production, the ACS/RP, issuer systems, risk engine, card network messages,
secrets management, and audit logging would be separate hardened components.

## Reporting Issues

Please do not report real card data, real credentials, or production secrets in
issues. Use synthetic test data only.
