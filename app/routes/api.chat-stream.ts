import type { ActionFunctionArgs } from "react-router";
import { streamChatAssistant } from "../services/ai.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { userQuery, dbContext } = body;

    if (!userQuery) {
      return new Response(JSON.stringify({ error: "userQuery is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChatAssistant(userQuery, dbContext || "")) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (error: any) {
          console.error("Error in AI chat stream endpoint:", error);
          controller.enqueue(
            encoder.encode("\n\n*⚠️ AI response was interrupted. Please try asking again.*")
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    console.error("API Chat Stream action error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to initialize stream" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
