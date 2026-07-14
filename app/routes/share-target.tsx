import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireAdmin } from "../session.server";

/**
 * Web Share Target Handler
 *
 * Android invokes this route via POST multipart/form-data when the user
 * shares an image to Dreamline Logistics from the Gallery or any other app.
 *
 * We:
 * 1. Read the shared image file from the multipart body.
 * 2. Convert it to a base64 data URL.
 * 3. Store it in a cookie so the main page (home.tsx) can pick it up.
 * 4. Redirect back to / (the expenses entry form).
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);

  const formData = await request.formData();
  const mediaFile = formData.get("media") as File | null;

  if (!mediaFile || typeof mediaFile === "string") {
    return redirect("/?tab=expenses");
  }

  try {
    const arrayBuffer = await mediaFile.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);
    const mimeType = mediaFile.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Store the data URL in a short-lived cookie (<4KB limit, we rely on compression)
    // If it's too big we just redirect without it and let the user upload manually.
    const maxCookieSize = 3500; // chars ~3.5KB safe limit
    if (dataUrl.length <= maxCookieSize) {
      return redirect("/?tab=expenses&shared=1", {
        headers: {
          "Set-Cookie": `shared_receipt=${encodeURIComponent(dataUrl)}; Path=/; Max-Age=60; SameSite=Strict`,
        },
      });
    }

    // Image too large for a cookie: store a flag and let the client show a paste hint
    return redirect("/?tab=expenses&shared=large", {
      headers: {
        "Set-Cookie": `shared_receipt=TOO_LARGE; Path=/; Max-Age=60; SameSite=Strict`,
      },
    });
  } catch {
    return redirect("/?tab=expenses");
  }
}

// This route has no UI; it only handles POST actions.
export default function ShareTarget() {
  return null;
}
