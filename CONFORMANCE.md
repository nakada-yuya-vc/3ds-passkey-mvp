# SPC Conformance Notes

This document maps the MVP to the main Secure Payment Confirmation behaviours
that reviewers are likely to ask about. It is not a formal W3C test report.

| Area | Status | Notes |
| --- | --- | --- |
| SPC credential registration | Implemented | Registration requests `extensions.payment.isPayment: true`, `residentKey: "required"`, platform attachment, user verification, and direct attestation capture. |
| Registration-time payment extension output | Partial | The current SPC extension does not provide a reliable registration success output for the payment bit. The MVP records AAGUID/attestation format and flips `spcCapable` only after a successful SPC ceremony. See W3C issue #273. |
| SPC invocation | Implemented | The challenge UI uses `PaymentRequest` with `supportedMethods: "secure-payment-confirmation"`, credential IDs, challenge, `rpId`, `payeeOrigin`, instrument data, and total amount. |
| `payment.get` verification | Implemented | The server verifies SPC assertions with `expectedType: "payment.get"`, expected challenge, origin, RP ID, signature, counter, and User Verification. |
| Dynamic linking | Partial | The server verifies `clientDataJSON.payment.rpId`, `payeeOrigin`, total value, currency, `instrument.displayName`, and `instrument.icon`. It does not yet enforce every displayed field such as `topOrigin` or `payeeName`. |
| SPC service boundary | Implemented | `/spc/options` and `/spc/verify` delegate to `packages/server/src/services/spc.ts`, which owns SPC request construction, assertion verification, dynamic-linking checks, failure classification, and audit writes. |
| ACS transaction state | Implemented for MVP | `Transaction.acsState` stores the current ACS-oriented state and `AcsTransactionStateHistory` records transitions such as `CHALLENGE_REQUIRED -> SPC_REQUESTED -> SPC_AUTHENTICATED` or `SPC_REQUESTED -> OTP_FALLBACK_REQUIRED`. |
| SPC audit evidence | Implemented | `SpcAuthenticationAudit` records issued expected payment data, received signed payment data summaries, event type, failure reason, and hashed credential IDs. Full credential IDs and full icon payloads are not stored in the audit row. |
| Fallback reason taxonomy | Implemented for MVP | Server-side SPC failures are classified with `SpcFailureReason`; client-side fallback reasons currently distinguish insecure context, SPC unavailable, generic SPC error, and unknown client reasons. |
| Browser Bound Key | Out of scope | BBK handling is intentionally neutral in this MVP because requiredness, feature detection, storage characteristics, and fallback behaviour are still active W3C topics. See issues #321, #315, #290, #288, and #287. |
| Payment-bit policy | Partial | Credentials are registered with `isPayment: true`, but the MVP does not reject credentials based on an attestation/AAGUID policy. See issues #299 and #273. |
| UX data quality | Partial | The MVP supplies a merchant name, total, and visible demo card art. `paymentEntitiesLogos` is intentionally not sent in the live demo because Chrome's current SPC dialog rendered the demo logos inconsistently in local testing. Production integrations should use tested HTTPS-hosted artwork before enabling entity logos. The MVP does not yet provide production card art, line items, or localization guidance. See issues #309, #300, #313, and #269. |
| Permissions Policy / iframe use | Implemented for dev | The merchant iframe allows public-key credential create/get and payment. Vite dev headers also grant these permissions for the ACS UI. |
| Secure contexts | Implemented for detection | The challenge UI detects insecure contexts and falls back or surfaces a clear error. |
| Replay resistance | Implemented | WebAuthn and SPC challenges are claimed atomically and burned before verification. |
| Rate limiting | Implemented for MVP | A global bucket is registered, with tighter per-minute limits on verify endpoints. |
| Route-level integration tests | Implemented for key paths | `packages/server/src/routes/spc.integration.test.ts` covers SPC options issuance, dynamic-linking mismatch rejection, OTP fallback, audit writes, and ACS state transitions using Fastify `inject()`. |
| WPT coverage | Not implemented | The repository has focused unit coverage for money formatting and dynamic-linking checks plus route-level integration coverage, but does not yet run the W3C SPC WPT subset. |

## Review Position

The intended review position is:

> This is an SPC and 3DS challenge integration MVP. It demonstrates registration,
> SPC invocation, assertion verification, transaction-data verification, fallback,
> audit logging, and ACS-oriented state transitions. It intentionally does not
> take a final position on BBK requiredness.
