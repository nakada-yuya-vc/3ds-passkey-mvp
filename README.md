# 3DS Passkey MVP

A prototype implementation that replaces SMS OTP with Passkeys (WebAuthn/FIDO2) in EMV 3-D Secure challenge authentication.

> 日本語版は [README.ja.md](./README.ja.md) をご覧ください。

---

![Demo](./demo.gif)

## Overview

This MVP demonstrates replacing SMS one-time passwords with **device biometrics (Face ID / Touch ID / fingerprint)** for identity verification during the 3DS challenge step of credit card payments.

### Key Metrics Being Validated

| Metric                    | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| Challenge completion rate | Passkeys eliminate OTP input errors and reduce drop-offs         |
| Authentication time       | Near-zero wait time compared to SMS delivery + manual entry      |
| Passkey enrollment rate   | In-flow enrollment (enroll-on-challenge) as an adoption strategy |

---

## Features

### Authentication Flows

- **Frictionless authentication** — Approved without any challenge
- **OTP challenge** — SMS one-time password verification (mock mode: fixed code `123456`)
- **Passkey challenge** — Biometric authentication with a previously registered passkey
- **Enroll-on-challenge** — After successful OTP, users are prompted to register a passkey for future purchases
- **SPC (Secure Payment Confirmation)** — Payment-specific authentication combining Payment Request API with WebAuthn. Credentials are registered with the `payment: { isPayment: true }` extension and authenticated with `payment.get`, so the server can verify the WebAuthn assertion and the transaction details shown by the browser. Browser Bound Key (BBK) handling is intentionally left out of scope because the requirement and deployment model are still under active W3C discussion.

### How the flow is selected

In this MVP the test storefront ([`packages/merchant/src/Checkout.tsx`](packages/merchant/src/Checkout.tsx)) chooses the auth flow **per product**:

| Product              | Price   | Flow         |
| -------------------- | ------- | ------------ |
| Wireless Earbuds Pro | ¥12,800 | frictionless |
| Smartwatch Elite     | ¥34,800 | otp          |
| Mechanical Keyboard  | ¥18,500 | webauthn     |
| Gaming Headset       | ¥24,800 | spc          |

> A real RBA engine (amount + device-history based routing) would replace the per-product selection. A scaffold for that lives in `packages/server/src/services/rba.ts`; the current implementation just respects the merchant-specified flow.

### Admin Dashboard

Visualizes real-time metrics with 10-second auto-refresh:

- **KPI cards** — Total transactions, frictionless rate, challenge completion rate, passkey usage rate, passkey enrollment rate
- **Auth type breakdown** — Pie chart (FRICTIONLESS / OTP / PASSKEY / PASSKEY_SPC)
- **Avg. authentication time comparison** — Bar chart (OTP vs Passkey, in milliseconds)
- **Frictionless rate time series** — Line chart (last 7 days, 1-hour granularity)
- **Recent transactions table** — Auth method, result, and duration per transaction

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Browser (User)                                      │
│                                                      │
│  ┌──────────────┐   ┌───────────────────────────┐   │
│  │  Merchant    │   │  Challenge UI (ACS)       │   │
│  │  :3002       │──▶│  :3004  (iframe)          │   │
│  └──────────────┘   └───────────────────────────┘   │
└──────────────────────────┬───────────────────────────┘
                           │ HTTP / WebAuthn
                           ▼
              ┌─────────────────────────┐
              │   API Server  :3001     │
              │   (Fastify + Prisma)    │
              │                        │
              │   /threeds  3DS flow   │
              │   /webauthn Passkey    │
              │   /spc      SPC        │
              │   /admin    Metrics    │
              └───────────┬────────────┘
                          │
              ┌───────────▼────────────┐
              │   PostgreSQL  :5432    │
              └────────────────────────┘

  ┌──────────────────────┐
  │  Dashboard  :3003    │
  │  (Admin view)        │
  └──────────────────────┘
