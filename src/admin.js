import { supabase, isConfigured } from './supabaseClient.js';
import {
  escapeHtml,
  fallbackImage,
  normalizeExternalUrl,
  normalizeStatus,
  normalizeTag,
  statusLabels,
  tagLabels,
  uid
} from './shared.js';
/* OTBASU PRODUCT PHOTO UPLOAD FIX — вставить сразу после import
   Исправляет загрузку фото в карточке товара.
   Не трогает витрину.
*/
const OTBASU_MAX_PRODUCT_PHOTOS = 5;

function otbasuCanvasToBlob(canvas, type = 'image/webp', quality = 0.84) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function otbasuLoadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Не удалось прочитать фото: ${file.name}`));
    };

    image.src = objectUrl;
  });
}

async function otbasuPrepareProductPhoto(file, isCover = false) {
  if (!file?.type?.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;

  try {
    const image = await otbasuLoadImageFromFile(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return file;

    if (isCover) {
      const size = 1080;
      canvas.width = size;
      canvas.height = size;

      ctx.fillStyle = '#fff8ef';
      ctx.fillRect(0, 0, size, size);

      const scale = Math.min(size / image.width, size / image.height);
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      const x = Math.round((size - width) / 2);
      const y = Math.round((size - height) / 2);

      ctx.drawImage(image, x, y, width, height);
    } else {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));

      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }

    let quality = 0.84;
    let blob = await otbasuCanvasToBlob(canvas, 'image/webp', quality);

    while (blob && blob.size > 850 * 1024 && quality > 0.62) {
      quality -= 0.06;
      blob = await otbasuCanvasToBlob(canvas, 'image/webp', quality);
    }

    if (!blob || blob.size >= file.size) return file;

    const cleanName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zа-я0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '');

    return new File([blob], `${cleanName || 'product-photo'}.webp`, {
      type: 'image/webp',
      lastModified: Date.now()
    });
  } catch (error) {
    console.warn('[OTBASU] Фото не удалось подготовить, использую оригинал:', error);
    return file;
  }
}

/* ВАЖНО:
   Этот обработчик стоит сверху файла и срабатывает раньше старого автосжатия.
   Поэтому фото сразу попадают в imageDraft и отображаются в галерее.
*/
document.addEventListener('change', async (event) => {
  const input = event.target;

  if (!(input instanceof HTMLInputElement)) return;
  if (input.type !== 'file') return;
  if (input.name !== 'imageFile') return;
  if (!input.closest('#productForm')) return;

  const files = Array.from(input.files || []).filter((file) => file.type.startsWith('image/'));

  if (!files.length) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const freeSlots = Math.max(0, OTBASU_MAX_PRODUCT_PHOTOS - imageDraft.length);

  if (freeSlots <= 0) {
    input.value = '';
    setStatus('Можно добавить максимум 5 фотографий товара.', 'error');
    return;
  }

  const selectedFiles = files.slice(0, freeSlots);
  const beforeSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  setStatus(`Готовлю фото: ${selectedFiles.length} шт...`);

  try {
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
      const willBeCover = imageDraft.length === 0 && index === 0;
      const preparedFile = await otbasuPrepareProductPhoto(file, willBeCover);

      imageDraft.push({
        id: uid('img'),
        type: 'file',
        file: preparedFile,
        previewUrl: URL.createObjectURL(preparedFile)
      });
    }

    const afterSize = imageDraft
      .filter((item) => item.type === 'file')
      .reduce((sum, item) => sum + (item.file?.size || 0), 0);

    input.value = '';
    renderImageDraft();

    if (files.length > freeSlots) {
      setStatus('Добавлены первые 5 фото. Лишние фото не добавлены.', 'error');
      return;
    }

    if (beforeSize > 0 && afterSize > 0) {
      setStatus('Фото добавлены. Нажми ⭐ для обложки или перетащи фото для порядка.', 'ok');
    } else {
      setStatus('Фото добавлены.', 'ok');
    }
  } catch (error) {
    input.value = '';
    setStatus(`Ошибка фото: ${error.message}`, 'error');
  }
}, true);
const roleLabels = {
  admin: 'Администратор',
  content_manager: 'Контент-менеджер'
};

const analyticsTagLabels = {
  all: 'Все товары',
  hit: 'Хиты',
  new: 'Новинки',
  promo: 'Акции',
  none: 'Без метки'
};

let state = { settings: {}, categories: [], products: [] };
let analyticsEvents = [];
let users = [];
let currentPage = 'dashboard';
let currentUser = null;
let currentProfile = null;
let editingProductId = null;
let imageDraft = [];
let isSaving = false;
let draggedProductId = null;
let draggedImageId = null;

const els = {
  loginScreen: document.getElementById('loginScreen'),
  adminShell: document.getElementById('adminShell'),
  loginForm: document.getElementById('loginForm'),
  logoutButton: document.getElementById('logoutButton'),
  navList: document.getElementById('navList'),
  pageTitle: document.getElementById('pageTitle'),
  pageEyebrow: document.getElementById('pageEyebrow'),
  statusBar: document.getElementById('statusBar'),
  addProductTopButton: document.getElementById('addProductTopButton'),
  quickAddButton: document.getElementById('quickAddButton'),
  addProductButton: document.getElementById('addProductButton'),
  productsTableBody: document.getElementById('productsTableBody'),
  productSearch: document.getElementById('productSearch'),
  productFilter: document.getElementById('productFilter'),
  categoryForm: document.getElementById('categoryForm'),
  categoryList: document.getElementById('categoryList'),
  settingsForm: document.getElementById('settingsForm'),
  productDialog: document.getElementById('productDialog'),
  productForm: document.getElementById('productForm'),
  productDialogMode: document.getElementById('productDialogMode'),
  closeProductDialog: document.getElementById('closeProductDialog'),
  deleteProductButton: document.getElementById('deleteProductButton'),
  saveAndNewButton: document.getElementById('saveAndNewButton'),
  imagePreview: document.getElementById('imagePreview'),
  metricActive: document.getElementById('metricActive'),
  metricHit: document.getElementById('metricHit'),
  metricNew: document.getElementById('metricNew'),
  metricPromo: document.getElementById('metricPromo'),
  metricViews: document.getElementById('metricViews'),
  metricKaspiClicks: document.getElementById('metricKaspiClicks'),
  metricVideoClicks: document.getElementById('metricVideoClicks'),
  metricKaspiCtr: document.getElementById('metricKaspiCtr'),
  analyticsTableBody: document.getElementById('analyticsTableBody'),
  tagAnalytics: document.getElementById('tagAnalytics'),
  analyticsInsights: document.getElementById('analyticsInsights'),
  refreshAnalyticsButton: document.getElementById('refreshAnalyticsButton'),
  resetAnalyticsButton: document.getElementById('resetAnalyticsButton'),
  addImageUrlButton: document.getElementById('addImageUrlButton'),
  imageGalleryList: document.getElementById('imageGalleryList'),
  userForm: document.getElementById('userForm'),
  usersTableBody: document.getElementById('usersTableBody')
};

function setStatus(message, type = '') {
  if (!els.statusBar) return;
  els.statusBar.textContent = message;
  els.statusBar.classList.remove('ok', 'error');
  if (type) els.statusBar.classList.add(type);
}

function setLoginMessage(message, isError = false) {
  let box = document.getElementById('loginMessage');

  if (!box && els.loginForm) {
    box = document.createElement('div');
    box.id = 'loginMessage';
    box.className = 'status-bar';
    els.loginForm.prepend(box);
  }

  if (!box) return;

  box.textContent = message;
  box.classList.toggle('error', Boolean(isError));
  box.classList.toggle('ok', !isError);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function percent(part, total) {
  if (!Number(total)) return '0%';
  return `${Math.round((Number(part || 0) / Number(total || 0)) * 100)}%`;
}

function isAdmin() {
  return currentProfile?.role === 'admin';
}

function canManageContent() {
  return ['admin', 'content_manager'].includes(currentProfile?.role);
}

function normalizeImages(product = {}) {
  const values = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.image_url,
    product.imageUrl
  ];

  const seen = new Set();

  return values.map(normalizeExternalUrl).filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function categoryById(categoryId) {
  return state.categories.find((category) => String(category.id) === String(categoryId)) || null;
}

function productById(productId) {
  return state.products.find((product) => String(product.id) === String(productId)) || null;
}

function activeProducts() {
  return state.products.filter((product) => product.status === 'active');
}

function dbProductToUi(product = {}) {
  const images = normalizeImages(product);

  return {
    id: product.id,
    title: product.title || 'Без названия',
    categoryId: product.category_id || '',
    category: product.category || categoryById(product.category_id)?.name || 'Без категории',
    tag: normalizeTag(product.tag),
    status: normalizeStatus(product.status),
    imageUrl: images[0] || fallbackImage(),
    images,
    kaspiUrl: product.kaspi_url || '',
    videoUrl: product.video_url || '',
    sort: Number.isFinite(Number(product.sort)) ? Number(product.sort) : 100,
    note: product.note || '',
    createdAt: product.created_at || '',
    updatedAt: product.updated_at || ''
  };
}

async function requireSession() {
  if (!isConfigured()) {
    setLoginMessage('Не заданы переменные VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.', true);
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.user) {
    showLogin();
    return;
  }

  currentUser = session.user;
  await loadProfile();

  if (!canManageContent()) {
    await supabase.auth.signOut();
    setLoginMessage('У этого пользователя нет доступа к админке.', true);
    showLogin();
    return;
  }

  openAdmin();
}

async function loadProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) throw error;
  currentProfile = data || null;
}

function showLogin() {
  els.loginScreen?.classList.remove('hidden');
  els.adminShell?.classList.add('hidden');
}

function openAdmin() {
  els.loginScreen?.classList.add('hidden');
  els.adminShell?.classList.remove('hidden');
  applyRoleToUi();
  loadState();
}

function applyRoleToUi() {
  document.querySelectorAll('[data-admin-only]').forEach((node) => {
    node.hidden = !isAdmin();
  });

  if (els.resetAnalyticsButton) {
    els.resetAnalyticsButton.hidden = !isAdmin();
  }

  if (!isAdmin() && ['settings', 'users'].includes(currentPage)) {
    switchPage('dashboard');
  }
}

async function login(event) {
  event.preventDefault();

  if (!isConfigured()) {
    setLoginMessage('Сначала настрой Supabase ENV-переменные.', true);
    return;
  }

  const form = new FormData(els.loginForm);
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');

  setLoginMessage('Проверяю доступ…');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setLoginMessage(`Ошибка входа: ${error.message}`, true);
    return;
  }

  currentUser = data.user;
  await loadProfile();

  if (!canManageContent()) {
    await supabase.auth.signOut();
    setLoginMessage('У этого пользователя нет роли администратора или контент-менеджера.', true);
    return;
  }

  openAdmin();
}

async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  showLogin();
}

async function loadState() {
  setStatus('Загружаю данные из Supabase…');

  try {
    const [
      { data: settings, error: settingsError },
      { data: categories, error: categoriesError },
      { data: products, error: productsError }
    ] = await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('categories').select('*').order('sort', { ascending: true }),
      supabase.from('products').select('*').order('sort', { ascending: true })
    ]);

    if (settingsError) throw settingsError;
    if (categoriesError) throw categoriesError;
    if (productsError) throw productsError;

    state.settings = settings || defaultSettings();
    state.categories = Array.isArray(categories) ? categories : [];
    state.products = Array.isArray(products) ? products.map(dbProductToUi) : [];

    renderAll();
    await loadAnalytics(false);
    if (isAdmin()) await loadUsers(false);

    setStatus('Данные загружены. Можно редактировать витрину.', 'ok');
  } catch (error) {
    setStatus(`Ошибка загрузки данных: ${error.message}`, 'error');
  }
}

function defaultSettings() {
  return {
    id: 1,
    storeName: 'ОТБАСЫ',
    eyebrow: 'Instagram витрина',
    heroTitle: 'Товары для дома и семьи',
    heroButtonText: 'Смотреть товары',
    catalogTitle: 'Популярные товары',
    searchPlaceholder: 'Найти товар из обзора...',
    kaspiStoreUrl: '',
    kaspiStoreTitle: 'Все товары ОТБАСЫ',
    kaspiStoreSubtitle: 'Открыть магазин на Kaspi'
  };
}

function renderAll() {
  renderMetrics();
  renderProducts();
  renderCategories();
  renderSettings();
  renderProductCategoryOptions();
  renderAnalytics();
  if (isAdmin()) renderUsers();
}

function renderMetrics() {
  const active = activeProducts();
  const byTag = (tag) => active.filter((product) => product.tag === tag).length;

  if (els.metricActive) els.metricActive.textContent = formatNumber(active.length);
  if (els.metricHit) els.metricHit.textContent = formatNumber(byTag('hit'));
  if (els.metricNew) els.metricNew.textContent = formatNumber(byTag('new'));
  if (els.metricPromo) els.metricPromo.textContent = formatNumber(byTag('promo'));
}

function filteredProducts() {
  const filter = els.productFilter?.value || 'all';
  const query = String(els.productSearch?.value || '').trim().toLowerCase();

  return state.products.filter((product) => {
    const matchesFilter = filter === 'all' || product.status === filter || product.tag === filter;
    const matchesQuery = !query || [
      product.title,
      product.category,
      product.kaspiUrl,
      product.videoUrl
    ].join(' ').toLowerCase().includes(query);

    return matchesFilter && matchesQuery;
  }).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

function renderProducts() {
  if (!els.productsTableBody) return;

  const items = filteredProducts();

  els.productsTableBody.innerHTML = items.length ? items.map((product, index) => {
    const statusClass = product.status === 'active' ? '' : 'draft';
    const image = product.imageUrl || product.images?.[0] || fallbackImage();

    return `
      <tr class="product-row" draggable="true" data-product-id="${escapeHtml(product.id)}">
        <td class="drag-cell"><span class="drag-handle" title="Перетащить">⋮⋮</span><small>${index + 1}</small></td>
        <td><img class="table-image" src="${escapeHtml(image)}" alt=""></td>
        <td><strong>${escapeHtml(product.title)}</strong><small>${escapeHtml(product.note || '')}</small></td>
        <td>${escapeHtml(product.category)}</td>
        <td>${escapeHtml(tagLabels[product.tag] || product.tag)}</td>
        <td><span class="badge ${statusClass}">${escapeHtml(statusLabels[product.status] || product.status)}</span></td>
        <td><span class="link-flags">${product.videoUrl ? 'Видео' : '—'} / ${product.kaspiUrl ? 'Kaspi' : '—'}</span></td>
        <td><button class="ghost-button compact" data-edit-product="${escapeHtml(product.id)}">Изменить</button></td>
      </tr>`;
  }).join('') : '<tr><td colspan="8">Товаров пока нет.</td></tr>';

  els.productsTableBody.querySelectorAll('[data-edit-product]').forEach((button) => {
    button.addEventListener('click', () => openProductDialog(button.dataset.editProduct));
  });

  bindDragSorting();
}

function bindDragSorting() {
  els.productsTableBody?.querySelectorAll('tr[data-product-id]').forEach((row) => {
    row.addEventListener('dragstart', () => {
      draggedProductId = row.dataset.productId;
      row.classList.add('dragging');
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
    });

    row.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    row.addEventListener('drop', async (event) => {
      event.preventDefault();

      const targetId = row.dataset.productId;

      if (!draggedProductId || draggedProductId === targetId) return;

      const ordered = filteredProducts();
      const from = ordered.findIndex((product) => product.id === draggedProductId);
      const to = ordered.findIndex((product) => product.id === targetId);

      if (from < 0 || to < 0) return;

      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);

      await persistProductOrder(ordered);
    });
  });
}

async function persistProductOrder(ordered) {
  try {
    const updates = ordered.map((product, index) => ({
      id: product.id,
      sort: (index + 1) * 10
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from('products')
        .update({ sort: update.sort })
        .eq('id', update.id);

      if (error) throw error;

      const local = productById(update.id);
      if (local) local.sort = update.sort;
    }

    renderProducts();
    setStatus('Порядок товаров сохранён.', 'ok');
  } catch (error) {
    setStatus(`Не удалось сохранить порядок: ${error.message}`, 'error');
  }
}

function renderCategories() {
  if (!els.categoryList) return;

  const items = [...state.categories].sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));

  els.categoryList.innerHTML = items.length ? items.map((category) => `
    <div class="category-item">
      <strong>${escapeHtml(category.name)}</strong>
      <span>Порядок: ${escapeHtml(category.sort ?? 50)}</span>
      <button class="ghost-button compact danger" data-delete-category="${escapeHtml(category.id)}">Удалить</button>
    </div>
  `).join('') : '<div class="empty-state">Категорий пока нет.</div>';

  els.categoryList.querySelectorAll('[data-delete-category]').forEach((button) => {
    button.addEventListener('click', async () => deleteCategory(button.dataset.deleteCategory));
  });
}

function renderProductCategoryOptions() {
  const select = els.productForm?.elements?.category;

  if (!select) return;

  select.innerHTML = state.categories
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
    .join('');

  if (!select.innerHTML) {
    select.innerHTML = '<option value="">Без категории</option>';
  }
}

function renderSettings() {
  const form = els.settingsForm;

  if (!form) return;

  const settings = { ...defaultSettings(), ...(state.settings || {}) };

  [
    'storeName',
    'eyebrow',
    'heroTitle',
    'heroButtonText',
    'catalogTitle',
    'searchPlaceholder',
    'kaspiStoreUrl',
    'kaspiStoreTitle',
    'kaspiStoreSubtitle'
  ].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = settings[key] || '';
  });
}

async function loadAnalytics(showStatus = true) {
  if (showStatus) setStatus('Обновляю аналитику…');

  try {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString();

    const { data, error } = await supabase
      .from('analytics_events')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (error) throw error;

    analyticsEvents = Array.isArray(data) ? data : [];
    renderAnalytics();

    if (showStatus) setStatus('Аналитика обновлена.', 'ok');
  } catch (error) {
    if (showStatus) setStatus(`Ошибка аналитики: ${error.message}`, 'error');
  }
}

function productEventRows() {
  const rows = new Map();

  activeProducts().forEach((product) => {
    rows.set(product.id, {
      productId: product.id,
      title: product.title,
      tag: product.tag,
      imageUrl: product.imageUrl,
      views: 0,
      videoClicks: 0,
      kaspiClicks: 0
    });
  });

  analyticsEvents.forEach((event) => {
    const productId = event.product_id;

    if (!productId) return;

    if (!rows.has(productId)) {
      rows.set(productId, {
        productId,
        title: 'Удалённый товар',
        tag: 'none',
        imageUrl: fallbackImage(),
        views: 0,
        videoClicks: 0,
        kaspiClicks: 0
      });
    }

    const row = rows.get(productId);

    if (event.event_type === 'product_view') row.views += 1;
    if (event.event_type === 'video_click') row.videoClicks += 1;
    if (event.event_type === 'kaspi_click') row.kaspiClicks += 1;
  });

  return [...rows.values()].sort((a, b) => b.kaspiClicks - a.kaspiClicks || b.views - a.views);
}

function recommendation(row) {
  if (row.kaspiClicks >= 5) return 'Поднять выше / оставить в хитах';
  if (row.views >= 10 && row.kaspiClicks === 0) return 'Проверить цену/ссылку Kaspi или поставить акцию';
  if (row.videoClicks > row.kaspiClicks * 2) return 'Видео интересует — усилить CTA на Kaspi';
  if (!row.views) return 'Нужны показы: поднять или добавить метку';
  return 'Наблюдать';
}

function renderAnalytics() {
  const rows = productEventRows();
  const totalViews = rows.reduce((sum, row) => sum + row.views, 0);
  const totalKaspi = rows.reduce((sum, row) => sum + row.kaspiClicks, 0);
  const totalVideo = rows.reduce((sum, row) => sum + row.videoClicks, 0);

  if (els.metricViews) els.metricViews.textContent = formatNumber(totalViews);
  if (els.metricKaspiClicks) els.metricKaspiClicks.textContent = formatNumber(totalKaspi);
  if (els.metricVideoClicks) els.metricVideoClicks.textContent = formatNumber(totalVideo);
  if (els.metricKaspiCtr) els.metricKaspiCtr.textContent = percent(totalKaspi, totalViews);

  if (els.analyticsTableBody) {
    els.analyticsTableBody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td>
          <div class="analytics-product">
            <img src="${escapeHtml(row.imageUrl || fallbackImage())}" alt="">
            <span>${escapeHtml(row.title)}</span>
          </div>
        </td>
        <td>${escapeHtml(tagLabels[row.tag] || row.tag)}</td>
        <td>${formatNumber(row.views)}</td>
        <td>${formatNumber(row.videoClicks)}</td>
        <td>${formatNumber(row.kaspiClicks)}</td>
        <td>${percent(row.kaspiClicks, row.views)}</td>
        <td>${escapeHtml(recommendation(row))}</td>
      </tr>
    `).join('') : '<tr><td colspan="7">Аналитика появится после просмотров витрины.</td></tr>';
  }

  if (els.tagAnalytics) {
    const groups = ['all', 'hit', 'new', 'promo'].map((tag) => {
      const products = tag === 'all' ? rows : rows.filter((row) => row.tag === tag);

      return {
        tag,
        views: products.reduce((sum, row) => sum + row.views, 0),
        kaspi: products.reduce((sum, row) => sum + row.kaspiClicks, 0)
      };
    });

    els.tagAnalytics.innerHTML = groups.map((group) => `
      <div class="tag-row">
        <strong>${escapeHtml(analyticsTagLabels[group.tag])}</strong>
        <span>${formatNumber(group.views)} просмотров · ${formatNumber(group.kaspi)} Kaspi</span>
      </div>
    `).join('');
  }

  if (els.analyticsInsights) {
    const best = rows[0];
    const stuck = rows.find((row) => row.views >= 10 && row.kaspiClicks === 0);
    const items = [];

    if (best) items.push(`Лучше всего работает: ${best.title}.`);
    if (stuck) items.push(`Застрял товар: ${stuck.title}. Проверь ссылку, фото или поставь акцию.`);
    if (!items.length) items.push('Пока мало данных. Открой витрину и сделай несколько тестовых кликов.');

    els.analyticsInsights.innerHTML = items
      .map((item) => `<div class="insight-item">${escapeHtml(item)}</div>`)
      .join('');
  }
}

