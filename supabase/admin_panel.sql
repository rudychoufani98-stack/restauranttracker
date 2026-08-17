-- =====================================================================
--  ADMIN PANEL — super-admin (toi) pouvant gérer tous les restaurants.
--  À exécuter dans Supabase → SQL Editor. Idempotent.
-- =====================================================================

-- 1) Table des super-admins (gérée uniquement ici, jamais via l'app)
create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table app_admins enable row level security;
-- Chacun peut uniquement VÉRIFIER son propre statut (aucune écriture via l'API)
drop policy if exists rls_app_admins on app_admins;
create policy rls_app_admins on app_admins
  for select using (user_id = auth.uid());

-- 2) Helper : l'utilisateur courant est-il super-admin ?
create or replace function public.is_app_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- 3) owns_restaurant : propriétaire OU super-admin
create or replace function public.owns_restaurant(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from restaurants
    where id = rid and owner_id = auth.uid()
  )
  or exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- 4) La table restaurants elle-même : visible/gérable par le proprio OU l'admin
drop policy if exists rls_restaurants on restaurants;
create policy rls_restaurants on restaurants
  for all
  using (owner_id = auth.uid() or public.is_app_admin())
  with check (owner_id = auth.uid() or public.is_app_admin());

-- 5) TOI = super-admin (le propriétaire du restaurant Amaly)
insert into app_admins (user_id)
select owner_id from restaurants where name ilike '%amaly%'
on conflict do nothing;

-- 6) VÉRIFICATION — doit retourner 1 ligne (ton user_id)
select 'admin enregistré' as info, user_id from app_admins;
