// OrderStatus.jsx

import {
  extension,
  Text,
  BlockStack,
  InlineLayout,
  Divider,
  Heading,
  View,
} from '@shopify/ui-extensions/customer-account';

// Обменен курс
const BGN_TO_EUR_RATE = 1.95583;
const convertToEUR = (bgn) => ((parseFloat(bgn) || 0) / BGN_TO_EUR_RATE).toFixed(2);

// Регистрираме разширението
export default extension(
  'customer-account.order-status.block.render',
  (root, api) => {
    // Създаваме основния контейнер, който ще държи всичко
    const appContainer = root.createComponent(BlockStack);
    root.appendChild(appContainer);

    // Показваме "Зареждане...", докато чакаме данни
    const loadingText = root.createComponent(Text, {}, 'Зареждане на цени...');
    appContainer.appendChild(loadingText);
    
    let hasFetched = false; // Предпазител, за да не се изпълнява заявката многократно

    // Абонираме се за данни за поръчката
    api.order.subscribe((order) => {
      // Изпълняваме заявката само веднъж, когато получим ID и все още не сме го направили
      if (order && order.id && !hasFetched) {
        hasFetched = true; // Маркираме, че сме започнали заявка

        const orderId = order.id.split('/').pop();
        
        const appUrl = 'https://shopify-currency-converter-production.up.railway.app';
        // Използваме api.shop.myshopifyDomain за да вземем домейна на магазина
        const fetchUrl = `${appUrl}/api/order/${orderId}?shop=${api.shop.myshopifyDomain}`;
	console.log('FETCH URL:', fetchUrl);
        fetch(fetchUrl)
          .then(res => {
            if (!res.ok) {
              // Хвърляме грешка, за да я хване .catch()
              return res.text().then(text => { throw new Error(`Грешка от сървъра: ${res.status} - ${text}`) });
            }
            return res.json();
          })
          .then(data => {
            if (data.error) {
              throw new Error(data.error);
            }
            // Успех! Чистим "Зареждане..." и рисуваме блока с цените
            appContainer.removeChild(loadingText);
            const priceBlock = createPriceBlock(root, data);
            appContainer.appendChild(priceBlock);
          })
          .catch(err => {
            console.error(err);
            // Провал! Чистим "Зареждане..." и показваме грешката
            appContainer.removeChild(loadingText);
            const errorText = root.createComponent(Text, { appearance: 'critical' }, `Неуспешно зареждане: ${err.message}`);
            appContainer.appendChild(errorText);
          });
      }
    });
  },
);

// Помощна функция, която създава целия UI блок с цените
function createPriceBlock(root, orderData) {
  const { subtotalPrice, shippingPrice, totalPrice, lineItems } = orderData;
  
  const container = root.createComponent(View, {
    padding: 'base',
    border: 'base',
    cornerRadius: 'base',
  });

  const mainStack = root.createComponent(BlockStack, { spacing: 'base' });
  mainStack.appendChild(root.createComponent(Heading, { level: 2 }, 'Крайна сметка'));

  // Продукти
  (lineItems || []).forEach((item) => {
    const itemStack = root.createComponent(InlineLayout, { columns: ['fill', 'auto'], spacing: 'base', blockAlignment: 'center' });
    itemStack.appendChild(root.createComponent(Text, {}, `${item.quantity}× ${item.title}`));
    itemStack.appendChild(
      root.createComponent(Text, { emphasis: 'bold', alignment: 'end' }, `${parseFloat(item.price).toFixed(2)} лв / ${convertToEUR(item.price)} EUR`)
    );
    mainStack.appendChild(itemStack);
  });
  
  mainStack.appendChild(root.createComponent(Divider));

  // Разбивка
  const totalsStack = root.createComponent(BlockStack, { spacing: 'tight' });
  const subtotalStack = root.createComponent(InlineLayout, { columns: ['fill', 'auto'], spacing: 'base' });
  subtotalStack.appendChild(root.createComponent(Text, {}, 'Стоки'));
  subtotalStack.appendChild(root.createComponent(Text, { emphasis: 'bold', alignment: 'end' }, `${parseFloat(subtotalPrice).toFixed(2)} лв / ${convertToEUR(subtotalPrice)} EUR`));
  totalsStack.appendChild(subtotalStack);

  const shippingStack = root.createComponent(InlineLayout, { columns: ['fill', 'auto'], spacing: 'base' });
  shippingStack.appendChild(root.createComponent(Text, {}, 'Доставка'));
  shippingStack.appendChild(root.createComponent(Text, { emphasis: 'bold', alignment: 'end' }, shippingPrice > 0 ? `${parseFloat(shippingPrice).toFixed(2)} лв / ${convertToEUR(shippingPrice)} EUR` : 'БЕЗПЛАТНА'));
  totalsStack.appendChild(shippingStack);
  mainStack.appendChild(totalsStack);
  
  mainStack.appendChild(root.createComponent(Divider));

  // Общо
  const grandTotalStack = root.createComponent(InlineLayout, { columns: ['fill', 'auto'], spacing: 'base' });
  grandTotalStack.appendChild(root.createComponent(Text, { emphasis: 'bold' }, 'Общо'));
  grandTotalStack.appendChild(root.createComponent(Text, { emphasis: 'bold', alignment: 'end' }, `${parseFloat(totalPrice).toFixed(2)} лв / ${convertToEUR(totalPrice)} EUR`));
  mainStack.appendChild(grandTotalStack);

  container.appendChild(mainStack);
  return container;
}