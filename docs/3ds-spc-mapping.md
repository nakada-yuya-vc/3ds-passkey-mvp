# 3DS 2.3.1 / SPC Mapping Notes

This note maps the MVP to the public EMVCo WebAuthn/SPC whitepaper flow and the
W3C Secure Payment Confirmation data model. It is an implementation planning
document, not an EMVCo conformance claim.

Primary references:

- [EMVCo WebAuthn and SPC whitepaper section](https://www.emvco.com/whitepapers/emv-3-d-secure-whitepaper-v2/challenge-flow/webauthn-and-spc/)
- [W3C Secure Payment Confirmation](https://www.w3.org/TR/secure-payment-confirmation/)
- [MDN SecurePaymentConfirmationRequest](https://developer.mozilla.org/en-US/docs/Web/API/SecurePaymentConfirmationRequest)
- [Chrome Secure Payment Confirmation guide](https://developer.chrome.com/docs/payments/authenticate-secure-payment-confirmation)

## Current MVP Position

The repository implements the issuer/ACS-initiated shape: the ACS-hosted
challenge UI invokes SPC inside the challenge flow, verifies the resulting
`payment.get` WebAuthn assertion server-side, and falls back to OTP when SPC is
not available or fails.

It does not yet implement the EMV 3DS protocol message layer. The current
`/threeds/areq`, `/spc/options`, `/spc/verify`, and `/threeds/fallback/otp`
routes are intentionally simplified MVP endpoints that would map into an
existing certified ACS / 3DS Server product.

## Data Element Mapping

| Public 3DS/SPC concept | Current repository location | Commercial integration note |
| --- | --- | --- |
| 3DS Requestor SPC support / browser SPC support signal | `packages/challenge-ui/src/ChallengePage.tsx` probes secure context, WebAuthn, `PaymentRequest`, and `canMakePayment()` before selecting SPC. | In a merchant-initiated SPC flow this support signal belongs in the first AReq path from the 3DS Requestor / 3DS Server. In issuer-initiated challenge flow, the ACS may decide inside the challenge. |
| WebAuthn Credential List | `/threeds/transaction/:acsTransId` and `/spc/options` return credential IDs from `WebAuthnCredential`. | In commercial 3DS this list must be carried only through the protocol path and role that EMV 3DS allows for the selected SPC flow. Credential IDs should be treated as sensitive identifiers. |
| SPC Transaction Data | `createSpcAuthenticationRequest()` builds `rpId`, `payeeOrigin`, `instrument`, and `total`. | This needs a strict mapping to the 3DS transaction amount, currency, merchant/payee identity, display assets, and any scheme-specific formatting rules. |
| Payment Request `secure-payment-confirmation` invocation | `packages/challenge-ui/src/SpcChallenge.tsx` constructs `PaymentRequest` with `credentialIds`, `challenge`, `rpId`, `payeeOrigin`, `payeeName`, `instrument`, and `total`. | Browser support, iframe permissions, origin model, timeout, cancel, and fallback handling must be part of the ACS product behavior and test plan. |
| Signed `clientDataJSON.payment` | `verifySpcAuthentication()` parses and audits received payment data; `verifySpcPaymentClientData()` enforces dynamic-linking fields. | The commercial ACS should retain enough evidence to prove what was displayed and what was signed, while redacting/hashing sensitive identifiers. |
| WebAuthn assertion verification | `verifySpcAuthentication()` calls SimpleWebAuthn with `expectedType: "payment.get"`, expected challenge, origin, RP ID, and UV required. | Production must align this with the ACS authentication result, RReq evidence, counter handling, credential lifecycle, and issuer policy. |
| OTP fallback | `/threeds/fallback/otp` switches a pending SPC attempt to OTP and records `FALLBACK_TO_OTP` audit events. | Certified OTP behavior should remain the fallback baseline. SPC fallback reasons should feed operational monitoring and certification test cases. |
| Authentication result | `Transaction.authType = PASSKEY_SPC` and `authResult = AUTHENTICATED` after successful verify. | In a certified ACS, this result must be translated into the proper 3DS transaction status, authentication method, and result message behavior. |
| ACS transaction state | `Transaction.acsState` stores the current ACS state; `AcsTransactionStateHistory` records transitions. | This is the repository's bridge from MVP route names to a commercial ACS state machine. It should be mapped to the certified product's internal transaction states before EMVCo testing. |
| Audit / evidence | `SpcAuthenticationAudit` records issued expected payment data, received payment data, failure reason, and hashed credential ID. | Commercial audit retention, privacy controls, dispute evidence, and log integrity requirements still need product-specific policy. |

## W3C SPC Data Coverage

| W3C SPC field / behavior | MVP status | Notes |
| --- | --- | --- |
| `challenge` | Implemented | 32-byte random challenge issued server-side and burned by `claimChallenge()`. |
| `credentialIds` | Implemented | Sent from server to challenge UI and converted to byte arrays before `PaymentRequest`. |
| `rpId` | Implemented | Defaults to `localhost`; production must use the issuer/ACS RP domain. |
| `payeeOrigin` | Implemented with dev override | Production must set explicit HTTPS `SPC_PAYEE_ORIGIN`; dev coercion must not be used. |
| `payeeName` | Partial | Sent by the challenge UI, but server-side dynamic-linking currently does not enforce it. |
| `total` | Implemented | Currency numeric-to-alpha conversion and minor-unit formatting are centralized. |
| `instrument.displayName` / `instrument.icon` | Implemented | Verified server-side. Audit stores icon hash, not the full icon. |
| `topOrigin` | Partial | Captured in audit if present, but not enforced. |
| `paymentEntitiesLogos` | Not implemented | Deferred because local browser rendering was inconsistent; production assets require HTTPS-hosted, tested artwork. |
| Browser Bound Key | Out of scope | W3C SPC has active BBK-related fields and behavior. The MVP stays neutral until product policy is decided. |

## Message-Flow Gap

The repo currently demonstrates the security ceremony, not the full EMV 3DS
message choreography.

For commercialisation into an existing OTP ACS, the next design task is to
decide whether SPC is:

1. **Issuer/ACS-initiated challenge SPC**: SPC replaces the OTP UI inside the
   ACS challenge, with OTP fallback.
2. **Merchant/3DS Requestor-initiated SPC**: the 3DS Requestor invokes SPC
   after receiving SPC data, then sends a follow-up authentication request with
   the assertion / prior transaction reference.

Those paths affect where the WebAuthn Credential List, SPC Transaction Data,
assertion, result status, and fallback are represented in certified 3DS
messages. The MVP is currently closer to path 1.

## ACS State Machine

The MVP keeps an explicit ACS-oriented transaction state alongside the existing
`authType` and `authResult` fields. The current state is stored on
`Transaction.acsState`; every transition is appended to
`AcsTransactionStateHistory`.

```mermaid
stateDiagram-v2
  [*] --> A_REQ_RECEIVED
  A_REQ_RECEIVED --> FRICTIONLESS_AUTHENTICATED: frictionless
  A_REQ_RECEIVED --> CHALLENGE_REQUIRED: OTP / passkey / SPC challenge
  CHALLENGE_REQUIRED --> SPC_REQUESTED: /spc/options
  SPC_REQUESTED --> SPC_AUTHENTICATED: /spc/verify success
  SPC_REQUESTED --> OTP_FALLBACK_REQUIRED: client fallback
  OTP_FALLBACK_REQUIRED --> OTP_AUTHENTICATED: OTP verified
  CHALLENGE_REQUIRED --> OTP_AUTHENTICATED: OTP verified
  CHALLENGE_REQUIRED --> PASSKEY_AUTHENTICATED: WebAuthn verified
  SPC_REQUESTED --> AUTHENTICATION_FAILED: server-side SPC verify failure
  CHALLENGE_REQUIRED --> AUTHENTICATION_FAILED: explicit failure completion
```

This is still an MVP state model. A certified ACS will usually have more states
for protocol message receipt/sending, challenge window lifecycle, timeouts,
RReq/RRes handling, retries, and decoupled or out-of-band flows. The important
step is that the repository no longer treats `/threeds/*` and `/spc/*`
endpoints as the only source of truth; they now drive a transaction state that
can be compared to a commercial ACS implementation.

## Implementation Backlog

- Add route-level tests for successful assertion verification with a real
  WebAuthn fixture or a tightly scoped SimpleWebAuthn mock.
- Enforce or explicitly ignore `payeeName` and `topOrigin` in
  `verifySpcPaymentClientData()`.
- Add an ACS transaction state machine that names 3DS-style phases separately
  from the simplified MVP route names.
- Add a certification-facing test matrix for browser unsupported, user cancel,
  timeout, dynamic-linking mismatch, replayed challenge, expired challenge, and
  OTP fallback.
- Confirm with the EMVCo lab whether the existing OTP product's LOA can be
  amended or whether SPC requires a new 2.3.1 option/version test campaign.
