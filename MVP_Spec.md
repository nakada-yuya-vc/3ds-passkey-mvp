# 3DS Passkey MVP — Technical Specification

## 概要・目的

EMV 3DS のチャレンジ認証を SMS OTP から Passkey（WebAuthn/FIDO2）に置き換えるデモ実装。
日本市場向けの「高UX ACS」の実証として、以下を数値で示せる状態にする。

- チャレンジ完了率の改善
- 認証所要時間の短縮（OTP比）
- Passkey 登録率（enroll-on-challenge）

**スコープ外（MVP には含めない）**
- VP Token / Verifiable Credentials 連携
- 実際のカードネットワーク接続（テスト環境のみ）
- 本番 SMS 送信（モック可）
- 完全な EMVCo プロトコル準拠（プロトコル近似で可）

---

## システム構成

```
[Test Merchant Page]
      |
      | AReq (POST)
      v
[3DS Server]  ←→  [ACS]
                     |
                     |-- RBA Engine (frictionless 判定)
                     |-- WebAuthn RP Server (Passkey 管理)
                     |-- Challenge UI (iframe で加盟店に埋め込み)
                     |-- Enroll UI (OTP 認証成功後の登録画面)
                     |
[Admin Dashboard] ←-- [Metrics DB]
```

### コンポーネント

| コンポーネント | 役割 |
|---|---|
| Test Merchant | テスト用 EC ページ。購入ボタン → 3DS フロー起動 |
| 3DS Server | AReq 受信 → ACS へ転送 → ARes 返却 |
| ACS | RBA 判定・チャレンジ発行・WebAuthn RP・認証結果生成 |
| Admin Dashboard | frictionless 率・認証時間・Passkey 登録率の可視化 |

---

## 技術スタック

| 領域 | 採用技術 |
|---|---|
| 言語 | TypeScript |
| バックエンド | Node.js + Fastify |
| WebAuthn ライブラリ | `@simplewebauthn/server`（サーバー）/ `@simplewebauthn/browser`（クライアント） |
| DB | PostgreSQL + Prisma ORM |
| フロントエンド | React（Challenge UI / Enroll UI / Admin Dashboard） |
| SPC | Web Payment Request API（ブラウザネイティブ） |
| モノレポ | pnpm workspaces |

---

## ディレクトリ構成

```
/
├── packages/
│   ├── server/          # 3DS Server + ACS バックエンド (Fastify)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── threeds.ts      # 3DS プロトコル (AReq/CReq/RReq)
│   │   │   │   ├── webauthn.ts     # WebAuthn 登録・認証
│   │   │   │   ├── spc.ts          # SPC verification
│   │   │   │   └── admin.ts        # メトリクス API
│   │   │   ├── services/
│   │   │   │   ├── rba.ts          # Risk-Based Authentication エンジン
│   │   │   │   ├── otp.ts          # OTP 生成・検証（モック可）
│   │   │   │   └── metrics.ts      # メトリクス記録
│   │   │   └── prisma/
│   │   │       └── schema.prisma
│   │   └── package.json
│   │
│   ├── challenge-ui/    # ACS チャレンジ画面 (React)
│   │   └── src/
│   │       ├── ChallengePage.tsx   # メイン画面（OTP or Passkey 分岐）
│   │       ├── OtpChallenge.tsx
│   │       ├── PasskeyChallenge.tsx
│   │       ├── SpcChallenge.tsx
│   │       └── EnrollPasskey.tsx   # enroll-on-challenge 画面
│   │
│   ├── merchant/        # テスト用加盟店ページ (React)
│   │   └── src/
│   │       └── Checkout.tsx        # 購入フロー + 3DS 起動
│   │
│   └── dashboard/       # Admin ダッシュボード (React)
│       └── src/
│           └── Dashboard.tsx
│
├── pnpm-workspace.yaml
└── docker-compose.yml   # PostgreSQL
```

---

## データモデル（Prisma Schema）

