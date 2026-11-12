-- v0.6: run ONLY in a user-authorized NEW Supabase project, never against existing tables.
-- No credentials or personal data. Setup intentionally fails if these names already exist.
begin;
create table public.sbl_allowed_users (user_id uuid primary key references auth.users(id));
alter table public.sbl_allowed_users enable row level security;
revoke all on public.sbl_allowed_users from public, anon, authenticated;
create table public.sbl_records (
  owner_id uuid not null references auth.users(id),
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  revision bigint not null check(revision > 0),
  deleted boolean not null,
  record jsonb,
  server_updated_at timestamptz not null default now(),
  primary key(owner_id,id),
  check ((deleted and record is null) or (not deleted and record is not null and jsonb_typeof(record)='object' and record->>'id'=id)),
  check (record is null or octet_length(record::text) <= 100000)
);
alter table public.sbl_records enable row level security;
revoke all on public.sbl_records from public, anon, authenticated;
-- All browser operations go through functions; direct REST table writes are forbidden.
create function public.sbl_assert_owner() returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or coalesce(auth.jwt()->>'client_id','') <> '' or not exists(select 1 from public.sbl_allowed_users where user_id=u) then
    raise sqlstate '42501' using message='Not authorized';
  end if;
  return u;
end $$;
create function public.sbl_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.sbl_assert_owner(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'deleted',deleted,'record',record,'server_updated_at',server_updated_at) order by id),'[]'::jsonb)
  into result from public.sbl_records where owner_id=u;
  return result;
end $$;
create function public.sbl_cas(p_id text,p_expected bigint,p_record jsonb,p_deleted boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.sbl_assert_owner(); r public.sbl_records; result jsonb;
begin
  if p_id is null or p_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_expected is null or p_expected<0 or p_deleted is null
    or (p_deleted and p_record is not null) or (not p_deleted and (p_record is null or jsonb_typeof(p_record)<>'object' or p_record->>'id' is distinct from p_id)) then
    raise sqlstate '22023' using message='Invalid record envelope';
  end if;
  -- Serialize an ID including first creation, avoiding insert races.
  perform pg_advisory_xact_lock(hashtextextended(u::text || ':' || p_id,0));
  select * into r from public.sbl_records where owner_id=u and id=p_id for update;
  if found then
    if r.deleted=p_deleted and r.record is not distinct from p_record then
      null; -- lost response / duplicate request: same revision, idempotent
    elsif r.revision<>p_expected then
      raise sqlstate 'PT409' using message='Revision conflict';
    else
      update public.sbl_records set revision=revision+1,record=p_record,deleted=p_deleted,server_updated_at=now()
      where owner_id=u and id=p_id returning * into r;
    end if;
  else
    if p_expected<>0 or p_deleted then raise sqlstate 'PT409' using message='Missing revision'; end if;
    if (select count(*) from public.sbl_records where owner_id=u)>=20000 then raise sqlstate '54000' using message='Record limit'; end if;
    insert into public.sbl_records(owner_id,id,revision,deleted,record) values(u,p_id,1,false,p_record) returning * into r;
  end if;
  result=jsonb_build_object('id',r.id,'revision',r.revision,'deleted',r.deleted,'record',r.record,'server_updated_at',r.server_updated_at);
  return result;
end $$;
revoke all on function public.sbl_assert_owner(), public.sbl_list(), public.sbl_cas(text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sbl_list(), public.sbl_cas(text,bigint,jsonb,boolean) to authenticated;
commit;
-- After creating your own Auth user: manually allow ONLY its UUID in sbl_allowed_users.
-- To revoke database access immediately: remove its allowlist entry via the dashboard.
-- Do not grant AI OAuth clients these functions. AI needs a separate read-only gateway.
