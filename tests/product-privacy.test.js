import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { publicProductColumns } from '../src/catalog-fields.js';

test('product privacy migration preserves public catalog and staff access', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key, bucket_id text);
    grant usage on schema public, auth to anon, authenticated;
  `);
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  // gen_random_uuid is built in; this test does not need the optional pgcrypto extension.
  await db.exec(schema.replace('create extension if not exists pgcrypto;', ''));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('00000000-0000-4000-8000-000000000001', 'owner@example.test', '{"role":"admin"}'),
      ('00000000-0000-4000-8000-000000000002', 'inactive@example.test', '{}'),
      ('00000000-0000-4000-8000-000000000003', 'editor@example.test', '{"role":"content_manager"}');
    update public.profiles set is_active = false where email = 'inactive@example.test';
    insert into public.products (title, status, note) values
      ('Published product', 'active', 'private active note'),
      ('Draft product', 'draft', 'private draft note');
    grant all on public.products to anon, authenticated;
    grant select on public.products to public;
    grant select (note, created_by) on public.products to anon;
  `);
  const migration = await readFile(new URL('../supabase/migrations/20260905_product_column_privacy.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const assume = async (role, subject = '') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [subject]);
    await db.exec(`set role ${role}`);
  };

  await t.test('anonymous visitor reads the exact frontend allowlist, only published rows', async () => {
    await assume('anon');
    const { rows } = await db.query(`select ${publicProductColumns} from public.products order by sort`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Published product');
    assert.equal(Object.hasOwn(rows[0], 'note'), false);
  });

  await t.test('anonymous visitor cannot read or infer internal columns', async () => {
    await assume('anon');
    for (const sql of [
      'select * from public.products', 'select note from public.products',
      'select created_by from public.products', 'select to_jsonb(products) from public.products',
      "select title from public.products where note = 'private active note'"
    ]) await assert.rejects(db.query(sql), (error) => error.code === '42501', sql);
  });

  await t.test('anonymous visitor cannot create, edit or delete products', async () => {
    await assume('anon');
    await assert.rejects(db.query("insert into public.products(title) values ('Unauthorized')"), (error) => error.code === '42501');
    assert.equal((await db.query("update public.products set title = 'Unauthorized' returning id")).rows.length, 0);
    assert.equal((await db.query('delete from public.products returning id')).rows.length, 0);
  });

  await t.test('signed-in inactive or unprofiled accounts cannot read internal data', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000099']) {
      await assume('authenticated', id);
      assert.deepEqual((await db.query('select * from public.products')).rows, []);
    }
  });

  await t.test('owner and content manager retain notes, drafts and editing', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003']) {
      await assume('authenticated', id);
      assert.equal((await db.query('select * from public.products')).rows.length, 2);
      const result = await db.query("update public.products set note = 'staff edit' where status = 'draft' returning note");
      assert.equal(result.rows[0].note, 'staff edit');
    }
  });
});
