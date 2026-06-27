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
/* =========================================================
   OTBASU — FIX GALLERY MOBILE SWIPE EDGES
   Вставить в самый конец файла src/vitrine.js
   Исправляет:
   - плавный свайп фото влево / вправо
   - упор на первом фото
   - упор на последнем фото
   - защита от случайного закрытия сайта при лишнем свайпе
========================================================= */

(function () {
  const PATCH_KEY = "__otbasu_gallery_edge_swipe_fix_v1__";

  if (window[PATCH_KEY]) return;
  window[PATCH_KEY] = true;

  const SWIPE_MIN = 45;
  const VERTICAL_CLOSE_MIN = 70;
  const HORIZONTAL_LOCK_MIN = 8;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let isDown = false;
  let isHorizontal = false;
  let pointerId = null;
  let moved = false;

  function getGalleryModal() {
    return document.querySelector(
      ".gallery-modal, .photo-modal, .lightbox-modal, [data-gallery-modal]"
    );
  }

  function isGalleryOpen() {
    const modal = getGalleryModal();

    if (!modal) return false;

    const style = window.getComputedStyle(modal);

    const visibleByStyle =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0;

    const visibleByClass =
      modal.classList.contains("open") ||
      modal.classList.contains("active") ||
      modal.classList.contains("is-open") ||
      document.body.classList.contains("gallery-open");

    return visibleByStyle && visibleByClass;
  }

  function getGalleryImage() {
    const modal = getGalleryModal();

    if (!modal) return null;

    return (
      modal.querySelector(".gallery-image") ||
      modal.querySelector(".gallery-main-image") ||
      modal.querySelector(".lightbox-image") ||
      modal.querySelector("img")
    );
  }

  function getGalleryMoveTarget() {
    const modal = getGalleryModal();

    if (!modal) return null;

    return (
      modal.querySelector(".gallery-sheet") ||
      modal.querySelector(".gallery-content") ||
      modal.querySelector(".lightbox-content") ||
      getGalleryImage()
    );
  }

  function getGalleryIndex() {
    try {
      if (typeof galleryState !== "undefined") {
        if (Number.isFinite(galleryState.index)) return galleryState.index;
        if (Number.isFinite(galleryState.currentIndex)) return galleryState.currentIndex;
        if (Number.isFinite(galleryState.activeIndex)) return galleryState.activeIndex;
      }
    } catch (e) {}

    const activeThumb = document.querySelector(
      ".gallery-thumb.active, .gallery-thumb.is-active, [data-gallery-thumb].active"
    );

    if (activeThumb && activeThumb.dataset) {
      const value =
        activeThumb.dataset.index ||
        activeThumb.dataset.galleryIndex ||
        activeThumb.getAttribute("data-index");

      const parsed = Number(value);

      if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
  }

  function getGalleryCount() {
    try {
      if (typeof galleryState !== "undefined") {
        if (Array.isArray(galleryState.images)) return galleryState.images.length;
        if (Array.isArray(galleryState.photos)) return galleryState.photos.length;
        if (Array.isArray(galleryState.items)) return galleryState.items.length;
      }
    } catch (e) {}

    const thumbs = document.querySelectorAll(
      ".gallery-thumb, [data-gallery-thumb], .product-photo-thumb"
    );

    if (thumbs && thumbs.length) return thumbs.length;

    const modal = getGalleryModal();

    if (modal && modal.dataset) {
      const count =
        Number(modal.dataset.count) ||
        Number(modal.dataset.galleryCount) ||
        Number(modal.getAttribute("data-count"));

      if (Number.isFinite(count) && count > 0) return count;
    }

    return 1;
  }

  function isFirstPhoto() {
    return getGalleryIndex() <= 0;
  }

  function isLastPhoto() {
    const count = getGalleryCount();
    return getGalleryIndex() >= count - 1;
  }

  function isBlockedDirection(direction) {
    if (direction < 0 && isFirstPhoto()) return true;
    if (direction > 0 && isLastPhoto()) return true;
    return false;
  }

  function resetVisual() {
    const target = getGalleryMoveTarget();

    if (!target) return;

    target.style.transition = "transform 180ms ease";
    target.style.transform = "translate3d(0, 0, 0)";

    window.setTimeout(function () {
      target.style.transition = "";
    }, 220);
  }

  function softEdgeBounce(direction) {
    const target = getGalleryMoveTarget();

    if (!target) return;

    const bounceX = direction < 0 ? 18 : -18;

    target.style.transition = "transform 120ms ease";
    target.style.transform = "translate3d(" + bounceX + "px, 0, 0)";

    window.setTimeout(function () {
      target.style.transition = "transform 180ms ease";
      target.style.transform = "translate3d(0, 0, 0)";
    }, 90);

    window.setTimeout(function () {
      target.style.transition = "";
    }, 300);
  }

  function moveGallery(direction) {
    if (isBlockedDirection(direction)) {
      softEdgeBounce(direction);
      return;
    }

    try {
      if (typeof shiftGallery === "function") {
        shiftGallery(direction);
        return;
      }
    } catch (e) {}

    const buttonSelector =
      direction > 0
        ? ".gallery-next, [data-gallery-next], .lightbox-next"
        : ".gallery-prev, [data-gallery-prev], .lightbox-prev";

    const button = document.querySelector(buttonSelector);

    if (button) {
      button.click();
    }
  }

  function closeGalleryBySwipe() {
    try {
      if (typeof closeGallery === "function") {
        closeGallery("swipe");
        return;
      }
    } catch (e) {}

    const closeButton = document.querySelector(
      ".gallery-close, [data-gallery-close], .lightbox-close"
    );

    if (closeButton) {
      closeButton.click();
    }
  }

  function lockPageWhenGalleryOpen() {
    if (!document.getElementById("otbasu-gallery-edge-style")) {
      const style = document.createElement("style");

      style.id = "otbasu-gallery-edge-style";
      style.textContent = `
        body.gallery-open,
        body.gallery-dragging {
          overflow: hidden !important;
          overscroll-behavior: none !important;
          touch-action: none !important;
        }

        .gallery-modal,
        .photo-modal,
        .lightbox-modal,
        [data-gallery-modal] {
          overscroll-behavior: none !important;
          touch-action: none !important;
        }

        .gallery-modal img,
        .photo-modal img,
        .lightbox-modal img,
        [data-gallery-modal] img {
          user-select: none !important;
          -webkit-user-drag: none !important;
          -webkit-touch-callout: none !important;
        }
      `;

      document.head.appendChild(style);
    }
  }

  function onPointerDown(event) {
    if (!isGalleryOpen()) return;

    lockPageWhenGalleryOpen();

    isDown = true;
    isHorizontal = false;
    moved = false;
    pointerId = event.pointerId;

    startX = event.clientX;
    startY = event.clientY;
    lastX = startX;
    lastY = startY;

    document.body.classList.add("gallery-dragging");

    if (event.target && event.target.setPointerCapture && pointerId !== null) {
      try {
        event.target.setPointerCapture(pointerId);
      } catch (e) {}
    }
  }

  function onPointerMove(event) {
    if (!isDown || !isGalleryOpen()) return;

    lastX = event.clientX;
    lastY = event.clientY;

    const dx = lastX - startX;
    const dy = lastY - startY;

    if (Math.abs(dx) > HORIZONTAL_LOCK_MIN || Math.abs(dy) > HORIZONTAL_LOCK_MIN) {
      moved = true;
    }

    if (!isHorizontal && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > HORIZONTAL_LOCK_MIN) {
      isHorizontal = true;
    }

    if (!isHorizontal) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const direction = dx < 0 ? 1 : -1;
    const blocked = isBlockedDirection(direction);
    const target = getGalleryMoveTarget();

    if (target) {
      const resistance = blocked ? 0.22 : 0.72;
      const moveX = dx * resistance;

      target.style.transition = "none";
      target.style.transform = "translate3d(" + moveX + "px, 0, 0)";
    }
  }

  function onPointerUp(event) {
    if (!isDown || !isGalleryOpen()) {
      clearPointer();
      return;
    }

    const dx = lastX - startX;
    const dy = lastY - startY;

    const wasHorizontal = isHorizontal || Math.abs(dx) > Math.abs(dy);

    if (wasHorizontal) {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (Math.abs(dx) >= SWIPE_MIN) {
        const direction = dx < 0 ? 1 : -1;
        moveGallery(direction);
      } else {
        resetVisual();
      }

      clearPointer();
      return;
    }

    if (Math.abs(dy) >= VERTICAL_CLOSE_MIN && Math.abs(dy) > Math.abs(dx)) {
      closeGalleryBySwipe();
      clearPointer();
      return;
    }

    resetVisual();
    clearPointer();
  }

  function clearPointer() {
    isDown = false;
    isHorizontal = false;
    moved = false;
    pointerId = null;

    document.body.classList.remove("gallery-dragging");
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", clearPointer, true);

  document.addEventListener(
    "click",
    function (event) {
      if (!isGalleryOpen()) return;

      if (moved) {
        event.preventDefault();
        event.stopImmediatePropagation();
        moved = false;
      }
    },
    true
  );

  lockPageWhenGalleryOpen();
})();
