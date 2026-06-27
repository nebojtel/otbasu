import { supabase, isConfigured } from './supabaseClient.js';
import { escapeHtml, fallbackImage, normalizeExternalUrl, normalizeStatus, normalizeTag, statusLabels, tagLabels, uid } from './shared.js';

const roleLabels = { admin: 'Администратор', content_manager: 'Контент-менеджер' };
const analyticsTagLabels = { all: 'Все товары', hit: 'Хиты', new: 'Новинки', promo: 'Акции', none: 'Без метки' };

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

function categoryById(categoryId) {
  return state.categories.find((category) => String(category.id) === String(categoryId)) || null;
}

function productById(productId) {
  return state.products.find((product) => String(product.id) === String(productId)) || null;
}

function activeProducts() {
  return state.products.filter((product) => product.status === 'active');
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
  if (els.resetAnalyticsButton) els.resetAnalyticsButton.hidden = !isAdmin();
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
    const [{ data: settings, error: settingsError }, { data: categories, error: categoriesError }, { data: products, error: productsError }] = await Promise.all([
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
    const matchesQuery = !query || [product.title, product.category, product.kaspiUrl, product.videoUrl].join(' ').toLowerCase().includes(query);
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
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (event) => event.preventDefault());
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
    const updates = ordered.map((product, index) => ({ id: product.id, sort: (index + 1) * 10 }));
    for (const update of updates) {
      const { error } = await supabase.from('products').update({ sort: update.sort }).eq('id', update.id);
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
    </div>`).join('') : '<div class="empty-state">Категорий пока нет.</div>';

  els.categoryList.querySelectorAll('[data-delete-category]').forEach((button) => {
    button.addEventListener('click', async () => deleteCategory(button.dataset.deleteCategory));
  });
}

function renderProductCategoryOptions() {
  const select = els.productForm?.elements?.category;
  if (!select) return;
  select.innerHTML = state.categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  if (!select.innerHTML) select.innerHTML = '<option value="">Без категории</option>';
}

function renderSettings() {
  const form = els.settingsForm;
  if (!form) return;
  const settings = { ...defaultSettings(), ...(state.settings || {}) };
  ['storeName', 'eyebrow', 'heroTitle', 'heroButtonText', 'catalogTitle', 'searchPlaceholder', 'kaspiStoreUrl', 'kaspiStoreTitle', 'kaspiStoreSubtitle'].forEach((key) => {
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
  activeProducts().forEach((product) => rows.set(product.id, {
    productId: product.id,
    title: product.title,
    tag: product.tag,
    imageUrl: product.imageUrl,
    views: 0,
    videoClicks: 0,
    kaspiClicks: 0
  }));

  analyticsEvents.forEach((event) => {
    const productId = event.product_id;
    if (!productId) return;
    if (!rows.has(productId)) {
      rows.set(productId, { productId, title: 'Удалённый товар', tag: 'none', imageUrl: fallbackImage(), views: 0, videoClicks: 0, kaspiClicks: 0 });
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
        <td><div class="analytics-product"><img src="${escapeHtml(row.imageUrl || fallbackImage())}" alt=""><span>${escapeHtml(row.title)}</span></div></td>
        <td>${escapeHtml(tagLabels[row.tag] || row.tag)}</td>
        <td>${formatNumber(row.views)}</td>
        <td>${formatNumber(row.videoClicks)}</td>
        <td>${formatNumber(row.kaspiClicks)}</td>
        <td>${percent(row.kaspiClicks, row.views)}</td>
        <td>${escapeHtml(recommendation(row))}</td>
      </tr>`).join('') : '<tr><td colspan="7">Аналитика появится после просмотров витрины.</td></tr>';
  }

  if (els.tagAnalytics) {
    const groups = ['all', 'hit', 'new', 'promo'].map((tag) => {
      const products = tag === 'all' ? rows : rows.filter((row) => row.tag === tag);
      return { tag, views: products.reduce((s, r) => s + r.views, 0), kaspi: products.reduce((s, r) => s + r.kaspiClicks, 0) };
    });
    els.tagAnalytics.innerHTML = groups.map((group) => `
      <div class="tag-row"><strong>${escapeHtml(analyticsTagLabels[group.tag])}</strong><span>${formatNumber(group.views)} просмотров · ${formatNumber(group.kaspi)} Kaspi</span></div>`).join('');
  }

  if (els.analyticsInsights) {
    const best = rows[0];
    const stuck = rows.find((row) => row.views >= 10 && row.kaspiClicks === 0);
    const items = [];
    if (best) items.push(`Лучше всего работает: ${best.title}.`);
    if (stuck) items.push(`Застрял товар: ${stuck.title}. Проверь ссылку, фото или поставь акцию.`);
    if (!items.length) items.push('Пока мало данных. Открой витрину и сделай несколько тестовых кликов.');
    els.analyticsInsights.innerHTML = items.map((item) => `<div class="insight-item">${escapeHtml(item)}</div>`).join('');
  }
}