```prisma
model User {
  id              String   @id @default(uuid())
  cardNumberHash  String   @unique  // SHA-256 of PAN
  email           String?
  phone           String?
  createdAt       DateTime @default(now())

  credentials     WebAuthnCredential[]
  transactions    Transaction[]
  devices         DeviceFingerprint[]
}

model WebAuthnCredential {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])

  credentialId  String   @unique  // base64url
  publicKey     Bytes              // COSE 形式
  signCount     Int      @default(0)
  aaguid        String?
  transports    String[]           // ["internal", "hybrid", ...]
  spcCapable    Boolean  @default(false)  // payment extension 付きか

  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?
}

model Transaction {
  id                    String   @id @default(uuid())
  threeDSServerTransId  String   @unique
  acsTransId            String   @unique @default(uuid())

  userId                String?
  user                  User?    @relation(fields: [userId], references: [id])
  cardNumberHash        String
  merchantId            String
  merchantName          String?
  purchaseAmount        Int                // 最小単位（円）
  purchaseCurrency      String  @default("392")  // JPY

  // 認証フロー
  authType              AuthType           // FRICTIONLESS | OTP | PASSKEY | PASSKEY_SPC
  authResult            AuthResult         // AUTHENTICATED | NOT_AUTHENTICATED | ATTEMPTED
  frictionless          Boolean @default(false)

  // タイミング
  requestedAt           DateTime @default(now())
  challengeStartedAt    DateTime?
  authenticatedAt       DateTime?

  // RBA シグナル
  deviceKnown           Boolean?
  deviceHash            String?
  ipAddress             String?
}

enum AuthType {
  FRICTIONLESS
  OTP
  PASSKEY
  PASSKEY_SPC
}

enum AuthResult {
  AUTHENTICATED
  NOT_AUTHENTICATED
  ATTEMPTED
}

model DeviceFingerprint {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  deviceHash      String
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime @updatedAt
  transactionCount Int     @default(1)
  trusted         Boolean  @default(false)

  @@unique([userId, deviceHash])
}

model OtpSession {
  id          String   @id @default(uuid())
  acsTransId  String   @unique
  otpCode     String
  expiresAt   DateTime
  verified    Boolean  @default(false)
}
```

---

## 認証フロー仕様

### Flow 1: frictionless（チャレンジなし）

```
Merchant → POST /threeds/areq
ACS: RBA スコアリング
  条件: known device AND amount < 30,000 AND same merchant before
  → ARes { transStatus: "Y", frictionless: true }
Merchant: 認証完了
```

### Flow 2: OTP チャレンジ（Passkey 未登録ユーザー）

```
Merchant → POST /threeds/areq
ACS: RBA → チャレンジ必要、Passkey 未登録
  → ARes { transStatus: "C", acsURL: "/challenge/{acsTransId}" }

Merchant: iframe で /challenge/{acsTransId} を表示
  allow="publickey-credentials-get publickey-credentials-create payment"

Challenge UI: OTP 入力画面を表示
User: OTP 入力
  → POST /threeds/creq { otpCode }
ACS: OTP 検証成功
  → 「Passkey を登録しますか？」画面を表示（EnrollPasskey.tsx）

User: 登録する場合
  → GET /webauthn/register/options
  → WebAuthn 登録 ceremony（Face ID / Touch ID）
  → POST /webauthn/register/verify
  ACS: クレデンシャル保存（spcCapable = payment extension があれば true）

ACS: RReq 送信 → Merchant: 認証完了
```

### Flow 3: Passkey チャレンジ（登録済みユーザー）

```
Merchant → POST /threeds/areq
ACS: RBA → チャレンジ必要、Passkey 登録済みを確認
  → ARes { transStatus: "C", acsURL: "/challenge/{acsTransId}" }

Merchant: iframe を表示
  allow="publickey-credentials-get payment"

Challenge UI: ブラウザを判定
  ├── SPC 対応 (Chrome/Edge) AND spcCapable な credential あり
  │     → SpcChallenge.tsx: PaymentRequest API 起動
  │       → POST /spc/verify { assertion }
  │
  └── SPC 非対応 (Safari 等)
        → PasskeyChallenge.tsx: navigator.credentials.get() 起動
          → POST /webauthn/authenticate/verify { assertion }

ACS: assertion 検証・signCount 更新
  → RReq 送信 → Merchant: 認証完了
```

