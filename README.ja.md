# 3DS Passkey MVP

EMV 3-D Secure チャレンジ認証において、SMS OTP をパスキー（WebAuthn/FIDO2）に置き換えるプロトタイプ実装です。

---

![デモ](./demo.gif)

## 概要

クレジットカード決済時に求められる本人確認（3DS チャレンジ）を、SMS ワンタイムパスワードの代わりに **デバイス生体認証（Face ID / Touch ID / 指紋認証）** で行えることを示します。

### 主な検証ポイント

| 指標                   | 内容                                                        |
| ---------------------- | ----------------------------------------------------------- |
| チャレンジ完了率の向上 | Passkey はキャンセルが少なく、OTP の入力ミスもない          |
| 認証時間の短縮         | OTP 受信〜入力にかかる時間をゼロに近づける                  |
| Passkey 登録率         | OTP 成功後のその場登録（enroll-on-challenge）による普及施策 |

---

## 機能一覧

### 認証フロー

- **フリクションレス認証** — チャレンジなしで承認
- **OTP チャレンジ** — SMS ワンタイムパスワードによる本人確認（モック：`123456` 固定）
- **Passkey チャレンジ** — 登録済みパスキーによる生体認証
- **enroll-on-challenge** — OTP 成功後にその場でパスキーを登録、次回からパスキー認証へ移行
- **SPC（Secure Payment Confirmation）** — Payment Request API と WebAuthn を統合した決済特化認証。`payment: { isPayment: true }` 拡張で登録し、`payment.get` assertion とブラウザが表示した取引情報をサーバー側で検証します。Browser Bound Key（BBK）は要件・展開モデルが W3C で継続議論中のため、本 MVP では意図的にスコープ外としています。

### 認証フローの切り替え

この MVP では加盟店側（テスト用ストアフロント）が **商品ごとに認証フローを指定** する方式を採っています。実装は [`packages/merchant/src/Checkout.tsx`](packages/merchant/src/Checkout.tsx) を参照してください。

| 商品                 | 価格    | 指定フロー   |
| -------------------- | ------- | ------------ |
| Wireless Earbuds Pro | ¥12,800 | frictionless |
| Smartwatch Elite     | ¥34,800 | otp          |
| Mechanical Keyboard  | ¥18,500 | webauthn     |
| Gaming Headset       | ¥24,800 | spc          |

> 実 RBA エンジン（金額・デバイス履歴に基づく自動振り分け）は将来拡張ポイントとして `packages/server/src/services/rba.ts` にスケルトンを置いていますが、現状は加盟店指定のフローを尊重します。

### 管理ダッシュボード

リアルタイムに以下のメトリクスを可視化します（10 秒ごと自動更新）。

- **KPI カード** — 総取引数・フリクションレス率・チャレンジ完了率・Passkey 利用率・Passkey 登録率
- **認証方式内訳** — 円グラフ（FRICTIONLESS / OTP / PASSKEY / PASSKEY_SPC）
- **平均認証時間比較** — 棒グラフ（OTP vs Passkey、単位：ミリ秒）
- **時系列フリクションレス率** — 折れ線グラフ（直近 7 日、1 時間粒度）
- **最新トランザクション一覧** — 取引ごとの認証方式・結果・所要時間

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ（ユーザー）                                │
│                                                     │
│  ┌──────────────┐   ┌──────────────────────────┐   │
│  │  Merchant    │   │  Challenge UI (ACS)      │   │
│  │  :3002       │──▶│  :3004  (iframe)         │   │
│  └──────────────┘   └──────────────────────────┘   │
└──────────────────────────┬──────────────────────────┘
                           │ HTTP / WebAuthn
                           ▼
              ┌────────────────────────┐
              │  API Server  :3001     │
              │  (Fastify + Prisma)    │
              │                       │
              │  /threeds  3DS フロー  │
              │  /webauthn パスキー    │
              │  /spc      SPC        │
              │  /admin    メトリクス  │
              └──────────┬────────────┘
                         │
              ┌──────────▼────────────┐
              │  PostgreSQL  :5432    │
              └───────────────────────┘

  ┌──────────────────────┐
  │  Dashboard  :3003    │
  │  (管理者向け)        │
  └──────────────────────┘
