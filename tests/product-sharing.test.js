import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductShareData, createShareLinks } from '../src/product-sharing.js';

test('product shares use only the current product and catalog anchor', () => {
  const location = new URL('https://www.otbasu.shop/vitrine/?product=old&tracking=secret#old');
  const id = 'товар / 7?x=1&next=2';
  const data = createProductShareData({ id, title: 'Набор ножей 7 в 1' }, location);
  const url = new URL(data.url);
  assert.equal(url.origin, location.origin);
  assert.equal(url.pathname, '/vitrine/');
  assert.deepEqual([...url.searchParams], [['product', id]]);
  assert.equal(url.hash, '#catalog');
  assert.equal(data.title, 'Набор ножей 7 в 1');
  assert.equal(createProductShareData({ id }, location).title, 'Товар ОТБАСЫ');
});

test('messenger destinations retain the product URL and encoded title', () => {
  const data = { title: 'Набор & чай + кофе #7 "Дом"', url: 'https://www.otbasu.shop/vitrine/?product=a%26b#catalog' };
  const links = createShareLinks(data);
  const telegram = new URL(links.telegram);
  assert.equal(telegram.origin, 'https://t.me');
  assert.equal(telegram.pathname, '/share/url');
  assert.deepEqual([...telegram.searchParams], [['url', data.url], ['text', data.title]]);
  const whatsapp = new URL(links.whatsapp);
  assert.equal(whatsapp.origin, 'https://wa.me');
  assert.equal(whatsapp.pathname, '/');
  assert.deepEqual([...whatsapp.searchParams], [['text', data.title + '\n' + data.url]]);
});

test('email has no preset recipient and preserves Unicode and reserved characters', () => {
  const data = { title: 'Дом & уют + 50%', url: 'https://www.otbasu.shop/vitrine/?product=a#catalog' };
  const email = new URL(createShareLinks(data).email);
  assert.equal(email.protocol, 'mailto:');
  assert.equal(email.pathname, '');
  assert.deepEqual([...email.searchParams], [['subject', data.title], ['body', data.title + '\n' + data.url]]);
});

test('title text cannot add recipients or replace a messenger destination', () => {
  const data = { title: '<img src=x>&bcc=someone@example.test?next=https://example.test', url: 'https://www.otbasu.shop/vitrine/?product=7#catalog' };
  const links = createShareLinks(data);
  const email = new URL(links.email);
  assert.equal(email.searchParams.has('bcc'), false);
  assert.equal(email.searchParams.get('subject'), data.title);
  assert.equal(new URL(links.telegram).origin, 'https://t.me');
  assert.equal(new URL(links.whatsapp).origin, 'https://wa.me');
});

test('email subject does not contain header line breaks', () => {
  const data = { title: 'Товар\r\nBcc: someone@example.test', url: 'https://www.otbasu.shop/vitrine/?product=7#catalog' };
  const email = new URL(createShareLinks(data).email);
  assert.equal(email.searchParams.get('subject'), 'Товар Bcc: someone@example.test');
  assert.equal(email.searchParams.has('bcc'), false);
  assert.equal(email.searchParams.get('body'), data.title + '\n' + data.url);
});
