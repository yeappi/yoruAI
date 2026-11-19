# yoruAI

夜職AIキャストとLINE風に会話するプロトタイプ。既存のUIは `index.html` にあり、チャット生成はVercel Functions経由で行う。

## 構成

- `index.html`: 友だち追加・出会い方・トーク画面。Supabase Auth、クラウド同期のクライアント処理
- `api/config.js`: 公開してよいSupabase URL / Publishable Keyをブラウザへ渡す
- `api/chat.js`: Supabase Authトークンを検証し、Gemini APIでキャスト返信を生成する
- Supabase `public.app_states`: 各ユーザーの現在の画面状態とトーク履歴をJSONBで保存（RLS有効）

## Vercelの環境変数（Production）

| 変数 | 内容 |
| --- | --- |
| `GEMINI_API_KEY` | **非公開**・サーバー側でのみ利用 |
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable Key |
| `GEMINI_MODEL` (任意) | 未設定なら `gemini-3.8-flash` |

## Supabase Auth

最初に既存セッションを読み、無ければ匿名サインインを試す。
匿名サインインが無効の場合はメールOTPのログイン画面を表示する。

匿名で即利用させるなら、Supabase Dashboard → Authentication → Providers → Anonymous Sign-Ins を有効にする。
メールのログインリンクを利用する場合は、SupabaseのRedirect URLに本番サイトを登録する。

匿名ユーザーはブラウザのセッションを失うと、そのアカウントのデータを引き継げない。
複数端末対応や一般公開前には永続的なログイン方法とアカウント連携を実装すること。

## セキュリティと運用

- Gemini APIキーをHTML/ブラウザへ配布しない。旧プロトタイプの保存キーは読み込み時に除去する。
- Supabaseの`app_states`には`auth.uid()=user_id`のRLSがある。
- 会話データはブラウザにもキャッシュし、初回ログイン時にクラウドへ保存する。
- APIは本人確認と入力長チェックを行う。Vercel関数のメモリ内制限は**本番向けの厳密なレート制限ではない**ので、一般公開前に分散型のAPI利用制限を追加する。
- 最初のMVPはJSONB状態保存。今後、メッセージ検索・分析・長期記憶を実装する際に正規化を検討する。
- Geminiの無料枠では、Googleによるデータ利用条件に注意し、実ユーザーの機微な会話を扱う前にプランを確認する。

## 動作確認

1. 認証が完了すること
2. キャストを追加し、Gemini返信が届くこと
3. リロードしても友だち・トーク履歴が維持されること
4. 別ユーザーのデータをRLSで読めないこと

UIのデザインは、Geminiの接続やDB実装とは独立して改善できる。
