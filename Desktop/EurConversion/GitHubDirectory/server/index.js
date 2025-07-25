// extensions/customer-account/src/OrderStatus.jsx
import React, {useEffect, useState} from 'react';
import {
  reactExtension,
  useApi,
  useSettings,
  useSubscription,
  Text,
  View,
  BlockStack,
  InlineLayout,
  Divider,
} from '@shopify/ui-extensions-react/customer-account';

const EUR_TO_BGN_RATE = 1.95583;
const convertToEUR = (bgn) => ((parseFloat(bgn) || 0) / EUR_TO_BGN_RATE).toFixed(2);

export default reactExtension(
  'customer-account.order-status.block.render',
  () => <OrderStatus />
);

function OrderStatus() {
  const api = useApi();
  const settings = useSettings();
  // На този етап api.order съдържа само id и name
  const orderRemote = useSubscription(api.order);
  const orderGid = orderRemote?.id;
  const orderId = orderGid?.split('/').pop();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    fetch(`${process.env.BACKEND_URL}/api/orders/${orderId}`)
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Order fetch error:', err);
        setLoading(false);
      });
  }, [orderId]);

  if (loading) return <Text>Зареждане...</Text>;
  if (!data) return <Text>Грешка при зареждане на данни.</Text>;

  const {lineItems, subtotalPrice, totalShippingPrice, totalPrice} = data;

  return (
    <View padding="base" border="base" cornerRadius="base" background="subdued">
      <BlockStack spacing="tight">
        <Text size="medium" emphasis="bold">EUR / BGN Pricing</Text>

        {/* Total Paid */}
        <InlineLayout spacing="base" blockAlignment="center">
          <Text size="large" emphasis="bold">
            {totalPrice.amount} {totalPrice.currencyCode} / {convertToEUR(totalPrice.amount)} EUR
          </Text>
        </InlineLayout>

        <Divider />
        <Text size="small" emphasis="bold" appearance="subdued">Разбивка:</Text>

        {lineItems.map((item) => (
          <InlineLayout key={item.id} spacing="base" blockAlignment="center">
            <Text size="small">{item.quantity}× {item.title}</Text>
            <Text size="small" emphasis="bold">
              {item.originalUnitPrice.amount} {item.originalUnitPrice.currencyCode} / {convertToEUR(item.originalUnitPrice.amount)} EUR —
              {item.originalTotalPrice.amount} {item.originalTotalPrice.currencyCode} / {convertToEUR(item.originalTotalPrice.amount)} EUR
            </Text>
          </InlineLayout>
        ))}

        {/* Subtotal */}
        <InlineLayout spacing="base" blockAlignment="center">
          <Text size="small">Стоки</Text>
          <Text size="small" emphasis="bold">
            {subtotalPrice.amount} {subtotalPrice.currencyCode} / {convertToEUR(subtotalPrice.amount)} EUR
          </Text>
        </InlineLayout>

        {/* Shipping */}
        <InlineLayout spacing="base" blockAlignment="center">
          <Text size="small">Доставка</Text>
          <Text size="small" emphasis="bold">
            {totalShippingPrice.amount} {totalShippingPrice.currencyCode} / {convertToEUR(totalShippingPrice.amount)} EUR
          </Text>
        </InlineLayout>

        {settings.show_rate_info && (
          <>
            <Divider />
            <Text size="small" appearance="subdued">
              Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN
            </Text>
          </>
        )}
        {settings.highlight_euro_switch && (
          <>
            <Divider />
            <Text size="small" appearance="warning">
              ⚠️ От 01.01.2026 г. България преминава към EUR
            </Text>
          </>
        )}
      </BlockStack>
    </View>
  );
}
