import { escapeHtml, fallbackImage } from './shared.js';

const MAX_INLINE_ZOOM = 2.5;
const CARD_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const carouselCleanups = new WeakMap();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uniqueImages(images = []) {
  return [...new Set(images.map((src) => String(src || '').trim()).filter(Boolean))];
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

function touchCenter(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  };
}

export function getProductCardImages(product = {}) {
  const images = uniqueImages([
    product.imageUrl,
    ...(Array.isArray(product.images) ? product.images : [])
  ]);

  return images.length ? images : [fallbackImage()];
}

export function renderProductCardMedia(product, cardIndex = 0) {
  const images = getProductCardImages(product);
  const title = product.title || 'Товар';
  const hasMultipleImages = images.length > 1;

  return `
    <div
      class="product-media shop-card__media"
      data-gallery-open="${escapeHtml(product.id)}"
      data-card-carousel
      data-card-active-index="0"
      data-card-inline-zoomed="false">
      <div class="shop-card__track" data-card-track aria-label="Фотографии товара ${escapeHtml(title)}">
        ${images.map((src, imageIndex) => {
          const loadEagerly = imageIndex === 0 && cardIndex === 0;
          const fetchPriority = loadEagerly ? 'high' : 'low';
          const initialSource = loadEagerly ? src : CARD_IMAGE_PLACEHOLDER;
          const deferredSource = loadEagerly ? '' : `data-card-src="${escapeHtml(src)}"`;

          return `
            <button
              class="shop-card__slide"
              type="button"
              data-card-slide="${imageIndex}"
              tabindex="${imageIndex === 0 ? '0' : '-1'}"
              ${imageIndex === 0 ? 'aria-current="true"' : 'aria-hidden="true"'}
              aria-label="Открыть фото ${imageIndex + 1} из ${images.length}: ${escapeHtml(title)}">
              <img
                class="photo shop-card__image"
                src="${escapeHtml(initialSource)}"
                ${deferredSource}
                alt="${escapeHtml(imageIndex === 0 ? title : `${title}, фото ${imageIndex + 1}`)}"
                loading="${loadEagerly ? 'eager' : 'lazy'}"
                fetchpriority="${fetchPriority}"
                decoding="async"
                draggable="false">
            </button>`;
        }).join('')}
      </div>
      ${hasMultipleImages ? `
        <button class="shop-card__arrow shop-card__arrow--prev" type="button" data-card-carousel-control="prev" aria-label="Предыдущее фото">‹</button>
        <button class="shop-card__arrow shop-card__arrow--next" type="button" data-card-carousel-control="next" aria-label="Следующее фото">›</button>
        <span class="otbasu-photo-count-badge" data-card-photo-count aria-live="polite">1 / ${images.length}</span>
        <span class="shop-card__position" aria-hidden="true">
          ${images.map((_, imageIndex) => `<i class="${imageIndex === 0 ? 'is-active' : ''}" data-card-position="${imageIndex}"></i>`).join('')}
        </span>
      ` : ''}
    </div>`;
}

