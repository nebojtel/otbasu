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
/* MOBILE SWIPE FIX: свайп фото в галерее товара */
(() => {
  const modal = document.getElementById('galleryModal');
  const image = document.querySelector('.gallery-image');
  const stage = document.querySelector('.gallery-stage');
  const prevBtn = document.querySelector('[data-gallery-prev]');
  const nextBtn = document.querySelector('[data-gallery-next]');

  if (!modal || !image || !stage || !prevBtn || !nextBtn) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let startTime = 0;
  let moved = false;

  const isGalleryOpen = () => modal.getAttribute('aria-hidden') === 'false';

  function resetImage() {
    image.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms ease';
    image.style.transform = 'translate3d(0,0,0) scale(1)';
    image.style.opacity = '1';

    window.setTimeout(() => {
      image.style.transition = '';
    }, 240);
  }

  function startSwipe(event) {
    if (!isGalleryOpen()) return;
    if (event.pointerType && event.pointerType === 'mouse') return;
    if (event.target.closest('button, a')) return;

    isDragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    currentX = event.clientX;
    startTime = Date.now();

    image.style.transition = 'none';

    try {
      stage.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  function moveSwipe(event) {
    if (!isDragging || !isGalleryOpen()) return;

    currentX = event.clientX;

    const diffX = currentX - startX;
    const diffY = event.clientY - startY;
    const horizontalMove = Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 8;

    if (!horizontalMove) return;

    moved = true;

    if (event.cancelable) {
      event.preventDefault();
    }

    const limitedX = Math.max(-110, Math.min(110, diffX));
    const opacity = 1 - Math.min(Math.abs(limitedX) / 520, 0.18);
    const scale = 1 - Math.min(Math.abs(limitedX) / 1800, 0.035);

    image.style.transform = `translate3d(${limitedX}px,0,0) scale(${scale})`;
    image.style.opacity = String(opacity);
  }

  function endSwipe(event) {
    if (!isDragging || !isGalleryOpen()) return;

    const diffX = currentX - startX;
    const diffY = event.clientY - startY;
    const time = Date.now() - startTime;

    isDragging = false;

    const normalSwipe = Math.abs(diffX) > 55 && Math.abs(diffX) > Math.abs(diffY) * 1.25;
    const quickSwipe = Math.abs(diffX) > 30 && time < 230 && Math.abs(diffX) > Math.abs(diffY);

    resetImage();

    if (normalSwipe || quickSwipe) {
      if (diffX < 0) {
        nextBtn.click();
      } else {
        prevBtn.click();
      }

      if ('vibrate' in navigator) {
        navigator.vibrate(8);
      }
    }

    window.setTimeout(() => {
      moved = false;
    }, 260);
  }

  function cancelSwipe() {
    isDragging = false;
    moved = false;
    resetImage();
  }

  if ('PointerEvent' in window) {
    stage.addEventListener('pointerdown', startSwipe, { passive: true });
    stage.addEventListener('pointermove', moveSwipe, { passive: false });
    stage.addEventListener('pointerup', endSwipe, { passive: true });
    stage.addEventListener('pointercancel', cancelSwipe, { passive: true });
  } else {
    stage.addEventListener('touchstart', (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      startSwipe({
        clientX: touch.clientX,
        clientY: touch.clientY,
        target: event.target
      });
    }, { passive: true });

    stage.addEventListener('touchmove', (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      moveSwipe({
        clientX: touch.clientX,
        clientY: touch.clientY,
        cancelable: event.cancelable,
        preventDefault: () => event.preventDefault()
      });
    }, { passive: false });

    stage.addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      endSwipe({
        clientX: touch.clientX,
        clientY: touch.clientY
      });
    }, { passive: true });

    stage.addEventListener('touchcancel', cancelSwipe, { passive: true });
  }

  stage.addEventListener('click', (event) => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
})();
/* OTBASU GALLERY LUXE: свайп влево/вправо + закрытие вверх/вниз + плавное открытие */
(() => {
  const modal = document.querySelector('#galleryModal, .gallery-modal, [data-gallery-modal]');
  if (!modal || modal.dataset.otbasuGalleryLuxe === '1') return;

  modal.dataset.otbasuGalleryLuxe = '1';

  let launchRect = null;

  document.addEventListener('click', (event) => {
    const opener = event.target.closest?.('[data-gallery-open]');
    if (!opener) return;

    const img = opener.tagName === 'IMG' ? opener : opener.querySelector('img');
    const node = img || opener;
    const rect = node.getBoundingClientRect();

    launchRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2
    };
  }, true);

  const getStage = () =>
    modal.querySelector('.gallery-stage, [data-gallery-stage]') ||
    modal.querySelector('.gallery-sheet') ||
    modal;

  const getImage = () =>
    modal.querySelector('.gallery-image, [data-gallery-image], .gallery-stage img, .gallery-sheet img, img');

  const getDots = () =>
    Array.from(modal.querySelectorAll('.gallery-dots button, [data-gallery-dot], .gallery-dot'));

  const getPrevButton = () =>
    modal.querySelector('[data-gallery-prev], .gallery-prev, .gallery-nav-prev');

  const getNextButton = () =>
    modal.querySelector('[data-gallery-next], .gallery-next, .gallery-nav-next');

  const getCloseButton = () =>
    modal.querySelector('[data-gallery-close], .gallery-close');

  const isOpen = () => {
    const hidden = modal.getAttribute('aria-hidden');
    return hidden !== 'true' && !modal.hidden && getComputedStyle(modal).display !== 'none';
  };

  const getPoint = (event) => {
    if (event.touches && event.touches[0]) return event.touches[0];
    if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0];
    return event;
  };

  const getCurrentIndex = () => {
    const dots = getDots();
    const activeIndex = dots.findIndex((dot) =>
      dot.classList.contains('active') ||
      dot.classList.contains('is-active') ||
      dot.getAttribute('aria-selected') === 'true'
    );

    if (activeIndex >= 0) return activeIndex;

    const counter = modal.querySelector('.gallery-counter, [data-gallery-counter]');
    const match = counter?.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
    return match ? Math.max(0, Number(match[1]) - 1) : 0;
  };

  const goToPhoto = (direction) => {
    const dots = getDots();

    if (dots.length > 1) {
      const current = getCurrentIndex();
      const next = (current + direction + dots.length) % dots.length;
      dots[next]?.click();
      return;
    }

    const btn = direction > 0 ? getNextButton() : getPrevButton();

    if (btn) {
      btn.click();
      return;
    }

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: direction > 0 ? 'ArrowRight' : 'ArrowLeft',
        bubbles: true
      })
    );
  };

  const clearImageAnimation = () => {
    const image = getImage();
    if (!image) return;

    image.style.transition = '';
    image.style.transform = '';
    image.style.opacity = '';
    image.style.borderRadius = '';
  };

  const resetImage = () => {
    const image = getImage();
    if (!image) return;

    image.style.transition = 'transform 240ms cubic-bezier(.2,.9,.2,1), opacity 220ms ease';
    image.style.transform = 'translate3d(0,0,0) scale(1)';
    image.style.opacity = '1';

    window.setTimeout(clearImageAnimation, 260);
  };

  const animateOpen = () => {
    if (!isOpen()) return;

    modal.classList.add('otbasu-gallery-luxe-open');
    modal.style.opacity = '1';

    const image = getImage();
    if (!image) return;

    requestAnimationFrame(() => {
      const rect = image.getBoundingClientRect();

      if (!launchRect || !rect.width || !rect.height) {
        image.style.transition = 'transform 420ms cubic-bezier(.16,1,.3,1), opacity 320ms ease';
        image.style.transform = 'scale(1)';
        image.style.opacity = '1';
        return;
      }

      const dx = launchRect.cx - (rect.left + rect.width / 2);
      const dy = launchRect.cy - (rect.top + rect.height / 2);
      const scale = Math.max(
        0.12,
        Math.min(1, Math.min(launchRect.width / rect.width, launchRect.height / rect.height))
      );

      image.style.transition = 'none';
      image.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
      image.style.opacity = '0.48';
      image.style.borderRadius = '26px';

      requestAnimationFrame(() => {
        image.style.transition =
          'transform 460ms cubic-bezier(.16,1,.3,1), opacity 360ms ease, border-radius 460ms ease';
        image.style.transform = 'translate3d(0,0,0) scale(1)';
        image.style.opacity = '1';
        image.style.borderRadius = '0px';

        window.setTimeout(clearImageAnimation, 500);
      });
    });
  };

  const closeGalleryWithSwipe = (directionY) => {
    const image = getImage();
    const closeBtn = getCloseButton();

    modal.classList.add('otbasu-gallery-luxe-closing');
    modal.style.transition = 'opacity 210ms ease';
    modal.style.opacity = '0';

    if (image) {
      image.style.transition = 'transform 220ms cubic-bezier(.2,.9,.2,1), opacity 180ms ease';
      image.style.transform = `translate3d(0, ${directionY * 170}px, 0) scale(0.86)`;
      image.style.opacity = '0';
    }

    window.setTimeout(() => {
      if (closeBtn) {
        closeBtn.click();
      } else {
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('gallery-open');
      }

      modal.classList.remove('otbasu-gallery-luxe-closing');
      modal.style.transition = '';
      modal.style.opacity = '';

      clearImageAnimation();
    }, 190);
  };

  const animateHorizontalChange = (direction) => {
    const image = getImage();

    if (!image) {
      goToPhoto(direction);
      return;
    }

    image.style.transition = 'transform 150ms cubic-bezier(.2,.9,.2,1), opacity 150ms ease';
    image.style.transform = `translate3d(${direction > 0 ? -155 : 155}px, 0, 0) scale(0.94)`;
    image.style.opacity = '0.2';

    window.setTimeout(() => {
      goToPhoto(direction);

      const nextImage = getImage();
      if (!nextImage) return;

      nextImage.style.transition = 'none';
      nextImage.style.transform = `translate3d(${direction > 0 ? 90 : -90}px, 0, 0) scale(0.98)`;
      nextImage.style.opacity = '0.65';

      requestAnimationFrame(() => {
        nextImage.style.transition = 'transform 260ms cubic-bezier(.16,1,.3,1), opacity 220ms ease';
        nextImage.style.transform = 'translate3d(0,0,0) scale(1)';
        nextImage.style.opacity = '1';

        window.setTimeout(clearImageAnimation, 280);
      });
    }, 110);
  };

  let dragging = false;
  let mode = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let startTime = 0;
  let moved = false;

  const start = (event) => {
    if (!isOpen()) return;
    if (event.target.closest?.('button, a, input, textarea, select')) return;

    const point = getPoint(event);
    if (!point) return;

    dragging = true;
    mode = null;
    moved = false;

    startX = point.clientX;
    startY = point.clientY;
    currentX = point.clientX;
    currentY = point.clientY;
    startTime = Date.now();

    const image = getImage();
    if (image) image.style.transition = 'none';

    document.body.classList.add('otbasu-gallery-touching');

    event.stopPropagation();
  };

  const move = (event) => {
    if (!dragging || !isOpen()) return;

    const point = getPoint(event);
    if (!point) return;

    currentX = point.clientX;
    currentY = point.clientY;

    const diffX = currentX - startX;
    const diffY = currentY - startY;

    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);

    if (!mode && Math.max(absX, absY) > 10) {
      if (absX > absY * 1.15) mode = 'horizontal';
      else if (absY > absX * 1.05) mode = 'vertical';
    }

    if (!mode) return;

    moved = true;

    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();

    const image = getImage();
    if (!image) return;

    if (mode === 'horizontal') {
      const limitedX = Math.max(-145, Math.min(145, diffX));
      const progress = Math.min(Math.abs(limitedX) / 145, 1);

      image.style.transform = `translate3d(${limitedX}px, 0, 0) scale(${1 - progress * 0.035})`;
      image.style.opacity = String(1 - progress * 0.16);
    }

    if (mode === 'vertical') {
      const limitedY = Math.max(-230, Math.min(230, diffY));
      const progress = Math.min(Math.abs(limitedY) / 230, 1);

      image.style.transform = `translate3d(0, ${limitedY}px, 0) scale(${1 - progress * 0.11})`;
      image.style.opacity = String(1 - progress * 0.58);
      modal.style.opacity = String(1 - progress * 0.22);
    }
  };

  const end = (event) => {
    if (!dragging || !isOpen()) return;

    const point = getPoint(event) || {};
    currentX = point.clientX ?? currentX;
    currentY = point.clientY ?? currentY;

    const diffX = currentX - startX;
    const diffY = currentY - startY;

    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);

    const time = Date.now() - startTime;

    dragging = false;
    document.body.classList.remove('otbasu-gallery-touching');

    event.stopImmediatePropagation();

    const strongHorizontal = mode === 'horizontal' && absX > 56 && absX > absY * 1.18;
    const fastHorizontal = mode === 'horizontal' && absX > 32 && time < 240 && absX > absY;

    const strongVertical = mode === 'vertical' && absY > 76 && absY > absX * 1.08;
    const fastVertical = mode === 'vertical' && absY > 42 && time < 240 && absY > absX;

    if (strongVertical || fastVertical) {
      closeGalleryWithSwipe(diffY < 0 ? -1 : 1);
    } else if (strongHorizontal || fastHorizontal) {
      animateHorizontalChange(diffX < 0 ? 1 : -1);

      if ('vibrate' in navigator) {
        navigator.vibrate(7);
      }
    } else {
      modal.style.transition = 'opacity 180ms ease';
      modal.style.opacity = '1';
      resetImage();

      window.setTimeout(() => {
        modal.style.transition = '';
      }, 200);
    }

    window.setTimeout(() => {
      moved = false;
      mode = null;
    }, 280);
  };

  const cancel = () => {
    dragging = false;
    moved = false;
    mode = null;
    document.body.classList.remove('otbasu-gallery-touching');
    modal.style.opacity = '1';
    resetImage();
  };

  const stage = getStage();

  if ('PointerEvent' in window) {
    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      start(event);
    }, { capture: true, passive: true });

    stage.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') return;
      move(event);
    }, { capture: true, passive: false });

    stage.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse') return;
      end(event);
    }, { capture: true, passive: false });

    stage.addEventListener('pointercancel', cancel, { capture: true, passive: true });
  } else {
    stage.addEventListener('touchstart', start, { capture: true, passive: true });
    stage.addEventListener('touchmove', move, { capture: true, passive: false });
    stage.addEventListener('touchend', end, { capture: true, passive: false });
    stage.addEventListener('touchcancel', cancel, { capture: true, passive: true });
  }

  modal.addEventListener('click', (event) => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  const observer = new MutationObserver(() => {
    if (isOpen()) {
      window.setTimeout(animateOpen, 20);
    } else {
      modal.classList.remove('otbasu-gallery-luxe-open');
      modal.style.opacity = '';
      clearImageAnimation();
    }
  });

  observer.observe(modal, {
    attributes: true,
    attributeFilter: ['aria-hidden', 'hidden', 'style', 'class']
  });
})();
