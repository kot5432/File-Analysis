# コード分析ツール

AIコーディングツールのブラックボックス化を解消するファイル分析システム

## 機能

- ファイルアップロード（ドラッグ&ドロップ対応）
- 単一ファイル分析
- ZIPファイル一括分析
- 使用言語の自動検出
- フレームワーク・ライブラリの特定
- コード構造の分析
- プロジェクト全体のサマリー表示

## 技術スタック

- **フロントエンド**: React + TypeScript
- **バックエンド**: Node.js + Express
- **ファイル処理**: Multer, yauzl

## インストール

```bash
# ルートディレクトリで
npm install

# サーバー依存関係
cd server && npm install

# クライアント依存関係
cd client && npm install
```

## 起動方法

### 開発モード

```bash
# ルートディレクトリで両方のサーバーを起動
npm run dev

# または個別に起動
npm run server  # バックエンド (ポート 5000)
npm run client  # フロントエンド (ポート 3000)
```

### 本番ビルド

```bash
npm run build
```

## 使用方法

1. ブラウザで `http://localhost:3000` にアクセス
2. ファイルをドラッグ&ドロップまたはクリックして選択
3. 「分析開始」ボタンをクリック
4. 分析結果を確認

## 分析対象ファイル

対応しているファイル形式：
- プログラミング言語: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.java`, `.cpp`, `.c`, `.cs`, `.php`, `.rb`, `.go`, `.rs`, `.swift`, `.kt`
- マークアップ/スタイル: `.html`, `.css`, `.scss`, `.sass`, `.less`
- 設定ファイル: `.json`, `.xml`, `.yaml`, `.yml`
- その他: `.md`, `.sql`, `.sh`, `.vue`, `.svelte`
- アーカイブ: `.zip`

## 検出可能な技術

- **フレームワーク**: React, Vue, Angular, Express, Django, Flask, Spring, Laravel, Rails
- **ライブラリ**: Bootstrap, Tailwind, Material-UI, jQuery, Redux, GraphQL
- **ツール**: Docker, Kubernetes, Webpack, Vite, Babel, ESLint, Jest
- **データベース**: MongoDB, PostgreSQL, MySQL, Redis, Elasticsearch

## プロジェクト構成

```
week1/
├── client/          # Reactフロントエンド
├── server/          # Expressバックエンド
├── package.json     # ルート設定
└── README.md       # このファイル
```

## ライセンス

MIT