async function loadUsers(showStatus = true) {
  if (!isAdmin()) return;

  if (showStatus) setStatus('Загружаю пользователей…');

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    users = Array.isArray(data) ? data : [];
    renderUsers();

    if (showStatus) setStatus('Пользователи загружены.', 'ok');
  } catch (error) {
    if (showStatus) setStatus(`Ошибка загрузки пользователей: ${error.message}`, 'error');
  }
}

function renderUsers() {
  if (!els.usersTableBody) return;

  els.usersTableBody.innerHTML = users.length ? users.map((user) => `
    <tr>
      <td><strong>${escapeHtml(user.full_name || user.email || user.id)}</strong><small>${escapeHtml(user.email || '')}</small></td>
      <td>${escapeHtml(roleLabels[user.role] || user.role)}</td>
      <td>${user.is_active ? 'Активен' : 'Отключён'}</td>
      <td>${user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}</td>
    </tr>
  `).join('') : '<tr><td colspan="4">Пользователей пока нет.</td></tr>';
}

function switchPage(page) {
  if (['settings', 'users'].includes(page) && !isAdmin()) return;

  currentPage = page;

  document.querySelectorAll('.page').forEach((section) => {
    section.classList.toggle('active', section.id === `${page}Page`);
  });

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  const titles = {
    dashboard: ['Instagram витрина', 'Обзор'],
    products: ['Контент', 'Товары'],
    categories: ['Структура', 'Категории'],
    analytics: ['Мониторинг', 'Аналитика'],
    settings: ['Витрина', 'Настройки'],
    users: ['Безопасность', 'Пользователи']
  };

  if (els.pageEyebrow) els.pageEyebrow.textContent = titles[page]?.[0] || 'ОТБАСЫ';
  if (els.pageTitle) els.pageTitle.textContent = titles[page]?.[1] || 'ОТБАСЫ';

  if (page === 'analytics') loadAnalytics(false);
  if (page === 'users') loadUsers(false);
}

