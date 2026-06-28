import { supabase, isConfigured } from './supabaseClient.js';
import { badgeClasses, escapeHtml, fallbackImage, normalizeExternalUrl, normalizeStatus, normalizeTag, productWord, safeHref, tagLabels } from './shared.js';

const tabTitles = {
  all: 'Популярные товары',
  hit: 'Хиты',
  new: 'Новинки',
  promo: 'Акции'
};

const fallbackState = {
  settings: {
    eyebrow: 'Instagram витрина',
    heroTitle: 'Товары для дома и семьи',
    heroButtonText: 'Смотреть товары',
    catalogTitle: 'Популярные товары',
    searchPlaceholder: 'Найти товар из обзора...',
    kaspiStoreUrl: '',
    kaspiStoreTitle: 'Все товары ОТБАСЫ',
    kaspiStoreSubtitle: 'Открыть магазин на Kaspi'
  },
  categories: [
    { id: 'cat-home', name: 'Дом', sort: 10 },
    { id: 'cat-tech', name: 'Техника', sort: 20 },
    { id: 'cat-video', name: 'Съемка', sort: 30 },
    { id: 'cat-care', name: 'Уход', sort: 40 }
  ],
  products: [
    { id: 'prod-diffuser', title: 'Умный увлажнитель воздуха', category: 'Дом', tag: 'hit', status: 'active', imageUrl: '/assets/product-diffuser.png', images: ['/assets/product-diffuser.png', '/assets/gallery-diffuser-2.svg', '/assets/gallery-diffuser-3.svg'], kaspiUrl: '#', videoUrl: '#', sort: 10 },
    { id: 'prod-blender', title: 'Мини-блендер для смузи', category: 'Техника', tag: 'new', status: 'active', imageUrl: '/assets/product-blender.png', images: ['/assets/product-blender.png', '/assets/gallery-blender-2.svg', '/assets/gallery-blender-3.svg'], kaspiUrl: '#', videoUrl: '#', sort: 20 },
    { id: 'prod-light', title: 'LED-лампа для съемки', category: 'Съемка', tag: 'promo', status: 'active', imageUrl: '/assets/product-light.png', images: ['/assets/product-light.png', '/assets/gallery-light-2.svg', '/assets/gallery-light-3.svg'], kaspiUrl: '#', videoUrl: '#', sort: 30 },
    { id: 'prod-organizer', title: 'Органайзер для косметики', category: 'Уход', tag: 'new', status: 'active', imageUrl: '/assets/product-organizer.png', images: ['/assets/product-organizer.png', '/assets/gallery-organizer-2.svg', '/assets/gallery-organizer-3.svg'], kaspiUrl: '#', videoUrl: '#', sort: 40 }
  ]
};

let state = fallbackState;
let currentTab = 'all';
let currentCategory = 'all';
let sortMode = 'manual';
let observer = null;
const viewedProducts = new Set();
const sessionId = getSessionId();
const galleryState = { product: null, images: [], index: 0 };

const els = {
  list: document.querySelector('[data-products-list]') || document.querySelector('.products-list'),
  counter: document.querySelector('[data-product-count]'),
  search: document.querySelector('[data-search-input]') || document.querySelector('.search-bar input'),
  categoryFilter: document.querySelector('[data-category-filter]'),
  sortToggle: document.querySelector('[data-sort-toggle]'),
  heroTitle: document.querySelector('[data-hero-title]'),
  heroEyebrow: document.querySelector('[data-hero-eyebrow]'),
  heroButton: document.querySelector('[data-hero-button]'),
  catalogTitle: document.querySelector('[data-catalog-title]'),
  storeLink: document.querySelector('[data-kaspi-store-link]'),
  navLinks: Array.from(document.querySelectorAll('[data-vitrine-filter]')),
  galleryModal: document.getElementById('galleryModal'),
  galleryImage: document.querySelector('.gallery-image'),
  galleryTitle: document.querySelector('.gallery-title'),
  galleryCounter: document.querySelector('.gallery-counter'),
  galleryDots: document.querySelector('.gallery-dots'),
  galleryPrev: document.querySelector('[data-gallery-prev]'),
  galleryNext: document.querySelector('[data-gallery-next]')
};