async function loadUsers(showStatus = true) {
  if (!isAdmin()) return;
  if (showStatus) setStatus('Загружаю пользователей…');
  try {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
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
    </tr>`).join('') : '<tr><td colspan="4">Пользователей пока нет.</td></tr>';
}

function switchPage(page) {
  if (['settings', 'users'].includes(page) && !isAdmin()) return;
  currentPage = page;
  document.querySelectorAll('.page').forEach((section) => section.classList.toggle('active', section.id === `${page}Page`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
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
  imageDraft = (product?.images || []).map((url) => ({ id: uid('img'), type: 'url', url }));
  renderImageDraft();
  if (els.productDialogMode) els.productDialogMode.textContent = product ? 'Редактирование товара' : 'Новый товар';
  if (els.deleteProductButton) els.deleteProductButton.hidden = !product;
  els.productDialog?.showModal();
}

function renderImageDraft() {
  const first = imageDraft[0];
  const src = first?.type === 'file' ? first.previewUrl : first?.url;
  if (els.imagePreview) {
    els.imagePreview.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="">` : '<span>Фото</span>';
  }
  if (!els.imageGalleryList) return;
  els.imageGalleryList.innerHTML = imageDraft.length ? imageDraft.map((item, index) => {
    const src = item.type === 'file' ? item.previewUrl : item.url;
    return `
      <div class="gallery-item ${index === 0 ? 'is-cover' : ''}" data-image-id="${escapeHtml(item.id)}">
        <img src="${escapeHtml(src)}" alt="">
        <div class="gallery-item-meta"><strong>${index === 0 ? 'Обложка' : `Фото ${index + 1}`}</strong><span>${item.type === 'file' ? 'файл' : 'URL'}</span></div>
        <div class="gallery-actions">
          <button type="button" data-image-up="${escapeHtml(item.id)}" aria-label="Выше">↑</button>
          <button type="button" data-image-down="${escapeHtml(item.id)}" aria-label="Ниже">↓</button>
          <button type="button" data-image-remove="${escapeHtml(item.id)}" aria-label="Удалить">×</button>
        </div>
      </div>`;
  }).join('') : '<div class="empty-state">Фото пока не добавлены.</div>';

  els.imageGalleryList.querySelectorAll('[data-image-up]').forEach((button) => button.addEventListener('click', () => moveImage(button.dataset.imageUp, -1)));
  els.imageGalleryList.querySelectorAll('[data-image-down]').forEach((button) => button.addEventListener('click', () => moveImage(button.dataset.imageDown, 1)));
  els.imageGalleryList.querySelectorAll('[data-image-remove]').forEach((button) => button.addEventListener('click', () => removeImage(button.dataset.imageRemove)));
}

function moveImage(imageId, delta) {
  const index = imageDraft.findIndex((item) => item.id === imageId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= imageDraft.length) return;
  [imageDraft[index], imageDraft[next]] = [imageDraft[next], imageDraft[index]];
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
  imageDraft.push({ id: uid('img'), type: 'url', url });
  if (input) input.value = '';
  renderImageDraft();
}

async function uploadImage(file, productId) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) throw new Error(`Недопустимый тип файла: ${file.name}`);
  if (file.size > 5 * 1024 * 1024) throw new Error(`Файл больше 5 МБ: ${file.name}`);
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `products/${productId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

async function resolveImageDraft(productId) {
  const urls = [];
  const seen = new Set();
  for (const item of imageDraft) {
    const url = item.type === 'file' ? await uploadImage(item.file, productId) : normalizeExternalUrl(item.url);
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
    const { data, error } = await supabase.from('products').upsert(payload).select('*').single();
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
    const { error } = await supabase.from('products').delete().eq('id', editingProductId);
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
    const { data, error } = await supabase.from('categories').insert(payload).select('*').single();
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
    const { error } = await supabase.from('categories').delete().eq('id', categoryId);
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
    const { data, error } = await supabase.from('settings').upsert(payload).select('*').single();
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
    const { error } = await supabase.from('analytics_events').delete().neq('id', 0);
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
        'Authorization': `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
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
  [els.addProductTopButton, els.quickAddButton, els.addProductButton].forEach((button) => button?.addEventListener('click', () => openProductDialog(null)));
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
    Array.from(event.target.files || []).forEach((file) => {
      imageDraft.push({ id: uid('img'), type: 'file', file, previewUrl: URL.createObjectURL(file) });
    });
    event.target.value = '';
    renderImageDraft();
  });
  els.userForm?.addEventListener('submit', createUser);
}

bindEvents();
requireSession();
