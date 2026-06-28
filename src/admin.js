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
/* OTBASU ADMIN POLISH — SAFE VISUAL FIX
   Только внешний вид админки.
   Логику товаров, Supabase, витрину и галерею не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_POLISH_SAFE__) return;
  window.__OTBASU_ADMIN_POLISH_SAFE__ = true;

  const STYLE_ID = 'otbasu-admin-polish-safe-style';

  function injectAdminPolishStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      :root {
        --otbasu-admin-wine: #7b124f;
        --otbasu-admin-wine-dark: #4d0a33;
        --otbasu-admin-cream: #fff8ef;
        --otbasu-admin-card: rgba(255, 255, 255, .88);
        --otbasu-admin-border: rgba(123, 18, 79, .13);
        --otbasu-admin-shadow: 0 18px 48px rgba(50, 8, 34, .12);
      }

      body {
        background:
          radial-gradient(circle at 18% 0%, rgba(255, 224, 186, .55), transparent 32%),
          radial-gradient(circle at 88% 12%, rgba(123, 18, 79, .13), transparent 34%),
          linear-gradient(180deg, #fff8ef 0%, #fff4e7 100%) !important;
      }

      .admin-shell,
      main,
      .content,
      .main-content {
        min-height: 100vh;
      }

      .page.active {
        animation: otbasuAdminPageIn 240ms ease both;
      }

      @keyframes otbasuAdminPageIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .status-bar {
        border-radius: 18px !important;
        border: 1px solid var(--otbasu-admin-border) !important;
        box-shadow: 0 10px 28px rgba(50, 8, 34, .08) !important;
      }

      .status-bar.ok {
        background: rgba(230, 255, 237, .9) !important;
      }

      .status-bar.error {
        background: rgba(255, 231, 231, .92) !important;
      }

      .card,
      .panel,
      .metric-card,
      .dashboard-card,
      .table-card,
      .settings-card,
      .analytics-card {
        border-radius: 26px !important;
        border: 1px solid var(--otbasu-admin-border) !important;
        background: var(--otbasu-admin-card) !important;
        box-shadow: var(--otbasu-admin-shadow) !important;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
      }

      #productsPage table,
      #analyticsPage table,
      #usersPage table {
        width: 100% !important;
        border-collapse: separate !important;
        border-spacing: 0 10px !important;
      }

      #productsPage thead th,
      #analyticsPage thead th,
      #usersPage thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: rgba(255, 248, 239, .96) !important;
        color: rgba(77, 10, 51, .72) !important;
        font-size: 12px !important;
        font-weight: 900 !important;
        text-transform: uppercase;
        letter-spacing: .04em;
        padding: 12px 14px !important;
        border-bottom: 1px solid rgba(123, 18, 79, .1) !important;
      }

      #productsTableBody tr,
      #analyticsTableBody tr,
      #usersTableBody tr {
        background: rgba(255, 255, 255, .9) !important;
        box-shadow: 0 10px 26px rgba(48, 7, 32, .08) !important;
        transition:
          transform 160ms ease,
          box-shadow 160ms ease,
          background 160ms ease !important;
      }

      #productsTableBody tr:hover,
      #analyticsTableBody tr:hover,
      #usersTableBody tr:hover {
        transform: translateY(-1px);
        background: #fff !important;
        box-shadow: 0 16px 34px rgba(48, 7, 32, .13) !important;
      }

      #productsTableBody td,
      #analyticsTableBody td,
      #usersTableBody td {
        padding: 12px 14px !important;
        vertical-align: middle !important;
        border-top: 1px solid rgba(123, 18, 79, .08) !important;
        border-bottom: 1px solid rgba(123, 18, 79, .08) !important;
      }

      #productsTableBody td:first-child,
      #analyticsTableBody td:first-child,
      #usersTableBody td:first-child {
        border-left: 1px solid rgba(123, 18, 79, .08) !important;
        border-radius: 18px 0 0 18px !important;
      }

      #productsTableBody td:last-child,
      #analyticsTableBody td:last-child,
      #usersTableBody td:last-child {
        border-right: 1px solid rgba(123, 18, 79, .08) !important;
        border-radius: 0 18px 18px 0 !important;
      }

      #productsTableBody img,
      #analyticsTableBody img {
        width: 72px !important;
        height: 72px !important;
        min-width: 72px !important;
        max-width: 72px !important;
        max-height: 72px !important;
        object-fit: cover !important;
        border-radius: 18px !important;
        display: block !important;
        box-shadow: 0 10px 24px rgba(50, 8, 34, .16) !important;
        border: 1px solid rgba(123, 18, 79, .12) !important;
        background: #fff8ef !important;
      }

      #productsTableBody button,
      #analyticsPage button,
      #usersPage button,
      #categoriesPage button,
      #settingsPage button,
      #dashboardPage button,
      #productDialog button {
        border-radius: 999px !important;
        font-weight: 900 !important;
        transition:
          transform 140ms ease,
          box-shadow 140ms ease,
          opacity 140ms ease !important;
      }

      #productsTableBody button:hover,
      #analyticsPage button:hover,
      #usersPage button:hover,
      #categoriesPage button:hover,
      #settingsPage button:hover,
      #dashboardPage button:hover,
      #productDialog button:hover {
        transform: translateY(-1px);
      }

      [data-edit-product] {
        background: linear-gradient(135deg, #8d155d, #5b0d3c) !important;
        color: #fff8ef !important;
        border: 0 !important;
        box-shadow: 0 12px 26px rgba(123, 18, 79, .22) !important;
      }

      #productsTableBody tr[draggable="true"] {
        cursor: grab;
      }

      #productsTableBody tr.dragging {
        opacity: .58;
        transform: scale(.99);
      }

      #productsPage input,
      #productsPage select,
      #settingsPage input,
      #settingsPage textarea,
      #settingsPage select,
      #usersPage input,
      #usersPage select,
      #categoriesPage input,
      #productDialog input,
      #productDialog textarea,
      #productDialog select {
        border-radius: 16px !important;
        border: 1px solid rgba(123, 18, 79, .15) !important;
        background: rgba(255, 255, 255, .88) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .7) !important;
      }

      #productsPage input:focus,
      #productsPage select:focus,
      #settingsPage input:focus,
      #settingsPage textarea:focus,
      #settingsPage select:focus,
      #usersPage input:focus,
      #usersPage select:focus,
      #categoriesPage input:focus,
      #productDialog input:focus,
      #productDialog textarea:focus,
      #productDialog select:focus {
        outline: none !important;
        border-color: rgba(123, 18, 79, .45) !important;
        box-shadow:
          0 0 0 4px rgba(123, 18, 79, .09),
          inset 0 1px 0 rgba(255, 255, 255, .7) !important;
      }

      #productDialog {
        width: min(960px, calc(100vw - 28px)) !important;
        max-height: calc(100vh - 28px) !important;
        border: 0 !important;
        border-radius: 30px !important;
        padding: 0 !important;
        background: rgba(255, 248, 239, .97) !important;
        box-shadow: 0 28px 90px rgba(29, 3, 19, .38) !important;
        overflow: hidden !important;
      }

      #productDialog::backdrop {
        background:
          radial-gradient(circle at 50% 0%, rgba(255, 224, 186, .24), transparent 34%),
          rgba(21, 3, 15, .72) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      #productDialog form {
        max-height: calc(100vh - 28px) !important;
        overflow: auto !important;
        padding: 24px !important;
      }

      #imagePreview {
        min-height: 180px !important;
        border-radius: 24px !important;
        border: 1px dashed rgba(123, 18, 79, .28) !important;
        background:
          radial-gradient(circle at 50% 0%, rgba(255, 224, 186, .5), transparent 48%),
          rgba(255, 255, 255, .72) !important;
        display: grid !important;
        place-items: center !important;
        overflow: hidden !important;
        color: rgba(77, 10, 51, .45) !important;
        font-weight: 900 !important;
      }

      #imagePreview img {
        width: 100% !important;
        height: 220px !important;
        object-fit: cover !important;
        display: block !important;
      }

      #imageGalleryList {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)) !important;
        gap: 12px !important;
        margin-top: 12px !important;
      }

      #imageGalleryList > * {
        border-radius: 20px !important;
        background: rgba(255, 255, 255, .86) !important;
        border: 1px solid rgba(123, 18, 79, .12) !important;
        box-shadow: 0 12px 28px rgba(50, 8, 34, .1) !important;
        overflow: hidden !important;
      }

      #imageGalleryList img {
        width: 100% !important;
        height: 104px !important;
        object-fit: cover !important;
        display: block !important;
      }

      #imageGalleryList button {
        min-width: 34px !important;
        min-height: 34px !important;
      }

      @media (max-width: 900px) {
        #productsPage {
          overflow-x: auto;
        }

        #productsPage table {
          min-width: 820px !important;
        }

        #productDialog form {
          padding: 18px !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectAdminPolishStyles();

  document.addEventListener('DOMContentLoaded', injectAdminPolishStyles);
  window.setTimeout(injectAdminPolishStyles, 500);
})();
/* OTBASU ADMIN SORT ARROWS — SAFE
   Добавляет кнопки ↑ / ↓ в список товаров.
   Витрину, галерею, Supabase и styles.css не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_SORT_ARROWS_SAFE__) return;
  window.__OTBASU_ADMIN_SORT_ARROWS_SAFE__ = true;

  const STYLE_ID = 'otbasu-admin-sort-arrows-style';

  function injectSortArrowStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .otbasu-sort-controls {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: 8px;
        vertical-align: middle;
      }

      .otbasu-sort-btn {
        width: 34px;
        height: 34px;
        border: 0 !important;
        border-radius: 999px !important;
        background: rgba(123, 18, 79, .1) !important;
        color: #7b124f !important;
        font-size: 17px !important;
        font-weight: 900 !important;
        line-height: 1 !important;
        cursor: pointer;
        box-shadow: inset 0 0 0 1px rgba(123, 18, 79, .12) !important;
        transition:
          transform 140ms ease,
          background 140ms ease,
          color 140ms ease,
          opacity 140ms ease !important;
      }

      .otbasu-sort-btn:hover {
        transform: translateY(-1px);
        background: #7b124f !important;
        color: #fff8ef !important;
      }

      .otbasu-sort-btn:disabled {
        opacity: .32 !important;
        cursor: not-allowed !important;
        transform: none !important;
        background: rgba(123, 18, 79, .08) !important;
        color: rgba(123, 18, 79, .45) !important;
      }
    `;

    document.head.appendChild(style);
  }

  function getFullOrderedProducts() {
    return [...state.products].sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  }

  function canUseSortButtons() {
    const query = String(els.productSearch?.value || '').trim();
    const filter = els.productFilter?.value || 'all';

    if (query || filter !== 'all') {
      setStatus('Для сортировки очисти поиск и поставь фильтр “Все”.', 'error');
      return false;
    }

    return true;
  }

  async function moveProductByButton(productId, direction) {
    if (!canUseSortButtons()) return;

    const ordered = getFullOrderedProducts();
    const from = ordered.findIndex((product) => String(product.id) === String(productId));
    const to = from + Number(direction);

    if (from < 0) return;

    if (to < 0) {
      setStatus('Товар уже самый первый.', 'ok');
      return;
    }

    if (to >= ordered.length) {
      setStatus('Товар уже самый последний.', 'ok');
      return;
    }

    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);

    await persistProductOrder(ordered);
    window.setTimeout(addSortButtons, 80);
  }

  function addSortButtons() {
    injectSortArrowStyles();

    const tbody = els.productsTableBody;
    if (!tbody) return;

    const rows = [...tbody.querySelectorAll('tr[data-product-id]')];

    rows.forEach((row, index) => {
      if (row.querySelector('.otbasu-sort-controls')) return;

      const productId = row.dataset.productId;
      const actionCell = row.querySelector('td:last-child') || row.lastElementChild;

      if (!productId || !actionCell) return;

      const controls = document.createElement('span');
      controls.className = 'otbasu-sort-controls';
      controls.innerHTML = `
        <button
          class="otbasu-sort-btn"
          type="button"
          data-otbasu-sort-product="${productId}"
          data-otbasu-sort-direction="-1"
          ${index === 0 ? 'disabled' : ''}
          title="Поднять товар выше">
          ↑
        </button>
        <button
          class="otbasu-sort-btn"
          type="button"
          data-otbasu-sort-product="${productId}"
          data-otbasu-sort-direction="1"
          ${index === rows.length - 1 ? 'disabled' : ''}
          title="Опустить товар ниже">
          ↓
        </button>
      `;

      actionCell.appendChild(controls);
    });
  }

  const originalRenderProducts = renderProducts;

  renderProducts = function patchedRenderProducts(...args) {
    const result = originalRenderProducts.apply(this, args);
    window.setTimeout(addSortButtons, 0);
    return result;
  };

  els.productsTableBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-otbasu-sort-product]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    moveProductByButton(
      button.dataset.otbasuSortProduct,
      Number(button.dataset.otbasuSortDirection)
    );
  });

  document.addEventListener('DOMContentLoaded', () => {
    injectSortArrowStyles();
    window.setTimeout(addSortButtons, 500);
    window.setTimeout(addSortButtons, 1500);
  });

  injectSortArrowStyles();
  window.setTimeout(addSortButtons, 800);
})();
/* OTBASU ADMIN IMAGE SIZE FIX — SAFE
   Делает все фото в админке одинаковыми.
   Картинки не растягиваются, а аккуратно помещаются в рамку.
   Логику сохранения, витрину и галерею не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_IMAGE_SIZE_FIX__) return;
  window.__OTBASU_ADMIN_IMAGE_SIZE_FIX__ = true;

  const STYLE_ID = 'otbasu-admin-image-size-fix-style';

  function injectAdminImageSizeFix() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      /* Главное превью фото в карточке товара */
      #imagePreview {
        width: 100% !important;
        height: 220px !important;
        min-height: 220px !important;
        max-height: 220px !important;
        border-radius: 24px !important;
        overflow: hidden !important;
        display: grid !important;
        place-items: center !important;
        background:
          radial-gradient(circle at 50% 0%, rgba(255, 224, 186, .55), transparent 48%),
          rgba(255, 255, 255, .78) !important;
      }

      #imagePreview img {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain !important;
        object-position: center !important;
        display: block !important;
        border-radius: 18px !important;
        background: rgba(255, 248, 239, .92) !important;
      }

      /* Сетка фотографий товара справа */
      #imageGalleryList {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, 132px) !important;
        justify-content: start !important;
        align-items: start !important;
        gap: 12px !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      #imageGalleryList > * {
        width: 132px !important;
        min-width: 132px !important;
        max-width: 132px !important;
        min-height: 172px !important;
        border-radius: 20px !important;
        overflow: hidden !important;
        box-sizing: border-box !important;
        background: rgba(255, 255, 255, .9) !important;
        border: 1px solid rgba(123, 18, 79, .13) !important;
        box-shadow: 0 10px 24px rgba(50, 8, 34, .1) !important;
      }

      #imageGalleryList img {
        width: 100% !important;
        height: 104px !important;
        min-height: 104px !important;
        max-height: 104px !important;
        object-fit: contain !important;
        object-position: center !important;
        display: block !important;
        padding: 6px !important;
        box-sizing: border-box !important;
        background: rgba(255, 248, 239, .95) !important;
        border-radius: 16px !important;
      }

      /* Кнопки ↑ ↓ × внутри фото не должны растягивать карточку */
      #imageGalleryList button {
        width: 32px !important;
        height: 32px !important;
        min-width: 32px !important;
        min-height: 32px !important;
        max-width: 32px !important;
        max-height: 32px !important;
        padding: 0 !important;
        display: inline-grid !important;
        place-items: center !important;
        flex: 0 0 auto !important;
      }

      /* Миниатюры товаров в таблице админки */
      #productsTableBody img,
      #analyticsTableBody img {
        width: 72px !important;
        height: 72px !important;
        min-width: 72px !important;
        max-width: 72px !important;
        min-height: 72px !important;
        max-height: 72px !important;
        object-fit: contain !important;
        object-position: center !important;
        padding: 4px !important;
        box-sizing: border-box !important;
        border-radius: 18px !important;
        background: rgba(255, 248, 239, .95) !important;
      }

      /* Чтобы длинные фото не расширяли форму */
      #productDialog,
      #productDialog form {
        overflow-x: hidden !important;
      }

      #productDialog * {
        max-width: 100%;
        box-sizing: border-box;
      }

      @media (max-width: 760px) {
        #imagePreview {
          height: 190px !important;
          min-height: 190px !important;
          max-height: 190px !important;
        }

        #imageGalleryList {
          grid-template-columns: repeat(auto-fill, 118px) !important;
          gap: 10px !important;
        }

        #imageGalleryList > * {
          width: 118px !important;
          min-width: 118px !important;
          max-width: 118px !important;
        }

        #imageGalleryList img {
          height: 96px !important;
          min-height: 96px !important;
          max-height: 96px !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectAdminImageSizeFix();
  document.addEventListener('DOMContentLoaded', injectAdminImageSizeFix);
  window.setTimeout(injectAdminImageSizeFix, 500);
})();
/* OTBASU ADMIN PHOTO SIZE HINT — SAFE
   Добавляет подсказку по правильному размеру фото.
   Логику товаров, витрину, галерею и Supabase не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_PHOTO_SIZE_HINT__) return;
  window.__OTBASU_ADMIN_PHOTO_SIZE_HINT__ = true;

  const STYLE_ID = 'otbasu-admin-photo-size-hint-style';
  const HINT_ID = 'otbasuPhotoSizeHint';

  function injectPhotoHintStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      .otbasu-photo-size-hint {
        margin: 12px 0 14px;
        padding: 14px 16px;
        border-radius: 20px;
        background:
          radial-gradient(circle at 0% 0%, rgba(255, 225, 185, .62), transparent 40%),
          rgba(255, 255, 255, .82);
        border: 1px solid rgba(123, 18, 79, .14);
        box-shadow: 0 12px 28px rgba(50, 8, 34, .09);
        color: #4d0a33;
      }

      .otbasu-photo-size-hint strong {
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 950;
        color: #7b124f;
      }

      .otbasu-photo-size-hint ul {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 5px;
      }

      .otbasu-photo-size-hint li {
        font-size: 12px;
        line-height: 1.35;
        font-weight: 750;
        color: rgba(77, 10, 51, .82);
      }

      .otbasu-photo-size-hint .bad {
        color: #b4142b;
        font-weight: 900;
      }

      .otbasu-photo-size-hint .good {
        color: #7b124f;
        font-weight: 950;
      }
    `;

    document.head.appendChild(style);
  }

  function addPhotoSizeHint() {
    injectPhotoHintStyles();

    if (document.getElementById(HINT_ID)) return;

    const imagePreview = document.getElementById('imagePreview');
    const imageGalleryList = document.getElementById('imageGalleryList');

    if (!imagePreview && !imageGalleryList) return;

    const anchor = imagePreview || imageGalleryList;

    const hint = document.createElement('div');
    hint.id = HINT_ID;
    hint.className = 'otbasu-photo-size-hint';
    hint.innerHTML = `
      <strong>Размер фото для витрины</strong>
      <ul>
        <li><span class="good">Обложка товара:</span> 1080×1080 px или 1200×1200 px</li>
        <li>Лучше квадратное фото, товар по центру, с отступами по краям</li>
        <li><span class="bad">Не ставь первым фото 1080×1920</span> — оно может растянуть карточку</li>
        <li>Вертикальные фото можно добавлять вторым, третьим, четвёртым — для галереи</li>
      </ul>
    `;

    anchor.parentElement?.insertBefore(hint, anchor);
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectPhotoHintStyles();
    window.setTimeout(addPhotoSizeHint, 500);
    window.setTimeout(addPhotoSizeHint, 1500);
  });

  document.addEventListener('click', () => {
    window.setTimeout(addPhotoSizeHint, 300);
    window.setTimeout(addPhotoSizeHint, 900);
  });

  injectPhotoHintStyles();
  window.setTimeout(addPhotoSizeHint, 800);
})();
/* OTBASU ANALYTICS POLISH — SAFE
   Только внешний вид вкладки аналитики.
   Логику подсчёта, витрину, галерею и Supabase не трогаем.
*/
(() => {
  if (window.__OTBASU_ANALYTICS_POLISH_SAFE__) return;
  window.__OTBASU_ANALYTICS_POLISH_SAFE__ = true;

  const STYLE_ID = 'otbasu-analytics-polish-safe-style';

  function injectAnalyticsPolish() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      /* Вкладка аналитики — аккуратнее таблица */
      #analyticsPage table {
        table-layout: fixed !important;
      }

      #analyticsPage th,
      #analyticsPage td {
        vertical-align: middle !important;
      }

      #analyticsPage th:nth-child(1),
      #analyticsPage td:nth-child(1) {
        width: 270px !important;
      }

      #analyticsPage th:nth-child(2),
      #analyticsPage td:nth-child(2) {
        width: 92px !important;
      }

      #analyticsPage th:nth-child(3),
      #analyticsPage td:nth-child(3),
      #analyticsPage th:nth-child(4),
      #analyticsPage td:nth-child(4),
      #analyticsPage th:nth-child(5),
      #analyticsPage td:nth-child(5),
      #analyticsPage th:nth-child(6),
      #analyticsPage td:nth-child(6) {
        width: 72px !important;
        text-align: center !important;
      }

      #analyticsPage th:nth-child(7),
      #analyticsPage td:nth-child(7) {
        width: 250px !important;
      }

      #analyticsPage td {
        height: 78px !important;
      }

      #analyticsPage td:first-child {
        font-weight: 800 !important;
        color: #3f0a2b !important;
      }

      #analyticsPage td:nth-child(3),
      #analyticsPage td:nth-child(4),
      #analyticsPage td:nth-child(5),
      #analyticsPage td:nth-child(6) {
        font-weight: 950 !important;
        color: #5b0d3c !important;
      }

      /* Фото товара в аналитике одинаковые */
      #analyticsPage td img {
        width: 58px !important;
        height: 58px !important;
        min-width: 58px !important;
        max-width: 58px !important;
        min-height: 58px !important;
        max-height: 58px !important;
        object-fit: cover !important;
        border-radius: 16px !important;
        box-shadow: 0 8px 18px rgba(55, 8, 36, .14) !important;
      }

      /* Метки товара */
      #analyticsPage td:nth-child(2) {
        font-weight: 950 !important;
        color: #7b124f !important;
      }

      /* Рекомендация — как аккуратный бейдж */
      #analyticsPage td:nth-child(7) {
        font-size: 13px !important;
        line-height: 1.25 !important;
        color: #4d0a33 !important;
      }

      #analyticsPage td:nth-child(7)::before {
        content: "→ ";
        color: #7b124f;
        font-weight: 950;
      }

      #analyticsPage tbody tr {
        overflow: hidden !important;
      }

      /* Карточки сверху — чуть выразительнее */
      #analyticsPage .metric-card,
      #analyticsPage .dashboard-card,
      #analyticsPage .card {
        transition:
          transform 160ms ease,
          box-shadow 160ms ease !important;
      }

      #analyticsPage .metric-card:hover,
      #analyticsPage .dashboard-card:hover,
      #analyticsPage .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 22px 54px rgba(50, 8, 34, .14) !important;
      }

      /* Правая колонка — подсказки читабельнее */
      #analyticsPage .analytics-card li,
      #analyticsPage .card li,
      #analyticsPage aside li {
        line-height: 1.45 !important;
        margin-bottom: 8px !important;
      }

      /* Кнопки обновить / сбросить */
      #analyticsPage button {
        min-height: 42px !important;
        padding-left: 18px !important;
        padding-right: 18px !important;
      }

      /* На маленьких экранах пусть таблица спокойно скроллится */
      @media (max-width: 1100px) {
        #analyticsPage {
          overflow-x: auto !important;
        }

        #analyticsPage table {
          min-width: 920px !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  injectAnalyticsPolish();
  document.addEventListener('DOMContentLoaded', injectAnalyticsPolish);
  window.setTimeout(injectAnalyticsPolish, 500);
  window.setTimeout(injectAnalyticsPolish, 1500);
})();
/* OTBASU ADMIN TOP BUTTONS + THEME — SAFE
   Делает понятную кнопку выхода и добавляет светлую/тёмную тему админки.
   Логику товаров, витрину, галерею и аналитику не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_TOP_BUTTONS_THEME__) return;
  window.__OTBASU_ADMIN_TOP_BUTTONS_THEME__ = true;

  const STYLE_ID = 'otbasu-admin-top-buttons-theme-style';
  const THEME_KEY = 'otbasu-admin-theme';

  function injectTopButtonStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      .otbasu-admin-exit-button {
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
      }

      .otbasu-admin-exit-button:hover {
        background: #6b0f46 !important;
        color: #fff8ef !important;
        transform: translateY(-1px);
      }

      .otbasu-admin-theme-toggle {
        height: 46px !important;
        padding: 0 18px !important;
        border-radius: 999px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        background: linear-gradient(135deg, #3c0728, #6b0f46) !important;
        color: #fff8ef !important;
        border: 1px solid rgba(255, 248, 239, .2) !important;
        box-shadow: 0 14px 32px rgba(50, 8, 34, .2) !important;
        font-size: 14px !important;
        font-weight: 950 !important;
        cursor: pointer !important;
        white-space: nowrap !important;
      }

      .otbasu-admin-theme-toggle:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 38px rgba(50, 8, 34, .26) !important;
      }

      body.otbasu-admin-dark {
        background:
          radial-gradient(circle at 18% 0%, rgba(123, 18, 79, .28), transparent 34%),
          radial-gradient(circle at 88% 12%, rgba(255, 210, 160, .1), transparent 30%),
          linear-gradient(180deg, #1d0313 0%, #310620 100%) !important;
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark aside,
      body.otbasu-admin-dark .sidebar {
        background: rgba(22, 3, 15, .86) !important;
        color: #fff4e7 !important;
        border-color: rgba(255, 248, 239, .12) !important;
      }

      body.otbasu-admin-dark .page,
      body.otbasu-admin-dark .card,
      body.otbasu-admin-dark .panel,
      body.otbasu-admin-dark .metric-card,
      body.otbasu-admin-dark .dashboard-card,
      body.otbasu-admin-dark .table-card,
      body.otbasu-admin-dark .settings-card,
      body.otbasu-admin-dark .analytics-card,
      body.otbasu-admin-dark #productDialog {
        background: rgba(38, 6, 27, .9) !important;
        color: #fff4e7 !important;
        border-color: rgba(255, 248, 239, .12) !important;
        box-shadow: 0 22px 60px rgba(0, 0, 0, .28) !important;
      }

      body.otbasu-admin-dark h1,
      body.otbasu-admin-dark h2,
      body.otbasu-admin-dark h3,
      body.otbasu-admin-dark strong,
      body.otbasu-admin-dark label {
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark table,
      body.otbasu-admin-dark thead th {
        background: rgba(32, 5, 23, .95) !important;
        color: rgba(255, 244, 231, .8) !important;
      }

      body.otbasu-admin-dark tbody tr,
      body.otbasu-admin-dark #productsTableBody tr,
      body.otbasu-admin-dark #analyticsPage tbody tr {
        background: rgba(255, 248, 239, .08) !important;
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark td {
        color: #fff4e7 !important;
        border-color: rgba(255, 248, 239, .1) !important;
      }

      body.otbasu-admin-dark input,
      body.otbasu-admin-dark textarea,
      body.otbasu-admin-dark select {
        background: rgba(255, 248, 239, .08) !important;
        color: #fff4e7 !important;
        border-color: rgba(255, 248, 239, .18) !important;
      }

      body.otbasu-admin-dark input::placeholder,
      body.otbasu-admin-dark textarea::placeholder {
        color: rgba(255, 244, 231, .55) !important;
      }

      body.otbasu-admin-dark .otbasu-admin-exit-button {
        background: rgba(255, 248, 239, .1) !important;
        color: #fff4e7 !important;
        border-color: rgba(255, 248, 239, .18) !important;
      }

      body.otbasu-admin-dark .otbasu-admin-theme-toggle {
        background: linear-gradient(135deg, #fff8ef, #f0d7bd) !important;
        color: #4d0a33 !important;
      }

      @media (max-width: 900px) {
        .otbasu-admin-exit-button,
        .otbasu-admin-theme-toggle {
          min-width: 46px !important;
          padding: 0 12px !important;
          font-size: 0 !important;
        }

        .otbasu-admin-exit-button::after {
          content: "Выйти";
          font-size: 13px;
        }

        .otbasu-admin-theme-toggle::after {
          content: attr(data-short-label);
          font-size: 13px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';

    document.body.classList.toggle('otbasu-admin-dark', isDark);
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');

    const toggle = document.getElementById('otbasuAdminThemeToggle');

    if (toggle) {
      toggle.innerHTML = isDark ? '☀️ Светлая тема' : '🌙 Тёмная тема';
      toggle.dataset.shortLabel = isDark ? '☀️' : '🌙';
      toggle.setAttribute('aria-label', isDark ? 'Включить светлую тему' : 'Включить тёмную тему');
    }
  }

  function findTopActionsContainer() {
    const buttons = [...document.querySelectorAll('button, a')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < 180;
    });

    const addButton = buttons.find((node) => /товар/i.test(node.textContent || ''));
    const vitrineButton = buttons.find((node) => /витрин/i.test(node.textContent || ''));

    return addButton?.parentElement || vitrineButton?.parentElement || null;
  }

  function makeExitButtonClear() {
    const topContainer = findTopActionsContainer();
    if (!topContainer) return;

    const buttons = [...topContainer.querySelectorAll('button, a')];

    let exitButton =
      buttons.find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const label = (node.getAttribute('aria-label') || node.getAttribute('title') || '').toLowerCase();

        return (
          text === 'выйти' ||
          label.includes('выйти') ||
          label.includes('logout') ||
          node.dataset.logout !== undefined ||
          node.id?.toLowerCase?.().includes('logout') ||
          node.className?.toString?.().toLowerCase?.().includes('logout')
        );
      }) ||
      buttons.find((node) => {
        const text = (node.textContent || '').trim();
        const rect = node.getBoundingClientRect();

        return (
          !/товар/i.test(text) &&
          !/витрин/i.test(text) &&
          rect.width <= 64 &&
          rect.height <= 64
        );
      });

    if (!exitButton || exitButton.classList.contains('otbasu-admin-exit-button')) return;

    exitButton.classList.add('otbasu-admin-exit-button');
    exitButton.setAttribute('title', 'Выйти из админки');
    exitButton.setAttribute('aria-label', 'Выйти из админки');
    exitButton.innerHTML = '⎋ Выйти';
  }

  function addThemeToggle() {
    const topContainer = findTopActionsContainer();
    if (!topContainer) return;

    if (document.getElementById('otbasuAdminThemeToggle')) return;

    const toggle = document.createElement('button');
    toggle.id = 'otbasuAdminThemeToggle';
    toggle.className = 'otbasu-admin-theme-toggle';
    toggle.type = 'button';

    toggle.addEventListener('click', () => {
      const nextTheme = document.body.classList.contains('otbasu-admin-dark') ? 'light' : 'dark';
      applyTheme(nextTheme);
    });

    topContainer.appendChild(toggle);

    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    applyTheme(savedTheme);
  }

  function initAdminTopButtons() {
    injectTopButtonStyles();
    makeExitButtonClear();
    addThemeToggle();
  }

  injectTopButtonStyles();

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(initAdminTopButtons, 400);
    window.setTimeout(initAdminTopButtons, 1200);
  });

  window.setTimeout(initAdminTopButtons, 500);
  window.setTimeout(initAdminTopButtons, 1500);
})();
/* OTBASU ADMIN DARK THEME CONTRAST FIX — SAFE
   Исправляет читаемость текста в тёмной теме.
   Логику админки, витрину, галерею и аналитику не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_DARK_CONTRAST_FIX__) return;
  window.__OTBASU_ADMIN_DARK_CONTRAST_FIX__ = true;

  const STYLE_ID = 'otbasu-admin-dark-contrast-fix-style';

  function injectDarkContrastFix() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      body.otbasu-admin-dark #analyticsPage,
      body.otbasu-admin-dark #productsPage,
      body.otbasu-admin-dark #categoriesPage,
      body.otbasu-admin-dark #settingsPage,
      body.otbasu-admin-dark #usersPage,
      body.otbasu-admin-dark #dashboardPage {
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark #analyticsPage h1,
      body.otbasu-admin-dark #analyticsPage h2,
      body.otbasu-admin-dark #analyticsPage h3,
      body.otbasu-admin-dark #analyticsPage strong,
      body.otbasu-admin-dark #analyticsPage label,
      body.otbasu-admin-dark #productsPage h1,
      body.otbasu-admin-dark #productsPage h2,
      body.otbasu-admin-dark #productsPage h3,
      body.otbasu-admin-dark #productsPage strong,
      body.otbasu-admin-dark #productsPage label {
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark #analyticsPage table,
      body.otbasu-admin-dark #productsPage table {
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark #analyticsPage thead th,
      body.otbasu-admin-dark #productsPage thead th,
      body.otbasu-admin-dark #usersPage thead th {
        background: rgba(255, 248, 239, .92) !important;
        color: #5b0d3c !important;
      }

      body.otbasu-admin-dark #analyticsPage tbody tr,
      body.otbasu-admin-dark #productsTableBody tr,
      body.otbasu-admin-dark #usersTableBody tr {
        background: rgba(255, 248, 239, .11) !important;
        color: #fff4e7 !important;
      }

      body.otbasu-admin-dark #analyticsPage tbody tr:hover,
      body.otbasu-admin-dark #productsTableBody tr:hover,
      body.otbasu-admin-dark #usersTableBody tr:hover {
        background: rgba(255, 248, 239, .17) !important;
      }

      body.otbasu-admin-dark #analyticsPage td,
      body.otbasu-admin-dark #analyticsPage td:first-child,
      body.otbasu-admin-dark #analyticsPage td:nth-child(2),
      body.otbasu-admin-dark #analyticsPage td:nth-child(3),
      body.otbasu-admin-dark #analyticsPage td:nth-child(4),
      body.otbasu-admin-dark #analyticsPage td:nth-child(5),
      body.otbasu-admin-dark #analyticsPage td:nth-child(6),
      body.otbasu-admin-dark #analyticsPage td:nth-child(7),
      body.otbasu-admin-dark #productsTableBody td,
      body.otbasu-admin-dark #usersTableBody td {
        color: #fff4e7 !important;
        border-color: rgba(255, 248, 239, .12) !important;
      }

      body.otbasu-admin-dark #analyticsPage td:first-child {
        color: #fff4e7 !important;
        font-weight: 900 !important;
      }

      body.otbasu-admin-dark #analyticsPage td:nth-child(2) {
        color: #ffb7dd !important;
        font-weight: 950 !important;
      }

      body.otbasu-admin-dark #analyticsPage td:nth-child(3),
      body.otbasu-admin-dark #analyticsPage td:nth-child(4),
      body.otbasu-admin-dark #analyticsPage td:nth-child(5),
      body.otbasu-admin-dark #analyticsPage td:nth-child(6) {
        color: #ffd9aa !important;
        font-weight: 950 !important;
      }

      body.otbasu-admin-dark #analyticsPage td:nth-child(7) {
        color: rgba(255, 244, 231, .92) !important;
      }

      body.otbasu-admin-dark #analyticsPage td:nth-child(7)::before {
        color: #ffd9aa !important;
      }

      body.otbasu-admin-dark #analyticsPage .card,
      body.otbasu-admin-dark #analyticsPage .analytics-card,
      body.otbasu-admin-dark #analyticsPage .metric-card,
      body.otbasu-admin-dark #analyticsPage .dashboard-card {
        background: rgba(48, 7, 34, .9) !important;
        border-color: rgba(255, 248, 239, .13) !important;
      }

      body.otbasu-admin-dark #analyticsPage .card p,
      body.otbasu-admin-dark #analyticsPage .analytics-card p,
      body.otbasu-admin-dark #analyticsPage .metric-card p,
      body.otbasu-admin-dark #analyticsPage .dashboard-card p,
      body.otbasu-admin-dark #analyticsPage li,
      body.otbasu-admin-dark #analyticsPage span {
        color: rgba(255, 244, 231, .88) !important;
      }

      body.otbasu-admin-dark .status-bar.ok {
        background: rgba(210, 255, 220, .9) !important;
        color: #075c2d !important;
      }

      body.otbasu-admin-dark .status-bar.ok * {
        color: #075c2d !important;
      }

      body.otbasu-admin-dark .nav-link,
      body.otbasu-admin-dark aside a,
      body.otbasu-admin-dark aside button {
        color: rgba(255, 244, 231, .78) !important;
      }

      body.otbasu-admin-dark .nav-link.active,
      body.otbasu-admin-dark aside a.active,
      body.otbasu-admin-dark aside button.active {
        color: #fff8ef !important;
      }
    `;

    document.head.appendChild(style);
  }

  injectDarkContrastFix();
  document.addEventListener('DOMContentLoaded', injectDarkContrastFix);
  window.setTimeout(injectDarkContrastFix, 500);
  window.setTimeout(injectDarkContrastFix, 1500);
})();
/* OTBASU ADMIN DARK INPUTS FIX — SAFE
   Исправляет поля ввода в тёмной теме.
   Логику админки, товары, витрину и галерею не трогаем.
*/
(() => {
  if (window.__OTBASU_ADMIN_DARK_INPUTS_FIX__) return;
  window.__OTBASU_ADMIN_DARK_INPUTS_FIX__ = true;

  const STYLE_ID = 'otbasu-admin-dark-inputs-fix-style';

  function injectDarkInputsFix() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      body.otbasu-admin-dark #settingsPage input,
      body.otbasu-admin-dark #settingsPage textarea,
      body.otbasu-admin-dark #settingsPage select,
      body.otbasu-admin-dark #productsPage input,
      body.otbasu-admin-dark #productsPage textarea,
      body.otbasu-admin-dark #productsPage select,
      body.otbasu-admin-dark #productDialog input,
      body.otbasu-admin-dark #productDialog textarea,
      body.otbasu-admin-dark #productDialog select,
      body.otbasu-admin-dark #categoriesPage input,
      body.otbasu-admin-dark #categoriesPage textarea,
      body.otbasu-admin-dark #categoriesPage select,
      body.otbasu-admin-dark #usersPage input,
      body.otbasu-admin-dark #usersPage textarea,
      body.otbasu-admin-dark #usersPage select {
        background: rgba(255, 248, 239, .12) !important;
        color: #fff8ef !important;
        border-color: rgba(255, 248, 239, .26) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .08),
          0 8px 20px rgba(0, 0, 0, .12) !important;
      }

      body.otbasu-admin-dark #settingsPage input::placeholder,
      body.otbasu-admin-dark #settingsPage textarea::placeholder,
      body.otbasu-admin-dark #productsPage input::placeholder,
      body.otbasu-admin-dark #productsPage textarea::placeholder,
      body.otbasu-admin-dark #productDialog input::placeholder,
      body.otbasu-admin-dark #productDialog textarea::placeholder,
      body.otbasu-admin-dark #categoriesPage input::placeholder,
      body.otbasu-admin-dark #categoriesPage textarea::placeholder,
      body.otbasu-admin-dark #usersPage input::placeholder,
      body.otbasu-admin-dark #usersPage textarea::placeholder {
        color: rgba(255, 248, 239, .58) !important;
      }

      body.otbasu-admin-dark #settingsPage input:focus,
      body.otbasu-admin-dark #settingsPage textarea:focus,
      body.otbasu-admin-dark #settingsPage select:focus,
      body.otbasu-admin-dark #productsPage input:focus,
      body.otbasu-admin-dark #productsPage textarea:focus,
      body.otbasu-admin-dark #productsPage select:focus,
      body.otbasu-admin-dark #productDialog input:focus,
      body.otbasu-admin-dark #productDialog textarea:focus,
      body.otbasu-admin-dark #productDialog select:focus,
      body.otbasu-admin-dark #categoriesPage input:focus,
      body.otbasu-admin-dark #categoriesPage textarea:focus,
      body.otbasu-admin-dark #categoriesPage select:focus {
        border-color: rgba(255, 217, 170, .65) !important;
        box-shadow:
          0 0 0 4px rgba(255, 217, 170, .12),
          inset 0 1px 0 rgba(255, 255, 255, .08) !important;
      }

      body.otbasu-admin-dark #settingsPage label,
      body.otbasu-admin-dark #productsPage label,
      body.otbasu-admin-dark #productDialog label,
      body.otbasu-admin-dark #categoriesPage label,
      body.otbasu-admin-dark #usersPage label {
        color: #fff4e7 !important;
        font-weight: 900 !important;
      }

      body.otbasu-admin-dark #settingsPage button,
      body.otbasu-admin-dark #productsPage button,
      body.otbasu-admin-dark #productDialog button,
      body.otbasu-admin-dark #categoriesPage button {
        color: #fff8ef !important;
      }

      body.otbasu-admin-dark #settingsPage button:not(.otbasu-admin-theme-toggle):not(.otbasu-admin-exit-button),
      body.otbasu-admin-dark #productDialog button:not(.otbasu-admin-theme-toggle):not(.otbasu-admin-exit-button) {
        background: linear-gradient(135deg, #7b124f, #4d0a33) !important;
        border-color: rgba(255, 248, 239, .16) !important;
      }
    `;

    document.head.appendChild(style);
  }

  injectDarkInputsFix();
  document.addEventListener('DOMContentLoaded', injectDarkInputsFix);
  window.setTimeout(injectDarkInputsFix, 500);
  window.setTimeout(injectDarkInputsFix, 1500);
})();