function setupCarousel(media) {
  if (media.dataset.cardCarouselReady === 'true') return;

  const track = media.querySelector('[data-card-track]');
  const slides = Array.from(media.querySelectorAll('[data-card-slide]'));
  const images = slides.map((slide) => slide.querySelector('img'));
  const counter = media.querySelector('[data-card-photo-count]');
  const positions = Array.from(media.querySelectorAll('[data-card-position]'));
  const previousButton = media.querySelector('[data-card-carousel-control="prev"]');
  const nextButton = media.querySelector('[data-card-carousel-control="next"]');

  if (!track || !slides.length) return;

  media.dataset.cardCarouselReady = 'true';

  let activeIndex = -1;
  let scrollRaf = 0;
  let navigationTimer = 0;
  let isNearViewport = false;
  let scrollStartLeft = 0;
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  let gesture = null;
  let gestureMoved = false;
  let lastZoomTap = 0;

  const getActiveImage = () => images[activeIndex] || null;

  function suppressOpen(duration = 450) {
    media.dataset.cardSuppressOpenUntil = String(Date.now() + duration);
  }

  function clampPan() {
    const image = getActiveImage();
    if (!image || zoomScale <= 1.01) {
      panX = 0;
      panY = 0;
      return;
    }

    const maxX = image.clientWidth * (zoomScale - 1) / 2;
    const maxY = image.clientHeight * (zoomScale - 1) / 2;
    panX = clamp(panX, -maxX, maxX);
    panY = clamp(panY, -maxY, maxY);
  }

  function applyInlineZoom(withTransition = true) {
    const isZoomed = zoomScale > 1.01;

    clampPan();
    media.classList.toggle('is-inline-zoomed', isZoomed);
    media.dataset.cardInlineZoomed = String(isZoomed);

    images.forEach((image, index) => {
      if (!image) return;
      image.style.transition = withTransition ? 'transform 180ms ease' : 'none';
      image.style.transform = index === activeIndex && isZoomed
        ? `translate3d(${panX}px, ${panY}px, 0) scale(${zoomScale})`
        : '';
      if (index !== activeIndex) image.style.transformOrigin = '';
    });
  }

  function resetInlineZoom(withTransition = true) {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    applyInlineZoom(withTransition);
  }

  function hydrateImage(image, priority = 'low') {
    if (!image) return;

    image.setAttribute('loading', 'eager');
    image.setAttribute('fetchpriority', priority);

    const source = image.dataset.cardSrc;
    if (source) {
      image.src = source;
      delete image.dataset.cardSrc;
    }
  }

  function hydrateNearbyImages() {
    [activeIndex, activeIndex + 1, activeIndex - 1].forEach((index) => {
      const image = images[index];
      hydrateImage(image, index === activeIndex ? 'high' : 'low');
    });
  }

  function prefetchNextImage() {
    const connection = navigator.connection;
    if (!isNearViewport || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
    const activeImage = getActiveImage();
    if (activeImage?.complete && activeImage.naturalWidth > 1 && !activeImage.dataset.cardSrc) {
      hydrateImage(images[activeIndex + 1]);
    }
  }

  function setActiveIndex(index, hydrate = true) {
    const nextIndex = clamp(index, 0, slides.length - 1);
    if (nextIndex === activeIndex) return;
    if (activeIndex >= 0) resetInlineZoom(false);
    activeIndex = nextIndex;
    media.dataset.cardActiveIndex = String(activeIndex);

    if (counter) counter.textContent = `${activeIndex + 1} / ${slides.length}`;
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeIndex;
      slide.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        slide.removeAttribute('aria-hidden');
        slide.setAttribute('aria-current', 'true');
      } else {
        slide.setAttribute('aria-hidden', 'true');
        slide.removeAttribute('aria-current');
      }
    });
    positions.forEach((position, positionIndex) => {
      position.classList.toggle('is-active', positionIndex === activeIndex);
    });
    if (previousButton) previousButton.disabled = activeIndex === 0;
    if (nextButton) nextButton.disabled = activeIndex === slides.length - 1;
    if (hydrate) hydrateNearbyImages();
  }

  function syncIndexFromScroll() {
    scrollRaf = 0;
    setActiveIndex(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
  }

  function requestIndexSync() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(syncIndexFromScroll);
  }

  function scrollToIndex(index) {
    resetInlineZoom(false);
    const nextIndex = clamp(index, 0, slides.length - 1);
    hydrateImage(images[nextIndex], 'high');
    suppressOpen();
    track.scrollTo({ left: nextIndex * track.clientWidth, behavior: 'smooth' });
    window.clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(() => setActiveIndex(nextIndex), 220);
  }

  track.addEventListener('load', (event) => {
    if (event.target === getActiveImage()) prefetchNextImage();
  }, true);

  track.addEventListener('scroll', () => {
    if (Math.abs(track.scrollLeft - scrollStartLeft) > 4) suppressOpen();
    requestIndexSync();
  }, { passive: true });

  track.addEventListener('pointerdown', () => {
    scrollStartLeft = track.scrollLeft;
    hydrateNearbyImages();
  }, { passive: true });

  media.addEventListener('pointerenter', hydrateNearbyImages, { passive: true });
  media.addEventListener('focusin', hydrateNearbyImages, { passive: true });

  previousButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrollToIndex(activeIndex - 1);
  });

  nextButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrollToIndex(activeIndex + 1);
  });

  track.addEventListener('touchstart', (event) => {
    gestureMoved = false;
    hydrateNearbyImages();

    if (event.touches.length >= 2) {
      const image = getActiveImage();
      if (!image) return;
      const center = touchCenter(event.touches);
      const rect = image.getBoundingClientRect();

      image.style.transformOrigin = `${clamp(center.x - rect.left, 0, rect.width)}px ${clamp(center.y - rect.top, 0, rect.height)}px`;
      gesture = {
        type: 'pinch',
        distance: touchDistance(event.touches),
        scale: zoomScale
      };
      suppressOpen(700);
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (zoomScale > 1.01 && event.touches.length === 1) {
      gesture = {
        type: 'pan',
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        panX,
        panY
      };
      suppressOpen(700);
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });

  track.addEventListener('touchmove', (event) => {
    if (!gesture) return;

    if (gesture.type === 'pinch' && event.touches.length >= 2) {
      const distance = touchDistance(event.touches);
      zoomScale = clamp(gesture.scale * distance / Math.max(1, gesture.distance), 1, MAX_INLINE_ZOOM);
      gestureMoved = true;
      applyInlineZoom(false);
      suppressOpen(700);
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (gesture.type === 'pan' && event.touches.length === 1) {
      const dx = event.touches[0].clientX - gesture.x;
      const dy = event.touches[0].clientY - gesture.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) gestureMoved = true;
      panX = gesture.panX + dx;
      panY = gesture.panY + dy;
      applyInlineZoom(false);
      suppressOpen(700);
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });

  track.addEventListener('touchend', (event) => {
    if (!gesture) return;

    if (gesture.type === 'pinch' && event.touches.length < 2) {
      gesture = null;
      if (zoomScale < 1.05) resetInlineZoom();
      else applyInlineZoom();
      suppressOpen(700);
      return;
    }

    if (gesture.type === 'pan' && event.touches.length === 0) {
      const now = Date.now();
      if (!gestureMoved && now - lastZoomTap < 320) {
        resetInlineZoom();
        lastZoomTap = 0;
      } else if (!gestureMoved) {
        lastZoomTap = now;
      }
      gesture = null;
      applyInlineZoom();
      suppressOpen(700);
    }
  }, { passive: true });

  track.addEventListener('touchcancel', () => {
    gesture = null;
    applyInlineZoom();
    suppressOpen();
  }, { passive: true });

  const resizeObserver = new ResizeObserver(() => {
    track.scrollLeft = activeIndex * track.clientWidth;
  });
  resizeObserver.observe(track);

  let nearbyObserver;
  if ('IntersectionObserver' in window) {
    nearbyObserver = new IntersectionObserver(([entry]) => {
      isNearViewport = entry.isIntersecting;
      if (!isNearViewport) return;
      hydrateImage(getActiveImage(), 'high');
      prefetchNextImage();
    }, { rootMargin: '120px 0px' });
    nearbyObserver.observe(media);
  } else {
    images.forEach((image) => hydrateImage(image));
  }

  setActiveIndex(0, false);

  return () => {
    resizeObserver.disconnect();
    nearbyObserver?.disconnect();
    cancelAnimationFrame(scrollRaf);
    window.clearTimeout(navigationTimer);
  };
}

export function setupProductCardCarousels(root = document) {
  const media = [...root.querySelectorAll('[data-card-carousel]')];
  const previous = carouselCleanups.get(root) || new Map();
  const current = new Map();

  previous.forEach((dispose, element) => {
    if (!media.includes(element)) dispose();
  });
  media.forEach((element) => {
    const dispose = previous.get(element) || setupCarousel(element);
    if (dispose) current.set(element, dispose);
  });
  carouselCleanups.set(root, current);
}
