-- The sign-up trigger (T08, FR-ACC-01): every new sign-in account gets a profile at once, with the
-- data dictionary's defaults (unverified, active, traveller, not over 18, no languages).
--
-- Only the id is copied. Names, photos and everything else come through onboarding, never from
-- the account's metadata, where a Google sign-in brings a name and a photo.
--
-- Supabase Auth inserts into auth.users as its own role, which can't write to public.profiles,
-- so the function is security definer and runs as its owner. A trigger needs no execute grant,
-- so no role gets one (DB-SCH-02). If the insert fails, the sign-up fails with it, so no account
-- is ever left without a profile.
create function private.create_profile() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger create_profile_after_sign_up
  after insert on auth.users
  for each row execute function private.create_profile();

-- Accounts made before this migration, such as staging's preview-checks account, get their
-- profile now, so every account has one from here on.
insert into public.profiles (id)
select u.id from auth.users as u
on conflict (id) do nothing;
