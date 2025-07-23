import { json, LoaderFunctionArgs } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Shop parameter required" }, { status: 400 });
  }

  try {
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
      baseCurrency: settings.baseCurrency,
      exchangeRate: settings.exchangeRate,
      isActive: settings.isActive
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (error) {
    console.error("Settings API error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}