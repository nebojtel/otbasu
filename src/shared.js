export const tagLabels = { none: 'Без метки', hit: 'Хит', new: 'Новинка', promo: 'Акция' };
export const badgeClasses = { hit: 'badge-hit', new: 'badge-new', promo: 'badge-sale', none: '' };
export const statusLabels = { active: 'Опубликован', draft: 'Черновик', hidden: 'Скрыт' };

const FALLBACK_PRODUCT_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="bg" x1="38" y1="26" x2="282" y2="294" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff8ed"/>
      <stop offset="1" stop-color="#efd8bb"/>
    </linearGradient>
    <linearGradient id="mark" x1="112" y1="96" x2="214" y2="224" gradientUnits="userSpaceOnUse">
      <stop stop-color="#c78a32"/>
      <stop offset="1" stop-color="#4f1d42"/>
    </linearGradient>
  </defs>
  <rect width="320" height="320" rx="32" fill="url(#bg)"/>
  <circle cx="160" cy="144" r="54" fill="none" stroke="url(#mark)" stroke-width="10" opacity=".78"/>
  <path d="M96 226c22-34 47-50 76-50 23 0 44 10 64 31 8 8 6 23-5 28H107c-11 0-17-10-11-19z" fill="url(#mark)" opacity=".7"/>
</svg>
`)}`;

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
  return FALLBACK_PRODUCT_IMAGE;
}
