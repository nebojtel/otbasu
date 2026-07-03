      min-height: 42px !important;
      padding: 7px 8px !important;
      display: grid !important;
      gap: 2px !important;
      background: rgba(255,255,255,.9) !important;
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
      font-size: 10px !important;
      line-height: 1.15 !important;
      color: rgba(77, 10, 51, .6) !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .gallery-order,
    .gallery-star,
    .gallery-remove {
      position: absolute !important;
      z-index: 3 !important;
      top: 7px !important;
      width: 26px !important;
      height: 26px !important;
      min-width: 26px !important;
      min-height: 26px !important;
      padding: 0 !important;
      border-radius: 999px !important;
      display: grid !important;
      place-items: center !important;
      border: 0 !important;
      background: rgba(255,255,255,.94) !important;
      box-shadow: 0 9px 20px rgba(0,0,0,.14) !important;
      line-height: 1 !important;
    }

    .gallery-order {
      left: 7px !important;
      color: #4d0a33 !important;
      font-size: 12px !important;
      font-weight: 950 !important;
    }

    .gallery-star {
      left: 38px !important;
      color: #f2a900 !important;
      cursor: pointer !important;
      font-size: 15px !important;
    }

    .gallery-remove {
      right: 7px !important;
      color: #991b1b !important;
      cursor: pointer !important;
      font-size: 17px !important;
    }

    .gallery-item.is-cover .gallery-order,
    .gallery-item.is-cover .gallery-star {
      background: #f2a900 !important;
      color: #fff !important;
    }

    #productDialog .muted.small {
      font-size: 0 !important;
      line-height: 0 !important;
      margin: 0 !important;
    }

    #productDialog .muted.small::after {
      content: 'До 5 фото. Цифра — порядок на витрине, ★ — обложка. Перетащи карточку мышкой, чтобы изменить порядок.';
      display: block !important;
      font-size: 12px !important;
      line-height: 1.3 !important;
      color: rgba(77, 10, 51, .62) !important;
      margin-top: 4px !important;
      font-weight: 800 !important;
    }

    #productDialog .dialog-actions {
      position: sticky !important;
      bottom: 0 !important;
      z-index: 10 !important;
      margin: 0 !important;
      padding-top: 12px !important;
      background: #fffaf3 !important;
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
        grid-template-columns: minmax(0, 1fr) minmax(400px, .9fr) !important;
        gap: 18px !important;
      }

      #imagePreview {
        height: 220px !important;
        min-height: 220px !important;
        max-height: 220px !important;
      }
    }

    @media (max-width: 900px) {
      #productDialog {
        width: calc(100vw - 18px) !important;
        max-height: calc(100vh - 18px) !important;
        border-radius: 24px !important;
      }

      #productDialog .dialog-card,
      #productDialog form {
        height: auto !important;
        max-height: calc(100vh - 18px) !important;
        overflow: auto !important;
        padding: 20px !important;
      }

      #productDialog .product-form-grid {
        grid-template-columns: 1fr !important;
        overflow: visible !important;
      }

      #productDialog .form-stack,
      #productDialog .image-box {
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

bindEvents();
injectAdminUiFixes();
requireSession();
