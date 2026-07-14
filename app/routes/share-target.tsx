import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { prisma } from "../db.server";

/**
 * Web Share Target Handler
 *
 * Android invokes this route via POST multipart/form-data when the user
 * shares an image to Dreamline Logistics from the Gallery or any other app.
 *
 * NOTE: We do NOT enforce requireAdmin here because SameSite cookie rules
 * block session cookies on cross-app POST requests. Instead:
 * 1. We receive the image file.
 * 2. Save it as a temporary unapproved expense record (category: "shared_temp").
 * 3. Redirect the browser to the home route GET request.
 * 4. The home loader (which receives the session cookie during GET) will authenticate
 *    the user and run the Gemini scanning on the saved ID.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    const mediaFiles = formData.getAll("media") as File[];

    if (!mediaFiles || mediaFiles.length === 0 || (mediaFiles.length === 1 && mediaFiles[0].size === 0)) {
      return redirect("/?tab=expenses");
    }

    const tempExpenseIds: number[] = [];

    for (const file of mediaFiles) {
      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64Data = btoa(binary);
        const mimeType = file.type || "image/jpeg";
        const imageUrl = `data:${mimeType};base64,${base64Data}`;

        // Create a temporary unapproved Expense record
        const tempExpense = await prisma.expense.create({
          data: {
            amount: 0,
            category: "shared_temp",
            notes: "Processing shared receipt...",
            senderName: "Shared Photo Target",
            approved: false,
            imageUrl: imageUrl,
            type: "EXPENSE",
          }
        });
        tempExpenseIds.push(tempExpense.id);
      }
    }

    if (tempExpenseIds.length === 0) {
      return redirect("/?tab=expenses");
    }

    return redirect(`/?tab=expenses&processSharedIds=${tempExpenseIds.join(",")}`);
  } catch (err: any) {
    console.error("Share target request parsing failed:", err);
    return redirect(`/?tab=expenses&shareError=${encodeURIComponent(err.message || "Failed to process shared files")}`);
  }
}

export default function ShareTarget() {
  return null;
}
