export function normalizeSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ru')
    .replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const aliases = [
  ['блендер', 'blender'],
  ['пароварка', 'мантоварка'],
  ['воздуходув', 'воздуходувка']
];

function isOneEditApart(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
}

export function matchesProductSearch(product, query, { highlight = '', tagLabel = '' } = {}) {
  const terms = normalizeSearch(query).slice(0, 120).split(/\s+/).filter(Boolean);
  const words = normalizeSearch([product.title, product.category, highlight, tagLabel].join(' ')).split(/\s+/);
  return terms.every((term) => {
    const variants = aliases.find((group) => group.includes(term)) || [term];
    return variants.some((variant) => words.some((word) => word.startsWith(variant)
      || (variant.length >= 5 && word.length >= 5 && isOneEditApart(variant, word))));
  });
}