```

### パッケージ構成

```
passkey-mvp/
├── packages/
│   ├── server/          # Fastify API サーバー（Node.js + TypeScript）
│   ├── challenge-ui/    # ACS チャレンジ画面（React + Vite）
│   ├── merchant/        # テスト用加盟店画面（React + Vite）
│   └── dashboard/       # 管理ダッシュボード（React + Vite + Recharts）
├── docker-compose.yml   # PostgreSQL
└── pnpm-workspace.yaml
```

---

## 技術スタック

| カテゴリ       | 技術                                                    |
| -------------- | ------------------------------------------------------- |
| バックエンド   | Node.js, Fastify, TypeScript                            |
| ORM            | Prisma                                                  |
| DB             | PostgreSQL 16                                           |
| フロントエンド | React 18, Vite 5, TypeScript                            |
| WebAuthn       | @simplewebauthn/server v10, @simplewebauthn/browser v10 |
| チャート       | Recharts                                                |
| パッケージ管理 | pnpm workspaces                                         |
| コンテナ       | Docker (PostgreSQL のみ)                                |

---

## セットアップ

### 前提条件

- Node.js 18 以上
- pnpm 8 以上（`npm install -g pnpm`）
- Docker Desktop

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd passkey-mvp
```

### 2. 依存パッケージのインストール

```bash
pnpm install
```

### 3. 環境変数の設定

リポジトリ直下の `.env` を作成します（既に存在する場合は確認のみ）。

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
```

> **`OTP_MOCK=true`** にすると OTP コードが常に `123456` になります（開発用）。
> **`MERCHANT_URL`** は SPC の `payeeOrigin` 生成に使われます（`http://` を `https://` に変換した値が credential の clientData に署名されます）。

### 4. データベースの起動とスキーマ適用

```bash
# PostgreSQL コンテナを起動
pnpm db:up

# スキーマをDBに反映
pnpm db:push
```

### 5. 開発サーバーの起動

```bash
pnpm dev
```

4 つのサーバーが同時に起動します。

| サービス             | URL                   |
| -------------------- | --------------------- |
| API サーバー         | http://localhost:3001 |
| チャレンジ UI（ACS） | http://localhost:3004 |
| テスト加盟店         | http://localhost:3002 |
| 管理ダッシュボード   | http://localhost:3003 |

---

## 使い方

### 決済テスト（テスト加盟店）

**http://localhost:3002** にアクセスします。

テスト用カード番号は固定で `4111 1111 1111 1111` です。**認証フローは商品ごとに紐付いて** いるので、試したいフローの商品を選んでください。

| 商品                 | フロー       | 期待される挙動                                              |
| -------------------- | ------------ | ----------------------------------------------------------- |
| Wireless Earbuds Pro | Frictionless | チャレンジなしで即承認                                      |
| Smartwatch Elite     | OTP          | OTP `123456` 入力 → Passkey 登録誘導（enroll-on-challenge） |
| Mechanical Keyboard  | WebAuthn     | 既存 passkey で生体認証（無ければ OTP に切り替え）          |
| Gaming Headset       | SPC          | Secure Payment Confirmation 専用ダイアログ。利用不可時は OTP fallback |

#### 基本的な操作手順

1. 商品を選んで **「Buy Now」**
2. **「Pay」** をクリック
3. 商品に対応するチャレンジ画面（または承認画面）が表示される

#### Passkey 登録の最初の一回

1. **Smartwatch Elite (OTP)** で購入
2. OTP 入力画面で `123456` を入力
3. 「Register Passkey」画面で Windows Hello / Touch ID を使って登録
4. 以降は **Mechanical Keyboard (WebAuthn)** では生体認証、**Gaming Headset (SPC)** では SPC ダイアログを使います。SPC が利用できない場合は OTP に fallback します。

### 管理ダッシュボード

**http://localhost:3003** にアクセスして、認証メトリクスをリアルタイムに確認できます。

---

## API エンドポイント

