import { GoogleGenAI } from "@google/genai";

// Initialize official Google Gen AI Client
function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is missing.");
  }
  return new GoogleGenAI({ apiKey });
}

export interface ParsedExpenseLog {
  amount: number;
  currency?: string;
  category: string;
  notes: string;
  senderName?: string | null;
  vehicle?: string | null;
  date?: string | null;
  type?: "EXPENSE" | "INCOME";
}

export interface ReceiptScanResult {
  amount: number;
  vehicle?: string | null;
  senderName?: string | null;
  notes: string;
  date?: string | null;
}

/**
 * Fast & accurate text expense parser using gemini-2.0-flash-lite with strict JSON output.
 */
export async function parseExpenseText(rawText: string): Promise<ParsedExpenseLog[]> {
  const ai = getAiClient();
  const prompt = `
You are an intelligent logistics accounting parser for "Dreamline Logistics".
Analyze the user's operational log text and extract structured financial line items.

Rules:
1. Identify all amounts, categories, driver names, vehicle numbers, and notes.
2. Categories MUST be one of: 
   - 'fuel' (diesel, CNG, petrol)
   - 'bittu' (ALL driver salary advances, personal loans, daily kharcha, food/medicine money given to drivers like Rahul, Bittu, etc.)
   - 'service' (repairs, mechanics, spare parts, tires)
   - 'shadowfax' (client/vendor payments)
   - 'rate_change' (rate adjustments)
   - 'factory' (factory expenses)
   - 'other_income' (income received)
   - 'other' (miscellaneous expenses)
3. Fields per item:
   - amount: (number) Numeric amount in INR.
   - category: (string) One of the allowed categories.
   - notes: (string) Description of transaction (e.g. 'Rahul advance salary for medicine').
   - senderName: (string or null) The name of driver receiving advance (e.g. 'Rahul', 'Bittu') or client, otherwise null.
   - vehicle: (string or null) Vehicle plate (e.g. MH-12-AB-1234), otherwise null.
   - date: (string or null) UTC ISO 8601 date string if past date specified, otherwise null.
   - type: (string) "INCOME" if money received/earned, otherwise "EXPENSE".

User Input: "${rawText}"

Return ONLY a valid double-quoted JSON array of objects.
`;

  const MODEL_CHAIN = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"];
  let lastError = "";

  for (const model of MODEL_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const text = response.text || "";
      const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        return parsed as ParsedExpenseLog[];
      } else if (typeof parsed === "object" && parsed !== null) {
        return [parsed as ParsedExpenseLog];
      }
    } catch (e: any) {
      lastError = e.message || String(e);
      console.warn(`[AI Parser] Model ${model} failed, trying fallback...`, lastError);
    }
  }

  throw new Error(`AI Expense Parser failed across model chain: ${lastError}`);
}

/**
 * Multimodal fuel & service receipt scanner.
 */
export async function scanReceiptImage(imageUrl: string): Promise<ReceiptScanResult> {
  const ai = getAiClient();
  const prompt = `
Analyze this fuel pump / service receipt image. Extract operational logistics details:
- amount: (number) Total amount paid in INR.
- vehicle: (string or null) License plate printed or written on slip (e.g. MH-12-PQ-4567), otherwise null.
- senderName: (string or null) Driver name printed/written, otherwise null.
- notes: (string) Clean description (e.g. "Diesel fuel refill", "Auto Servicing").
- date: (string or null) Printed date/time in ISO 8601 UTC format, or null.

Return ONLY a raw JSON object with these fields.
`;

  const base64Data = imageUrl.split(",")[1] || imageUrl;
  const mimeType = imageUrl.split(";")[0]?.split(":")[1] || "image/jpeg";

  const MODEL_CHAIN = ["gemini-2.0-flash", "gemini-2.5-flash"];
  let lastError = "";

  for (const model of MODEL_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const text = response.text || "";
      const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned) as ReceiptScanResult;
    } catch (e: any) {
      lastError = e.message || String(e);
      console.warn(`[AI Vision] Model ${model} failed, trying fallback...`, lastError);
    }
  }

  throw new Error(`AI Receipt Scanner failed: ${lastError}`);
}

/**
 * Stream AI Chat Assistant answers asynchronously using generateContentStream.
 */
export async function* streamChatAssistant(userQuery: string, dbContext: string) {
  const ai = getAiClient();
  const prompt = `
You are the AI Operations & Analytics Co-Pilot for "Dreamline Logistics".
Answer the user's question clearly, concisely, and accurately based on the live system database below.

Live System Database Context:
${dbContext}

User Question: "${userQuery}"

Provide a direct, friendly, and structured Markdown response.
`;

  const MODEL_CHAIN = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash"];
  let streamSuccess = false;
  let lastError = "";

  for (const model of MODEL_CHAIN) {
    try {
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: {
          temperature: 0.3,
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
      streamSuccess = true;
      break;
    } catch (e: any) {
      lastError = e.message || String(e);
      console.warn(`[AI Chat Stream] Model ${model} failed, trying fallback...`, lastError);
    }
  }

  if (!streamSuccess) {
    throw new Error(`AI Chat Stream failed: ${lastError}`);
  }
}
