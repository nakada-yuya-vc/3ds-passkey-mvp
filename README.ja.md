# 3DS Passkey MVP

EMV 3-D Secure チャレンジ認証において、SMS OTP をパスキー（WebAuthn/FIDO2）に置き換えるプロトタイプ実装です。

---

## 概要

クレジットカード決済時に求められる本人確認（3DS チャレンジ）を、SMS ワンタイムパスワードの代わりに **デバイス生体認証（Face ID / Touch ID / 指紋認証）** で行えることを示します。

### 主な検証ポイント

| 指標 | 内容 |
|------|------|
| チャレンジ完了率の向上 | Passkey はキャンセルが少なく、OTP の入力ミスもない |
| 認証時間の短縮 | OTP 受信〜入力にかかる時間をゼロに近づける |
| Passkey 登録率 | OTP 成功後のその場登録（enroll-on-challenge）による普及施策 |

---

## 機能一覧

### 認証フロー

- **フリクションレス認証** — RBA エンジンがリスク低と判定した取引はチャレンジなしで完了
- **OTP チャレンジ** — SMS ワンタイムパスワードによる本人確認（モック：`123456` 固定）
- **Passkey チャレンジ** — 登録済みパスキーによる生体認証
- **enroll-on-challenge** — OTP 成功後にその場でパスキーを登録、次回からパスキー認証へ移行
- **SPC（Secure Payment Confirmation）** — Payment Request API と WebAuthn を統合した決済特化認証

### RBA（リスクベース認証）エンジン

以下のルールで自動的にフリクションレス／チャレンジを振り分けます。

| 条件 | 判定 |
|------|------|
| 30,000円以上の高額取引 | チャレンジ必須 |
| 未知のデバイス | チャレンジ必須 |
| 初回利用加盟店 | チャレンジ必須 |
| 既知のデバイス＋既知の加盟店 | フリクションレス |

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

| カテゴリ | 技術 |
|---------|------|
| バックエンド | Node.js, Fastify, TypeScript |
| ORM | Prisma |
| DB | PostgreSQL 16 |
| フロントエンド | React 18, Vite 5, TypeScript |
| WebAuthn | @simplewebauthn/server v10, @simplewebauthn/browser v10 |
| チャート | Recharts |
| パッケージ管理 | pnpm workspaces |
| コンテナ | Docker (PostgreSQL のみ) |

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

`packages/server/.env` を作成します。

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/threeds_mvp"
PORT=3001
RP_ID=localhost
RP_NAME=3DS Passkey MVP
RP_ORIGIN=http://localhost:3004
OTP_MOCK=true
```

> **`OTP_MOCK=true`** にすると OTP コードが常に `123456` になります（開発用）。

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

| サービス | URL |
|---------|-----|
| API サーバー | http://localhost:3001 |
| チャレンジ UI（ACS） | http://localhost:3004 |
| テスト加盟店 | http://localhost:3002 |
| 管理ダッシュボード | http://localhost:3003 |

---

## 使い方

### 決済テスト（テスト加盟店）

**http://localhost:3002** にアクセスします。

#### テスト用カード

| カード番号 | シナリオ |
|-----------|---------|
| `4111 1111 1111 1111` | フリクションレス（チャレンジなし） |
| `4111 1111 1111 1129` | OTP チャレンジ |
| `4111 1111 1111 1137` | Passkey チャレンジ（要事前登録） |
| `4111 1111 1111 1145` | 高額取引 → チャレンジ |

#### 基本的な操作手順

1. 商品を選んで「購入する」をクリック
2. テスト用カードを選択して「支払う」をクリック
3. カードによってチャレンジ画面が表示される

#### Passkey を登録するには

1. **OTP チャレンジカード** (`...1129`) で購入
2. OTP 入力画面で `123456` を入力して認証
3. 「パスキーを登録する」画面が表示されたら登録
4. 次回から **Passkey チャレンジカード** (`...1137`) で生体認証のみで完了

### 管理ダッシュボード

**http://localhost:3003** にアクセスして、認証メトリクスをリアルタイムに確認できます。

---

## API エンドポイント

### 3DS フロー

| メソッド | パス | 説明 |
|--------|------|------|
| POST | `/threeds/areq` | 認証リクエスト（AReq）。RBA 判定を実行しフリクションレスorチャレンジを決定 |
| POST | `/threeds/creq` | チャレンジリクエスト（CReq）。OTP コードを検証 |
| GET | `/threeds/transaction/:acsTransId` | トランザクション情報取得 |

### WebAuthn（Passkey）

| メソッド | パス | 説明 |
|--------|------|------|
| GET | `/webauthn/register/options` | Passkey 登録オプション取得 |
| POST | `/webauthn/register/verify` | Passkey 登録検証・保存 |
| GET | `/webauthn/authenticate/options` | Passkey 認証オプション取得 |
| POST | `/webauthn/authenticate/verify` | Passkey 認証検証 |

### 管理

| メソッド | パス | 説明 |
|--------|------|------|
| GET | `/admin/metrics` | KPI メトリクス取得（`?from=&to=`） |
| GET | `/admin/transactions` | トランザクション一覧（`?limit=&offset=`） |
| GET | `/admin/timeseries` | 時系列データ（`?from=&to=`） |

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
 │
 └──── DeviceFingerprint（デバイス学習）

OtpSession（OTP 一時セッション）
```

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

### ポート 3001 が使用中と言われる

```bash
# Windows の場合
netstat -ano | findstr :3001
taskkill /PID <PID番号> /F
```

---

## ライセンス

MIT