### 3DS フロー

| メソッド | パス                               | 説明                                                                       |
| -------- | ---------------------------------- | -------------------------------------------------------------------------- |
| POST     | `/threeds/areq`                    | 認証リクエスト（AReq）。RBA 判定を実行しフリクションレスorチャレンジを決定 |
| POST     | `/threeds/creq`                    | チャレンジリクエスト（CReq）。OTP コードを検証                             |
| POST     | `/threeds/fallback/otp`            | SPC 利用不可時に OTP を発行し、トランザクションを OTP として記録            |
| GET      | `/threeds/transaction/:acsTransId` | トランザクション情報取得                                                   |

### WebAuthn（Passkey）

| メソッド | パス                             | 説明                                                                      |
| -------- | -------------------------------- | ------------------------------------------------------------------------- |
| GET      | `/webauthn/register/options`     | Passkey 登録オプション取得（`extensions.payment.isPayment: true` を含む） |
| POST     | `/webauthn/register/verify`      | Passkey 登録検証・保存（AAGUID もログに記録）                             |
| GET      | `/webauthn/authenticate/options` | Passkey 認証オプション取得                                                |
| POST     | `/webauthn/authenticate/verify`  | Passkey 認証検証                                                          |

### SPC（Secure Payment Confirmation）

| メソッド | パス           | 説明                                                                                           |
| -------- | -------------- | ---------------------------------------------------------------------------------------------- |
| GET      | `/spc/options` | SPC ceremony 用 challenge / rpId / payeeOrigin / 登録済み credential 一覧を返す                |
| POST     | `/spc/verify`  | SPC assertion 検証（`expectedType: 'payment.get'` を指定して `@simplewebauthn/server` で検証） |

### 管理

| メソッド | パス                  | 説明                                      |
| -------- | --------------------- | ----------------------------------------- |
| GET      | `/admin/metrics`      | KPI メトリクス取得（`?from=&to=`）        |
| GET      | `/admin/transactions` | トランザクション一覧（`?limit=&offset=`） |
| GET      | `/admin/timeseries`   | 時系列データ（`?from=&to=`）              |

---

## データベーススキーマ

```
User ──── WebAuthnCredential（Passkey 公開鍵）
 │
 └──── Transaction（3DS 取引履歴）
 │       - authType: FRICTIONLESS / OTP / PASSKEY / PASSKEY_SPC
 │       - authResult: AUTHENTICATED / NOT_AUTHENTICATED / ATTEMPTED
 │       - challengeStartedAt / otpCompletedAt / authenticatedAt（時刻計測）
 │       - enrolledPasskey（登録率計算用フラグ）
 │       └──── ChallengeSession（WebAuthn / SPC challenge 一時セッション）
 │
 └──── DeviceFingerprint（デバイス学習）

OtpSession（OTP 一時セッション）
```

---

## ブラウザ・OS の挙動

### SPC credential と BBK のスコープ

本 MVP は `payment: { isPayment: true }` 拡張で passkey を登録し、SPC assertion を `expectedType: 'payment.get'` として検証します。また、署名された `clientDataJSON.payment` の内容が発行済みトランザクション（`rpId`、`payeeOrigin`、金額、通貨）と一致することを確認します。

Browser Bound Key（BBK）は本 MVP では実装していません。BBK を device possession の証跡としてどう扱うか、どのように feature detection するか、どこまで必須にするかは W3C で継続議論中です。そのため、このリポジトリは完全な PSD2 SCA / EMVCo 準拠実装ではなく、SPC と 3DS チャレンジ UX の統合検証用 MVP として位置付けています。

DB に保存する AAGUID は、登録時に観測された認証器（Windows Hello / Touch ID / 匿名 platform authenticator など）の参考情報です。レビュー用に記録しますが、現時点では AAGUID や attestation による allowlist enforcement は行っていません。

### ブラウザ・OS 別 SPC 対応状況

