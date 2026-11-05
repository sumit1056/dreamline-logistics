import type { LoaderFunctionArgs } from "react-router";

/**
 * 24/7 Render Keep-Awake Ping Endpoint
 * Ultra-fast 1ms response with ZERO database queries.
 * Prevents Render free-tier instances from spinning down without consuming Neon PostgreSQL hours.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return new Response(
    JSON.stringify({
      status: "awake",
      app: "dreamline-logistics",
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