function openProductDialog(productId = null) {
  editingProductId = productId;

  const product = productId ? productById(productId) : null;
  const form = els.productForm;

  if (!form) return;

  if (!state.categories.length) {
    setStatus('Сначала добавь хотя бы одну категорию.', 'error');
    switchPage('categories');
    return;
  }

  renderProductCategoryOptions();

  form.reset();

  form.id.value = product?.id || '';
  form.title.value = product?.title || '';
  form.category.value = product?.categoryId || state.categories[0]?.id || '';
  form.tag.value = product?.tag || 'none';
  form.status.value = product?.status || 'active';
  form.kaspiUrl.value = product?.kaspiUrl || '';
  form.videoUrl.value = product?.videoUrl || '';
  form.sort.value = product?.sort || ((state.products.length + 1) * 10);
  form.note.value = product?.note || '';
  form.imageUrl.value = '';

  imageDraft = (product?.images || []).map((url) => ({
    id: uid('img'),
    type: 'url',
    url
  }));

  renderImageDraft();

  if (els.productDialogMode) {
    els.productDialogMode.textContent = product ? 'Редактирование товара' : 'Новый товар';
  }

  if (els.deleteProductButton) {
    els.deleteProductButton.hidden = !product;
  }

  els.productDialog?.showModal();
}

function imageItemSource(item) {
  return item?.type === 'file' ? item.previewUrl : item?.url;
}

