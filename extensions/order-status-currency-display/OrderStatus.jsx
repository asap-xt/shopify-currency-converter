// extensions/order-status-currency-display/src/OrderStatus.jsx
import React from 'react';
import {
  reactExtension,
  Text,
  View,
  BlockStack,
  InlineLayout,
  useApi,
  Divider,
  useLocalizationCountry,
  useLocalizationMarket
} from '@shopify/ui-extensions-react/customer-account';

const EUR_TO_BGN_RATE = 1.95583;

// Функции за конвертиране - СЪЩИТЕ КАТО В Checkout.jsx
const convertBGNtoEUR = (bgnAmount) => {
  return (parseFloat(bgnAmount) / EUR_TO_BGN_RATE).toFixed(2);
};

const convertEURtoBGN = (eurAmount) => {
  return (parseFloat(eurAmount) * EUR_TO_BGN_RATE).toFixed(2);
};

export default reactExtension(
  'customer-account.order-status.block.render',
  () => <OrderStatusExtension />,
);

function OrderStatusExtension() {
  const api = useApi();
  const country = useLocalizationCountry();
  const market = useLocalizationMarket();
  
  const [orderData, setOrderData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  
  // ПРОВЕРКА - показваме САМО за България (същата логика като Checkout.jsx)
  const isBulgaria = country?.isoCode === 'BG' || 
                     market?.handle === 'bulgaria' || 
                     market?.handle === 'bg';
  
  if (!isBulgaria) {
    return null; // Не показваме за други държави/markets
  }
  
  React.useEffect(() => {
    const fetchOrderData = async () => {
      try {
        // Get order ID from the order status context
        const orderId = api.orderStatus?.order?.id;
        
        if (!orderId) {
          console.log('No order ID available');
          setLoading(false);
          return;
        }
        
        // Query за order детайли
        const query = `
          query getOrderDetails($id: ID!) {
            order(id: $id) {
              id
              currencyCode
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              subtotalPriceSet {
                shopMoney {
                  amount
                }
              }
              totalShippingPriceSet {
                shopMoney {
                  amount
                }
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    quantity
                    originalTotalSet {
                      shopMoney {
                        amount
                      }
                    }
                  }
                }
              }
            }
          }
        `;
        
        const { data } = await api.query(query, {
          variables: { id: orderId }
        });
        
        if (data?.order) {
          setOrderData(data.order);
        }
      } catch (error) {
        console.error('Error fetching order:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchOrderData();
  }, [api]);
  
  if (loading || !orderData) {
    return null;
  }
  
  // Определяме валутата и сумите
  const currency = orderData.currencyCode;
  const isBGN = currency === 'BGN';
  
  const totalAmount = parseFloat(orderData.totalPriceSet?.shopMoney?.amount || 0);
  const subtotalAmount = parseFloat(orderData.subtotalPriceSet?.shopMoney?.amount || 0);
  const shippingAmount = parseFloat(orderData.totalShippingPriceSet?.shopMoney?.amount || 0);
  
  const lines = orderData.lineItems?.edges || [];
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        {/* Заглавие с флагове - същото като в Checkout.jsx */}
        <Text size="medium" emphasis="bold">
          🇧🇬 Твоята поръчка 🇪🇺
        </Text>
        
        {/* Разбивка секция */}
        <View padding="base" background="base" cornerRadius="base">
          <BlockStack spacing="base">
            <Text size="small" emphasis="bold">
              Продукти:
            </Text>
            
            {/* Продукти по отделно */}
            {lines.length > 0 && (
              <BlockStack spacing="tight">
                {lines.map((edge, index) => {
                  const line = edge.node;
                  const lineAmount = parseFloat(line.originalTotalSet?.shopMoney?.amount || 0);
                  
                  const displayPrice = isBGN
                    ? `${lineAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(lineAmount)} EUR`
                    : `${lineAmount.toFixed(2)} EUR / ${convertEURtoBGN(lineAmount)} ЛВ`;

                  return (
                    <InlineLayout
                      key={line.id || index}
                      spacing="base"
                      blockAlignment="center"
                    >
                      <View inlineAlignment="start" minInlineSize="fill">
                        <Text size="small">
                          {line.quantity}× {line.title}
                        </Text>
                      </View>
                      <View inlineAlignment="end">
                        <Text size="small" emphasis="bold">
                          {displayPrice}
                        </Text>
                      </View>
                    </InlineLayout>
                  );
                })}
              </BlockStack>
            )}

            {/* Доставка */}
            {shippingAmount > 0 && (
              <>
                <Divider />
                <InlineLayout spacing="base" blockAlignment="center">
                  <View inlineAlignment="start" minInlineSize="fill">
                    <Text size="small">Доставка</Text>
                  </View>
                  <View inlineAlignment="end">
                    <Text size="small" emphasis="bold">
                      {isBGN
                        ? `${shippingAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(shippingAmount)} EUR`
                        : `${shippingAmount.toFixed(2)} EUR / ${convertEURtoBGN(shippingAmount)} ЛВ`
                      }
                    </Text>
                  </View>
                </InlineLayout>
              </>
            )}
          </BlockStack>
        </View>
        
        {/* Обща сума */}
        <View padding="tight" background="interactive" cornerRadius="base">
          <InlineLayout spacing="base" blockAlignment="center">
            <View inlineAlignment="start" minInlineSize="fill">
              <Text size="medium" emphasis="bold">Общо:</Text>
            </View>
            <View inlineAlignment="end">
              <Text size="large" emphasis="bold">
                {isBGN
                  ? `${totalAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(totalAmount)} EUR`
                  : `${totalAmount.toFixed(2)} EUR / ${convertEURtoBGN(totalAmount)} ЛВ`
                }
              </Text>
            </View>
          </InlineLayout>
        </View>
        
        {/* Курс */}
        <View padding="extraTight">
          <Text size="small" appearance="subdued">
            Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN (фиксиран курс на БНБ)
          </Text>
        </View>
      </BlockStack>
    </View>
  );
}