import {extend, BlockStack, Text} from '@shopify/checkout-ui-extensions';

extend('Checkout::PostPurchase::Render', (root, {order}) => {
  const bgnTotal = parseFloat(order.subtotalAmount.amount);
  const container = root.createComponent(BlockStack, {});
  container.appendChild(
    root.createComponent(Text, {}, `Сума (BGN): ${bgnTotal.toFixed(2)} лв`)
  );

  fetch('https://api.exchangerate.host/latest?base=BGN&symbols=EUR')
    .then(res => res.json())
    .then(data => {
      const rate = data.rates.EUR;
      const eurTotal = (bgnTotal * rate).toFixed(2);
      container.appendChild(
        root.createComponent(
          Text,
          {},
          `Сума (EUR): ${eurTotal} €  (курс: ${rate.toFixed(4)})`
        )
      );
    })
    .catch(() => {
      const eurTotal = (bgnTotal / 1.96).toFixed(2);
      container.appendChild(
        root.createComponent(Text, {}, `Сума (EUR): ${eurTotal} €`)
      );
    });

  root.appendChild(container);
});