---

## API エンドポイント仕様

### 3DS プロトコル

```
POST /threeds/areq
  Body: {
    threeDSServerTransID: string
    cardNumberHash: string        // テスト用: PAN の代替
    merchantID: string
    merchantName: string
    purchaseAmount: number
    purchaseCurrency: string
    deviceChannel: "02"           // BRW固定（MVP）
    browserInfo: {
      userAgent: string
      language: string
      screenWidth: number
      screenHeight: number
    }
  }
  Response: {
    acsTransID: string
    transStatus: "Y" | "C"       // Y=frictionless, C=challenge
    acsURL?: string               // transStatus=C のとき
  }

POST /threeds/creq
  Body: {
    acsTransID: string
    otpCode?: string
  }
  Response: {
    status: "otp_verified" | "show_enroll"
    enrollOptions?: RegistrationOptions
  }
```

### WebAuthn

```
GET /webauthn/register/options?acsTransId=xxx
  Response: PublicKeyCredentialCreationOptionsJSON
    ※ extensions: { payment: { isPayment: true } } を含める（SPC対応のため）
    ※ authenticatorSelection: { residentKey: "required", userVerification: "required" }

POST /webauthn/register/verify
  Body: {
    acsTransId: string
    credential: RegistrationResponseJSON
  }
  Response: { success: true, credentialId: string }

GET /webauthn/authenticate/options?acsTransId=xxx
  Response: PublicKeyCredentialRequestOptionsJSON
    ※ userVerification: "required"
    ※ allowCredentials: [{ id: credentialId, type: "public-key" }]

POST /webauthn/authenticate/verify
  Body: {
    acsTransId: string
    credential: AuthenticationResponseJSON
  }
  Response: { success: true }
```

### SPC

```
POST /spc/verify
  Body: {
    acsTransId: string
    assertion: AuthenticationResponseJSON  // SPC から返ってきた WebAuthn assertion
  }
  Response: { success: true }
```

### Admin / Metrics

```
GET /admin/metrics?from=ISO8601&to=ISO8601
  Response: {
    totalTransactions: number
    frictionlessRate: number          // 0.0 - 1.0
    challengeCompletionRate: number
    passkeyUsageRate: number          // challenge中のPasskey割合
    passkeyEnrollmentRate: number     // OTP後にPasskeyを登録した割合
    avgAuthTimeMs: {
      otp: number
      passkey: number
    }
    authTypeBreakdown: {
      FRICTIONLESS: number
      OTP: number
      PASSKEY: number
      PASSKEY_SPC: number
    }
  }
```

---

## RBA エンジン（MVP版: ルールベース）

```typescript
// services/rba.ts

interface RBAInput {
  cardNumberHash: string
  merchantId: string
  purchaseAmount: number  // 円
  deviceHash: string
  ipAddress: string
}

interface RBAResult {
  decision: 'frictionless' | 'challenge'
  reason: string
}

function evaluate(input: RBAInput): RBAResult {
  // Rule 1: 高額はチャレンジ
  if (input.purchaseAmount >= 30000) {
    return { decision: 'challenge', reason: 'high_amount' }
  }

  // Rule 2: 未知デバイスはチャレンジ
  const deviceKnown = checkDeviceHistory(input.cardNumberHash, input.deviceHash)
  if (!deviceKnown) {
    return { decision: 'challenge', reason: 'unknown_device' }
  }

  // Rule 3: 初回加盟店はチャレンジ
  const merchantKnown = checkMerchantHistory(input.cardNumberHash, input.merchantId)
  if (!merchantKnown) {
    return { decision: 'challenge', reason: 'new_merchant' }
  }

  // 上記いずれも該当しない → frictionless
  return { decision: 'frictionless', reason: 'trusted' }
}
```

---

## Challenge UI: ブラウザ分岐ロジック