```

### Package Structure

```
passkey-mvp/
├── packages/
│   ├── server/          # Fastify API server (Node.js + TypeScript)
│   ├── challenge-ui/    # ACS challenge UI (React + Vite)
│   ├── merchant/        # Test merchant storefront (React + Vite)
│   └── dashboard/       # Admin dashboard (React + Vite + Recharts)
├── docker-compose.yml   # PostgreSQL
└── pnpm-workspace.yaml
```

---

## Tech Stack

| Category        | Technology                                              |
| --------------- | ------------------------------------------------------- |
| Backend         | Node.js, Fastify, TypeScript                            |
| ORM             | Prisma                                                  |
| Database        | PostgreSQL 16                                           |
| Frontend        | React 18, Vite 5, TypeScript                            |
| WebAuthn        | @simplewebauthn/server v10, @simplewebauthn/browser v10 |
| Charts          | Recharts                                                |
| Package manager | pnpm workspaces                                         |
| Container       | Docker (PostgreSQL only)                                |

---

## Setup

### Prerequisites

- Node.js 18+
- pnpm 8+ (`npm install -g pnpm`)
- Docker Desktop

### 1. Clone the Repository

```bash
git clone <repository-url>
cd passkey-mvp
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Create `.env` at the repository root (check if it already exists):

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/threeds_mvp
PORT=3001
RP_ID=localhost
RP_NAME=3DS Passkey MVP
RP_ORIGIN=http://localhost:3004
ACS_URL=http://localhost:3004
MERCHANT_URL=http://localhost:3002
OTP_MOCK=true
JWT_SECRET=change_me_in_production
PAN_PEPPER=dev_only_pepper_replace_in_production_xxxxxxxxxxxxxxxxxxxx
# SPC_PAYEE_ORIGIN=https://merchant.example.com
```

> **`OTP_MOCK=true`** fixes the OTP code to `123456` for development.
> **`MERCHANT_URL`** is used to build the SPC `payeeOrigin`. In dev (http) the server coerces it to `https://` and logs a warning; for any non-dev environment set **`SPC_PAYEE_ORIGIN`** explicitly to a real `https://` origin.
> **`PAN_PEPPER`** is the HMAC key used to derive the user join key from the PAN. PAN space is small enough to brute-force a plain SHA-256, so we HMAC it. The dev value here is fine for local testing; in production load this from KMS / Secrets Manager and never commit it. Must be at least 32 chars.

### 4. Start the Database and Apply Schema

```bash
# Start the PostgreSQL container
pnpm db:up

# Push the schema to the database
pnpm db:push
```

### 5. Start the Development Servers

```bash
pnpm dev
```

This starts all four services concurrently:

| Service            | URL                   |
| ------------------ | --------------------- |
| API server         | http://localhost:3001 |
| Challenge UI (ACS) | http://localhost:3004 |
| Test merchant      | http://localhost:3002 |
| Admin dashboard    | http://localhost:3003 |

---

## Usage

### Testing Payments (Test Merchant)

Open **http://localhost:3002** in your browser. The test card is always `4111 1111 1111 1111` — **the auth flow is tied to the product**, so pick the product matching the flow you want to test.

| Product              | Flow         | Expected behaviour                                                  |
| -------------------- | ------------ | ------------------------------------------------------------------- |
| Wireless Earbuds Pro | Frictionless | Approved immediately, no challenge                                  |
| Smartwatch Elite     | OTP          | Enter OTP `123456` → prompted to enroll a passkey                   |
| Mechanical Keyboard  | WebAuthn     | Biometric auth with an existing passkey (falls back to OTP if none) |
| Gaming Headset       | SPC          | Secure Payment Confirmation dialog, with OTP fallback if unavailable |

#### Basic Flow

1. Pick a product and click **"Buy Now"**
2. Click **"Pay"**
3. The challenge (or success) screen for the product's flow appears

#### Registering Your First Passkey

