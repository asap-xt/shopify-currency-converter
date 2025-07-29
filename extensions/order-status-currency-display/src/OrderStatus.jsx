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
  useLocalizationMarket,
  useOrder
} from '@shopify/ui-extensions-react/customer-account';

const EUR_TO_BGN_RATE = 1.95583;

// Функции за конвертиране
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
  
  // Опитваме useOrder hook директно
  const orderFromHook = useOrder();
  
  const [orderData, setOrderData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [debugInfo, setDebugInfo] = React.useState({});
  
  // ПРОВЕРКА - показваме САМО за България
  const isBulgaria = country?.isoCode === 'BG' || 
                     market?.handle === 'bulgaria' || 
                     market?.handle === 'bg';
  
  if (!isBulgaria) {
    return null;
  }
  
  React.useEffect(() => {
    // Debug информация
    const debug = {
      api: !!api,
      apiOrderStatus: api?.orderStatus,
      apiOrder: api?.order,
      orderFromHook: orderFromHook,
      url: window.location.href
    };
    
    console.log('🔍 Debug info:', debug);
    setDebugInfo(debug);
    
    // Ако имаме данни от hook-а, използваме ги директно
    if (orderFromHook && orderFromHook.totalPrice) {
      console.log('✅ Using order data from hook');
      setOrderData(orderFromHook);
      setLoading(false);
      return;
    }
    
    // Иначе се опитваме да вземем order ID и да направим query
    const fetchOrderData = async () => {
      try {
        // Различни опити за order ID
        let orderId = null;
        
        // Опит 1: от api.orderStatus
        if (api?.orderStatus?.order?.id) {
          orderId = api.orderStatus.order.id;
        }
        // Опит 2: от api.order
        else if (api?.order?.id) {
          orderId = api.order.id;
        }
        // Опит 3: от URL
        else if (window.location.pathname.includes('/orders/')) {
          const match = window.location.pathname.match(/orders\/(\d+)/);
          if (match) {
            orderId = `gid://shopify/Order/${match[1]}`;
          }
        }
        
        console.log('Order ID attempts:', orderId);
        
        if (!orderId) {
          console.log('❌ No order ID found');
          setLoading(false);
          return;
        }
        
        // Опростена GraphQL заявка
        const query = `
          query getOrder($id: ID!) {
            order(id: $id) {
              id
              currencyCode
              totalPrice {
                amount
                currencyCode
              }
              lineItems(first: 10) {
                nodes {
                  title
                  quantity
                  totalPrice {
                    amount
                  }
                }
              }
            }
          }
        `;
        
        const response = await api.query(query, {
          variables: { id: orderId }
        });
        
        console.log('GraphQL response:', response);
        
        if (response?.data?.order) {
          setOrderData(response.data.order);
        }
      } catch (error) {
        console.error('❌ Error fetching order:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchOrderData();
  }, [api, orderFromHook]);
  
  // Показваме debug информация
  if (!loading && !orderData) {
    return (
      <View padding="base" border="base" background="subdued">
        <BlockStack spacing="base">
          <Text size="medium" emphasis="bold">
            🔍 Debug Mode - Order Status Extension
          </Text>
          <Text size="small">
            Debug info: {JSON.stringify(debugInfo, null, 2)}
          </Text>
          <Text size="small" subdued>
            Проверете console за повече информация
          </Text>
        </BlockStack>
      </View>
    );
  }
  
  if (loading) {
    return (
      <View padding="base" border="base" background="subdued">
        <Text>Зареждане...</Text>
      </View>
    );
  }
  
  if (!orderData) {
    return null;
  }
  
  // Извличаме данните
  const currency = orderData.currencyCode || orderData.totalPrice?.currencyCode || 'BGN';
  const isBGN = currency === 'BGN';
  
  // Опитваме различни пътища за total
  const totalAmount = 
    parseFloat(orderData.totalPrice?.amount) || 
    parseFloat(orderData.totalPriceSet?.shopMoney?.amount) || 
    0;
  
  const lines = orderData.lineItems?.nodes || orderData.lineItems?.edges?.map(e => e.node) || [];
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">
          🇧🇬 Твоята поръчка 🇪🇺
        </Text>
        
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