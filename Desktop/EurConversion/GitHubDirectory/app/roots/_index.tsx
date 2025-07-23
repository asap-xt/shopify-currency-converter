import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node"; 
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { AppProvider, Page, Card, FormLayout, TextField, Select, Button, Banner } from "@shopify/polaris";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface LoaderData {
  settings: {
    baseCurrency: string;
    exchangeRate: number;
    isActive: boolean;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "example-shop.myshopify.com";
  
  let settings = await prisma.settings.findUnique({
    where: { shop }
  });
  
  if (!settings) {
    settings = await prisma.settings.create({
      data: {
        shop,
        baseCurrency: "BGN",
        exchangeRate: 1.95583,
        isActive: true
      }
    });
  }
  
  return json({
    settings: {
      baseCurrency: settings.baseCurrency,
      exchangeRate: settings.exchangeRate,
      isActive: settings.isActive
    }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "example-shop.myshopify.com";
  
  const baseCurrency = formData.get("baseCurrency") as string;
  const exchangeRate = parseFloat(formData.get("exchangeRate") as string);
  const isActive = formData.get("isActive") === "true";
  
  await prisma.settings.upsert({
    where: { shop },
    update: { baseCurrency, exchangeRate, isActive },
    create: { shop, baseCurrency, exchangeRate, isActive }
  });
  
  return json({ success: true });
}

export default function Index() {
  const { settings } = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  
  const currencyOptions = [
    { label: "Лева (BGN)", value: "BGN" },
    { label: "Евро (EUR)", value: "EUR" }
  ];
  
  const statusOptions = [
    { label: "Активен", value: "true" },
    { label: "Неактивен", value: "false" }
  ];

  return (
    <AppProvider>
      <Page title="Dual Currency Display - Настройки">
        <Card>
          <Banner status="info">
            <p>Настройте основната валута и обменния курс за показване на цените в две валути.</p>
          </Banner>
          
          <div style={{ padding: "20px 0" }}>
            <Form method="post">
              <FormLayout>
                <Select
                  label="Основна валута"
                  options={currencyOptions}
                  value={settings.baseCurrency}
                  name="baseCurrency"
                  helpText="Изберете основната валута на магазина"
                />
                
                <TextField
                  label="Обменен курс"
                  type="number"
                  step="0.00001"
                  value={settings.exchangeRate.toString()}
                  name="exchangeRate"
                  helpText={settings.baseCurrency === "BGN" 
                    ? "1 EUR = X BGN (например: 1.95583)" 
                    : "1 BGN = X EUR (например: 0.511292)"
                  }
                  autoComplete="off"
                />
                
                <Select
                  label="Статус"
                  options={statusOptions}
                  value={settings.isActive.toString()}
                  name="isActive"
                  helpText="При неактивиране блокът няма да се показва"
                />
                
                <Button
                  submit
                  primary
                  loading={isSubmitting}
                >
                  {isSubmitting ? "Запазване..." : "Запази настройки"}
                </Button>
              </FormLayout>
            </Form>
          </div>
        </Card>
        
        <Card sectioned title="Инструкции за инсталиране">
          <p><strong>1.</strong> Отидете в админ панела на вашия Shopify магазин</p>
          <p><strong>2.</strong> Themes → Customize → Add block</p>
          <p><strong>3.</strong> Изберете "Dual Currency Display" от списъка с блокове</p>
          <p><strong>4.</strong> Добавете блока на Thank You Page и Order Status Page</p>
          <p><strong>5.</strong> Запазете промените</p>
        </Card>
      </Page>
    </AppProvider>
  );
}