1. Purchase **Smartwatch Elite (OTP)**
2. Enter `123456` on the OTP screen
3. Complete passkey enrollment with Windows Hello / Touch ID when prompted
4. Subsequent **Mechanical Keyboard (WebAuthn)** purchases use biometric auth; **Gaming Headset (SPC)** uses the SPC dialog and falls back to OTP when SPC is unavailable

### Admin Dashboard

Open **http://localhost:3003** to monitor authentication metrics in real time.

---

## API Reference

### 3DS Flow

| Method | Path                               | Description                                                                              |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/threeds/areq`                    | Authentication Request (AReq). Runs RBA evaluation and decides frictionless or challenge |
| POST   | `/threeds/creq`                    | Challenge Request (CReq). Verifies the OTP code                                          |
| POST   | `/threeds/fallback/otp`            | Issues an OTP and records the transaction as OTP when SPC is unavailable                 |
| GET    | `/threeds/transaction/:acsTransId` | Fetch transaction details                                                                |

### WebAuthn (Passkey)

| Method | Path                             | Description                                                                      |
| ------ | -------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/webauthn/register/options`     | Get passkey registration options (includes `extensions.payment.isPayment: true`) |
| POST   | `/webauthn/register/verify`      | Verify and save passkey registration (AAGUID also logged)                        |
| GET    | `/webauthn/authenticate/options` | Get passkey authentication options                                               |
| POST   | `/webauthn/authenticate/verify`  | Verify passkey authentication                                                    |

### SPC (Secure Payment Confirmation)

| Method | Path           | Description                                                                                  |
| ------ | -------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/spc/options` | Returns the SPC ceremony challenge, rpId, payeeOrigin, and the user's registered credentials |
| POST   | `/spc/verify`  | Verifies an SPC assertion via `@simplewebauthn/server` with `expectedType: 'payment.get'`    |

### Admin

| Method | Path                  | Description                          |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/admin/metrics`      | KPI metrics (`?from=&to=`)           |
| GET    | `/admin/transactions` | Transaction list (`?limit=&offset=`) |
| GET    | `/admin/timeseries`   | Time-series data (`?from=&to=`)      |

---

## Database Schema

```
User ──── WebAuthnCredential  (passkey public key)
 │
 └──── Transaction  (3DS transaction history)
 │       - authType: FRICTIONLESS / OTP / PASSKEY / PASSKEY_SPC
 │       - authResult: AUTHENTICATED / NOT_AUTHENTICATED / ATTEMPTED
 │       - challengeStartedAt / otpCompletedAt / authenticatedAt  (timing)
 │       - enrolledPasskey  (flag for enrollment rate calculation)
 │       └──── ChallengeSession  (temporary WebAuthn/SPC challenges)
 │
 └──── DeviceFingerprint  (device learning)

OtpSession  (temporary OTP session)
```

---

## Browser / OS Behaviour

### SPC credential and BBK scope

This MVP registers passkeys with the `payment: { isPayment: true }` extension and verifies SPC assertions with `expectedType: 'payment.get'`. It also checks the signed `clientDataJSON.payment` payload against the issued transaction (`rpId`, `payeeOrigin`, amount, and currency).

Browser Bound Key (BBK) support is intentionally not implemented in this MVP. The role of BBK in proving device possession, how it should be detected, and how strictly it should be required are still active W3C discussion topics. For that reason, this prototype should be read as an SPC / 3DS UX and protocol-integration MVP, not as a complete PSD2 SCA or EMVCo compliance implementation.

The AAGUID written to the database is an observation signal for the authenticator used at registration time (for example Windows Hello, Touch ID, or an anonymous platform authenticator). It is logged for review, but the MVP does not yet enforce an AAGUID or attestation allowlist.

Inspect server logs for `'[register] credential created — authenticator identified by AAGUID'` to see which authenticator or passkey provider was observed at registration time (known AAGUIDs get labelled automatically).

### SPC support by browser / OS