```typescript
// PasskeyChallenge.tsx または SpcChallenge.tsx への分岐

async function detectAndChallenge(acsTransId: string) {
  // 1. SPC 対応チェック
  const spcAvailable =
    typeof PaymentRequest !== 'undefined' &&
    await PaymentRequest.canMakePayment?.({
      supportedMethods: 'secure-payment-confirmation',
      data: { credentialIds: [], rpId: '', challenge: new Uint8Array(), instrument: { displayName: '', icon: '' } }
    }).catch(() => false)

  // 2. SPC 対応 AND spcCapable な credential がある場合
  if (spcAvailable && credential.spcCapable) {
    return <SpcChallenge acsTransId={acsTransId} />
  }

  // 3. SPC 非対応（Safari 等）→ ACS チャレンジ内 WebAuthn
  return <PasskeyChallenge acsTransId={acsTransId} />
}
```

### iframe 設定（加盟店側 SDK が出力）

```html
<!-- 3DS SDK が加盟店ページに挿入する iframe -->
<iframe
  src="https://acs.example.com/challenge/{acsTransId}"
  allow="publickey-credentials-get publickey-credentials-create payment"
  style="width:390px; height:400px; border:none;"
/>
```

---

## SPC フロー実装（Chrome/Edge）

```typescript
// SpcChallenge.tsx

async function triggerSPC(options: SpcOptions) {
  const request = new PaymentRequest(
    [{
      supportedMethods: 'secure-payment-confirmation',
      data: {
        credentialIds: [base64urlToBuffer(options.credentialId)],
        challenge: base64urlToBuffer(options.challenge),
        rpId: options.rpId,                  // ACS の RP ドメイン
        payeeOrigin: options.merchantOrigin,
        instrument: {
          displayName: options.merchantName,
          icon: options.merchantIconUrl,
        },
        timeout: 60000,
      }
    }],
    {
      total: {
        label: options.merchantName,
        amount: { currency: 'JPY', value: String(options.amount / 100) }
      }
    }
  )

  const response = await request.show()
  const assertion = response.details  // WebAuthn assertion

  await fetch('/spc/verify', {
    method: 'POST',
    body: JSON.stringify({ acsTransId: options.acsTransId, assertion })
  })

  await response.complete('success')
}
```

---

## テスト用カード番号マッピング

| カード番号 | 動作 |
|---|---|
| 4111111111111111 | 常に frictionless |
| 4111111111111129 | 常に OTP チャレンジ |
| 4111111111111137 | Passkey チャレンジ（登録済み前提） |
| 4111111111111145 | 高額扱い → チャレンジ |

---

## Admin Dashboard 表示項目

- **frictionless 率** （時系列グラフ）
- **認証タイプ内訳** （円グラフ: frictionless / OTP / Passkey / Passkey+SPC）
- **平均認証時間** （OTP vs Passkey の棒グラフ）
- **チャレンジ完了率** （離脱率の逆）
- **Passkey 登録率** （OTP 成功後に登録した割合）
- **最新トランザクション一覧** （テーブル）

---

## 実装優先順位

| Priority | 内容 |
|---|---|
| P0 | DB スキーマ・Prisma 設定 |
| P0 | POST /threeds/areq（RBA 判定 + ARes 返却） |
| P0 | OTP チャレンジ UI + 検証 |
| P1 | WebAuthn 登録フロー（enroll-on-challenge） |
| P1 | Passkey チャレンジ（ACS チャレンジ内 WebAuthn） |
| P1 | Test Merchant ページ |
| P2 | SPC フロー（Chrome/Edge） |
| P2 | Admin Dashboard |
| P3 | ブラウザ分岐の精緻化・エラーハンドリング |

---

## 環境変数

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/threeds_mvp
RP_ID=localhost                    # WebAuthn RP ID（本番: ACSのドメイン）
RP_NAME=3DS Passkey MVP
RP_ORIGIN=http://localhost:3000
ACS_URL=http://localhost:3001
MERCHANT_URL=http://localhost:3002
OTP_MOCK=true                      # true の場合 OTP は "123456" 固定
JWT_SECRET=change_me_in_production
```

---

## 起動手順（Claude Code 向け）

```bash
# 依存インストール
pnpm install

# DB 起動
docker-compose up -d

# マイグレーション
pnpm --filter server prisma migrate dev

# 全サービス起動
pnpm dev
# → server:   http://localhost:3001
# → merchant: http://localhost:3002
# → dashboard: http://localhost:3003
```