function getSessionId() {
  const key = 'otbasy-vitrine-session-v2';
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch (_) {
    return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function dbProductToUi(product = {}) {
  const images = Array.isArray(product.images) ? product.images.map(normalizeExternalUrl).filter(Boolean) : [];
  const imageUrl = normalizeExternalUrl(product.image_url || product.imageUrl || images[0] || fallbackImage());
  return {
    id: product.id,
    title: product.title || 'Без названия',
    category: product.category || product.category_name || 'Без категории',
    tag: normalizeTag(product.tag),
    status: normalizeStatus(product.status),
    imageUrl,
    images: [...new Set([imageUrl, ...images].filter(Boolean))],
    kaspiUrl: normalizeExternalUrl(product.kaspi_url || product.kaspiUrl || ''),
    videoUrl: normalizeExternalUrl(product.video_url || product.videoUrl || ''),
    sort: Number.isFinite(Number(product.sort)) ? Number(product.sort) : 100,
    note: product.note || ''
  };
}

async function loadState() {
  if (!isConfigured()) {
    applySettings(fallbackState.settings);
    renderProducts();
    return;
  }

  try {
    const [{ data: settings, error: settingsError }, { data: categories, error: categoriesError }, { data: products, error: productsError }] = await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('categories').select('*').eq('is_active', true).order('sort', { ascending: true }),
      supabase.from('products').select('*').eq('status', 'active').order('sort', { ascending: true })
    ]);

    if (settingsError) throw settingsError;
    if (categoriesError) throw categoriesError;
    if (productsError) throw productsError;

    state = {
      settings: settings || fallbackState.settings,
      categories: Array.isArray(categories) ? categories : fallbackState.categories,
      products: Array.isArray(products) && products.length ? products.map(dbProductToUi) : fallbackState.products
    };
  } catch (error) {
    console.warn('Supabase load failed, using fallback data:', error.message);
    state = fallbackState;
  }

  applySettings(state.settings);
  renderProducts();
}

function applySettings(settings = {}) {
  const merged = { ...fallbackState.settings, ...settings };
  if (els.heroTitle) els.heroTitle.textContent = merged.heroTitle || fallbackState.settings.heroTitle;
  if (els.heroEyebrow) els.heroEyebrow.textContent = merged.eyebrow || fallbackState.settings.eyebrow;
  if (els.heroButton) els.heroButton.textContent = merged.heroButtonText || fallbackState.settings.heroButtonText;
  if (els.catalogTitle) els.catalogTitle.textContent = merged.catalogTitle || tabTitles[currentTab] || fallbackState.settings.catalogTitle;
  if (els.search) els.search.placeholder = merged.searchPlaceholder || fallbackState.settings.searchPlaceholder;

  if (els.storeLink) {
    const title = els.storeLink.querySelector('strong');
    const sub = els.storeLink.querySelector('small');
    if (title) title.textContent = merged.kaspiStoreTitle || fallbackState.settings.kaspiStoreTitle;
    if (sub) sub.textContent = merged.kaspiStoreSubtitle || fallbackState.settings.kaspiStoreSubtitle;
    const href = safeHref(merged.kaspiStoreUrl);
    els.storeLink.href = href;
    els.storeLink.dataset.enabled = href !== '#' ? 'true' : 'false';
  }
}

function activeProducts() {
  return (state.products || [])
    .map(dbProductToUi)
    .filter((product) => product.status === 'active')
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

function visibleProducts() {
  const query = String(els.search?.value || '').trim().toLowerCase();
  return activeProducts().filter((product) => {
    const tabOk = currentTab === 'all' || product.tag === currentTab;
    const catOk = currentCategory === 'all' || product.category === currentCategory;
    const searchOk = !query || [product.title, product.category, tagLabels[product.tag]].join(' ').toLowerCase().includes(query);
    return tabOk && catOk && searchOk;
  }).sort((a, b) => {
    if (sortMode === 'title') return a.title.localeCompare(b.title, 'ru');
    return Number(a.sort || 0) - Number(b.sort || 0);
  });
}

function renderProducts() {
  if (!els.list) return;
  disconnectObserver();

  const items = visibleProducts();
  els.list.innerHTML = items.length
    ? items.map(renderProductCard).join('')
    : `<div class="empty-state"><strong>Товаров пока нет</strong><span>Добавьте товар в админке или выберите другую вкладку.</span></div>`;

  if (els.counter) els.counter.textContent = `${items.length} ${productWord(items.length)}`;
  if (els.catalogTitle) els.catalogTitle.textContent = currentTab === 'all'
    ? (state.settings?.catalogTitle || tabTitles.all)
    : tabTitles[currentTab];

  attachCardHandlers();
  observeProductViews();
}

function renderProductCard(product) {
  const badgeText = tagLabels[product.tag] || '';
  const badgeClass = badgeClasses[product.tag] || '';
  const image = product.imageUrl || product.images?.[0] || fallbackImage();
  const safeKaspi = safeHref(product.kaspiUrl);
  const safeVideo = safeHref(product.videoUrl);
  return `
    <article class="product" data-product-id="${escapeHtml(product.id)}">
      <div class="product-media" data-gallery-open="${escapeHtml(product.id)}" role="button" tabindex="0" aria-label="Открыть фото товара ${escapeHtml(product.title)}">
        <img class="photo" src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" loading="lazy">
        ${badgeText ? `<span class="product-badge ${badgeClass}">${escapeHtml(badgeText)}</span>` : ''}
      </div>
      <div class="content">
        <p class="category-name">${escapeHtml(product.category)}</p>
        <h2>${escapeHtml(product.title)}</h2>
        <div class="actions">
          <a class="video" href="${escapeHtml(safeVideo)}" target="_blank" rel="noopener noreferrer" data-action="video" data-enabled="${safeVideo !== '#'}"><span></span>Видео</a>
          <a class="kaspi" href="${escapeHtml(safeKaspi)}" target="_blank" rel="noopener noreferrer" data-action="kaspi" data-enabled="${safeKaspi !== '#'}"><span></span>Kaspi</a>
        </div>
      </div>
    </article>`;
}

function attachCardHandlers() {
  document.querySelectorAll('[data-gallery-open]').forEach((node) => {
    node.addEventListener('click', () => openGalleryById(node.dataset.galleryOpen));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openGalleryById(node.dataset.galleryOpen);
      }
    });
  });

  document.querySelectorAll('.product .actions a').forEach((link) => {
    link.addEventListener('click', (event) => {
      const productEl = link.closest('.product');
      const productId = productEl?.dataset.productId;
      const action = link.dataset.action;
      const enabled = link.dataset.enabled === 'true';
      trackEvent(action === 'kaspi' ? 'kaspi_click' : 'video_click', { productId });
      if (!enabled) {
        event.preventDefault();
      }
    });
  });
}

function disconnectObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function observeProductViews() {
  if (!('IntersectionObserver' in window)) return;
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const productId = entry.target.dataset.productId;
      if (!productId || viewedProducts.has(productId)) return;
      viewedProducts.add(productId);
      trackEvent('product_view', { productId });
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('.product[data-product-id]').forEach((node) => observer.observe(node));
}

function productById(productId) {
  return activeProducts().find((product) => String(product.id) === String(productId));
}

function openGalleryById(productId) {
  const product = productById(productId);
  if (!product) return;
  const images = Array.isArray(product.images) && product.images.length ? product.images : [product.imageUrl || fallbackImage()];
  galleryState.product = product;
  galleryState.images = images;
  galleryState.index = 0;
  updateGallery();
  els.galleryModal?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('gallery-open');
  trackEvent('gallery_open', { productId: product.id });
}

function closeGallery() {
  els.galleryModal?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('gallery-open');
}

function updateGallery() {
  const { product, images, index } = galleryState;
  if (!product || !images.length) return;
  const image = images[index] || images[0];
  if (els.galleryImage) {
    els.galleryImage.src = image;
    els.galleryImage.alt = product.title;
  }
  if (els.galleryTitle) els.galleryTitle.textContent = product.title;
  if (els.galleryCounter) els.galleryCounter.textContent = `${index + 1} / ${images.length}`;
  if (els.galleryPrev) els.galleryPrev.hidden = images.length <= 1;
  if (els.galleryNext) els.galleryNext.hidden = images.length <= 1;
  if (els.galleryDots) {
    els.galleryDots.innerHTML = images.map((_, i) => `<button type="button" class="${i === index ? 'active' : ''}" data-gallery-dot="${i}" aria-label="Фото ${i + 1}"></button>`).join('');
    els.galleryDots.querySelectorAll('[data-gallery-dot]').forEach((button) => {
      button.addEventListener('click', () => {
        galleryState.index = Number(button.dataset.galleryDot) || 0;
        updateGallery();
      });
    });
  }
}

function shiftGallery(delta) {
  if (!galleryState.images.length) return;
  galleryState.index = (galleryState.index + delta + galleryState.images.length) % galleryState.images.length;
  updateGallery();
}

async function trackEvent(eventType, details = {}) {
  if (!isConfigured()) return;
  const payload = {
    event_type: eventType,
    product_id: details.productId || null,
    session_id: sessionId,
    tab: currentTab,
    category_filter: currentCategory,
    meta: {
      page: 'vitrine',
      userAgent: navigator.userAgent.slice(0, 200)
    }
  };
  try {
    await supabase.from('analytics_events').insert(payload);
  } catch (_) {
    // Analytics must never block the vitrine.
  }
}

function cycleCategory() {
  const categories = ['all', ...(state.categories || []).map((cat) => cat.name).filter(Boolean)];
  const index = categories.indexOf(currentCategory);
  currentCategory = categories[(index + 1) % categories.length] || 'all';
  if (els.categoryFilter) els.categoryFilter.firstChild.textContent = currentCategory === 'all' ? 'Все категории ' : `${currentCategory} `;
  renderProducts();
  trackEvent('filter_change', { category: currentCategory });
}

function toggleSort() {
  sortMode = sortMode === 'manual' ? 'title' : 'manual';
  if (els.sortToggle) els.sortToggle.firstChild.textContent = sortMode === 'manual' ? 'По порядку ' : 'По названию ';
  renderProducts();
}

function bindEvents() {
  els.search?.addEventListener('input', renderProducts);
  els.categoryFilter?.addEventListener('click', cycleCategory);
  els.sortToggle?.addEventListener('click', toggleSort);
  els.navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      currentTab = link.dataset.vitrineFilter || 'all';
      els.navLinks.forEach((item) => item.classList.toggle('active', item === link));
      renderProducts();
      document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      trackEvent('tab_click', { tab: currentTab });
    });
  });
  document.querySelectorAll('[data-gallery-close]').forEach((node) => node.addEventListener('click', closeGallery));
  els.galleryPrev?.addEventListener('click', () => shiftGallery(-1));
  els.galleryNext?.addEventListener('click', () => shiftGallery(1));
  window.addEventListener('keydown', (event) => {
    if (els.galleryModal?.getAttribute('aria-hidden') === 'false') {
      if (event.key === 'Escape') closeGallery();
      if (event.key === 'ArrowLeft') shiftGallery(-1);
      if (event.key === 'ArrowRight') shiftGallery(1);
    }
  });
}

