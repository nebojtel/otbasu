export const tagLabels = { none: 'Без метки', hit: 'Хит', new: 'Новинка', promo: 'Акция' };
export const badgeClasses = { hit: 'badge-hit', new: 'badge-new', promo: 'badge-sale', none: '' };
export const statusLabels = { active: 'Опубликован', draft: 'Черновик', hidden: 'Скрыт' };

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function normalizeExternalUrl(url) {
  const value = String(url || '').trim();
  if (!value || value === '#') return '';
  if (/^(https?:\/\/|\/)/i.test(value)) return value;
  if (/^[\w.-]+\.[a-zа-я]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return value;
}

export function isSafeUrl(url) {
  const value = normalizeExternalUrl(url);
  return /^(https?:\/\/|\/)/i.test(value);
}

export function safeHref(url) {
  const value = normalizeExternalUrl(url);
  return isSafeUrl(value) ? value : '#';
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTag(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['hit', 'hits', 'top', 'popular', 'хит', 'хиты'].includes(raw)) return 'hit';
  if (['new', 'novelty', 'newbie', 'новинка', 'новинки'].includes(raw)) return 'new';
  if (['promo', 'sale', 'discount', 'action', 'акция', 'акции', 'скидка'].includes(raw)) return 'promo';
  return 'none';
}

export function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || ['active', 'published', 'publish', 'опубликован', 'опубликовано'].includes(raw)) return 'active';
  if (['draft', 'черновик'].includes(raw)) return 'draft';
  if (['hidden', 'hide', 'скрыт', 'скрыто'].includes(raw)) return 'hidden';
  return raw;
}

export function productWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'товар';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'товара';
  return 'товаров';
}

export function fallbackImage() {
  return '/assets/product-diffuser.png';
}
