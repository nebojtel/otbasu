-- Replace email below with your first administrator email after creating the Auth user in Supabase Dashboard.
update public.profiles
set role = 'admin', is_active = true, updated_at = now()
where email = 'OWNER_EMAIL@example.com';

select id, email, full_name, role, is_active from public.profiles where email = 'OWNER_EMAIL@example.com';
