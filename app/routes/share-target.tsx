import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireAdmin } from "../session.server";
import { prisma } from "../db.server";

/**
 * Web Share Target Handler
 *
 * Android invokes this route via POST multipart/form-data when the user
 * shares an image to Dreamline Logistics from the Gallery or any other app.
 *
 * We:
 * 1. Read the shared image files directly from the request.
 * 2. Process each image in parallel by invoking Gemini's multimodal API.
 * 3. Log each scanned receipt directly to the PostgreSQL database.
 * 4. Redirect to the homepage with query parameters to show a success toast.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    await requireAdmin(request);
  } catch (e) {
    // If not authenticated, redirect to login
    return redirect("/login");
  }

  try {
    const formData = await request.formData();
    const mediaFiles = formData.getAll("media") as File[];

    if (!mediaFiles || mediaFiles.length === 0 || (mediaFiles.length === 1 && mediaFiles[0].size === 0)) {
      return redirect("/?tab=expenses");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not configured in backend .env");
    }

    // Fast Model Failover Chain
    const MODEL_CHAIN = [
      "gemini-2.5-flash",      // Primary: latest 2.5 flash
      "gemini-2.0-flash",      // Fallback 1: stable 2.0
      "gemini-2.0-flash-lite", // Fallback 2: lightest
    ];

    // Helper function to scan a single file using the failover chain
    const scanReceipt = async (file: File) => {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64Data = btoa(binary);
      const mimeType = file.type || "image/jpeg";
      const imageUrl = `data:${mimeType};base64,${base64Data}`;

      const prompt = `
        Analyze this fuel pump / service receipt image. Extract operational logistics details:
        - amount: (number) The total amount paid in Rupees/INR.
        - vehicle: (string or null) The vehicle plate/license number if printed or hand-written on the slip (e.g. MH-12-PQ-4567), otherwise null.
        - senderName: (string or null) The driver's name if printed or hand-written on the slip (e.g. Amit Sharma), otherwise null.
        - notes: (string) A clean description of the transaction (e.g. "CNG Fuel refill", "Diesel fuel refill", "Auto Servicing").
        - date: (string or null) The date/time printed on the receipt in ISO 8601 UTC format, or null if not readable.

        Return ONLY a valid, raw JSON object with these fields, for example:
        {"amount": 1200, "vehicle": "MH-12-PQ-4567", "senderName": "Amit Sharma", "notes": "CNG Fuel refill", "date": "2026-07-13T10:30:00Z"}
        Do not include markdown code block formatting (like \`\`\`json or \`\`\`).
      `;

      const requestBody = JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ]
      });

      let response: Response | null = null;
      let lastError = "";

      for (const model of MODEL_CHAIN) {
        try {
          console.log(`🤖 [Share Target Scan] Trying model: ${model}`);
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: requestBody,
            }
          );

          if (res.ok) {
            console.log(`✅ [Share Target Scan] Success with model: ${model}`);
            response = res;
            break;
          }

          if (res.status === 400 || res.status === 403 || res.status === 401) {
            const errText = await res.text();
            throw new Error(`Gemini API config error: ${errText}`);
          }

          console.warn(`⚡ [Share Target Scan] ${model} returned status ${res.status}. Falling back...`);
        } catch (err: any) {
          lastError = err.message || String(err);
          if (err.message?.includes("Gemini API config error")) throw err;
          console.warn(`⚡ [Share Target Scan] ${model} network error: ${lastError}. Trying next...`);
          continue;
        }
      }

      if (!response) {
        throw new Error(`⚠️ Gemini service busy: ${lastError}`);
      }

      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleanedText = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanedText);

      if (!parsed || typeof parsed.amount === "undefined") {
        throw new Error("Unable to parse amount from receipt image.");
      }

      const amount = Math.round(parseFloat(parsed.amount) || 0);
      const vehicle = parsed.vehicle || null;
      const notes = parsed.notes || "Fuel expense auto-scanned from shared receipt";
      const senderName = parsed.senderName || "Founder";
      const parsedDate = parsed.date ? new Date(parsed.date) : new Date();

      return { amount, vehicle, notes, senderName, parsedDate, imageUrl };
    };

    // Scan all shared files in parallel
    const validFiles = mediaFiles.filter(f => f && f.size > 0);
    if (validFiles.length === 0) {
      return redirect("/?tab=expenses");
    }

    const parsedResults = await Promise.all(validFiles.map(f => scanReceipt(f)));

    // Save to DB
    const savedExpenses = await Promise.all(
      parsedResults.map(result =>
        prisma.expense.create({
          data: {
            amount: result.amount,
            category: result.notes.toLowerCase().includes("service") ? "service" : "fuel",
            notes: result.notes,
            vehicle: result.vehicle,
            senderName: result.senderName,
            approved: true,
            imageUrl: result.imageUrl,
            type: "EXPENSE",
            timestamp: result.parsedDate,
          },
        })
      )
    );

    const totalAmount = savedExpenses.reduce((sum, e) => sum + e.amount, 0);
    return redirect(`/?tab=expenses&shareSuccess=true&count=${savedExpenses.length}&total=${totalAmount}`);
  } catch (err: any) {
    console.error("Share target receipt scan failed:", err);
    return redirect(`/?tab=expenses&shareError=${encodeURIComponent(err.message || "Failed to process shared files")}`);
  }
}

export default function ShareTarget() {
  return null;
}
