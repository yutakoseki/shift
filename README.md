# 保育園シフト管理 MVP

園長先生向けの最小構成シフト管理アプリです。  
Next.js + Tailwind + Amplify(Cognito) + DynamoDB + Terraform + Vercel で構成しています。

## 1. セットアップ

```bash
npm install
cp .env.example .env.local
```

`.env.local` は Terraform 適用後の値に置き換えてください。
デバッグログを有効にする場合は `DEBUG_LOG_ENABLED=true` を設定してください。

## 2. ローカル起動

```bash
npm run dev
```

- `http://localhost:3000/login` でログイン
- ログイン後に `http://localhost:3000/` でシフト表を編集
- ログイン後はサイドバーから `シフト作成 / データ管理 / ユーザー管理` に遷移

## 3. Terraform（AWS + Vercel）

事前に以下を用意してください。

- AWS認証情報（`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`）
- Vercel APIトークン（`VERCEL_API_TOKEN`）

```bash
cd infra
terraform init
terraform plan
terraform apply
```

### 重要

- Terraformで `vercel_project_environment_variable` を使って環境変数をVercelへ投入します。
- Cognitoの初期ユーザー（園長先生アカウント）は Terraform 外で作成が必要です。  
  例: AWS Console でユーザー作成して初期パスワード発行。

## 4. Vercelデプロイ

```bash
npm i -g vercel
vercel link
vercel --prod
```

`vercel link` 時に、Terraformで作成した `vercel_project` を選択してください。

## MVP仕様

- 認証: Amplify(Cognito)ログイン必須
- シフトUI: 縦軸=日付、横軸=早番/中番/遅番
- 保存: 月単位で DynamoDB に上書き保存
- ユーザー管理: Cognito作成時にDynamoDBへユーザープロファイル保存
- ロール: 新規登録は「メンバー」、ロール変更は「管理者」のみ実行可能

# shift