function renderImageDraft() {
  const first = imageDraft[0];
  const src = imageItemSource(first);

  if (els.imagePreview) {
    els.imagePreview.innerHTML = src
      ? `<img src="${escapeHtml(src)}" alt="">`
      : '<span>Главное фото</span>';
  }

  if (!els.imageGalleryList) return;

  els.imageGalleryList.innerHTML = imageDraft.length ? imageDraft.map((item, index) => {
    const itemSrc = imageItemSource(item);

    return `
      <div class="gallery-item ${index === 0 ? 'is-cover' : ''}" draggable="true" data-image-id="${escapeHtml(item.id)}">
        <button type="button" class="gallery-star" data-image-cover="${escapeHtml(item.id)}" title="Сделать обложкой">${index === 0 ? '★' : '☆'}</button>
        <button type="button" class="gallery-remove" data-image-remove="${escapeHtml(item.id)}" title="Удалить">×</button>
        <img src="${escapeHtml(itemSrc)}" alt="">
        <div class="gallery-item-meta">
          <strong>${index === 0 ? 'Обложка' : `Фото ${index + 1}`}</strong>
          <span>${item.type === 'file' ? 'файл' : 'URL'} · перетащи для порядка</span>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-state">Фото пока не добавлены.</div>';

  els.imageGalleryList.querySelectorAll('[data-image-cover]').forEach((button) => {
    button.addEventListener('click', () => makeCoverImage(button.dataset.imageCover));
  });

  els.imageGalleryList.querySelectorAll('[data-image-remove]').forEach((button) => {
    button.addEventListener('click', () => removeImage(button.dataset.imageRemove));
  });

  els.imageGalleryList.querySelectorAll('[data-image-id]').forEach((card) => {
    card.addEventListener('dragstart', () => {
      draggedImageId = card.dataset.imageId;
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    card.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    card.addEventListener('drop', (event) => {
      event.preventDefault();

      const targetId = card.dataset.imageId;

      if (!draggedImageId || !targetId || draggedImageId === targetId) return;

      const from = imageDraft.findIndex((item) => item.id === draggedImageId);
      const to = imageDraft.findIndex((item) => item.id === targetId);

      if (from < 0 || to < 0) return;

      const [moved] = imageDraft.splice(from, 1);
      imageDraft.splice(to, 0, moved);

      renderImageDraft();
    });
  });
}

function makeCoverImage(imageId) {
  const index = imageDraft.findIndex((item) => item.id === imageId);

  if (index <= 0) return;

  const [selected] = imageDraft.splice(index, 1);
  imageDraft.unshift(selected);

  renderImageDraft();
}

function removeImage(imageId) {
  imageDraft = imageDraft.filter((item) => item.id !== imageId);
  renderImageDraft();
}

function addUrlImage() {
  const input = els.productForm?.elements?.imageUrl;
  const url = normalizeExternalUrl(input?.value || '');

  if (!url) return;

  const exists = imageDraft.some((item) => item.url === url);

  if (!exists) {
    imageDraft.push({
      id: uid('img'),
      type: 'url',
      url
    });
  }

  if (input) input.value = '';

  renderImageDraft();
}

function addFileImages(files) {
  Array.from(files || []).forEach((file) => {
    if (!file.type.startsWith('image/')) return;

    imageDraft.push({
      id: uid('img'),
      type: 'file',
      file,
      previewUrl: URL.createObjectURL(file)
    });
  });

  renderImageDraft();
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Не удалось прочитать фото: ${file.name}`));
    };

    img.src = url;
  });
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.82) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function compressImageFile(file, isCover = false) {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;

  try {
    const img = await loadImageFromFile(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return file;

    if (isCover) {
      const size = 1080;
      canvas.width = size;
      canvas.height = size;

      ctx.fillStyle = '#fff8ef';
      ctx.fillRect(0, 0, size, size);

      const scale = Math.min(size / img.width, size / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      const x = (size - width) / 2;
      const y = (size - height) / 2;

      ctx.drawImage(img, x, y, width, height);
    } else {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));

      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    let quality = 0.84;
    let blob = await canvasToBlob(canvas, 'image/webp', quality);

    while (blob && blob.size > 850 * 1024 && quality > 0.62) {
      quality -= 0.06;
      blob = await canvasToBlob(canvas, 'image/webp', quality);
    }

    if (!blob || blob.size >= file.size) return file;

    const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zа-я0-9_-]+/gi, '-');
    return new File([blob], `${cleanName || 'photo'}.webp`, {
      type: 'image/webp',
      lastModified: Date.now()
    });
  } catch (error) {
    console.warn('[OTBASU] Не удалось сжать фото:', error);
    return file;
  }
}

