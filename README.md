# yoruAI

夜職AIキャストとLINE風に会話するプロトタイプ。既存のUIは `index.html` にあり、チャット生成はVercel Functions経由で行う。

## 会話エンジン v1（開発中）

**設定 → 会話ラボ** から、人格・関係性・気分・記憶・自発性の有効/無効を切り替えられる。
同じ会話条件でA/B比較し、返信の良し悪しとモデル・設定の履歴を記録可能。

実装の詳細と仮仕様、操作方法、制約は [ENGINE.md](./ENGINE.md) を参照。

既読・返信の時間制御、追いDMによる待機解除、連投の集約と障害時の振る舞いは [TIMING.md](./TIMING.md) を参照。テストは `node tests/timing.test.cjs` で実行。
エンジンの純粋関数テストは `node tests/engine.test.cjs` で実行できる。


## 構成

- `index.html`: 友だち追加・出会い方・トーク画面。Supabase Auth、クラウド同期のクライアント処理。固定返信モードは廃止し、初回挨拶もGeminiで生成
- `lib/engine.js`: 5要素のコンテキスト、モデル応答のJSON解釈、状態更新
- `lab-ui.js`: A/B比較・設定切替・返信評価・状態閲覧
- `api/config.js`: 公開してよいSupabase URL / Publishable Keyをブラウザへ渡す
- `api/chat.js`: Supabase Authトークンを検証し、Gemini APIでキャスト返信を生成する
- Supabase `public.app_states`: 各ユーザーの現在の画面状態とトーク履歴をJSONBで保存（RLS有効）

## Vercelの環境変数（Production）

| 変数 | 内容 |
| --- | --- |
| `GEMINI_API_KEY` | **非公開**・サーバー側でのみ利用 |
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable Key |
| `GEMINI_MODEL` (任意) | 未設定なら `gemini-3.5-flash-lite` |

既定モデルを実績のある `gemini-3.5-flash-lite` に変更。1モデルへの同一リクエスト内での再試行は廃止し、失敗時のみ `gemini-3.1-flash-lite` を1回試す。429が発生したモデルは同一サーバー実行環境で10分間対象外にする（分散インスタンス全体には共有されない）。固定セリフには戻さず、アプリ側では障害中の短い保留メッセージを表示する。

## Supabase Auth

最初に既存セッションを読み、無ければユーザー名だけの登録画面を表示する。
ユーザー名入力後にSupabaseの匿名サインインで専用UUIDを発行する。メールアドレス・パスワード入力は不要。
同じ名前でもUUIDで区別し、設定画面に固定の表示ID（YA-から始まる文字列）を表示する。
Supabaseの匿名サインインが無効な場合は設定手順を表示し、メール認証に切り替えない。

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

## 開発者画面（/admin）
- AIの追加・編集・削除・アイコン、試し話、全ユーザーの会話履歴の閲覧、AIから指定時刻に送る連絡を扱う。
- 合言葉は Vercel の環境変数 `ADMIN_PASSWORD`。サーバー（`api/admin.js`）で検証し、ブラウザには sessionStorage にだけ置く（タブを閉じると消える）。失敗が続くと10分ブロック。
- 他に必要な環境変数: `SUPABASE_SERVICE_ROLE_KEY`（全ユーザーの読み取りとキャスト書き込み用。ブラウザには出さない）。
- `supabase/admin.sql` を Supabase の SQL Editor で1回実行する（`casts` と `admin_pushes`）。
- キャストの定義は 組み込み（`casts.js` + `lib/engine.js` の PERSONAS）に DB の `casts` を重ねる。組み込みを編集すると上書き、削除は非表示（「元に戻す」で復活）。
- 連絡は `admin_pushes` に予約され、ユーザーがアプリを開いている間は60秒ごと／開いた時に受信して、時刻を過ぎていれば届く。
