// Public copy checked against the current gallery images, never admin notes.
const highlights = {
  '5f5b18b9-58aa-4009-bcd7-f714b045b4b0': {
    title: 'Блендер смузи',
    source: '1783099790983-47864421-c3ca-4f19-93f1-ec40748c686d.webp',
    text: 'Для смузи и супов-пюре'
  },
  'a553e4fd-204a-4af0-9506-2685f16b0d8e': {
    title: 'Набор ножей 7 в 1',
    source: '1783099977366-46f9c80a-e79c-4fa6-a80a-e41b1e065a4f.webp',
    text: 'Ножи, ножницы и подставка'
  },
  '11111111-1111-4111-8111-111111111111': {
    title: 'Погружной блендер',
    source: '1783099892941-12eab039-c28e-4f75-9a15-d76aa3b41b45.webp',
    text: 'Измельчитель, венчик и мерный стакан'
  },
  '721982af-c35a-4bd9-835f-c40306029fd5': {
    title: 'Пароварка 3 яруса',
    source: '1783099932234-570e0ca4-bc48-481e-8a3e-bd2e7b1e7fff.webp',
    text: 'Для приготовления на пару'
  },
  '41237a37-3321-4a23-95fb-844be0142480': {
    title: 'Набор столовых приборов',
    source: '1783100021024-b6d86b09-40f4-4dbf-87ab-6a2213448b91.webp',
    text: 'Ложки, вилки и подарочная коробка'
  },
  '6bc604ff-7565-4f76-9010-532a0bbb869a': {
    title: 'Ручной отпариватель',
    source: '1783100048533-75d186bd-f376-49f4-a71c-cf2a7f48f4a9.webp',
    text: 'Для разглаживания одежды'
  },
  '09c553d3-3cd3-49dc-93fb-64d74087e17d': {
    title: 'Беспроводной воздуходув',
    source: '1783100084678-fafe69b0-e941-43b5-8ba6-f339cb93f370.webp',
    text: 'Для дома, автомобиля и двора'
  }
};

export function getProductHighlight(product) {
  const highlight = highlights[product.id];
  if (!highlight || product.title !== highlight.title) return '';

  // Stop using curated copy if its source photo has been replaced in the admin.
  const hasSource = (product.images || []).some((src) => {
    try {
      return new URL(src).pathname.endsWith(`/products/${product.id}/${highlight.source}`);
    } catch (_) {
      return false;
    }
  });
  return hasSource ? highlight.text : '';
}
