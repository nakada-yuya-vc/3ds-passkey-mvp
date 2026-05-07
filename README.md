# 3DS Passkey MVP

A prototype implementation that replaces SMS OTP with Passkeys (WebAuthn/FIDO2) in EMV 3-D Secure challenge authentication.

> 日本語版は [README.ja.md](./README.ja.md) をご覧ください。

---

## Overview

This MVP demonstrates replacing SMS one-time passwords with **device biometrics (Face ID / Touch ID / fingerprint)** for identity verification during the 3DS challenge step of credit card payments.

### Key Metrics Being Validated

| Metric | Description |
|--------|-------------|
| Challenge completion rate | Passkeys eliminate OTP input errors and reduce drop-offs |
| Authentication time | Near-zero wait time compared to SMS delivery + manual entry |
| Passkey enrollment rate | In-flow enrollment (enroll-on-challenge) as an adoption strategy |

---

## Features

### Authentication Flows

- **Frictionless authentication** — Transactions assessed as low-risk by the RBA engine complete without any challenge
- **OTP challenge** — SMS one-time password verification (mock mode: fixed code `123456`)
- **Passkey challenge** — Biometric authentication with a previously registered passkey
- **Enroll-on-challenge** — After successful OTP, users are prompted to register a passkey for future purchases
- **SPC (Secure Payment Confirmation)** — Payment-specific authentication combining Payment Request API with WebAuthn

### RBA (Risk-Based Authentication) Engine

Automatically decides frictionless vs. challenge based on the following rules:

| Condition | Decision |
|-----------|----------|
| Transaction amount ≥ ¥30,000 | Challenge required |
| Unknown device | Challenge required |
| First-time merchant | Challenge required |
| Known device + known merchant | Frictionless |

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

| Category | Technology |
|----------|-----------|
| Backend | Node.js, Fastify, TypeScript |
| ORM | Prisma |
| Database | PostgreSQL 16 |
| Frontend | React 18, Vite 5, TypeScript |
| WebAuthn | @simplewebauthn/server v10, @simplewebauthn/browser v10 |
| Charts | Recharts |
| Package manager | pnpm workspaces |
| Container | Docker (PostgreSQL only) |

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

Create `packages/server/.env`:

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/threeds_mvp"
PORT=3001
RP_ID=localhost
RP_NAME=3DS Passkey MVP
RP_ORIGIN=http://localhost:3004
OTP_MOCK=true
```

> **`OTP_MOCK=true`** fixes the OTP code to `123456` for development.

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

| Service | URL |
|---------|-----|
| API server | http://localhost:3001 |
| Challenge UI (ACS) | http://localhost:3004 |
| Test merchant | http://localhost:3002 |
| Admin dashboard | http://localhost:3003 |

---

## Usage

### Testing Payments (Test Merchant)

Open **http://localhost:3002** in your browser.

#### Test Cards

| Card Number | Scenario |
|-------------|----------|
| `4111 1111 1111 1111` | Frictionless (no challenge) |
| `4111 1111 1111 1129` | OTP challenge |
| `4111 1111 1111 1137` | Passkey challenge (requires prior enrollment) |
| `4111 1111 1111 1145` | High-value transaction → challenge |

#### Basic Flow

1. Select a product and click **"Purchase"**
2. Choose a test card and click **"Pay"**
3. A challenge screen appears depending on the card selected

#### How to Register a Passkey

1. Make a purchase with the **OTP challenge card** (`...1129`)
2. Enter `123456` on the OTP screen
3. When the **"Register Passkey"** prompt appears, complete enrollment using your device biometrics
4. Future purchases with the **Passkey challenge card** (`...1137`) will use biometric authentication only

### Admin Dashboard

Open **http://localhost:3003** to monitor authentication metrics in real time.

---

## API Reference

### 3DS Flow

| Method | Path | Description |
|--------|------|-------------|
| POST | `/threeds/areq` | Authentication Request (AReq). Runs RBA evaluation and decides frictionless or challenge |
| POST | `/threeds/creq` | Challenge Request (CReq). Verifies the OTP code |
| GET | `/threeds/transaction/:acsTransId` | Fetch transaction details |

### WebAuthn (Passkey)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webauthn/register/options` | Get passkey registration options |
| POST | `/webauthn/register/verify` | Verify and save passkey registration |
| GET | `/webauthn/authenticate/options` | Get passkey authentication options |
| POST | `/webauthn/authenticate/verify` | Verify passkey authentication |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/metrics` | KPI metrics (`?from=&to=`) |
| GET | `/admin/transactions` | Transaction list (`?limit=&offset=`) |
| GET | `/admin/timeseries` | Time-series data (`?from=&to=`) |

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
 │
 └──── DeviceFingerprint  (device learning)

OtpSession  (temporary OTP session)
```

---

## Browser Constraints

Passkey behavior varies significantly between browsers. Understanding these constraints is important when testing this MVP.

### Passkey storage is tied to each browser ecosystem

Each browser saves passkeys to its own backend. **A passkey registered in one browser cannot be used in another.**

| Browser | Passkey storage | Cross-browser use |
|---------|----------------|-------------------|
| Microsoft Edge | Windows Hello (local TPM) | ❌ Edge only |
| Google Chrome | Google Password Manager (cloud sync) | ❌ Chrome only |
| Safari | iCloud Keychain (Apple ecosystem sync) | ❌ Apple devices only |
| Cross-browser | Via Bluetooth / QR code (CTAP2 hybrid) | ⚠️ Requires phone nearby |

### Edge vs Chrome behave differently

- **Edge** routes directly to Windows Hello (Microsoft's own platform), prompting for Windows Hello PIN or biometrics.
- **Chrome** checks Google Password Manager first. If the credential isn't there (e.g. it was registered via Edge), Chrome falls back to showing a cross-device (Bluetooth/QR) prompt instead of Windows Hello — even if the credential exists in Windows Hello.

> In this MVP, registering and authenticating within the **same browser** is required. This mirrors real-world usage where users authenticate on a single device/ecosystem.

### Windows Hello uses a PIN, not just biometrics

On Windows, passkey authentication via Windows Hello may prompt for a **PIN** rather than a fingerprint or face scan, depending on device configuration. This is by design — the PIN is device-local and does not travel over the network, making it fundamentally different from an OTP.

### Recommended test environment

| Condition | Recommended setup |
|-----------|------------------|
| Full passkey flow | Use a single browser throughout (register + authenticate) |
| Biometric auth (no PIN) | Use a device with fingerprint reader or Face ID configured in Windows Hello |
| Cross-device test | Enable Bluetooth and use a phone with the same Google/Apple account |

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

### Port 3001 is already in use

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# macOS / Linux
lsof -ti:3001 | xargs kill
```

---

## License

MIT