bindEvents();
loadState();
/* OTBASU MOBILE PHOTO VIEWER — FINAL EDGE FIX VERSION
   Влево/вправо — листать фото.
   Вверх/вниз — закрыть просмотр.
   Первый/последний кадр мягко упираются и не закрывают просмотр.
   CSS встроен сюда, vitrine/styles.css не трогаем.
*/
(() => {
  if (window.__OTBASU_MOBILE_PHOTO_VIEWER_FINAL_EDGE__) return;
  window.__OTBASU_MOBILE_PHOTO_VIEWER_FINAL_EDGE__ = true;

  const STYLE_ID = 'otbasu-mobile-photo-viewer-final-edge-style';
  const VIEWER_ID = 'otbasuMobilePhotoViewer';

  function htmlEscape(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function uniqImages(list = []) {
    const seen = new Set();

    return list
      .flatMap((item) => {
        if (!item) return [];

        if (Array.isArray(item)) return item;

        if (typeof item === 'string') {
          const trimmed = item.trim();

          if (!trimmed) return [];

          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
          } catch (_) {}

          return [trimmed];
        }

        return [];
      })
      .map((src) => String(src || '').trim())
      .filter(Boolean)
      .filter((src) => {
        if (seen.has(src)) return false;
        seen.add(src);
        return true;
      });
  }

  function getProductsSafely() {
    try {
      if (typeof activeProducts === 'function') {
        return activeProducts();
      }
    } catch (_) {}

    try {
      if (typeof state !== 'undefined' && Array.isArray(state.products)) {
        return state.products;
      }
    } catch (_) {}

    return [];
  }

  function getProductFromClick(opener) {
    const card = opener.closest?.('[data-product-id], .product');
    const productId =
      opener.dataset?.galleryOpen ||
      opener.dataset?.productId ||
      card?.dataset?.productId ||
      '';

    const products = getProductsSafely();
    const product = products.find((item) => String(item.id) === String(productId));

    if (product) return product;

    const img = opener.querySelector?.('img') || opener.closest?.('.product')?.querySelector?.('img') || null;
    const title =
      card?.querySelector?.('h3')?.textContent?.trim() ||
      img?.alt ||
      'Товар';

    return {
      id: productId || `product-${Date.now()}`,
      title,
      imageUrl: img?.currentSrc || img?.src || '',
      images: [img?.currentSrc || img?.src || '']
    };
  }

  function getImagesFromProduct(product, opener) {
    const openerImg = opener.querySelector?.('img') || opener.closest?.('.product')?.querySelector?.('img') || null;

    const images = uniqImages([
      product?.imageUrl,
      product?.image_url,
      product?.mainImage,
      product?.main_image,
      product?.photo,
      product?.image,
      product?.images,
      openerImg?.currentSrc,
      openerImg?.src
    ]);

    return images.length ? images : [openerImg?.currentSrc || openerImg?.src || ''].filter(Boolean);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .otbasu-photo-count-badge {
        position: absolute;
        right: 10px;
        bottom: 10px;
        z-index: 5;
        padding: 6px 9px;
        border-radius: 999px;
        background: rgba(66, 12, 46, .74);
        color: #fff7e8;
        font-size: 11px;
        font-weight: 900;
        line-height: 1;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 10px 24px rgba(30, 4, 21, .24);
        pointer-events: none;
      }

      .product-media {
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }

      .otbasu-photo-viewer {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: block;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        background: rgba(20, 3, 15, 0);
        overflow: hidden;
        transition:
          opacity 180ms ease,
          visibility 180ms ease,
          background 180ms ease;
        -webkit-tap-highlight-color: transparent;
        contain: layout paint size;
      }

      .otbasu-photo-viewer.is-open {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        background: rgba(20, 3, 15, .94);
      }

      .otbasu-photo-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 8%, rgba(255, 232, 198, .14), transparent 34%),
          linear-gradient(180deg, rgba(58, 9, 42, .82), rgba(13, 1, 10, .98));
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      .otbasu-photo-track {
        position: relative;
        z-index: 2;
        display: flex;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        overflow-x: auto;
        overflow-y: hidden;
        scroll-snap-type: x mandatory;
        scroll-behavior: smooth;
        scrollbar-width: none;
        overscroll-behavior: contain;
        overscroll-behavior-x: contain;
        overscroll-behavior-y: none;
        touch-action: pan-x;
        transform: translate3d(0, 24px, 0) scale(.96);
        opacity: 0;
        transition:
          transform 280ms cubic-bezier(.16, 1, .3, 1),
          opacity 220ms ease;
        will-change: transform, opacity;
      }

      .otbasu-photo-viewer.is-open .otbasu-photo-track {
        transform: translate3d(0, 0, 0) scale(1);
        opacity: 1;
      }

      .otbasu-photo-track::-webkit-scrollbar {
        display: none;
      }

      .otbasu-photo-slide {
        flex: 0 0 100vw;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        margin: 0;
        padding:
          max(66px, calc(env(safe-area-inset-top) + 56px))
          0
          max(76px, calc(env(safe-area-inset-bottom) + 58px));
        display: grid;
        place-items: center;
        scroll-snap-align: center;
        scroll-snap-stop: always;
        user-select: none;
        -webkit-user-select: none;
      }

      .otbasu-photo-slide img {
        width: 100%;
        height: 100%;
        max-width: 100vw;
        max-height: 100%;
        object-fit: contain;
        display: block;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
        touch-action: pan-x;
      }

      .otbasu-photo-close {
        position: fixed;
        top: max(14px, env(safe-area-inset-top));
        right: 14px;
        z-index: 6;
        width: 46px;
        height: 46px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 250, 244, .92);
        box-shadow: 0 14px 40px rgba(12, 2, 9, .34);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        cursor: pointer;
      }

      .otbasu-photo-close::before,
      .otbasu-photo-close::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 19px;
        height: 3px;
        border-radius: 999px;
        background: #79124f;
        transform-origin: center;
      }

      .otbasu-photo-close::before {
        transform: translate(-50%, -50%) rotate(45deg);
      }

      .otbasu-photo-close::after {
        transform: translate(-50%, -50%) rotate(-45deg);
      }

      .otbasu-photo-bars {
        position: fixed;
        left: 50%;
        bottom: max(22px, env(safe-area-inset-bottom));
        z-index: 6;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 10px 12px;
        max-width: calc(100vw - 28px);
        border-radius: 999px;
        background: rgba(255, 248, 238, .11);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 12px 32px rgba(12, 2, 9, .2);
      }

      .otbasu-photo-bar {
        width: 24px;
        height: 4px;
        border: 0;
        border-radius: 999px;
        padding: 0;
        background: rgba(255, 239, 229, .34);
        transition:
          width 180ms ease,
          background 180ms ease,
          transform 180ms ease;
        cursor: pointer;
      }

      .otbasu-photo-bar.is-active {
        width: 36px;
        background: #8d155d;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .16) inset;
      }

      .otbasu-photo-hint {
        position: fixed;
        left: 50%;
        top: max(18px, env(safe-area-inset-top));
        z-index: 5;
        transform: translateX(-50%);
        padding: 8px 12px;
        border-radius: 999px;
        color: rgba(255, 247, 229, .76);
        background: rgba(255, 248, 238, .1);
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        pointer-events: none;
        opacity: .82;
        transition: opacity 240ms ease;
      }

      .otbasu-photo-viewer.is-used .otbasu-photo-hint {
        opacity: 0;
      }

      body.otbasu-photo-open {
        overflow: hidden !important;
        overscroll-behavior: none !important;
      }

      @media (min-width: 761px) and (hover: hover) {
        .otbasu-photo-slide {
          padding: 74px 32px 86px;
        }

        .otbasu-photo-slide img {
          max-width: min(980px, 92vw);
        }
      }
    `;

    document.head.appendChild(style);
  }

  function addPhotoBadges() {
    document.querySelectorAll('.product').forEach((card) => {
      const media = card.querySelector('.product-media, [data-gallery-open]');
      if (!media || media.querySelector('.otbasu-photo-count-badge')) return;

      const productId = media.dataset.galleryOpen || card.dataset.productId || '';
      const product = getProductsSafely().find((item) => String(item.id) === String(productId));
      const images = getImagesFromProduct(product || {}, media);

      if (images.length < 2) return;

      const badge = document.createElement('span');
      badge.className = 'otbasu-photo-count-badge';
      badge.textContent = `${images.length} фото`;
      media.appendChild(badge);
    });
  }

  function openViewer(product, images, opener) {
    injectStyles();

    const safeImages = uniqImages(images);
    if (!safeImages.length) return;

    document.getElementById(VIEWER_ID)?.remove();

    const oldModal = document.getElementById('galleryModal');
    if (oldModal) oldModal.setAttribute('aria-hidden', 'true');

    const title = product?.title || opener?.closest?.('.product')?.querySelector?.('h3')?.textContent?.trim() || 'Товар';

    const viewer = document.createElement('section');
    viewer.id = VIEWER_ID;
    viewer.className = 'otbasu-photo-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', `Фото товара ${title}`);

    viewer.innerHTML = `
      <div class="otbasu-photo-backdrop" data-otbasu-photo-close></div>
      <button class="otbasu-photo-close" type="button" data-otbasu-photo-close aria-label="Закрыть просмотр фото"></button>
      <div class="otbasu-photo-hint">Листай влево/вправо · вверх/вниз закрыть</div>

      <div class="otbasu-photo-track" data-otbasu-photo-track>
        ${safeImages.map((src, index) => `
          <figure class="otbasu-photo-slide" data-otbasu-photo-slide="${index}">
            <img src="${htmlEscape(src)}" alt="${htmlEscape(title)} — фото ${index + 1}" draggable="false" decoding="async">
          </figure>
        `).join('')}
      </div>

      <div class="otbasu-photo-bars" aria-label="Фотографии товара">
        ${safeImages.map((_, index) => `
          <button
            class="otbasu-photo-bar${index === 0 ? ' is-active' : ''}"
            type="button"
            data-otbasu-photo-dot="${index}"
            aria-label="Фото ${index + 1} из ${safeImages.length}">
          </button>
        `).join('')}
      </div>
    `;

    document.body.appendChild(viewer);
    document.body.classList.add('otbasu-photo-open');

    const track = viewer.querySelector('[data-otbasu-photo-track]');
    const bars = Array.from(viewer.querySelectorAll('[data-otbasu-photo-dot]'));

    let activeIndex = 0;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let startTime = 0;
    let mode = null;
    let touching = false;
    let raf = 0;
    let ignoreClickUntil = 0;

    const updateBars = () => {
      const nextIndex = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      activeIndex = Math.max(0, Math.min(safeImages.length - 1, nextIndex));

      bars.forEach((bar, index) => {
        bar.classList.toggle('is-active', index === activeIndex);
        bar.setAttribute('aria-current', index === activeIndex ? 'true' : 'false');
      });
    };

    const requestUpdateBars = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateBars);
    };

    const scrollToIndex = (index, behavior = 'smooth') => {
      const next = Math.max(0, Math.min(safeImages.length - 1, index));
      viewer.classList.add('is-used');
      track.scrollTo({ left: next * track.clientWidth, behavior });
      window.setTimeout(updateBars, behavior === 'smooth' ? 220 : 0);
    };

    const closeViewer = (directionY = 1) => {
      if (!viewer.isConnected) return;

      viewer.classList.add('is-used');
      viewer.style.transition = 'opacity 190ms ease, background 190ms ease';
      viewer.style.opacity = '0';

      track.style.transition = 'transform 210ms cubic-bezier(.2,.9,.2,1), opacity 170ms ease';
      track.style.transform = `translate3d(0, ${directionY * 44}px, 0) scale(.96)`;
      track.style.opacity = '0';

      window.setTimeout(() => {
        viewer.remove();
        document.body.classList.remove('otbasu-photo-open');
      }, 190);
    };

    const resetTrack = () => {
      viewer.style.transition = 'opacity 180ms ease';
      viewer.style.opacity = '1';

      track.style.transition = 'transform 220ms cubic-bezier(.16,1,.3,1), opacity 180ms ease';
      track.style.transform = 'translate3d(0, 0, 0) scale(1)';
      track.style.opacity = '1';

      window.setTimeout(() => {
        viewer.style.transition = '';
        viewer.style.opacity = '';
        track.style.transition = '';
        track.style.transform = '';
        track.style.opacity = '';
      }, 240);
    };

    const getTouch = (event) => {
      if (event.touches?.[0]) return event.touches[0];
      if (event.changedTouches?.[0]) return event.changedTouches[0];
      return event;
    };

    const isAtFirstPhoto = () => track.scrollLeft <= 4;
    const isAtLastPhoto = () => {
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      return track.scrollLeft >= maxScrollLeft - 4;
    };

    const startTouch = (event) => {
      if (event.target.closest('button')) return;

      const point = getTouch(event);

      touching = true;
      mode = null;
      startX = point.clientX;
      startY = point.clientY;
      lastX = point.clientX;
      lastY = point.clientY;
      startTime = Date.now();

      track.style.transition = 'none';
    };

    const moveTouch = (event) => {
      if (!touching) return;

      const point = getTouch(event);

      lastX = point.clientX;
      lastY = point.clientY;

      const dx = lastX - startX;
      const dy = lastY - startY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      const pullingRightFromFirst = dx > 0 && isAtFirstPhoto();
      const pullingLeftFromLast = dx < 0 && isAtLastPhoto();
      const pullingEdge = pullingRightFromFirst || pullingLeftFromLast;

      if (!mode && Math.max(ax, ay) > 8) {
        if (pullingEdge && ax > ay * 0.55) {
          mode = 'edge-horizontal';
        } else {
          mode = ay > ax * 1.08 ? 'vertical' : 'horizontal';
        }
      }

      if (mode === 'edge-horizontal') {
        viewer.classList.add('is-used');

        if (event.cancelable) event.preventDefault();

        const rubber = Math.max(-34, Math.min(34, dx * 0.16));

        track.style.transition = 'none';
        track.style.transform = `translate3d(${rubber}px, 0, 0) scale(1)`;
        track.style.opacity = '1';
        viewer.style.opacity = '1';

        return;
      }

      if (mode === 'horizontal') {
        viewer.classList.add('is-used');
        return;
      }

      if (mode !== 'vertical') return;

      viewer.classList.add('is-used');

      if (event.cancelable) event.preventDefault();

      const limitedY = Math.max(-210, Math.min(210, dy));
      const progress = Math.min(Math.abs(limitedY) / 210, 1);
      const scale = 1 - progress * 0.075;

      track.style.transform = `translate3d(0, ${limitedY}px, 0) scale(${scale})`;
      track.style.opacity = String(1 - progress * 0.5);
      viewer.style.opacity = String(1 - progress * 0.18);
    };

    const endTouch = (event) => {
      if (!touching) return;

      const point = getTouch(event);

      if (point) {
        lastX = point.clientX;
        lastY = point.clientY;
      }

      const dx = lastX - startX;
      const dy = lastY - startY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const time = Date.now() - startTime;

      touching = false;

      if (mode === 'edge-horizontal') {
        ignoreClickUntil = Date.now() + 260;
        resetTrack();

        if ('vibrate' in navigator) {
          navigator.vibrate(5);
        }

        requestUpdateBars();
        return;
      }

      const fastVertical = mode === 'vertical' && ay > 42 && time < 240 && ay > ax * 1.15;
      const strongVertical = mode === 'vertical' && ay > 78 && ay > ax * 1.08;

      if (fastVertical || strongVertical) {
        ignoreClickUntil = Date.now() + 350;
        closeViewer(dy < 0 ? -1 : 1);
        return;
      }

      if (mode === 'vertical') {
        ignoreClickUntil = Date.now() + 280;
        resetTrack();
        return;
      }

      requestUpdateBars();
    };

    viewer.querySelectorAll('[data-otbasu-photo-close]').forEach((node) => {
      node.addEventListener('click', (event) => {
        if (Date.now() < ignoreClickUntil) return;
        event.preventDefault();
        closeViewer(1);
      });
    });

    bars.forEach((bar) => {
      bar.addEventListener('click', () => {
        scrollToIndex(Number(bar.dataset.otbasuPhotoDot) || 0);
      });
    });

    track.addEventListener('scroll', requestUpdateBars, { passive: true });
    track.addEventListener('touchstart', startTouch, { passive: true });
    track.addEventListener('touchmove', moveTouch, { passive: false });
    track.addEventListener('touchend', endTouch, { passive: true });
    track.addEventListener('touchcancel', resetTrack, { passive: true });

    const keyHandler = (event) => {
      if (!viewer.isConnected) {
        window.removeEventListener('keydown', keyHandler);
        return;
      }

      if (event.key === 'Escape') closeViewer(1);
      if (event.key === 'ArrowLeft') scrollToIndex(activeIndex - 1);
      if (event.key === 'ArrowRight') scrollToIndex(activeIndex + 1);
    };

    window.addEventListener('keydown', keyHandler);

    requestAnimationFrame(() => {
      viewer.classList.add('is-open');
      scrollToIndex(0, 'auto');

      const firstImage = track.querySelector('img');

      if (firstImage) {
        firstImage.animate(
          [
            { transform: 'scale(.94)', opacity: .7 },
            { transform: 'scale(1)', opacity: 1 }
          ],
          {
            duration: 260,
            easing: 'cubic-bezier(.16,1,.3,1)'
          }
        );
      }
    });
  }

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;

      if (!target || !target.closest) return;
      if (target.closest('.actions, a[href], [data-action], .otbasu-photo-viewer')) return;

      const opener =
        target.closest('[data-gallery-open]') ||
        target.closest('.product-media') ||
        target.closest('.product img');

      if (!opener) return;

      const product = getProductFromClick(opener);
      const images = getImagesFromProduct(product, opener);

      if (!images.length) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openViewer(product, images, opener);

      try {
        if (typeof trackEvent === 'function') {
          trackEvent('gallery_open', { productId: product.id });
        }
      } catch (_) {}
    },
    true
  );

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    window.setTimeout(addPhotoBadges, 500);
    window.setTimeout(addPhotoBadges, 1500);
  });

  injectStyles();
  window.setTimeout(addPhotoBadges, 700);
})();
/* OTBASU VITRINE SMART IMAGE OPTIMIZATION — SAFE
   Умная загрузка фото:
   - карточки ниже экрана грузятся лениво
   - первые фото грузятся сразу
   - в галерее следующее фото заранее подгружается
   - дальние фото не грузятся все сразу
   Админку, аналитику, свайпы и логику товаров не трогаем.
*/
(() => {
  if (window.__OTBASU_VITRINE_SMART_IMAGE_OPTIMIZATION__) return;
  window.__OTBASU_VITRINE_SMART_IMAGE_OPTIMIZATION__ = true;

  const BLANK_SRC =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>');

  const preconnectedOrigins = new Set();
  const preloadedSources = new Set();

  function runIdle(callback, timeout = 600) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout });
      return;
    }

    window.setTimeout(callback, 80);
  }

  function preconnectFromSrc(src) {
    try {
      const url = new URL(src, window.location.href);

      if (url.origin === window.location.origin) return;
      if (preconnectedOrigins.has(url.origin)) return;

      preconnectedOrigins.add(url.origin);

      const dns = document.createElement('link');
      dns.rel = 'dns-prefetch';
      dns.href = url.origin;
      document.head.appendChild(dns);

      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = url.origin;
      preconnect.crossOrigin = '';
      document.head.appendChild(preconnect);
    } catch (_) {}
  }

  function setImagePriority(img, priority) {
    if (!img) return;

    img.setAttribute('decoding', 'async');
    img.setAttribute('draggable', 'false');

    if (priority === 'high') {
      img.setAttribute('loading', 'eager');
      img.setAttribute('fetchpriority', 'high');
    } else {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('fetchpriority', 'low');
    }
  }

  function getOriginalSrc(img) {
    if (!img) return '';

    if (!img.dataset.otbasuOriginalSrc) {
      const src = img.getAttribute('src') || img.currentSrc || '';

      if (src && src !== BLANK_SRC && !src.startsWith('data:image/svg+xml')) {
        img.dataset.otbasuOriginalSrc = src;
      }
    }

    if (!img.dataset.otbasuOriginalSrcset) {
      const srcset = img.getAttribute('srcset') || '';

      if (srcset) {
        img.dataset.otbasuOriginalSrcset = srcset;
      }
    }

    return img.dataset.otbasuOriginalSrc || '';
  }

  function preloadImage(src) {
    if (!src || preloadedSources.has(src)) return;

    preloadedSources.add(src);

    runIdle(() => {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
    }, 400);
  }

  function hydrateImage(img, priority = 'low') {
    if (!img) return;

    const src = getOriginalSrc(img);

    if (!src) return;

    setImagePriority(img, priority);
    preconnectFromSrc(src);

    const srcset = img.dataset.otbasuOriginalSrcset;

    if (srcset && img.getAttribute('srcset') !== srcset) {
      img.setAttribute('srcset', srcset);
    }

    if (img.getAttribute('src') !== src) {
      img.setAttribute('src', src);
    }
  }

  function softenFarGalleryImage(img) {
    if (!img) return;

    const src = getOriginalSrc(img);

    if (!src) return;

    setImagePriority(img, 'low');
    preconnectFromSrc(src);

    if (img.complete && img.naturalWidth > 0) return;

    if (img.dataset.otbasuSoftened === 'true') return;

    img.dataset.otbasuSoftened = 'true';

    if (img.getAttribute('srcset')) {
      img.removeAttribute('srcset');
    }

    img.setAttribute('src', BLANK_SRC);
  }

  function optimizeProductCardImages() {
    const images = Array.from(
      document.querySelectorAll('.product img, .product-media img, [data-gallery-open] img')
    ).filter((img) => !img.closest('.otbasu-photo-viewer'));

    if (!images.length) return;

    images.forEach((img, index) => {
      if (!img || img.dataset.otbasuProductOptimized === 'true') return;

      img.dataset.otbasuProductOptimized = 'true';

      const src = img.getAttribute('src') || img.currentSrc || '';

      if (src) {
        preconnectFromSrc(src);
      }

      if (index <= 1) {
        setImagePriority(img, 'high');
      } else {
        setImagePriority(img, 'low');
      }
    });
  }

  function getGalleryActiveIndex(track) {
    if (!track) return 0;

    return Math.max(
      0,
      Math.round(track.scrollLeft / Math.max(1, track.clientWidth))
    );
  }

  function setupSmartGallery(viewer) {
    if (!viewer || viewer.dataset.otbasuSmartGalleryReady === 'true') return;

    const track = viewer.querySelector('[data-otbasu-photo-track]');

    if (!track) return;

    viewer.dataset.otbasuSmartGalleryReady = 'true';

    const getImages = () => Array.from(track.querySelectorAll('.otbasu-photo-slide img'));

    function hydrateAroundActive() {
      const images = getImages();

      if (!images.length) return;

      const activeIndex = getGalleryActiveIndex(track);

      images.forEach((img, index) => {
        getOriginalSrc(img);

        if (index === activeIndex) {
          hydrateImage(img, 'high');
          return;
        }

        if (Math.abs(index - activeIndex) <= 1) {
          hydrateImage(img, 'high');
          return;
        }

        if (Math.abs(index - activeIndex) === 2) {
          hydrateImage(img, 'low');
          return;
        }

        softenFarGalleryImage(img);
      });

      const next = images[activeIndex + 1];
      const next2 = images[activeIndex + 2];
      const prev = images[activeIndex - 1];

      [next, next2, prev].forEach((img) => {
        const src = getOriginalSrc(img);

        if (src) {
          preloadImage(src);
        }
      });
    }

    let raf = 0;

    function scheduleHydrate() {
      if (raf) cancelAnimationFrame(raf);

      raf = requestAnimationFrame(() => {
        hydrateAroundActive();
      });
    }

    track.addEventListener('scroll', scheduleHydrate, { passive: true });
    track.addEventListener('touchstart', scheduleHydrate, { passive: true });
    track.addEventListener('touchmove', scheduleHydrate, { passive: true });
    track.addEventListener('pointerdown', scheduleHydrate, { passive: true });

    window.setTimeout(hydrateAroundActive, 0);
    window.setTimeout(hydrateAroundActive, 120);
    window.setTimeout(hydrateAroundActive, 420);
  }

  function optimizeOpenedGallery() {
    const viewers = document.querySelectorAll(
      '#otbasuMobilePhotoViewer, .otbasu-photo-viewer'
    );

    viewers.forEach(setupSmartGallery);
  }

  function optimizeAllImages() {
    optimizeProductCardImages();
    optimizeOpenedGallery();
  }

  const observer = new MutationObserver(() => {
    requestAnimationFrame(optimizeAllImages);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(optimizeAllImages, 200);
    window.setTimeout(optimizeAllImages, 800);
    window.setTimeout(optimizeAllImages, 1800);
  });

  document.addEventListener('click', () => {
    window.setTimeout(optimizeAllImages, 120);
    window.setTimeout(optimizeAllImages, 500);
  });

  window.addEventListener('pageshow', optimizeAllImages);

  optimizeAllImages();
})();
