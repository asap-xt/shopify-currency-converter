import { LoaderFunctionArgs } from "@remix-run/node";
import { shopify } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get("shop");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!shop || !code) {
    throw new Response("Missing required parameters", { status: 400 });
  }

  try {
    const callback = await shopify.auth.callback({
      rawRequest: request,
    });

    const { session } = callback;

    if (!session) {
      throw new Response("Could not create session", { status: 500 });
    }

    // Redirect to the main app
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/?shop=${shop}`,
      },
    });
  } catch (error) {
    console.error("Auth callback error:", error);
    throw new Response("Authentication failed", { status: 500 });
  }
}