async function uploadImage(file, productId, isCover = false) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  if (!allowed.includes(file.type)) {
    throw new Error(`Недопустимый тип файла: ${file.name}`);
  }

  const preparedFile = await compressImageFile(file, isCover);

  if (preparedFile.size > 5 * 1024 * 1024) {
    throw new Error(`Файл больше 5 МБ даже после сжатия: ${file.name}`);
  }

  const ext = (preparedFile.name.split('.').pop() || 'webp')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const path = `products/${productId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from('product-images').upload(path, preparedFile, {
    contentType: preparedFile.type,
    upsert: false
  });

  if (error) throw error;

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);

  return data.publicUrl;
}

async function resolveImageDraft(productId) {
  const urls = [];
  const seen = new Set();

  for (let index = 0; index < imageDraft.length; index += 1) {
    const item = imageDraft[index];

    const url = item.type === 'file'
      ? await uploadImage(item.file, productId, index === 0)
      : normalizeExternalUrl(item.url);

    if (!url || seen.has(url)) continue;

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

async function saveProduct(event, keepOpen = false) {
  event?.preventDefault?.();

  if (isSaving) return;
  if (!canManageContent()) return;

  const form = els.productForm;
  const category = categoryById(form.category.value);
  const productId = form.id.value || crypto.randomUUID();

  isSaving = true;
  setStatus('Сохраняю товар…');

  try {
    const images = await resolveImageDraft(productId);

    const payload = {
      id: productId,
      title: String(form.title.value || '').trim(),
      category_id: category?.id || null,
      category: category?.name || 'Без категории',
      tag: normalizeTag(form.tag.value),
      status: normalizeStatus(form.status.value),
      image_url: images[0] || '',
      images,
      kaspi_url: normalizeExternalUrl(form.kaspiUrl.value),
      video_url: normalizeExternalUrl(form.videoUrl.value),
      sort: Number(form.sort.value || 100),
      note: String(form.note.value || '').trim(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('products')
      .upsert(payload)
      .select('*')
      .single();

    if (error) throw error;

    const uiProduct = dbProductToUi(data);
    const index = state.products.findIndex((item) => item.id === uiProduct.id);

    if (index >= 0) state.products[index] = uiProduct;
    else state.products.push(uiProduct);

    state.products.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));

    renderAll();

    setStatus('Товар сохранён. Витрина обновится автоматически.', 'ok');

    if (keepOpen) openProductDialog(null);
    else els.productDialog?.close();
  } catch (error) {
    setStatus(`Ошибка сохранения товара: ${error.message}`, 'error');
  } finally {
    isSaving = false;
  }
}

async function deleteProduct() {
  if (!editingProductId || !confirm('Удалить товар?')) return;

  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', editingProductId);

    if (error) throw error;

    state.products = state.products.filter((product) => product.id !== editingProductId);

    renderAll();
    els.productDialog?.close();
    setStatus('Товар удалён.', 'ok');
  } catch (error) {
    setStatus(`Не удалось удалить товар: ${error.message}`, 'error');
  }
}

async function saveCategory(event) {
  event.preventDefault();

  const form = event.currentTarget;

  const payload = {
    name: String(form.name.value || '').trim(),
    sort: Number(form.sort.value || 50),
    is_active: true
  };

  if (!payload.name) return;

  try {
    const { data, error } = await supabase
      .from('categories')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    state.categories.push(data);
    state.categories.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));

    form.reset();
    form.sort.value = '50';

    renderCategories();
    renderProductCategoryOptions();

    setStatus('Категория добавлена.', 'ok');
  } catch (error) {
    setStatus(`Ошибка категории: ${error.message}`, 'error');
  }
}

async function deleteCategory(categoryId) {
  if (!confirm('Удалить категорию? Товары в ней останутся с текстовым названием категории.')) return;

  try {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (error) throw error;

    state.categories = state.categories.filter((category) => String(category.id) !== String(categoryId));

    renderCategories();
    renderProductCategoryOptions();

    setStatus('Категория удалена.', 'ok');
  } catch (error) {
    setStatus(`Не удалось удалить категорию: ${error.message}`, 'error');
  }
}

async function saveSettings(event) {
  event.preventDefault();

  if (!isAdmin()) return;

  const form = event.currentTarget;

  const payload = {
    id: 1,
    storeName: form.storeName.value.trim(),
    eyebrow: form.eyebrow.value.trim(),
    heroTitle: form.heroTitle.value.trim(),
    heroButtonText: form.heroButtonText.value.trim(),
    catalogTitle: form.catalogTitle.value.trim(),
    searchPlaceholder: form.searchPlaceholder.value.trim(),
    kaspiStoreUrl: normalizeExternalUrl(form.kaspiStoreUrl.value),
    kaspiStoreTitle: form.kaspiStoreTitle.value.trim(),
    kaspiStoreSubtitle: form.kaspiStoreSubtitle.value.trim(),
    updated_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('settings')
      .upsert(payload)
      .select('*')
      .single();

    if (error) throw error;

    state.settings = data;
    setStatus('Настройки витрины сохранены.', 'ok');
  } catch (error) {
    setStatus(`Ошибка настроек: ${error.message}`, 'error');
  }
}

async function resetAnalytics() {
  if (!isAdmin() || !confirm('Сбросить аналитику?')) return;

  try {
    const { error } = await supabase
      .from('analytics_events')
      .delete()
      .neq('id', 0);

    if (error) throw error;

    analyticsEvents = [];
    renderAnalytics();

    setStatus('Аналитика сброшена.', 'ok');
  } catch (error) {
    setStatus(`Не удалось сбросить аналитику: ${error.message}`, 'error');
  }
}

async function createUser(event) {
  event.preventDefault();

  if (!isAdmin()) return;

  const form = new FormData(els.userForm);

  const payload = {
    fullName: String(form.get('fullName') || '').trim(),
    email: String(form.get('email') || '').trim(),
    password: String(form.get('password') || ''),
    role: String(form.get('role') || 'content_manager')
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();

    const response = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }

    els.userForm.reset();
    await loadUsers(false);

    setStatus('Пользователь создан.', 'ok');
  } catch (error) {
    setStatus(`Не удалось создать пользователя: ${error.message}`, 'error');
  }
}

function bindEvents() {
  els.loginForm?.addEventListener('submit', login);
  els.logoutButton?.addEventListener('click', logout);

  els.navList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (button) switchPage(button.dataset.page);
  });

  [els.addProductTopButton, els.quickAddButton, els.addProductButton].forEach((button) => {
    button?.addEventListener('click', () => openProductDialog(null));
  });

  els.productSearch?.addEventListener('input', renderProducts);
  els.productFilter?.addEventListener('change', renderProducts);

  els.categoryForm?.addEventListener('submit', saveCategory);
  els.settingsForm?.addEventListener('submit', saveSettings);

  els.refreshAnalyticsButton?.addEventListener('click', () => loadAnalytics(true));
  els.resetAnalyticsButton?.addEventListener('click', resetAnalytics);

  els.closeProductDialog?.addEventListener('click', () => els.productDialog?.close());
  els.deleteProductButton?.addEventListener('click', deleteProduct);

  els.productForm?.addEventListener('submit', saveProduct);
  els.saveAndNewButton?.addEventListener('click', (event) => saveProduct(event, true));

  els.addImageUrlButton?.addEventListener('click', addUrlImage);

  els.productForm?.elements?.imageFile?.addEventListener('change', (event) => {
    addFileImages(event.target.files);
    event.target.value = '';
  });

  els.userForm?.addEventListener('submit', createUser);
}

function injectAdminUiFixes() {
  if (document.getElementById('otbasu-admin-final-fixes')) return;

  const style = document.createElement('style');
  style.id = 'otbasu-admin-final-fixes';

  style.textContent = `
    #otbasuPhotoSizeHint,
    .otbasu-photo-size-hint {
      display: none !important;
    }

    .otbasu-sort-controls {
      display: none !important;
    }

    #logoutButton {
      width: auto !important;
      min-width: 104px !important;
      height: 46px !important;
      padding: 0 18px !important;
      border-radius: 999px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      background: rgba(255, 248, 239, .95) !important;
      color: #6b0f46 !important;
      border: 1px solid rgba(123, 18, 79, .18) !important;
      box-shadow: 0 12px 30px rgba(50, 8, 34, .12) !important;
      font-size: 14px !important;
      font-weight: 950 !important;
      white-space: nowrap !important;
      cursor: pointer !important;
    }

    #logoutButton::before {
      content: 'Выйти';
    }

    #logoutButton {
      font-size: 0 !important;
    }

    #logoutButton::before {
      font-size: 14px !important;
    }

    #productDialog {
      width: min(980px, calc(100vw - 28px)) !important;
      max-height: calc(100vh - 20px) !important;
      border: 0 !important;
      border-radius: 30px !important;
      padding: 0 !important;
      background: rgba(255, 248, 239, .98) !important;
      box-shadow: 0 28px 90px rgba(29, 3, 19, .38) !important;
      overflow: hidden !important;
    }

    #productDialog::backdrop {
      background: rgba(21, 3, 15, .72) !important;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    #productDialog .dialog-card,
    #productDialog form {
      padding: 18px 22px !important;
      max-height: calc(100vh - 20px) !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      overflow: hidden !important;
    }

    #productDialog .panel-heading {
      margin-bottom: 0 !important;
    }

    #productDialog .panel-heading h2 {
      font-size: 28px !important;
      line-height: 1.05 !important;
      margin: 0 !important;
    }

    #productDialog .eyebrow {
      font-size: 11px !important;
      margin-bottom: 4px !important;
    }

    #productDialog .product-form-grid {
      flex: 1 !important;
      min-height: 0 !important;
      display: grid !important;
      grid-template-columns: minmax(0, 1.55fr) minmax(290px, .9fr) !important;
      gap: 16px !important;
      overflow: hidden !important;
    }

    #productDialog .form-stack {
      gap: 9px !important;
    }

    #productDialog label {
      font-size: 12px !important;
      gap: 5px !important;
    }

    #productDialog input,
    #productDialog select,
    #productDialog textarea {
      min-height: 42px !important;
      height: 42px !important;
      padding: 10px 14px !important;
      font-size: 13px !important;
      border-radius: 15px !important;
    }

    #productDialog textarea {
      height: 64px !important;
      min-height: 64px !important;
      resize: none !important;
    }

    #productDialog .two-col {
      gap: 10px !important;
    }

    #productDialog .image-box {
      gap: 8px !important;
      align-content: start !important;
    }

    #imagePreview {
      width: 100% !important;
      height: 170px !important;
      min-height: 170px !important;
      max-height: 170px !important;
      border-radius: 20px !important;
      border: 1px dashed rgba(123, 18, 79, .24) !important;
      display: grid !important;
      place-items: center !important;
      overflow: hidden !important;
      background: rgba(255, 255, 255, .74) !important;
      color: rgba(77, 10, 51, .45) !important;
      font-weight: 900 !important;
    }

    #imagePreview img {
      width: 100% !important;
      height: 170px !important;
      object-fit: contain !important;
      object-position: center !important;
      display: block !important;
      background: #fff8ef !important;
    }

    #productDialog .gallery-manager {
      padding: 10px !important;
      border-radius: 18px !important;
    }

    #productDialog .gallery-head {
      margin: 0 0 8px !important;
    }

    #productDialog .gallery-head strong,
    #productDialog .gallery-head span {
      font-size: 12px !important;
    }

    #imageGalleryList {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
      gap: 8px !important;
      max-height: 172px !important;
      overflow-y: auto !important;
      margin-top: 8px !important;
    }

    #imageGalleryList .empty-state {
      grid-column: 1 / -1 !important;
      padding: 12px !important;
      border-radius: 16px !important;
      background: rgba(255,255,255,.68) !important;
      color: rgba(77,10,51,.52) !important;
      font-size: 12px !important;
      font-weight: 800 !important;
    }

    #imageGalleryList .gallery-item {
      position: relative !important;
      min-height: 132px !important;
      border-radius: 16px !important;
      background: rgba(255, 255, 255, .9) !important;
      border: 1px solid rgba(123, 18, 79, .13) !important;
      box-shadow: 0 10px 24px rgba(50, 8, 34, .1) !important;
      overflow: hidden !important;
      cursor: grab !important;
    }

    #imageGalleryList .gallery-item.dragging {
      opacity: .55 !important;
      transform: scale(.98) !important;
    }

    #imageGalleryList .gallery-item.is-cover {
      border: 2px solid #f2a900 !important;
      box-shadow: 0 14px 28px rgba(242, 169, 0, .18) !important;
    }

    #imageGalleryList .gallery-item img {
      width: 100% !important;
      height: 88px !important;
      object-fit: contain !important;
      object-position: center !important;
      display: block !important;
      padding: 6px !important;
      box-sizing: border-box !important;
      background: #fff8ef !important;
    }

    #imageGalleryList .gallery-item-meta {
      padding: 6px 8px !important;
      display: grid !important;
      gap: 2px !important;
    }

    #imageGalleryList .gallery-item-meta strong {
      font-size: 11px !important;
      line-height: 1.1 !important;
      color: #4d0a33 !important;
    }

    #imageGalleryList .gallery-item-meta span {
      font-size: 10px !important;
      line-height: 1.1 !important;
      color: rgba(77, 10, 51, .58) !important;
    }

    .gallery-star,
    .gallery-remove {
      position: absolute !important;
      z-index: 2 !important;
      top: 6px !important;
      width: 28px !important;
      height: 28px !important;
      min-width: 28px !important;
      min-height: 28px !important;
      max-width: 28px !important;
      max-height: 28px !important;
      padding: 0 !important;
      border-radius: 999px !important;
      display: grid !important;
      place-items: center !important;
      border: 0 !important;
      background: white !important;
      box-shadow: 0 8px 18px rgba(0,0,0,.14) !important;
      cursor: pointer !important;
      font-size: 15px !important;
      line-height: 1 !important;
    }

    .gallery-star {
      left: 6px !important;
      color: #f2a900 !important;
    }

    .gallery-remove {
      right: 6px !important;
      color: #991b1b !important;
    }

    .gallery-item.is-cover .gallery-star {
      background: #f2a900 !important;
      color: white !important;
    }

    #productDialog .muted.small {
      font-size: 0 !important;
      line-height: 0 !important;
      margin: 0 !important;
    }

    #productDialog .muted.small::after {
      content: '⭐ — обложка. Перетащи фото мышкой, чтобы изменить порядок.';
      display: block !important;
      font-size: 11px !important;
      line-height: 1.25 !important;
      color: rgba(77, 10, 51, .62) !important;
      margin-top: 2px !important;
    }

    #productDialog .dialog-actions {
      position: sticky !important;
      bottom: 0 !important;
      margin-top: 4px !important;
      padding-top: 10px !important;
      background: rgba(255, 248, 239, .96) !important;
      z-index: 5 !important;
    }

    #productDialog .dialog-actions button {
      min-height: 42px !important;
      height: 42px !important;
      padding: 0 20px !important;
      font-size: 14px !important;
      border-radius: 999px !important;
      font-weight: 900 !important;
    }

    @media (max-width: 900px) {
      #productDialog .dialog-card,
      #productDialog form {
        overflow: auto !important;
      }

      #productDialog .product-form-grid {
        grid-template-columns: 1fr !important;
        overflow: visible !important;
      }
    }
  `;

  document.head.appendChild(style);
}

bindEvents();
injectAdminUiFixes();
requireSession();
/* OTBASU PRODUCT DIALOG PROFESSIONAL UI
   Только окно добавления/редактирования товара.
   Витрину не трогает.
*/
(() => {
  if (window.__OTBASU_PRODUCT_DIALOG_PRO_UI__) return;
  window.__OTBASU_PRODUCT_DIALOG_PRO_UI__ = true;

  function injectProductDialogStyles() {
    if (document.getElementById('otbasu-product-dialog-pro-style')) return;

    const style = document.createElement('style');
    style.id = 'otbasu-product-dialog-pro-style';

    style.textContent = `
      #otbasuPhotoSizeHint,
      .otbasu-photo-size-hint,
      .otbasu-compress-note,
      #addImageUrlButton,
      label:has(input[name="sort"]) {
        display: none !important;
      }

      #productDialog {
        width: min(980px, calc(100vw - 32px)) !important;
        max-height: calc(100vh - 32px) !important;
        border: 0 !important;
        border-radius: 30px !important;
        padding: 0 !important;
        overflow: hidden !important;
        background: rgba(255, 248, 239, .98) !important;
        box-shadow: 0 28px 90px rgba(29, 3, 19, .38) !important;
      }

      #productDialog::backdrop {
        background: rgba(21, 3, 15, .72) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      #productDialog .dialog-card,
      #productDialog form {
        height: min(720px, calc(100vh - 32px)) !important;
        max-height: calc(100vh - 32px) !important;
        padding: 18px 22px !important;
        display: grid !important;
        grid-template-rows: auto minmax(0, 1fr) auto !important;
        gap: 12px !important;
        overflow: hidden !important;
      }

      #productDialog .panel-heading {
        margin: 0 !important;
      }

      #productDialog .panel-heading h2 {
        font-size: 28px !important;
        line-height: 1.05 !important;
        margin: 0 !important;
      }

      #productDialog .eyebrow {
        font-size: 11px !important;
        margin: 0 0 4px !important;
        letter-spacing: .06em !important;
      }

      #productDialog .product-form-grid {
        min-height: 0 !important;
        display: grid !important;
        grid-template-columns: minmax(0, 1.45fr) minmax(320px, .95fr) !important;
        gap: 16px !important;
        overflow: hidden !important;
      }

      #productDialog .form-stack,
      #productDialog .image-box {
        min-height: 0 !important;
        overflow: hidden !important;
      }

      #productDialog .form-stack {
        gap: 9px !important;
      }

      #productDialog .two-col {
        gap: 10px !important;
      }

      #productDialog label {
        font-size: 12px !important;
        gap: 5px !important;
        line-height: 1.25 !important;
      }

      #productDialog input,
      #productDialog select,
      #productDialog textarea {
        height: 40px !important;
        min-height: 40px !important;
        padding: 9px 14px !important;
        font-size: 13px !important;
        border-radius: 15px !important;
      }

      #productDialog textarea {
        height: 58px !important;
        min-height: 58px !important;
        resize: none !important;
      }

      #productDialog .image-box {
        display: grid !important;
        grid-template-rows: auto auto auto auto minmax(0, 1fr) auto !important;
        gap: 8px !important;
        align-content: start !important;
      }

      #imagePreview {
        width: 100% !important;
        height: 205px !important;
        min-height: 205px !important;
        max-height: 205px !important;
        border-radius: 22px !important;
        border: 1px dashed rgba(123, 18, 79, .25) !important;
        display: grid !important;
        place-items: center !important;
        overflow: hidden !important;
        background:
          radial-gradient(circle at 50% 0%, rgba(255, 224, 186, .52), transparent 48%),
          rgba(255, 255, 255, .76) !important;
        color: rgba(77, 10, 51, .45) !important;
        font-weight: 950 !important;
      }

      #imagePreview img {
        width: 100% !important;
        height: 205px !important;
        object-fit: contain !important;
        object-position: center !important;
        display: block !important;
        background: #fff8ef !important;
      }

      #productDialog .gallery-manager {
        padding: 10px !important;
        border-radius: 18px !important;
        min-height: 0 !important;
        overflow: hidden !important;
        background: rgba(255,255,255,.48) !important;
      }

      #productDialog .gallery-head {
        margin: 0 0 8px !important;
      }

      #productDialog .gallery-head strong,
      #productDialog .gallery-head span {
        font-size: 12px !important;
      }

      #imageGalleryList {
        display: grid !important;
        grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
        gap: 8px !important;
        max-height: 150px !important;
        overflow: hidden !important;
        margin-top: 8px !important;
      }

      #imageGalleryList .gallery-slot,
      #imageGalleryList .gallery-item {
        position: relative !important;
        height: 140px !important;
        min-height: 140px !important;
        border-radius: 16px !important;
        overflow: hidden !important;
        background: rgba(255, 255, 255, .9) !important;
        border: 1px solid rgba(123, 18, 79, .14) !important;
        box-shadow: 0 10px 22px rgba(50, 8, 34, .08) !important;
      }

      #imageGalleryList .gallery-slot {
        display: grid !important;
        place-items: center !important;
        color: rgba(77, 10, 51, .34) !important;
        font-size: 18px !important;
        font-weight: 950 !important;
        border-style: dashed !important;
        box-shadow: none !important;
      }

      #imageGalleryList .gallery-item {
        cursor: grab !important;
      }

      #imageGalleryList .gallery-item:active {
        cursor: grabbing !important;
      }

      #imageGalleryList .gallery-item.dragging {
        opacity: .55 !important;
        transform: scale(.98) !important;
      }

      #imageGalleryList .gallery-item.is-cover {
        border: 2px solid #f2a900 !important;
        box-shadow: 0 14px 28px rgba(242, 169, 0, .18) !important;
      }

      #imageGalleryList .gallery-item img {
        width: 100% !important;
        height: 92px !important;
        object-fit: contain !important;
        object-position: center !important;
        display: block !important;
        padding: 6px !important;
        box-sizing: border-box !important;
        background: #fff8ef !important;
      }

      #imageGalleryList .gallery-item-meta {
        padding: 6px 7px !important;
        display: grid !important;
        gap: 2px !important;
      }

      #imageGalleryList .gallery-item-meta strong {
        font-size: 10px !important;
        line-height: 1.05 !important;
        color: #4d0a33 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      #imageGalleryList .gallery-item-meta span {
        display: none !important;
      }

      .gallery-star,
      .gallery-remove {
        position: absolute !important;
        z-index: 3 !important;
        top: 5px !important;
        width: 27px !important;
        height: 27px !important;
        min-width: 27px !important;
        min-height: 27px !important;
        max-width: 27px !important;
        max-height: 27px !important;
        padding: 0 !important;
        border-radius: 999px !important;
        display: grid !important;
        place-items: center !important;
        border: 0 !important;
        background: white !important;
        box-shadow: 0 8px 18px rgba(0,0,0,.14) !important;
        cursor: pointer !important;
        font-size: 15px !important;
        line-height: 1 !important;
      }

      .gallery-star {
        left: 5px !important;
        color: #f2a900 !important;
      }

      .gallery-remove {
        right: 5px !important;
        color: #991b1b !important;
      }

      .gallery-item.is-cover .gallery-star {
        background: #f2a900 !important;
        color: white !important;
      }

      #productDialog .muted.small {
        font-size: 0 !important;
        line-height: 0 !important;
        margin: 0 !important;
      }

      #productDialog .muted.small::after {
        content: 'Можно добавить до 5 фото. ⭐ — обложка. Перетащи фото мышкой, чтобы изменить порядок.';
        display: block !important;
        font-size: 11px !important;
        line-height: 1.25 !important;
        color: rgba(77, 10, 51, .62) !important;
        margin-top: 2px !important;
      }

      #productDialog .dialog-actions {
        position: sticky !important;
        bottom: 0 !important;
        z-index: 10 !important;
        margin: 0 !important;
        padding-top: 10px !important;
        background: rgba(255,248,239,.98) !important;
      }

      #productDialog .dialog-actions button {
        height: 42px !important;
        min-height: 42px !important;
        padding: 0 20px !important;
        font-size: 14px !important;
        border-radius: 999px !important;
        font-weight: 900 !important;
      }

      @media (max-width: 900px) {
        #productDialog .dialog-card,
        #productDialog form {
          height: auto !important;
          overflow: auto !important;
        }

        #productDialog .product-form-grid {
          grid-template-columns: 1fr !important;
          overflow: visible !important;
        }

        #imageGalleryList {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          max-height: none !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function otbasuImageSource(item) {
    return item?.type === 'file' ? item.previewUrl : item?.url;
  }

  function otbasuRenderProductGallery() {
    const first = imageDraft[0];
    const firstSrc = otbasuImageSource(first);

    if (els.imagePreview) {
      els.imagePreview.innerHTML = firstSrc
        ? `<img src="${escapeHtml(firstSrc)}" alt="">`
        : '<span>Главное фото</span>';
    }

    if (!els.imageGalleryList) return;

    const photos = imageDraft.slice(0, OTBASU_MAX_PRODUCT_PHOTOS);

    const photoHtml = photos.map((item, index) => {
      const src = otbasuImageSource(item);

      return `
        <div class="gallery-item ${index === 0 ? 'is-cover' : ''}" draggable="true" data-image-id="${escapeHtml(item.id)}">
          <button type="button" class="gallery-star" data-image-cover="${escapeHtml(item.id)}" title="Сделать обложкой">${index === 0 ? '★' : '☆'}</button>
          <button type="button" class="gallery-remove" data-image-remove="${escapeHtml(item.id)}" title="Удалить">×</button>
          <img src="${escapeHtml(src)}" alt="">
          <div class="gallery-item-meta">
            <strong>${index === 0 ? 'Обложка' : `Фото ${index + 1}`}</strong>
            <span>перетащи</span>
          </div>
        </div>
      `;
    }).join('');

    const emptyHtml = Array.from({ length: Math.max(0, OTBASU_MAX_PRODUCT_PHOTOS - photos.length) })
      .map((_, index) => `<div class="gallery-slot">+${photos.length + index + 1}</div>`)
      .join('');

    els.imageGalleryList.innerHTML = photoHtml + emptyHtml;

    els.imageGalleryList.querySelectorAll('[data-image-cover]').forEach((button) => {
      button.addEventListener('click', () => {
        const imageId = button.dataset.imageCover;
        const index = imageDraft.findIndex((item) => item.id === imageId);

        if (index <= 0) return;

        const [selected] = imageDraft.splice(index, 1);
        imageDraft.unshift(selected);

        otbasuRenderProductGallery();
      });
    });

    els.imageGalleryList.querySelectorAll('[data-image-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const imageId = button.dataset.imageRemove;
        imageDraft = imageDraft.filter((item) => item.id !== imageId);
        otbasuRenderProductGallery();
      });
    });

    els.imageGalleryList.querySelectorAll('.gallery-item[data-image-id]').forEach((card) => {
      card.addEventListener('dragstart', () => {
        draggedImageId = card.dataset.imageId;
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      card.addEventListener('dragover', (event) => {
        event.preventDefault();
      });

      card.addEventListener('drop', (event) => {
        event.preventDefault();

        const targetId = card.dataset.imageId;

        if (!draggedImageId || !targetId || draggedImageId === targetId) return;

        const from = imageDraft.findIndex((item) => item.id === draggedImageId);
        const to = imageDraft.findIndex((item) => item.id === targetId);

        if (from < 0 || to < 0) return;

        const [moved] = imageDraft.splice(from, 1);
        imageDraft.splice(to, 0, moved);

        otbasuRenderProductGallery();
      });
    });
  }

  function patchProductPhotoFunctions() {
    renderImageDraft = otbasuRenderProductGallery;

    addUrlImage = function patchedAddUrlImage() {
      const input = els.productForm?.elements?.imageUrl;
      const url = normalizeExternalUrl(input?.value || '');

      if (!url) return;

      if (imageDraft.length >= OTBASU_MAX_PRODUCT_PHOTOS) {
        setStatus('Можно добавить максимум 5 фотографий товара.', 'error');
        return;
      }

      const exists = imageDraft.some((item) => item.url === url);

      if (!exists) {
        imageDraft.push({
          id: uid('img'),
          type: 'url',
          url
        });
      }

      if (input) input.value = '';

      renderImageDraft();
    };

    addFileImages = function patchedAddFileImages(files) {
      const incoming = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
      const freeSlots = Math.max(0, OTBASU_MAX_PRODUCT_PHOTOS - imageDraft.length);
      const selected = incoming.slice(0, freeSlots);

      selected.forEach((file) => {
        imageDraft.push({
          id: uid('img'),
          type: 'file',
          file,
          previewUrl: URL.createObjectURL(file)
        });
      });

      if (incoming.length > freeSlots) {
        setStatus('Можно добавить максимум 5 фотографий товара.', 'error');
      }

      renderImageDraft();
    };
  }

  function bindUrlInputAutoAdd() {
    const input = els.productForm?.elements?.imageUrl;

    if (!input || input.dataset.otbasuUrlAutoBound === 'true') return;

    input.dataset.otbasuUrlAutoBound = 'true';

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;

      event.preventDefault();
      addUrlImage();
    });

    input.addEventListener('blur', () => {
      if (input.value.trim()) addUrlImage();
    });
  }

  function hideOldButtonAndPrepareDialog() {
    injectProductDialogStyles();
    bindUrlInputAutoAdd();

    const addUrlButton = document.getElementById('addImageUrlButton');
    if (addUrlButton) addUrlButton.hidden = true;
  }

  patchProductPhotoFunctions();
  injectProductDialogStyles();

  document.addEventListener('DOMContentLoaded', () => {
    hideOldButtonAndPrepareDialog();
    window.setTimeout(hideOldButtonAndPrepareDialog, 400);
  });

  document.addEventListener('click', () => {
    window.setTimeout(hideOldButtonAndPrepareDialog, 150);
  });

  window.setTimeout(hideOldButtonAndPrepareDialog, 300);
})();
/* OTBASU PRODUCT DIALOG BIG MODERN VIEW
   Увеличивает окно карточки товара и делает фото заметными.
   Трогает только модальное окно добавления/редактирования товара.
   Витрину не трогает.
*/
(() => {
  if (window.__OTBASU_PRODUCT_DIALOG_BIG_MODERN_VIEW__) return;
  window.__OTBASU_PRODUCT_DIALOG_BIG_MODERN_VIEW__ = true;

  const style = document.createElement('style');
  style.id = 'otbasu-product-dialog-big-modern-view';

  style.textContent = `
    /* Убираем лишнее только внутри карточки товара */
    #otbasuPhotoSizeHint,
    .otbasu-photo-size-hint,
    .otbasu-compress-note,
    #addImageUrlButton,
    label:has(input[name="sort"]) {
      display: none !important;
    }

    /* Больше само окно */
    #productDialog {
      width: min(1220px, calc(100vw - 32px)) !important;
      max-width: 1220px !important;
      max-height: calc(100vh - 28px) !important;
      border: 0 !important;
      border-radius: 34px !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: rgba(255, 248, 239, .985) !important;
      box-shadow: 0 34px 100px rgba(29, 3, 19, .42) !important;
    }

    #productDialog::backdrop {
      background: rgba(21, 3, 15, .72) !important;
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
    }

    /* Внутренний каркас окна */
    #productDialog .dialog-card,
    #productDialog form {
      height: min(820px, calc(100vh - 28px)) !important;
      max-height: calc(100vh - 28px) !important;
      padding: 24px 28px !important;
      display: grid !important;
      grid-template-rows: auto minmax(0, 1fr) auto !important;
      gap: 18px !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }

    #productDialog .panel-heading {
      margin: 0 !important;
      align-items: start !important;
    }

    #productDialog .panel-heading h2 {
      font-size: 34px !important;
      line-height: 1.02 !important;
      margin: 0 !important;
      letter-spacing: -.02em !important;
    }

    #productDialog .eyebrow {
      font-size: 12px !important;
      margin: 0 0 6px !important;
      letter-spacing: .08em !important;
      font-weight: 950 !important;
    }

    /* Две колонки: слева поля, справа фото */
    #productDialog .product-form-grid {
      min-height: 0 !important;
      display: grid !important;
      grid-template-columns: minmax(0, 1.1fr) minmax(500px, .95fr) !important;
      gap: 24px !important;
      overflow: hidden !important;
    }

    #productDialog .form-stack,
    #productDialog .image-box {
      min-height: 0 !important;
      overflow: hidden !important;
    }

    #productDialog .form-stack {
      gap: 12px !important;
    }

    #productDialog .two-col {
      gap: 12px !important;
    }

    #productDialog label {
      font-size: 12px !important;
      gap: 6px !important;
      line-height: 1.25 !important;
      font-weight: 900 !important;
    }

    #productDialog input,
    #productDialog select,
    #productDialog textarea {
      height: 44px !important;
      min-height: 44px !important;
      padding: 11px 16px !important;
      font-size: 14px !important;
      border-radius: 16px !important;
      box-sizing: border-box !important;
    }

    #productDialog textarea {
      height: 74px !important;
      min-height: 74px !important;
      resize: none !important;
    }

    /* Правая часть с фото */
    #productDialog .image-box {
      display: grid !important;
      grid-template-rows: auto auto auto minmax(0, 1fr) auto !important;
      gap: 11px !important;
      align-content: start !important;
    }

    /* Главное фото крупнее */
    #imagePreview {
      width: 100% !important;
      height: 285px !important;
      min-height: 285px !important;
      max-height: 285px !important;
      border-radius: 26px !important;
      border: 1px dashed rgba(123, 18, 79, .26) !important;
      display: grid !important;
      place-items: center !important;
      overflow: hidden !important;
      background:
        radial-gradient(circle at 50% 0%, rgba(255, 224, 186, .6), transparent 48%),
        rgba(255, 255, 255, .78) !important;
      color: rgba(77, 10, 51, .42) !important;
      font-size: 17px !important;
      font-weight: 950 !important;
    }

    #imagePreview img {
      width: 100% !important;
      height: 285px !important;
      object-fit: contain !important;
      object-position: center !important;
      display: block !important;
      background: #fff8ef !important;
    }

    /* Поле URL компактно */
    #productDialog label:has(input[name="imageUrl"]) {
      margin-top: 0 !important;
    }

    /* Блок фотографий товара */
    #productDialog .gallery-manager {
      padding: 14px !important;
      border-radius: 24px !important;
      min-height: 0 !important;
      overflow: hidden !important;
      background:
        linear-gradient(180deg, rgba(255,255,255,.72), rgba(255,248,239,.78)) !important;
      border: 1px solid rgba(123, 18, 79, .12) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.7) !important;
    }

    #productDialog .gallery-head {
      margin: 0 0 12px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 10px !important;
    }

    #productDialog .gallery-head strong {
      font-size: 14px !important;
      font-weight: 950 !important;
      color: #4d0a33 !important;
    }

    #productDialog .gallery-head span {
      font-size: 12px !important;
      font-weight: 900 !important;
      color: rgba(77, 10, 51, .62) !important;
    }

    /* 5 фото крупнее, чтобы реально было видно */
    #imageGalleryList {
      display: grid !important;
      grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
      gap: 10px !important;
      max-height: 205px !important;
      overflow: hidden !important;
      margin-top: 0 !important;
      padding-bottom: 2px !important;
    }

    #imageGalleryList .gallery-slot,
    #imageGalleryList .gallery-item {
      position: relative !important;
      height: 195px !important;
      min-height: 195px !important;
      border-radius: 20px !important;
      overflow: hidden !important;
      background: rgba(255, 255, 255, .92) !important;
      border: 1px solid rgba(123, 18, 79, .14) !important;
      box-shadow: 0 12px 26px rgba(50, 8, 34, .09) !important;
      box-sizing: border-box !important;
    }

    #imageGalleryList .gallery-slot {
      display: grid !important;
      place-items: center !important;
      color: rgba(77, 10, 51, .3) !important;
      font-size: 22px !important;
      font-weight: 950 !important;
      border-style: dashed !important;
      box-shadow: none !important;
      background: rgba(255,255,255,.48) !important;
    }

    #imageGalleryList .gallery-item {
      cursor: grab !important;
      transition:
        transform 150ms ease,
        box-shadow 150ms ease,
        border-color 150ms ease !important;
    }

    #imageGalleryList .gallery-item:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 18px 34px rgba(50, 8, 34, .14) !important;
    }

    #imageGalleryList .gallery-item:active {
      cursor: grabbing !important;
    }

    #imageGalleryList .gallery-item.dragging {
      opacity: .55 !important;
      transform: scale(.98) !important;
    }

    #imageGalleryList .gallery-item.is-cover {
      border: 2px solid #f2a900 !important;
      box-shadow: 0 18px 36px rgba(242, 169, 0, .22) !important;
    }

    #imageGalleryList .gallery-item img {
      width: 100% !important;
      height: 142px !important;
      object-fit: contain !important;
      object-position: center !important;
      display: block !important;
      padding: 8px !important;
      box-sizing: border-box !important;
      background:
        radial-gradient(circle at 50% 0%, rgba(255, 224, 186, .38), transparent 45%),
        #fff8ef !important;
    }

    #imageGalleryList .gallery-item-meta {
      padding: 8px 9px !important;
      display: grid !important;
      gap: 2px !important;
      background: rgba(255,255,255,.82) !important;
    }

    #imageGalleryList .gallery-item-meta strong {
      font-size: 12px !important;
      line-height: 1.1 !important;
      color: #4d0a33 !important;
      font-weight: 950 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    #imageGalleryList .gallery-item-meta span {
      display: none !important;
    }

    .gallery-star,
    .gallery-remove {
      position: absolute !important;
      z-index: 3 !important;
      top: 8px !important;
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      max-width: 32px !important;
      max-height: 32px !important;
      padding: 0 !important;
      border-radius: 999px !important;
      display: grid !important;
      place-items: center !important;
      border: 0 !important;
      background: white !important;
      box-shadow: 0 9px 20px rgba(0,0,0,.16) !important;
      cursor: pointer !important;
      font-size: 17px !important;
      line-height: 1 !important;
    }

    .gallery-star {
      left: 8px !important;
      color: #f2a900 !important;
    }

    .gallery-remove {
      right: 8px !important;
      color: #991b1b !important;
    }

    .gallery-item.is-cover .gallery-star {
      background: #f2a900 !important;
      color: white !important;
    }

    /* Подсказка короче */
    #productDialog .muted.small {
      font-size: 0 !important;
      line-height: 0 !important;
      margin: 0 !important;
    }

    #productDialog .muted.small::after {
      content: 'До 5 фото. ⭐ — обложка. Перетащи фото мышкой, чтобы изменить порядок.';
      display: block !important;
      font-size: 12px !important;
      line-height: 1.25 !important;
      color: rgba(77, 10, 51, .62) !important;
      margin-top: 4px !important;
      font-weight: 800 !important;
    }

    /* Кнопки всегда внизу */
    #productDialog .dialog-actions {
      position: sticky !important;
      bottom: 0 !important;
      z-index: 10 !important;
      margin: 0 !important;
      padding-top: 12px !important;
      background: rgba(255,248,239,.985) !important;
    }

    #productDialog .dialog-actions button {
      height: 46px !important;
      min-height: 46px !important;
      padding: 0 24px !important;
      font-size: 15px !important;
      border-radius: 999px !important;
      font-weight: 950 !important;
    }

    @media (max-width: 1100px) {
      #productDialog {
        width: min(980px, calc(100vw - 24px)) !important;
      }

      #productDialog .product-form-grid {
        grid-template-columns: minmax(0, 1fr) minmax(420px, .9fr) !important;
      }

      #imageGalleryList .gallery-slot,
      #imageGalleryList .gallery-item {
        height: 170px !important;
        min-height: 170px !important;
      }

      #imageGalleryList .gallery-item img {
        height: 120px !important;
      }
    }

    @media (max-width: 900px) {
      #productDialog .dialog-card,
      #productDialog form {
        height: auto !important;
        overflow: auto !important;
      }

      #productDialog .product-form-grid {
        grid-template-columns: 1fr !important;
        overflow: visible !important;
      }

      #imageGalleryList {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        max-height: none !important;
      }
    }
  `;

  document.head.appendChild(style);
})();
