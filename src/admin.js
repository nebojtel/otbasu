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
/* OTBASU ADMIN EXIT BUTTON ONLY — SAFE
   Делает понятную кнопку "Выйти".
   Тёмную тему не добавляет.
   Витрину, галерею и логику админки не трогает.
*/
(() => {
  if (window.__OTBASU_ADMIN_EXIT_BUTTON_ONLY__) return;
  window.__OTBASU_ADMIN_EXIT_BUTTON_ONLY__ = true;

  const STYLE_ID = 'otbasu-admin-exit-button-only-style';

  function injectExitButtonStyle() {
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
        cursor: pointer !important;
      }

      .otbasu-admin-exit-button:hover {
        background: #6b0f46 !important;
        color: #fff8ef !important;
        transform: translateY(-1px);
      }
    `;

    document.head.appendChild(style);
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

    const exitButton =
      buttons.find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const label = (node.getAttribute('aria-label') || node.getAttribute('title') || '').toLowerCase();

        return (
          text.includes('выйти') ||
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

    if (!exitButton) return;

    exitButton.classList.add('otbasu-admin-exit-button');
    exitButton.setAttribute('title', 'Выйти из админки');
    exitButton.setAttribute('aria-label', 'Выйти из админки');
    exitButton.innerHTML = '⎋ Выйти';
  }

  function initExitButtonOnly() {
    injectExitButtonStyle();
    makeExitButtonClear();
  }

  injectExitButtonStyle();

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(initExitButtonOnly, 400);
    window.setTimeout(initExitButtonOnly, 1200);
  });

  window.setTimeout(initExitButtonOnly, 500);
  window.setTimeout(initExitButtonOnly, 1500);
})();
/* OTBASU ADMIN IMAGE AUTO COMPRESS — SAFE
   Автоматически сжимает фото перед сохранением товара.
   Главное фото делает квадратом 1080×1080.
   Дополнительные фото уменьшает по большой стороне до 1600 px.
   Витрину, галерею, аналитику и Supabase-логику не трогает.
*/
(() => {
  if (window.__OTBASU_ADMIN_IMAGE_AUTO_COMPRESS__) return;
  window.__OTBASU_ADMIN_IMAGE_AUTO_COMPRESS__ = true;

  const STYLE_ID = 'otbasu-admin-image-auto-compress-style';

  const CONFIG = {
    coverSize: 1080,
    galleryMaxSide: 1600,
    coverTargetKB: 300,
    galleryTargetKB: 500,
    startQuality: 0.84,
    minQuality: 0.66,
    mime: 'image/webp'
  };

  function injectCompressionStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      .otbasu-compress-note {
        margin-top: 8px;
        padding: 10px 12px;
        border-radius: 16px;
        background: rgba(123, 18, 79, .08);
        color: #5b0d3c;
        border: 1px solid rgba(123, 18, 79, .12);
        font-size: 12px;
        font-weight: 850;
        line-height: 1.35;
      }

      .otbasu-compress-note.is-working {
        background: rgba(255, 224, 186, .45);
      }

      .otbasu-compress-note.is-ok {
        background: rgba(226, 255, 235, .78);
        color: #0d5c2e;
        border-color: rgba(13, 92, 46, .14);
      }

      .otbasu-compress-note.is-error {
        background: rgba(255, 231, 231, .85);
        color: #9c1028;
        border-color: rgba(156, 16, 40, .16);
      }
    `;

    document.head.appendChild(style);
  }

  function bytesToText(bytes) {
    if (!Number.isFinite(bytes)) return '0 KB';

    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function showCompressionNote(input, text, type = 'ok') {
    injectCompressionStyles();

    const parent = input.closest('.field, label, div') || input.parentElement;
    if (!parent) return;

    let note = parent.querySelector('.otbasu-compress-note');

    if (!note) {
      note = document.createElement('div');
      note.className = 'otbasu-compress-note';
      parent.appendChild(note);
    }

    note.className = `otbasu-compress-note is-${type}`;
    note.textContent = text;
  }

  function getInputText(input) {
    const labelText =
      input.closest('label')?.textContent ||
      document.querySelector(`label[for="${input.id}"]`)?.textContent ||
      '';

    return [
      input.id,
      input.name,
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder'),
      labelText,
      input.parentElement?.textContent
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function isProductImageInput(input) {
    if (!input || input.type !== 'file') return false;

    const accept = String(input.accept || '').toLowerCase();
    const text = getInputText(input);

    const looksLikeImageInput =
      accept.includes('image') ||
      /image|photo|foto|фото|картин|изображ|главн|облож|gallery|галере/i.test(text);

    const inProductArea =
      input.closest('#productDialog') ||
      input.closest('#productsPage') ||
      input.closest('[id*="product"]') ||
      input.closest('[class*="product"]');

    return Boolean(looksLikeImageInput && inProductArea);
  }

  function isCoverInput(input) {
    const text = getInputText(input);

    return (
      !input.multiple &&
      /main|cover|облож|главн|preview|превью|основн/i.test(text)
    );
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
        reject(new Error('Не удалось открыть изображение'));
      };

      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, mime, quality);
    });
  }

  function drawContain(ctx, img, canvasWidth, canvasHeight) {
    const imageWidth = img.naturalWidth || img.width;
    const imageHeight = img.naturalHeight || img.height;

    const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const drawWidth = Math.round(imageWidth * scale);
    const drawHeight = Math.round(imageHeight * scale);

    const x = Math.round((canvasWidth - drawWidth) / 2);
    const y = Math.round((canvasHeight - drawHeight) / 2);

    ctx.drawImage(img, x, y, drawWidth, drawHeight);
  }

  function getGalleryCanvasSize(img) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const maxSide = Math.max(width, height);

    if (maxSide <= CONFIG.galleryMaxSide) {
      return { width, height };
    }

    const ratio = CONFIG.galleryMaxSide / maxSide;

    return {
      width: Math.round(width * ratio),
      height: Math.round(height * ratio)
    };
  }

  async function exportCompressed(canvas, targetKB) {
    let quality = CONFIG.startQuality;
    let blob = null;

    while (quality >= CONFIG.minQuality) {
      blob = await canvasToBlob(canvas, CONFIG.mime, quality);

      if (!blob) {
        blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      }

      if (!blob) break;

      const sizeKB = blob.size / 1024;

      if (sizeKB <= targetKB || quality <= CONFIG.minQuality) {
        return blob;
      }

      quality -= 0.06;
    }

    return blob;
  }

  function makeFileName(originalName, suffix = 'compressed') {
    const cleanName = String(originalName || 'image')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\wа-яА-ЯёЁ-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'image';

    return `${cleanName}-${suffix}.webp`;
  }

  async function compressImageFile(file, mode) {
    const img = await loadImageFromFile(file);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', {
      alpha: mode !== 'cover',
      willReadFrequently: false
    });

    if (!ctx) return file;

    if (mode === 'cover') {
      canvas.width = CONFIG.coverSize;
      canvas.height = CONFIG.coverSize;

      ctx.fillStyle = '#fff8ef';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawContain(ctx, img, canvas.width, canvas.height);

      const blob = await exportCompressed(canvas, CONFIG.coverTargetKB);

      if (!blob || blob.size >= file.size) {
        return file;
      }

      return new File([blob], makeFileName(file.name, 'cover'), {
        type: blob.type || CONFIG.mime,
        lastModified: Date.now()
      });
    }

    const size = getGalleryCanvasSize(img);

    canvas.width = size.width;
    canvas.height = size.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await exportCompressed(canvas, CONFIG.galleryTargetKB);

    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], makeFileName(file.name, 'photo'), {
      type: blob.type || CONFIG.mime,
      lastModified: Date.now()
    });
  }

  function replaceInputFiles(input, files) {
    if (!window.DataTransfer) {
      return false;
    }

    const dataTransfer = new DataTransfer();

    files.forEach((file) => dataTransfer.items.add(file));

    input.files = dataTransfer.files;

    return true;
  }

  async function handleFileInputChange(event) {
    const input = event.target;

    if (!isProductImageInput(input)) return;

    if (input.dataset.otbasuCompressedReady === 'true') {
      delete input.dataset.otbasuCompressedReady;
      return;
    }

    const files = Array.from(input.files || []);

    if (!files.length) return;

    const hasImages = files.some((file) => file.type.startsWith('image/'));

    if (!hasImages) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const beforeSize = files.reduce((sum, file) => sum + file.size, 0);
    const coverMode = isCoverInput(input);

    showCompressionNote(input, 'Сжимаю фото перед загрузкой…', 'working');

    try {
      const compressedFiles = [];

      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          compressedFiles.push(file);
          continue;
        }

        const mode = coverMode ? 'cover' : 'gallery';
        const compressed = await compressImageFile(file, mode);

        compressedFiles.push(compressed);
      }

      const replaced = replaceInputFiles(input, compressedFiles);

      if (!replaced) {
        showCompressionNote(input, 'Фото выбраны, но браузер не разрешил автозамену файлов.', 'error');

        input.dataset.otbasuCompressedReady = 'true';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      const afterSize = compressedFiles.reduce((sum, file) => sum + file.size, 0);
      const savedPercent = beforeSize > 0
        ? Math.max(0, Math.round((1 - afterSize / beforeSize) * 100))
        : 0;

      showCompressionNote(
        input,
        `Фото оптимизированы: ${bytesToText(beforeSize)} → ${bytesToText(afterSize)}. Экономия ${savedPercent}%.`,
        'ok'
      );

      input.dataset.otbasuCompressedReady = 'true';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      console.error('[OTBASU] Ошибка сжатия фото:', error);

      showCompressionNote(input, 'Не удалось сжать фото. Сохранение продолжится с оригиналом.', 'error');

      input.dataset.otbasuCompressedReady = 'true';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function addStaticCompressionHint() {
    injectCompressionStyles();

    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter(isProductImageInput);

    inputs.forEach((input) => {
      if (input.dataset.otbasuCompressHintAdded === 'true') return;

      input.dataset.otbasuCompressHintAdded = 'true';

      const parent = input.closest('.field, label, div') || input.parentElement;
      if (!parent || parent.querySelector('.otbasu-compress-note')) return;

      const note = document.createElement('div');
      note.className = 'otbasu-compress-note';
      note.textContent = isCoverInput(input)
        ? 'Автосжатие включено: обложка будет 1080×1080 и легче для витрины.'
        : 'Автосжатие включено: большие фото будут уменьшены и быстрее загрузятся.';

      parent.appendChild(note);
    });
  }

  injectCompressionStyles();

  document.addEventListener('change', handleFileInputChange, true);

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(addStaticCompressionHint, 500);
    window.setTimeout(addStaticCompressionHint, 1500);
  });

  document.addEventListener('click', () => {
    window.setTimeout(addStaticCompressionHint, 300);
    window.setTimeout(addStaticCompressionHint, 900);
  });

  window.setTimeout(addStaticCompressionHint, 800);
})();
/* OTBASU ADMIN LOGIN BRUTE FORCE GUARD — SAFE
   Защита формы входа от перебора пароля.
   После 5 ошибок блокирует вход на 15 минут в этом браузере.
   Если Supabase вернул 429 — блокирует на 30 минут.
   Витрину, товары, галерею и аналитику не трогает.
*/
(() => {
  if (window.__OTBASU_ADMIN_LOGIN_BRUTE_FORCE_GUARD__) return;
  window.__OTBASU_ADMIN_LOGIN_BRUTE_FORCE_GUARD__ = true;

  const STYLE_ID = 'otbasu-admin-login-guard-style';
  const STORAGE_PREFIX = 'otbasu-admin-login-guard:';

  const CONFIG = {
    maxAttempts: 5,
    lockMinutes: 15,
    rateLimitLockMinutes: 30
  };

  let timer = null;

  function injectLoginGuardStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
      .otbasu-login-guard-box {
        margin: 10px 0 14px;
        padding: 12px 14px;
        border-radius: 16px;
        font-size: 13px;
        font-weight: 850;
        line-height: 1.35;
        border: 1px solid rgba(123, 18, 79, .14);
        background: rgba(255, 248, 239, .88);
        color: #5b0d3c;
      }

      .otbasu-login-guard-box.is-warning {
        background: rgba(255, 239, 205, .92);
        color: #805000;
        border-color: rgba(128, 80, 0, .2);
      }

      .otbasu-login-guard-box.is-error {
        background: rgba(255, 231, 231, .92);
        color: #9c1028;
        border-color: rgba(156, 16, 40, .18);
      }

      .otbasu-login-guard-box.is-ok {
        background: rgba(226, 255, 235, .82);
        color: #0d5c2e;
        border-color: rgba(13, 92, 46, .14);
      }

      .otbasu-login-locked button[type="submit"] {
        opacity: .55 !important;
        cursor: not-allowed !important;
        pointer-events: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function getLoginForm() {
    return document.getElementById('loginForm') || els?.loginForm || null;
  }

  function getEmailFromForm() {
    const form = getLoginForm();
    if (!form) return 'unknown';

    const formData = new FormData(form);
    const email = String(formData.get('email') || '').trim().toLowerCase();

    return email || 'unknown';
  }

  function getKey(email = getEmailFromForm()) {
    return `${STORAGE_PREFIX}${email}`;
  }

  function readState(email = getEmailFromForm()) {
    try {
      return JSON.parse(localStorage.getItem(getKey(email)) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeState(email, value) {
    localStorage.setItem(getKey(email), JSON.stringify(value));
  }

  function clearState(email = getEmailFromForm()) {
    localStorage.removeItem(getKey(email));
  }

  function getRemainingMs(email = getEmailFromForm()) {
    const state = readState(email);
    const lockedUntil = Number(state.lockedUntil || 0);
    return Math.max(0, lockedUntil - Date.now());
  }

  function formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes <= 0) return `${seconds} сек.`;

    return `${minutes} мин. ${String(seconds).padStart(2, '0')} сек.`;
  }

  function getBox() {
    injectLoginGuardStyles();

    const form = getLoginForm();
    if (!form) return null;

    let box = document.getElementById('otbasuLoginGuardBox');

    if (!box) {
      box = document.createElement('div');
      box.id = 'otbasuLoginGuardBox';
      box.className = 'otbasu-login-guard-box';
      form.prepend(box);
    }

    return box;
  }

  function showGuardMessage(text, type = 'warning') {
    const box = getBox();
    if (!box) return;

    box.textContent = text;
    box.className = `otbasu-login-guard-box is-${type}`;
  }

  function setLoginDisabled(disabled) {
    const form = getLoginForm();
    if (!form) return;

    form.classList.toggle('otbasu-login-locked', disabled);

    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submit) submit.disabled = disabled;
  }

  function updateLockUi() {
    const email = getEmailFromForm();
    const remaining = getRemainingMs(email);

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (remaining <= 0) {
      setLoginDisabled(false);

      const state = readState(email);
      if (Number(state.lockedUntil || 0) > 0) {
        clearState(email);
        showGuardMessage('Можно снова попробовать войти.', 'ok');
      }

      return false;
    }

    setLoginDisabled(true);

    showGuardMessage(
      `Слишком много неправильных попыток. Повтори вход через ${formatTime(remaining)}.`,
      'error'
    );

    timer = setInterval(() => {
      const nextRemaining = getRemainingMs(email);

      if (nextRemaining <= 0) {
        clearInterval(timer);
        timer = null;
        setLoginDisabled(false);
        clearState(email);
        showGuardMessage('Можно снова попробовать войти.', 'ok');
        return;
      }

      showGuardMessage(
        `Слишком много неправильных попыток. Повтори вход через ${formatTime(nextRemaining)}.`,
        'error'
      );
    }, 1000);

    return true;
  }

  function registerFailedAttempt(email, errorMessage = '') {
    const state = readState(email);
    const attempts = Number(state.attempts || 0) + 1;

    const isRateLimited =
      /429|too many|rate limit|rate exceeded|слишком много/i.test(String(errorMessage || ''));

    if (isRateLimited) {
      writeState(email, {
        attempts,
        lockedUntil: Date.now() + CONFIG.rateLimitLockMinutes * 60 * 1000
      });

      updateLockUi();
      return;
    }

    if (attempts >= CONFIG.maxAttempts) {
      writeState(email, {
        attempts,
        lockedUntil: Date.now() + CONFIG.lockMinutes * 60 * 1000
      });

      updateLockUi();
      return;
    }

    writeState(email, {
      attempts,
      lockedUntil: 0
    });

    const left = Math.max(0, CONFIG.maxAttempts - attempts);

    showGuardMessage(
      `Неверный вход. Осталось попыток: ${left}. После этого вход временно заблокируется.`,
      'warning'
    );
  }

  function registerSuccessfulLogin(email) {
    clearState(email);
    setLoginDisabled(false);
  }

  function patchSupabaseLogin() {
    if (!supabase?.auth?.signInWithPassword) return;
    if (supabase.auth.signInWithPassword.__otbasuLoginGuardPatched) return;

    const originalSignIn = supabase.auth.signInWithPassword.bind(supabase.auth);

    const patchedSignIn = async (...args) => {
      const email = String(args?.[0]?.email || getEmailFromForm()).trim().toLowerCase() || 'unknown';

      const remaining = getRemainingMs(email);

      if (remaining > 0) {
        updateLockUi();

        return {
          data: null,
          error: {
            message: `Вход временно заблокирован. Повтори через ${formatTime(remaining)}.`
          }
        };
      }

      const result = await originalSignIn(...args);

      if (result?.error) {
        registerFailedAttempt(email, result.error.message);
      } else {
        registerSuccessfulLogin(email);
      }

      return result;
    };

    patchedSignIn.__otbasuLoginGuardPatched = true;
    supabase.auth.signInWithPassword = patchedSignIn;
  }

  function blockSubmitWhenLocked(event) {
    const email = getEmailFromForm();
    const remaining = getRemainingMs(email);

    if (remaining <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    updateLockUi();
  }

  function initLoginGuard() {
    injectLoginGuardStyles();
    patchSupabaseLogin();

    const form = getLoginForm();

    if (!form || form.dataset.otbasuLoginGuardReady === 'true') return;

    form.dataset.otbasuLoginGuardReady = 'true';

    form.addEventListener('submit', blockSubmitWhenLocked, true);

    const emailInput =
      form.querySelector('input[name="email"]') ||
      form.querySelector('input[type="email"]');

    emailInput?.addEventListener('input', () => {
      window.setTimeout(updateLockUi, 50);
    });

    updateLockUi();
  }

  injectLoginGuardStyles();

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(initLoginGuard, 300);
    window.setTimeout(initLoginGuard, 1000);
  });

  window.setTimeout(initLoginGuard, 500);
})();
