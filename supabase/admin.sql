-- yoruAI 開発者画面用のDB定義。何度実行しても安全。
-- 方針: サービスキーをサーバーに置かず、合言葉の検証をDB関数（admin_call）の中で行う。
--   ・ブラウザのユーザーは casts を読めるだけ（書けない）、自分宛ての連絡を既読にできるだけ。
--   ・全ユーザーの会話の読み取りや、キャスト・連絡の書き込みは、合言葉が合う admin_call 経由だけ。
--   ・合言葉は bcrypt のハッシュで admin_secret に保存（平文は保存しない）。失敗が続くと一時ロック。
-- 合言葉の設定（別途・この履歴には残さない）:
--   insert into admin_secret(id,hash) values (1, extensions.crypt('合言葉', extensions.gen_salt('bf')))
--   on conflict (id) do update set hash=excluded.hash, fails=0;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.casts (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.casts enable row level security;
drop policy if exists casts_read on public.casts;
create policy casts_read on public.casts for select to authenticated using (true);
grant select on public.casts to authenticated;  -- このプロジェクトは新しいテーブルに自動で権限が付かないため明示する

create table if not exists public.admin_pushes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  char_id text not null,
  text text not null,
  deliver_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_pushes_user_pending on public.admin_pushes (user_id) where delivered_at is null;
alter table public.admin_pushes enable row level security;
drop policy if exists pushes_read_own on public.admin_pushes;
create policy pushes_read_own on public.admin_pushes for select to authenticated using (auth.uid() = user_id);
drop policy if exists pushes_mark_own on public.admin_pushes;
create policy pushes_mark_own on public.admin_pushes for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- ユーザーが更新してよいのは既読時刻だけ（本文や宛先は書き換えられない）
grant select on public.admin_pushes to authenticated;
revoke update on public.admin_pushes from anon, authenticated;
grant update (delivered_at) on public.admin_pushes to authenticated;

create table if not exists public.admin_secret (
  id int primary key default 1 check (id = 1),
  hash text not null,
  fails int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.admin_secret enable row level security;
revoke all on public.admin_secret from anon, authenticated;

create or replace function public.admin_call(pw text, action text, args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.admin_secret%rowtype;
  out jsonb;
begin
  select * into s from public.admin_secret where id = 1 for update;
  if not found then return jsonb_build_object('error','NOT_CONFIGURED'); end if;
  if s.window_start < now() - interval '10 minutes' then
    update public.admin_secret set fails = 0, window_start = now() where id = 1;
    s.fails := 0;
  end if;
  if s.fails >= 30 then return jsonb_build_object('error','LOCKED'); end if;
  if pw is null or crypt(pw, s.hash) <> s.hash then
    update public.admin_secret set fails = fails + 1 where id = 1;
    return jsonb_build_object('error','AUTH');
  end if;
  if s.fails > 0 then update public.admin_secret set fails = 0 where id = 1; end if;

  case action
  when 'status' then
    out := jsonb_build_object('ok', true);
  when 'casts.list' then
    out := coalesce((select jsonb_agg(jsonb_build_object('id',id,'data',data,'deleted',deleted)) from public.casts), '[]'::jsonb);
  when 'casts.save' then
    insert into public.casts(id,data,deleted,updated_at) values (args->>'id', coalesce(args->'data','{}'::jsonb), false, now())
    on conflict (id) do update set data = excluded.data, deleted = false, updated_at = now();
    out := jsonb_build_object('ok', true);
  when 'casts.delete' then
    insert into public.casts(id,data,deleted,updated_at) values (args->>'id', '{}'::jsonb, true, now())
    on conflict (id) do update set data = '{}'::jsonb, deleted = true, updated_at = now();
    out := jsonb_build_object('ok', true);
  when 'casts.reset' then
    delete from public.casts where id = args->>'id';
    out := jsonb_build_object('ok', true);
  when 'users.list' then
    out := coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('user_id',user_id,'updated_at',updated_at,'state',state) x
      from public.app_states order by updated_at desc limit 200) t), '[]'::jsonb);
  when 'user.get' then
    out := coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'updated_at',updated_at,'state',state))
      from public.app_states where user_id = (args->>'id')::uuid), '[]'::jsonb);
  when 'push.create' then
    insert into public.admin_pushes(user_id,char_id,text,deliver_at)
    values ((args->>'user_id')::uuid, args->>'char_id', args->>'text', coalesce((args->>'deliver_at')::timestamptz, now()));
    out := jsonb_build_object('ok', true);
  when 'push.list' then
    out := coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id',id,'user_id',user_id,'char_id',char_id,'text',text,'deliver_at',deliver_at,'delivered_at',delivered_at) x
      from public.admin_pushes
      where args->>'user_id' is null or user_id = (args->>'user_id')::uuid
      order by deliver_at desc limit 50) t), '[]'::jsonb);
  when 'push.cancel' then
    delete from public.admin_pushes where id = (args->>'id')::uuid and delivered_at is null;
    out := jsonb_build_object('ok', true);
  else
    out := jsonb_build_object('error','UNKNOWN_ACTION');
  end case;
  return out;
end;
$$;
revoke all on function public.admin_call(text,text,jsonb) from public;
grant execute on function public.admin_call(text,text,jsonb) to anon, authenticated;
