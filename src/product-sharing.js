let feedbackTimer;
let sharedProductRevealed = false;

function announce(message) {
  const feedback = document.querySelector('[data-vitrine-feedback]');
  if (!feedback) return;
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 5000);
}

export function revealSharedProduct(root) {
  if (sharedProductRevealed) return;
  sharedProductRevealed = true;
  const id = new URL(window.location.href).searchParams.get('product');
  if (!id) return;
  const card = Array.from(root.querySelectorAll('[data-product-id]')).find((node) => node.dataset.productId === id);
  if (!card) {
    announce('Товар по ссылке сейчас недоступен. Посмотрите другие товары.');
    return;
  }
  requestAnimationFrame(() => {
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  });
}

export function createProductShareData(product, location = window.location) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('product', product.id);
  url.hash = 'catalog';
  return { title: product.title || 'Товар ОТБАСЫ', url: url.href };
}

export function createShareLinks({ title, url }) {
  const telegram = new URL('https://t.me/share/url');
  telegram.searchParams.set('url', url);
  telegram.searchParams.set('text', title);
  const whatsapp = new URL('https://wa.me/');
  const message = `${title}\n${url}`;
  const subject = title.replace(/[\r\n]+/g, ' ');
  whatsapp.searchParams.set('text', message);
  return {
    telegram: telegram.href,
    whatsapp: whatsapp.href,
    email: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
  };
}

export function setupProductSharing(root) {
  const dialog = document.getElementById('share-link-dialog');
  if (!root || !dialog) return;
  const input = dialog.querySelector('#share-link-input');
  const feedback = dialog.querySelector('[data-share-status]');
  const manualCopy = dialog.querySelector('[data-share-manual]');
  const copyButton = dialog.querySelector('[data-share-copy]');
  const nativeButton = dialog.querySelector('[data-share-native]');
  let currentShare = null;
  let nativeSharePending = false;
  let pressedBackdrop = false;

  async function shareNatively(data, button) {
    nativeSharePending = true;
    button.disabled = true;
    try {
      // Keep this call in the original click's user activation, without prefetches.
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      return error?.name === 'AbortError' ? 'cancelled' : 'failed';
    } finally {
      nativeSharePending = false;
      button.disabled = false;
    }
  }

  function showOptions(data, opener) {
    if (dialog.open) return;
    const links = createShareLinks(data);
    dialog.querySelector('[data-share-title]').textContent = data.title;
    dialog.querySelectorAll('[data-share-target]').forEach((link) => {
      link.href = links[link.dataset.shareTarget];
    });
    input.value = data.url;
    feedback.textContent = '';
    manualCopy.hidden = true;
    copyButton.disabled = false;
    nativeButton.hidden = typeof navigator.share !== 'function';
    nativeButton.disabled = false;
    currentShare = { data, opener, token: `share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    try {
      history.pushState({ ...history.state, otbasuShareDialog: currentShare.token }, '');
    } catch (_) {
      // Some embedded browsers disallow history updates; the close button still works.
    }
    dialog.showModal();
    dialog.querySelector('[data-share-close]').focus({ preventScroll: true });
  }

  dialog.querySelector('[data-share-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const targets = [...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled)')]
      .filter((node) => node.getClientRects().length > 0);
    const index = targets.indexOf(document.activeElement);
    if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === targets.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? targets.at(-1) : targets[0])?.focus();
    }
  });
  dialog.addEventListener('close', () => {
    const previousShare = currentShare;
    currentShare = null;
    if (previousShare && history.state?.otbasuShareDialog === previousShare.token) history.back();
    if (previousShare?.opener.isConnected) previousShare.opener.focus({ preventScroll: true });
  });
  window.addEventListener('popstate', () => {
    if (dialog.open && history.state?.otbasuShareDialog !== currentShare?.token) dialog.close();
  });
  function isBackdrop(event) {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom);
  }
  dialog.addEventListener('pointerdown', (event) => { pressedBackdrop = isBackdrop(event); });
  dialog.addEventListener('click', (event) => {
    if (pressedBackdrop && isBackdrop(event)) dialog.close();
    pressedBackdrop = false;
  });

  copyButton.addEventListener('click', async () => {
    const selected = currentShare;
    if (!selected || copyButton.disabled) return;
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(selected.data.url);
      if (currentShare === selected && dialog.open) feedback.textContent = 'Ссылка на товар скопирована';
    } catch (_) {
      if (currentShare !== selected || !dialog.open) return;
      manualCopy.hidden = false;
      feedback.textContent = 'Автоматическое копирование недоступно. Ссылка выделена ниже.';
      input.focus();
      input.select();
    } finally {
      if (currentShare === selected) copyButton.disabled = false;
    }
  });
  input.addEventListener('click', () => input.select());

  nativeButton.addEventListener('click', async () => {
    const selected = currentShare;
    if (!selected || nativeSharePending) return;
    feedback.textContent = '';
    const outcome = await shareNatively(selected.data, nativeButton);
    if (currentShare !== selected || !dialog.open) return;
    if (outcome === 'shared') dialog.close();
    if (outcome === 'failed') feedback.textContent = 'Системное меню недоступно в этом браузере.';
  });

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share-product]');
    if (!button || button.disabled || nativeSharePending || dialog.open) return;
    const card = button.closest('[data-product-id]');
    if (!card) return;
    const data = createProductShareData({ id: card.dataset.productId, title: card.querySelector('h2')?.textContent });
    if (typeof navigator.share === 'function') {
      const outcome = await shareNatively(data, button);
      if (outcome !== 'failed') {
        if (button.isConnected) button.focus({ preventScroll: true });
        return;
      }
    }
    showOptions(data, button);
  });
}