| Browser / OS             | SPC | Notes                                                                      |
| ------------------------ | --- | -------------------------------------------------------------------------- |
| Chrome / Edge on Windows | ✅  | Uses the platform authenticator, such as Windows Hello biometric or PIN     |
| Chrome / Edge on macOS   | ✅  | Uses the platform authenticator, such as Touch ID / Apple Watch            |
| Chrome on Android        | ✅  | Uses the Android platform authenticator                                    |
| Safari                   | ❌  | Supports WebAuthn but not the Payment Request × WebAuthn integration (SPC) |

### Windows Hello may prompt for PIN instead of biometrics

Depending on the device configuration, Windows Hello may ask for the **PIN** rather than a fingerprint or face scan. This is normal platform-authenticator behavior; the PIN remains local to the device and is not sent over the network like an OTP.

### Non-secure contexts (HTTP over LAN IP) block WebAuthn / SPC

If you open the merchant from a phone using the host machine's LAN IP (e.g. `http://192.168.x.x:3002`), the iframe at `http://192.168.x.x:3004` is not a secure context, so the browser hides `PublicKeyCredential` and `PaymentRequest`. The challenge UI surfaces this explicitly as "Passkey authentication unavailable here" instead of silently failing. To test from another device, expose HTTPS via:

- An ngrok tunnel (`ngrok http 3002` / `ngrok http 3004`)
- Vite's HTTPS dev mode (e.g. via `vite-plugin-mkcert`)

When SPC is unavailable, this sample explicitly switches the challenge to OTP by calling `/threeds/fallback/otp`. The fallback is visible in the UI and the transaction is recorded as `OTP`, so SPC failures are not hidden in the metrics.

### Recommended test environment

| Goal                              | Setup                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| Verify SPC end-to-end             | Chrome / Edge on Windows or macOS, served over `localhost`  |
| Biometric auth (no PIN)           | Configure fingerprint or face recognition in Windows Hello  |
| Register & use on the same device | Use the same browser profile for registration and challenge |

---

## Troubleshooting

### "The 'publickey-credentials-create' feature is not enabled" during Passkey registration

WebAuthn inside an iframe requires explicit Permissions Policy grants.  
Verify that the iframe in `packages/merchant/src/Checkout.tsx` has:

```html
allow="publickey-credentials-get *; publickey-credentials-create *; payment *"
```

### OTP is not accepted

When `OTP_MOCK=true`, the correct code is always `123456`.  
Check your `.env` file.

### SPC dialog appears but the ceremony fails with `NotAllowedError`

Check the following:

- Verify the registration options include `extensions.payment.isPayment: true` (`packages/server/src/routes/webauthn.ts`). The older key `isPaymentCredential` is silently ignored by Chrome, so the credential is created without the SPC marker and `show()` later refuses to use it.
- Confirm in the server log (`'[register] credential created'`) which AAGUID was stored — it should be a platform authenticator (Windows Hello, Touch ID, …).
- If a credential was previously created with the wrong extension, re-create it. `pnpm db:reset` clears the database.

### SPC verify returns 401 with `Unexpected authentication response type: payment.get`

`@simplewebauthn/server` accepts only `webauthn.get` by default. SPC sets the type to `payment.get`, so `/spc/verify` passes `expectedType: 'payment.get'` to allow it. The rest of the verification (signature / challenge / RPID / UV flag) is identical to regular WebAuthn.

### Port 3001 is already in use

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# macOS / Linux
lsof -ti:3001 | xargs kill
```

---

## Known gaps

See [BACKLOG.md](./BACKLOG.md) for the items deliberately deferred (BBK
positioning, attestation policy, line items, conformance tests, etc.) and
the W3C SPC issues each one tracks.

For external review, see also [SECURITY.md](./SECURITY.md) for the MVP security
posture and [CONFORMANCE.md](./CONFORMANCE.md) for SPC conformance notes.

## License

MIT