| ブラウザ / OS            | SPC 対応 | 備考                                                                      |
| ------------------------ | -------- | ------------------------------------------------------------------------- |
| Chrome / Edge on Windows | ✅       | Windows Hello（生体 or PIN）などの platform authenticator を利用           |
| Chrome / Edge on macOS   | ✅       | Touch ID / Apple Watch などの platform authenticator を利用                |
| Chrome on Android        | ✅       | Android platform authenticator を利用                                      |
| Safari                   | ❌       | WebAuthn 単体は対応するが、Payment Request × WebAuthn 統合（SPC）は未実装 |

### Windows Hello は生体認証ではなく PIN を求める場合がある

Windows では、デバイスの設定によっては指紋や顔認証ではなく **Windows Hello の PIN** を求められます。これは通常の platform authenticator の挙動です。PIN はデバイス内にのみ存在し、OTP のようにネットワーク送信されません。

### 非 Secure Context（HTTPS でも localhost でもない URL）では WebAuthn / SPC が動かない

スマートフォンから Wi-Fi 経由で `http://192.168.x.x:3004` のように IP で開発サーバーにアクセスすると、ブラウザが `PublicKeyCredential` と `PaymentRequest` を露出しません。この場合、SPC フローは `/threeds/fallback/otp` を呼び出して OTP チャレンジへ切り替えます。SPC 自体の動作確認をしたい場合は以下のいずれかで HTTPS を用意してください。

- `ngrok http 3002` / `ngrok http 3004` のようなトンネル
- `vite-plugin-mkcert` 等で Vite dev server を HTTPS 化

fallback は UI 上で明示され、トランザクションの `authType` も `OTP` に更新されます。これにより、SPC 失敗がメトリクス上で隠れないようにしています。

### 推奨テスト環境

| 条件                        | 推奨設定                                              |
| --------------------------- | ----------------------------------------------------- |
| SPC の動作確認              | Chrome / Edge on Windows or macOS、localhost アクセス |
| PIN なし生体認証            | Windows Hello に指紋または顔認証が設定済みのデバイス  |
| 同一デバイス内で登録 → 利用 | 登録と認証を同じブラウザ（同じプロファイル）で行う    |

---

## よくある問題

### パスキー登録時に「The 'publickey-credentials-create' feature is not enabled」と表示される

iframe 内での WebAuthn は Permissions Policy の明示的な許可が必要です。  
`packages/merchant/src/Checkout.tsx` の iframe に以下の属性が付いていることを確認してください。

```html
allow="publickey-credentials-get *; publickey-credentials-create *; payment *"
```

### OTP が通らない

`OTP_MOCK=true` が設定されている場合、正解は常に `123456` です。  
`.env` ファイルを確認してください。

### SPC ダイアログは出るが `NotAllowedError` で失敗する

以下を順に確認してください。

- 登録時に `payment: { isPayment: true }` 拡張が options に入っているか（`packages/server/src/routes/webauthn.ts`）。古いキー `isPaymentCredential` だと Chrome に無視され、credential が SPC マーカーなしで作られて `show()` 時に拒否されます。
- サーバーログ `'[register] credential created'` の AAGUID で、登録時に観測された platform authenticator / passkey provider を確認。
- 当該の credential を一度作り直す必要があるかもしれません（`pnpm db:reset` で全クリア）。

### SPC verify が `Unexpected authentication response type: payment.get` で 401

`@simplewebauthn/server` は default で `webauthn.get` のみを受け付けます。SPC は `payment.get` なので、`/spc/verify` 側で `expectedType: 'payment.get'` を渡してください（実装済み）。

### ポート 3001 が使用中と言われる

```bash
# Windows の場合
netstat -ano | findstr :3001
taskkill /PID <PID番号> /F
```

---

## 既知の制限

詳細は [BACKLOG.md](./BACKLOG.md) を参照してください。BBK positioning、
attestation policy、line items、conformance test など、MVP で意図的に
スコープ外にした項目と対応する W3C SPC issue を整理しています。

外部レビュー向けには、MVP のセキュリティ上の主張と非主張をまとめた
[SECURITY.md](./SECURITY.md)、SPC 仕様との対応状況をまとめた
[CONFORMANCE.md](./CONFORMANCE.md) も参照してください。

---

## ライセンス

MIT
