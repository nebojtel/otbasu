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

export function setupProductSharing(root) {
  root?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share-product]');
    if (!button || button.disabled) return;
    const card = button.closest('[data-product-id]');
    if (!card) return;
    const title = card.querySelector('h2')?.textContent || 'Товар ОТБАСЫ';
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('product', card.dataset.productId);
    url.hash = 'catalog';
    button.disabled = true;
    const dialog = document.getElementById('share-link-dialog');
    try {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, url: url.href });
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url.href);
        announce('Ссылка на товар скопирована');
      } catch (_) {
        const input = dialog?.querySelector('input');
        if (dialog && input) {
          input.value = url.href;
          dialog.showModal();
          input.focus();
          input.select();
          dialog.addEventListener('close', () => {
            if (button.isConnected) button.focus({ preventScroll: true });
          }, { once: true });
        }
      }
    } finally {
      button.disabled = false;
      if (!dialog?.open && button.isConnected) button.focus({ preventScroll: true });
    }
  });
}
