import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearch, matchesProductSearch } from '../src/catalog-search.js';

const product = { title: 'Набор ножей 7 в 1', category: 'Дом', note: 'секретный поставщик' };
const copy = { highlight: 'Ножи, ножницы и подставка', tagLabel: 'Хит' };

test('search includes visible copy, category, badge and all query terms', () => {
  for (const query of ['ножницы', 'подставка ножницы', 'ДОМ ХИТ', '7 в 1', '']) {
    assert.equal(matchesProductSearch(product, query, copy), true, query);
  }
  assert.equal(matchesProductSearch(product, 'ножницы блендер', copy), false);
});

test('normalizes Unicode, punctuation, case, spaces and yo', () => {
  assert.equal(normalizeSearch('  СЪЁМКА — Ａ  '), 'съемка a');
  assert.equal(matchesProductSearch({ title: 'Съёмка', category: '' }, 'съемка'), true);
});

test('permits one edit for longer words without fuzzy matching short queries', () => {
  for (const query of ['блендерр', 'блндер', 'блендар', 'blender']) {
    assert.equal(matchesProductSearch({ title: 'Блендер смузи' }, query), true, query);
  }
  assert.equal(matchesProductSearch({ title: 'Блендер смузи' }, 'бландир'), false);
  assert.equal(matchesProductSearch(product, 'том', copy), false);
});

test('never searches internal notes or unrelated product fields', () => {
  assert.equal(matchesProductSearch(product, 'поставщик', copy), false);
  assert.equal(matchesProductSearch({ ...product, kaspiUrl: 'https://example.test/secret' }, 'secret'), false);
});

test('uses bounded category synonyms and tolerates missing product text', () => {
  assert.equal(matchesProductSearch({ title: 'Пароварка 3 яруса' }, 'мантоварка'), true);
  assert.equal(matchesProductSearch({ title: 'Беспроводной воздуходув' }, 'воздуходувка'), true);
  assert.equal(matchesProductSearch({}, 'неизвестно'), false);
});
