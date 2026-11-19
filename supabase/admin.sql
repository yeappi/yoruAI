-- 開発者画面用のテーブル。Supabase の SQL Editor に貼って1回実行する（何度実行しても安全）。
-- 書き込みは /api/admin（service role）だけが行う。ブラウザのユーザーは読み取り（と自分宛ての既読化）だけ。

-- 開発者画面で追加・編集・削除したAIキャスト。
-- 組み込みキャスト（kokoa など）を編集するとここに上書きが入り、deleted=true で非表示になる。
create table if not exists public.casts (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.casts enable row level security;
drop policy if exists casts_read on public.casts;
create policy casts_read on public.casts for select to authenticated using (true);

-- AIからユーザーへ、指定した時刻に届く連絡。
create table if not exists public.admin_pushes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  char_id      text not null,
  text         text not null,
  deliver_at   timestamptz not null default now(),
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists admin_pushes_user_pending on public.admin_pushes (user_id) where delivered_at is null;
alter table public.admin_pushes enable row level security;
drop policy if exists pushes_read_own on public.admin_pushes;
create policy pushes_read_own on public.admin_pushes for select to authenticated using (auth.uid() = user_id);
drop policy if exists pushes_mark_own on public.admin_pushes;
create policy pushes_mark_own on public.admin_pushes for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
