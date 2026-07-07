import { useState, useMemo, useEffect, useRef } from "react";
import { useLoaderData, Form, useNavigation, useActionData, useSubmit } from "react-router";
import type { Route } from "./+types/home";
import { prisma } from "../db.server";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// High-performance canvas-based client-side image compression
function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } else {
          resolve(event.target?.result as string);
        }
      };
      img.onerror = () => {
        resolve(event.target?.result as string);
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      resolve("");
    };
    reader.readAsDataURL(file);
  });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Brain - Logistics Control" },
    { name: "description", content: "Notion-styled premium Logistics Entry & Analytics Platform" },
  ];
}

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireAdmin, hashPassword } from "../session.server";

// Server Loader - Parallelized database queries (cuts Neon cloud DB lag by 66%)
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireAdmin(request);
  const loggedInUser = {
    name: session.get("userName") || "User",
    role: session.get("userRole") || "ADMIN",
    phone: session.get("userPhone") || null,
  };

  let [users, expenses, deliveries, adminCredentials, settings] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.expense.findMany({ orderBy: { timestamp: "desc" } }),
    prisma.delivery.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.adminCredential.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.systemSetting.findMany(),
  ]);

  let didSeed = false;

  // Auto-seed mock data if empty
  if (users.length === 0) {
    await prisma.user.createMany({
      data: [
        { name: "Founder User", phone: "+919999999999", role: "FOUNDER" },
        { name: "John Driver", phone: "+918888888888", role: "DRIVER" },
        { name: "Sam Driver", phone: "+917777777777", role: "DRIVER" },
      ],
    });
    didSeed = true;
  }

  if (expenses.length === 0) {
    await prisma.expense.createMany({
      data: [
        { amount: 2500, category: "fuel", notes: "diesel for truck MH-12-AB-1234", vehicle: "MH-12-AB-1234", senderName: "John Driver", approved: false, type: "EXPENSE", timestamp: new Date() },
        { amount: 18500, category: "shadowfax", notes: "weekly vendor payment under Shadowfax hub", vehicle: null, senderName: "Founder", approved: true, type: "INCOME", timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { amount: 1500, category: "bittu", notes: "loading labor payment to Bittu", vehicle: "MH-12-AB-1234", senderName: "John Driver", approved: true, type: "EXPENSE", timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        { amount: 8200, category: "service", notes: "truck wheel alignment and air brake service", vehicle: "MH-14-XY-9876", senderName: "Sam Driver", approved: false, type: "EXPENSE", timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      ],
    });
    didSeed = true;
  }

  if (deliveries.length === 0) {
    await prisma.delivery.createMany({
      data: [
        { title: "Daily Runsheet - Shadowfax (Weekly)", category: "vendor_ship", totalOrders: 40, completedOrders: 40, driverName: "John Driver", notes: "Completed all regular shipments. 2 pending due to customer unavailability.", createdAt: new Date() },
        { title: "Daily Runsheet - Shadowfax (45-Day)", category: "per_order_rate", totalOrders: 25, completedOrders: 25, driverName: "Sam Driver", notes: "All orders completed successfully.", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { title: "Daily Runsheet - Shadowfax (Weekly)", category: "vendor_ship", totalOrders: 48, completedOrders: 48, driverName: "John Driver", notes: "Slight delay at Shadowfax hub.", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      ],
    });
    didSeed = true;
  }

  if (settings.length === 0) {
    await prisma.systemSetting.createMany({
      data: [
        { key: "rate_vendor_ship", value: "70" },
        { key: "rate_per_order_weekly", value: "35" },
        { key: "rate_per_order_monthly_base", value: "53000" },
        { key: "cc_fuel_cycle_end_day", value: "4" },
      ],
    });
    didSeed = true;
  }

  if (didSeed) {
    [users, expenses, deliveries, settings] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.expense.findMany({ orderBy: { timestamp: "desc" } }),
      prisma.delivery.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.systemSetting.findMany(),
    ]);
    adminCredentials = await prisma.adminCredential.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });
  }

  const getSetting = (key: string, defaultValue: string) => {
    return settings.find((s) => s.key === key)?.value || defaultValue;
  };

  const systemSettings = {
    rateVendorShip: parseFloat(getSetting("rate_vendor_ship", "70")),
    ratePerOrderWeekly: parseFloat(getSetting("rate_per_order_weekly", "35")),
    ratePerOrderMonthlyBase: parseFloat(getSetting("rate_per_order_monthly_base", "53000")),
    ccFuelCycleEndDay: parseInt(getSetting("cc_fuel_cycle_end_day", "4"), 10),
  };

  return { users, expenses, deliveries, adminCredentials, loggedInUser, systemSettings };
}

// Server Action - Database Writes & Gemini AI smart parser integration
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action")?.toString();

  if (actionType === "create_expense") {
    const isAi = formData.get("isAi") === "true";
    if (isAi) {
      const rawText = formData.get("rawText")?.toString() || "";
      if (!rawText.trim()) {
        return { error: "AI parser text cannot be empty" };
      }

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY not configured in backend .env");
        }

        const prompt = `
          You are an AI logistics assistant parsing operational logs and financial entries into a structured JSON array.
          Analyze the user's input. It may contain one or multiple separate entries: expenses, incomes, or delivery/runsheet tracking updates.

          Parse the input into a strict JSON array where each item represents an entry to be saved to our database.
          For each item in the array, specify the target table using "targetTable": "expense" or "delivery".

          Reference current time is: ${new Date().toISOString()} (Local current date: ${new Date().toString()}).

          For each item, if the user mentions a past date, relative date (e.g., 'yesterday', '2 days ago', 'last Friday', 'on 25th May'), parse it into a strict UTC ISO 8601 string and set the field "date". Otherwise, if no date is mentioned, omit or set "date" to null.

          If targetTable is "expense":
          - amount: (number) The cost or income in rupees/INR.
          - type: (string) Must be either "EXPENSE" or "INCOME".
          - category: (string) Must be one of the following exactly:
            For "EXPENSE": 'fuel', 'bittu', 'service', 'other'
            For "INCOME": 'shadowfax', 'factory', 'vendor_income', 'other_income'
          - notes: (string) Clean and concise description of the transaction.
          - vehicle: (string or null) The vehicle plate/license number if mentioned (e.g. MH-12-AB-1234), otherwise null.
          - date: (string or null) The parsed UTC ISO 8601 date string if a past/relative date is specified.

          If targetTable is "delivery":
          - title: (string) A clean title, e.g., "Daily Runsheet - Shadowfax (Weekly)" or "Shadowfax (45-Day) Runsheet".
          - category: (string) Must be either "vendor_ship" or "per_order_rate" based on context.
          - totalOrders: (number) Total orders completed (always default/set equal to completedOrders).
          - completedOrders: (number) Number of successfully completed orders.
          - driverName: (string) The driver's name if mentioned (e.g. "John Driver" or "Sam Driver"), otherwise "Unassigned".
          - notes: (string) Clean operational notes or remarks.
          - date: (string or null) The parsed UTC ISO 8601 date string if a past/relative date is specified.

          User Input: "${rawText}"

          Return ONLY a valid, raw, double-quoted JSON array of these objects. Do not include markdown code block formatting (like \`\`\`json or \`\`\`).
        `;

        // Fast Model Failover Chain — switches immediately to fallback models without waiting
        const MODEL_CHAIN = [
          "gemini-2.5-flash",      // Primary: latest 2.5 flash, fastest & most available
          "gemini-2.0-flash",      // Fallback 1: stable 2.0 flash
          "gemini-2.0-flash-lite", // Fallback 2: lightest model, least load
        ];

        const requestBody = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
        let response: Response | null = null;
        let lastError = "";

        for (const model of MODEL_CHAIN) {
          try {
            console.log(`🤖 Trying model: ${model}`);
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody,
              }
            );

            if (res.ok) {
              console.log(`✅ Success with model: ${model}`);
              response = res;
              break;
            }

            // For client errors (400, 403, etc.) → no point trying other models
            if (res.status === 400 || res.status === 403 || res.status === 401) {
              const errText = await res.text();
              throw new Error(`Gemini API config error: ${errText}`);
            }

            console.warn(`⚡ ${model} returned status ${res.status}. Falling back immediately...`);
          } catch (err: any) {
            lastError = err.message || String(err);
            if (err.message?.includes("Gemini API config error")) throw err; // Don't retry config errors
            console.warn(`⚡ ${model} network error: ${lastError}. Trying next model...`);
            continue;
          }
        }

        if (!response) {
          throw new Error("⚠️ All Gemini models are currently busy due to high traffic. Please try again in a moment, or use the ✍️ Manual Form below for instant saving!");
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const cleanedText = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedText);

        if (!Array.isArray(parsed)) {
          throw new Error("The AI couldn't understand your input. Please try rephrasing it — for example: 'cng 550' or 'diesel 4550.");
        }

        let expensesCreated = 0;
        let deliveriesCreated = 0;
        const imageUrl = formData.get("imageUrl")?.toString() || null;
        let pendingFuelExpense: any = null;

        for (const item of parsed) {
          const entryDate = item.date ? new Date(item.date) : new Date();

          if (item.targetTable === "expense") {
            const amount = Math.round(parseFloat(item.amount) || 0);
            const type = item.type === "INCOME" ? "INCOME" : "EXPENSE";
            const category = item.category || "other";
            const notes = item.notes || rawText;
            const vehicle = item.vehicle || null;

            // If it is a CNG/Fuel expense, we absolutely need a receipt slip!
            if (category === "fuel" && !imageUrl) {
              pendingFuelExpense = {
                amount,
                category,
                notes,
                vehicle,
                type,
                date: item.date || null,
              };
              continue; // Skip saving this one for now!
            }

            await prisma.expense.create({
              data: {
                amount,
                category,
                notes,
                vehicle,
                senderName: "AI Assistant",
                approved: false,
                imageUrl: category === "fuel" ? imageUrl : null,
                type,
                timestamp: entryDate,
              },
            });
            expensesCreated++;
          } else if (item.targetTable === "delivery") {
            const title = item.title || "Daily Runsheet";
            const category = item.category === "per_order_rate" ? "per_order_rate" : "vendor_ship";
            const completedOrders = parseInt(item.completedOrders) || 0;
            const totalOrders = parseInt(item.totalOrders) || completedOrders;
            const driverName = item.driverName || "Unassigned";
            const notes = item.notes || "";

            await prisma.delivery.create({
              data: {
                title,
                category,
                totalOrders,
                completedOrders,
                driverName,
                notes,
                createdAt: entryDate,
              },
            });
            deliveriesCreated++;
          }
        }

        return {
          success: true,
          action: "create_expense",
          isAi: true,
          expensesCreated,
          deliveriesCreated,
          needsFuelSlip: pendingFuelExpense !== null,
          pendingFuelExpense,
        };
      } catch (err: any) {
        console.error("AI Parse failed:", err);
        return { error: err.message };
      }
    } else {
      // Manual entry
      const amount = Math.round(parseFloat(formData.get("amount")?.toString() || "0") || 0);
      const type = formData.get("type")?.toString() || "EXPENSE";
      const category = formData.get("category")?.toString() || "other";
      const notes = formData.get("notes")?.toString() || "";
      const vehicle = formData.get("vehicle")?.toString() || null;
      const senderName = formData.get("senderName")?.toString() || "Founder";
      const imageUrl = formData.get("imageUrl")?.toString() || null;
      const customDateStr = formData.get("date")?.toString() || null;
      const entryDate = customDateStr ? new Date(customDateStr) : new Date();

      await prisma.expense.create({
        data: {
          amount,
          category,
          notes,
          vehicle,
          senderName,
          approved: false,
          imageUrl,
          type,
          timestamp: entryDate,
        },
      });
      return { success: true, action: "create_expense" };
    }
  }

  if (actionType === "approve_expense") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    await prisma.expense.update({
      where: { id },
      data: { approved: true },
    });
    return { success: true };
  }

  if (actionType === "reject_expense") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    await prisma.expense.delete({
      where: { id },
    });
    return { success: true };
  }

  if (actionType === "update_expense") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const amount = parseFloat(formData.get("amount")?.toString() || "0") || 0;
    const category = formData.get("category")?.toString() || "fuel";
    const notes = formData.get("notes")?.toString() || "";
    const type = formData.get("type")?.toString() || "EXPENSE";
    const vehicle = formData.get("vehicle")?.toString() || "";

    await prisma.expense.update({
      where: { id },
      data: {
        amount,
        category,
        notes,
        type,
        vehicle: vehicle || null,
      },
    });
    return { success: true };
  }

  if (actionType === "create_delivery") {
    const title = formData.get("title")?.toString() || "Daily Runsheet";
    const category = formData.get("category")?.toString() || "vendor_ship";
    const completedOrders = parseInt(formData.get("completedOrders")?.toString() || "0") || 0;
    const totalOrders = parseInt(formData.get("totalOrders")?.toString() || "0") || completedOrders;
    const driverName = formData.get("driverName")?.toString() || "Unassigned";
    const notes = formData.get("notes")?.toString() || "";
    const dateStr = formData.get("createdAt")?.toString() || null;
    const createdAt = dateStr ? new Date(dateStr) : new Date();

    await prisma.delivery.create({
      data: {
        title,
        category,
        totalOrders,
        completedOrders,
        driverName,
        notes,
        createdAt,
      },
    });
    return { success: true, action: "create_delivery" };
  }

  if (actionType === "update_delivery") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const category = formData.get("category")?.toString() || "vendor_ship";
    const completedOrders = parseInt(formData.get("completedOrders")?.toString() || "0") || 0;
    const totalOrders = parseInt(formData.get("totalOrders")?.toString() || "0") || completedOrders;
    const driverName = formData.get("driverName")?.toString() || "Unassigned";
    const notes = formData.get("notes")?.toString() || "";
    const dateStr = formData.get("createdAt")?.toString() || null;
    const createdAt = dateStr ? new Date(dateStr) : undefined;

    await prisma.delivery.update({
      where: { id },
      data: {
        category,
        totalOrders,
        completedOrders,
        driverName,
        notes,
        createdAt,
      },
    });
    return { success: true };
  }

  if (actionType === "delete_delivery") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    await prisma.delivery.delete({
      where: { id },
    });
    return { success: true };
  }

  if (actionType === "create_driver") {
    const name = formData.get("name")?.toString()?.trim() || "";
    const phone = formData.get("phone")?.toString()?.trim() || "";
    const password = formData.get("password")?.toString() || "";
    const vehicleNumber = formData.get("vehicleNumber")?.toString()?.trim() || null;
    const loginEnabled = formData.get("loginEnabled") === "true" || formData.get("loginEnabled") === "on";
    
    if (!name || !phone) {
      return { error: "Driver Name and Phone Number are required." };
    }
    
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return { error: `A user with phone number "${phone}" already exists.` };
    }
    
    await prisma.user.create({
      data: {
        name,
        phone,
        role: "DRIVER",
        passwordHash: password ? hashPassword(password) : null,
        passwordText: password || null,
        vehicleNumber,
        loginEnabled,
      },
    });
    return { success: true, action: "create_driver" };
  }

  if (actionType === "toggle_driver_login") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return { error: "User not found." };
    }
    await prisma.user.update({
      where: { id },
      data: { loginEnabled: !user.loginEnabled },
    });
    return { success: true, action: "toggle_driver_login" };
  }

  if (actionType === "delete_driver") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    await prisma.user.delete({
      where: { id },
    });
    return { success: true, action: "delete_driver" };
  }

  if (actionType === "create_admin") {
    const username = formData.get("username")?.toString()?.trim()?.toLowerCase() || "";
    const password = formData.get("password")?.toString() || "";
    
    if (!username || !password) {
      return { error: "Username and Password are required." };
    }
    
    const existing = await prisma.adminCredential.findUnique({ where: { username } });
    if (existing) {
      return { error: `Admin username "${username}" is already taken.` };
    }
    
    await prisma.adminCredential.create({
      data: {
        username,
        passwordHash: hashPassword(password),
      },
    });
    return { success: true, action: "create_admin" };
  }

  if (actionType === "delete_admin") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    
    const count = await prisma.adminCredential.count();
    if (count <= 1) {
      return { error: "Cannot delete the last remaining administrator account." };
    }
    
    await prisma.adminCredential.delete({
      where: { id },
    });
    return { success: true, action: "delete_admin" };
  }

  if (actionType === "mark_payout_paid") {
    const amount = parseFloat(formData.get("amount")?.toString() || "0") || 0;
    const category = formData.get("category")?.toString() || "";
    const notes = formData.get("notes")?.toString() || "";
    const mondayStr = formData.get("mondayStr")?.toString() || "";
    const paymentDateStr = formData.get("paymentDate")?.toString() || null;
    const paymentDate = paymentDateStr ? new Date(paymentDateStr) : new Date();

    let expenseCategory = "other_income";
    if (category === "vendor_ship") {
      expenseCategory = "shadowfax";
    } else if (category === "per_order_rate_weekly" || category === "per_order_rate") {
      expenseCategory = "factory";
    } else if (category === "per_order_rate_monthly") {
      expenseCategory = "vendor_income";
    }

    let refTag = "";
    let weekIdentifier = "";
    let startDate = new Date();
    let endDate = new Date();

    if (category === "vendor_ship" || category === "per_order_rate_weekly") {
      const typeStr = category === "vendor_ship" ? "VS" : "PO-orders";
      refTag = `[Ref: Weekly-Payout-${typeStr}-${mondayStr}]`;
      weekIdentifier = `${mondayStr}_${category}`;
      startDate = new Date(mondayStr);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // category === "per_order_rate_monthly"
      const monthStr = mondayStr.substring(0, 7); // "YYYY-MM"
      refTag = `[Ref: Monthly-Payout-PO-${monthStr}]`;
      weekIdentifier = `${monthStr}_${category}`;
      
      const parsedDate = new Date(mondayStr);
      const yyyy = parsedDate.getFullYear();
      const mm = parsedDate.getMonth();
      startDate = new Date(yyyy, mm, 1, 0, 0, 0, 0);
      endDate = new Date(yyyy, mm + 1, 0, 23, 59, 59, 999);
    }

    const finalNotes = notes ? `${notes} ${refTag}` : refTag;

    // Create corresponding INCOME entry in Expense table for unified cashflow ledger
    await prisma.expense.create({
      data: {
        amount,
        category: expenseCategory,
        notes: finalNotes,
        vehicle: null,
        senderName: "Founder",
        approved: true,
        type: "INCOME",
        timestamp: paymentDate,
      },
    });

    // Also persist in the Payout table for database-backed tracking
    try {
      await prisma.payout.upsert({
        where: {
          weekIdentifier_category: {
            weekIdentifier,
            category,
          },
        },
        update: {
          actualAmount: amount,
          status: "PAID",
          paidAt: paymentDate,
          notes,
        },
        create: {
          weekIdentifier,
          startDate,
          endDate,
          category,
          completedOrders: 0, // calculated on the fly, default to 0 here
          calculatedAmount: amount,
          actualAmount: amount,
          status: "PAID",
          paidAt: paymentDate,
          notes,
        },
      });
    } catch (err) {
      console.error("Failed to upsert Payout tracker record:", err);
    }

    return { success: true, action: "mark_payout_paid" };
  }

  if (actionType === "mark_fuel_cc_paid") {
    const amount = parseFloat(formData.get("amount")?.toString() || "0") || 0;
    const billingMonth = formData.get("billingMonth")?.toString() || ""; // YYYY-MM
    const notes = formData.get("notes")?.toString() || "";
    const paymentDateStr = formData.get("paymentDate")?.toString() || null;
    const paymentDate = paymentDateStr ? new Date(paymentDateStr) : new Date();

    const endDaySetting = await prisma.systemSetting.findUnique({ where: { key: "cc_fuel_cycle_end_day" } });
    const endDay = endDaySetting ? parseInt(endDaySetting.value, 10) : 4;

    // Generate the start and end of the billing cycle
    const endDayStr = String(endDay).padStart(2, "0");
    const parsedDate = new Date(`${billingMonth}-${endDayStr}`);
    const yyyy = parsedDate.getFullYear();
    const mm = parsedDate.getMonth(); // 0-indexed month
    const startDate = new Date(yyyy, mm - 1, endDay + 1, 0, 0, 0, 0); // starts endDay+1 of M-1
    const endDate = new Date(yyyy, mm, endDay, 23, 59, 59, 999); // ends endDay of M
    
    const formatOption: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const startStr = startDate.toLocaleDateString("en-US", formatOption);
    const endStr = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const cycleLabel = `${startStr} - ${endStr}`;

    const refTag = `[Ref: Fuel-CC-Bill-${billingMonth}]`;
    const finalNotes = notes 
      ? `Credit Card Payment for Fuel Bill (${cycleLabel}) ${notes} ${refTag}`
      : `Credit Card Payment for Fuel Bill (${cycleLabel}) ${refTag}`;

    // Create corresponding EXPENSE entry in Expense table with category "credit_card"
    await prisma.expense.create({
      data: {
        amount,
        category: "credit_card",
        notes: finalNotes,
        vehicle: null,
        senderName: "Founder",
        approved: true,
        type: "EXPENSE",
        timestamp: paymentDate,
      },
    });

    return { success: true, action: "mark_fuel_cc_paid" };
  }

  if (actionType === "update_weekly_orders") {
    const mondayStr = formData.get("mondayStr")?.toString() || "";
    const vendorShipOrders = parseInt(formData.get("vendorShipOrders")?.toString() || "0") || 0;
    const perOrderOrders = parseInt(formData.get("perOrderOrders")?.toString() || "0") || 0;

    const start = new Date(mondayStr);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    // 1. Update/Write vendor_ship
    await prisma.delivery.deleteMany({
      where: {
        category: "vendor_ship",
        createdAt: {
          gte: start,
          lte: end,
        }
      }
    });

    if (vendorShipOrders > 0) {
      await prisma.delivery.create({
        data: {
          title: "Weekly Payout Runsheet - 70 Per Order",
          category: "vendor_ship",
          completedOrders: vendorShipOrders,
          totalOrders: vendorShipOrders,
          driverName: "Weekly Summary",
          notes: "Manually entered weekly orders",
          createdAt: new Date(end), // Put on Sunday
        }
      });
    }

    // 2. Update/Write per_order_rate
    await prisma.delivery.deleteMany({
      where: {
        category: "per_order_rate",
        createdAt: {
          gte: start,
          lte: end,
        }
      }
    });

    if (perOrderOrders > 0) {
      await prisma.delivery.create({
        data: {
          title: "Weekly Payout Runsheet - Vendor Per Order",
          category: "per_order_rate",
          completedOrders: perOrderOrders,
          totalOrders: perOrderOrders,
          driverName: "Weekly Summary",
          notes: "Manually entered weekly orders",
          createdAt: new Date(end), // Put on Sunday
        }
      });
    }

    return { success: true, action: "update_weekly_orders" };
  }

  if (actionType === "update_system_settings") {
    const rateVendorShip = formData.get("rateVendorShip")?.toString() || "70";
    const ratePerOrderWeekly = formData.get("ratePerOrderWeekly")?.toString() || "35";
    const ratePerOrderMonthlyBase = formData.get("ratePerOrderMonthlyBase")?.toString() || "53000";
    const ccFuelCycleEndDay = formData.get("ccFuelCycleEndDay")?.toString() || "4";

    const parsedEndDay = parseInt(ccFuelCycleEndDay, 10);
    if (isNaN(parsedEndDay) || parsedEndDay < 1 || parsedEndDay > 28) {
      return { error: "Credit Card Billing Day must be between 1 and 28." };
    }

    try {
      await prisma.$transaction([
        prisma.systemSetting.upsert({
          where: { key: "rate_vendor_ship" },
          update: { value: rateVendorShip },
          create: { key: "rate_vendor_ship", value: rateVendorShip },
        }),
        prisma.systemSetting.upsert({
          where: { key: "rate_per_order_weekly" },
          update: { value: ratePerOrderWeekly },
          create: { key: "rate_per_order_weekly", value: ratePerOrderWeekly },
        }),
        prisma.systemSetting.upsert({
          where: { key: "rate_per_order_monthly_base" },
          update: { value: ratePerOrderMonthlyBase },
          create: { key: "rate_per_order_monthly_base", value: ratePerOrderMonthlyBase },
        }),
        prisma.systemSetting.upsert({
          where: { key: "cc_fuel_cycle_end_day" },
          update: { value: ccFuelCycleEndDay },
          create: { key: "cc_fuel_cycle_end_day", value: ccFuelCycleEndDay },
        }),
      ]);
      return { success: true, action: "update_system_settings" };
    } catch (err: any) {
      console.error("Failed to update system settings:", err);
      return { error: err.message || "Failed to update system settings" };
    }
  }

  return null;
}

export default function Home() {
  const { users, expenses, deliveries, adminCredentials, loggedInUser, systemSettings } = useLoaderData<typeof loader>();
  const drivers = users.filter((u: any) => u.role === "DRIVER");

  const getOrdinal = (day: number) => {
    if (day > 3 && day < 21) return `${day}th`;
    switch (day % 10) {
      case 1:  return `${day}st`;
      case 2:  return `${day}nd`;
      case 3:  return `${day}rd`;
      default: return `${day}th`;
    }
  };
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();
  const submit = useSubmit();

  const [deliveryDriverFilter, setDeliveryDriverFilter] = useState<string>("ALL");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [customDialog, setCustomDialog] = useState<{
    isOpen: boolean;
    type: "alert" | "confirm";
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: "alert",
    title: "",
    message: "",
  });

  const triggerAlert = (title: string, message: string) => {
    setCustomDialog({
      isOpen: true,
      type: "alert",
      title,
      message,
    });
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setCustomDialog({
      isOpen: true,
      type: "confirm",
      title,
      message,
      onConfirm,
    });
  };

  // Tab state & Dashboard workflow controls
  const [activeTab, setActiveTab] = useState<"expenses" | "orders" | "users">("expenses");
  const [userSubTab, setUserSubTab] = useState<"drivers" | "admins">("drivers");
  const [expensesSubTab, setExpensesSubTab] = useState<"entry" | "ledger" | "payouts">("entry");
  const [ledgerViewMode, setLedgerViewMode] = useState<"transactions" | "runsheets">("transactions");
  const [showExpenseDashboard, setShowExpenseDashboard] = useState(false);
  const [showDeliveryDashboard, setShowDeliveryDashboard] = useState(false);
  const [driverPassword, setDriverPassword] = useState("");

  const generateRandomPassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    let pwd = "";
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setDriverPassword(pwd);
  };

  // Timeframe filter state
  const [expenseFilter, setExpenseFilter] = useState<"ALL" | "YEAR" | "MONTH" | "TODAY" | "CUSTOM">("ALL");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<"ALL" | "EXPENSE" | "INCOME">("ALL");
  const [deliveryFilter, setDeliveryFilter] = useState<"ALL" | "YEAR" | "MONTH" | "TODAY" | "CUSTOM">("ALL");
  const [deliveryCategoryFilter, setDeliveryCategoryFilter] = useState<"ALL" | "VENDOR_SHIP" | "PER_ORDER">("ALL");

  // Auto-hiding notification and driver profile states
  const [runsheetSuccessVisible, setRunsheetSuccessVisible] = useState(false);
  const [expenseSuccessVisible, setExpenseSuccessVisible] = useState(false);
  const [actionErrorVisible, setActionErrorVisible] = useState(false);
  const [parsedExpenseVisible, setParsedExpenseVisible] = useState(false);
  const [userControlSuccessVisible, setUserControlSuccessVisible] = useState(false);
  const [selectedDriverProfile, setSelectedDriverProfile] = useState<any | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  const [selectedDeliveryYear, setSelectedDeliveryYear] = useState<string>("ALL");
  const [selectedDeliveryMonth, setSelectedDeliveryMonth] = useState<string>("ALL");
  const [customDeliveryStartDate, setCustomDeliveryStartDate] = useState<string>("");
  const [customDeliveryEndDate, setCustomDeliveryEndDate] = useState<string>("");

  // Mobile drawer states
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // PWA install state variables
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // AI manual feedback state
  const [aiRawInput, setAiRawInput] = useState("");
  const [expenseFormMode, setExpenseFormMode] = useState<"ai" | "manual" | "runsheet">("ai");

  // Controlled runsheet form inputs for live payout preview
  const [formCategory, setFormCategory] = useState<"vendor_ship" | "per_order_rate">("vendor_ship");
  const [formCompletedOrders, setFormCompletedOrders] = useState<string>("");

  const parseLocalDate = (d: Date | string): Date => {
    if (d instanceof Date) {
      const copy = new Date(d.getTime());
      copy.setHours(0, 0, 0, 0);
      return copy;
    }
    if (typeof d === "string") {
      const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        return new Date(year, month, day, 0, 0, 0, 0);
      }
    }
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const formatLocalDate = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const toUTCISOString = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  };

  const getMonday = (d: Date | string) => {
    const date = parseLocalDate(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const getSunday = (d: Date | string) => {
    const monday = getMonday(d);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return sunday;
  };

  const formatRange = (d: Date | string) => {
    const mon = getMonday(d);
    const sun = getSunday(d);
    const startStr = mon.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = sun.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  };

  const [runsheetDate, setRunsheetDate] = useState(() => {
    return formatLocalDate(getMonday(new Date()));
  });


  // Pagination page states and constants
  const EXPENSE_PAGE_SIZE = 10;
  const DELIVERY_PAGE_SIZE = 10;
  const [expensePage, setExpensePage] = useState(1);
  const [deliveryPage, setDeliveryPage] = useState(1);

  const [manualType, setManualType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [selectedCategory, setSelectedCategory] = useState("fuel");
  const [fuelSlipBase64, setFuelSlipBase64] = useState<string | null>(null);
  const [pendingSlipBase64, setPendingSlipBase64] = useState<string | null>(null);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [selectedSlipImage, setSelectedSlipImage] = useState<string | null>(null);

  // Weekly Payout Tracker states
  const [ordersViewMode, setOrdersViewMode] = useState<"form" | "dashboard" | "payouts">("form");
  const [payoutToPay, setPayoutToPay] = useState<any | null>(null);
  const [weeklyOrdersToEdit, setWeeklyOrdersToEdit] = useState<any | null>(null);
  const [ccBillToPay, setCcBillToPay] = useState<any | null>(null);
  const [payoutSubTab, setPayoutSubTab] = useState<"payouts" | "fuel_cycles" | "settings">("payouts");
  const [payAmountInput, setPayAmountInput] = useState<string>("");
  const [payDateInput, setPayDateInput] = useState<string>("");
  const [payNotesInput, setPayNotesInput] = useState<string>("");
  const [payoutSuccessVisible, setPayoutSuccessVisible] = useState(false);
  const [ccSuccessVisible, setCcSuccessVisible] = useState(false);
  const [settingsSuccessVisible, setSettingsSuccessVisible] = useState(false);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<"ALL" | "PAID" | "UNPAID" | "ONGOING">("ALL");
  const [payoutSortOrder, setPayoutSortOrder] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc");

  // Local edit states
  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [editingDelivery, setEditingDelivery] = useState<any | null>(null);

  // Form references for automated clearing on success
  const manualExpenseFormRef = useRef<HTMLFormElement>(null);
  const runsheetFormRef = useRef<HTMLFormElement>(null);
  const aiFormRef = useRef<HTMLFormElement>(null);

  // Initialize theme from localStorage or system preferences
  useEffect(() => {
    const storedTheme = localStorage.theme;
    if (storedTheme === "dark" || (!storedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setTheme("dark");
      document.documentElement.classList.add("dark");
    } else {
      setTheme("light");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Read search parameters on mount to support PWA shortcuts
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      const showAddParam = params.get("showAdd");
      if (tabParam === "expenses") {
        setActiveTab("expenses");
        if (showAddParam === "true") {
          setShowExpenseDashboard(false); // Show Entry Form
        } else {
          setShowExpenseDashboard(true);  // Show Ledger
        }
      } else if (tabParam === "orders") {
        setActiveTab("orders");
        if (showAddParam === "true") {
          setShowDeliveryDashboard(false); // Show Entry Form
        } else {
          setShowDeliveryDashboard(true);  // Show Dashboard
        }
      }
    }
  }, []);

  // Redirect away from disabled tabs if they try to access them
  useEffect(() => {
    if (activeTab === "users") {
      setActiveTab("expenses");
    }
  }, [activeTab]);

  // PWA Install Prompt & Compatibility Logic
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Check if already running in standalone mode
      const isStandaloneMode = 
        window.matchMedia("(display-mode: standalone)").matches || 
        (window.navigator as any).standalone === true;
      
      setIsStandalone(isStandaloneMode);

      // Detect iOS platform
      const userAgent = window.navigator.userAgent.toLowerCase();
      const iOSDetect = /iphone|ipad|ipod/.test(userAgent);
      setIsIOS(iOSDetect);

      // Check if user dismissed the banner previously
      const isDismissed = localStorage.getItem("dreamline_pwa_dismissed") === "true";

      // Intercept the browser's install prompt event
      const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setIsInstallable(true);
        if (!isStandaloneMode && !isDismissed) {
          setShowInstallBanner(true);
        }
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

      // If iOS, we can show instructions even if beforeinstallprompt is not supported
      if (iOSDetect && !isStandaloneMode && !isDismissed) {
        setShowInstallBanner(true);
      }

      // Fallback: if browser supports PWA but event hasn't fired yet
      if (!isStandaloneMode && !isDismissed && !iOSDetect) {
        const timer = setTimeout(() => {
          setShowInstallBanner(true);
        }, 4000);
        return () => {
          clearTimeout(timer);
          window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        };
      }

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      triggerAlert(
        "Installation Instructions",
        "To install: tap your browser's menu button and select 'Add to Home screen' or 'Install App'."
      );
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User responded to install prompt: ${outcome}`);
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setIsInstallable(false);
      setShowInstallBanner(false);
    }
  };

  const handleDismissBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem("dreamline_pwa_dismissed", "true");
  };

  const toggleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
      document.documentElement.classList.add("dark");
      localStorage.theme = "dark";
    } else {
      setTheme("light");
      document.documentElement.classList.remove("dark");
      localStorage.theme = "light";
    }
  };

  // Automated state resets upon switching tabs
  const switchTab = (tab: "expenses" | "orders" | "users") => {
    setActiveTab(tab);
    setShowExpenseDashboard(false);
    setShowDeliveryDashboard(false);
    setSidebarOpen(false);
    setManualType("EXPENSE");
    setSelectedCategory("fuel");
    setFuelSlipBase64(null);
    setSelectedSlipImage(null);
    setExpenseCategoryFilter("ALL");
  };

  // Dynamically extract all available years from expenses to populate the year filter dropdown
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    expenses.forEach((e) => {
      const yr = new Date(e.timestamp).getFullYear();
      if (!isNaN(yr)) years.add(yr.toString());
    });
    // Ensure the current year is in the list
    years.add(new Date().getFullYear().toString());
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  // Dynamically extract all available years from deliveries to populate the year filter dropdown
  const availableDeliveryYears = useMemo(() => {
    const years = new Set<string>();
    deliveries.forEach((d) => {
      const yr = new Date(d.createdAt).getFullYear();
      if (!isNaN(yr)) years.add(yr.toString());
    });
    years.add(new Date().getFullYear().toString());
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [deliveries]);

  // Filtered Expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp) => {
      // 1. First apply Category filter (Expense vs Income)
      if (expenseCategoryFilter === "EXPENSE" && exp.type !== "EXPENSE") {
        return false;
      }
      if (expenseCategoryFilter === "INCOME" && exp.type !== "INCOME") {
        return false;
      }

      // 2. Next apply Timeframe filter
      const d = new Date(exp.timestamp);
      const now = new Date();

      if (expenseFilter === "ALL") {
        return true;
      }

      if (expenseFilter === "TODAY") {
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }

      if (expenseFilter === "YEAR") {
        if (selectedYear === "ALL") return true;
        return d.getFullYear() === Number(selectedYear);
      }

      if (expenseFilter === "MONTH") {
        const yearMatch = selectedYear === "ALL" || d.getFullYear() === Number(selectedYear);
        const monthMatch = selectedMonth === "ALL" || d.getMonth() === Number(selectedMonth);
        return yearMatch && monthMatch;
      }

      if (expenseFilter === "CUSTOM") {
        if (!customStartDate) return true; // Default to showing all if start date is not selected yet
        const start = new Date(customStartDate);
        start.setHours(0, 0, 0, 0);

        const end = customEndDate ? new Date(customEndDate) : new Date(customStartDate);
        end.setHours(23, 59, 59, 999);

        return d >= start && d <= end;
      }

      return true;
    });
  }, [expenses, expenseFilter, expenseCategoryFilter, selectedYear, selectedMonth, customStartDate, customEndDate]);

  // Helper date checker for legacy dynamic visual filter
  const isDateInFilter = (dateObj: Date | string, filter: "ALL" | "YEAR" | "MONTH" | "TODAY") => {
    const d = new Date(dateObj);
    const now = new Date();
    if (filter === "ALL") return true;
    if (filter === "YEAR") return d.getFullYear() === now.getFullYear();
    if (filter === "MONTH") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (filter === "TODAY") {
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }
    return true;
  };

  // Filtered Deliveries
  const filteredDeliveries = useMemo(() => {
    return deliveries.filter((del) => {
      // 0. Filter by Driver
      if (deliveryDriverFilter !== "ALL" && del.driverName !== deliveryDriverFilter) {
        return false;
      }

      // 1. First apply Category filter
      if (deliveryCategoryFilter === "VENDOR_SHIP" && del.category !== "vendor_ship") {
        return false;
      }
      if (deliveryCategoryFilter === "PER_ORDER" && del.category !== "per_order_rate") {
        return false;
      }

      // 2. Next apply Timeframe filter
      const d = new Date(del.createdAt);
      const now = new Date();

      if (deliveryFilter === "ALL") {
        return true;
      }

      if (deliveryFilter === "TODAY") {
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }

      if (deliveryFilter === "YEAR") {
        if (selectedDeliveryYear === "ALL") return true;
        return d.getFullYear() === Number(selectedDeliveryYear);
      }

      if (deliveryFilter === "MONTH") {
        const yearMatch = selectedDeliveryYear === "ALL" || d.getFullYear() === Number(selectedDeliveryYear);
        const monthMatch = selectedDeliveryMonth === "ALL" || d.getMonth() === Number(selectedDeliveryMonth);
        return yearMatch && monthMatch;
      }

      if (deliveryFilter === "CUSTOM") {
        if (!customDeliveryStartDate) return true;
        const start = new Date(customDeliveryStartDate);
        start.setHours(0, 0, 0, 0);

        const end = customDeliveryEndDate ? new Date(customDeliveryEndDate) : new Date(customDeliveryStartDate);
        end.setHours(23, 59, 59, 999);

        return d >= start && d <= end;
      }

      return true;
    });
  }, [deliveries, deliveryFilter, deliveryCategoryFilter, selectedDeliveryYear, selectedDeliveryMonth, customDeliveryStartDate, customDeliveryEndDate, deliveryDriverFilter]);

  // Paginated sublists
  const totalExpensePages = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSE_PAGE_SIZE));
  const activeExpensePage = Math.min(expensePage, totalExpensePages);

  const totalDeliveryPages = Math.max(1, Math.ceil(filteredDeliveries.length / DELIVERY_PAGE_SIZE));
  const activeDeliveryPage = Math.min(deliveryPage, totalDeliveryPages);

  const paginatedExpenses = useMemo(() => {
    const startIndex = (activeExpensePage - 1) * EXPENSE_PAGE_SIZE;
    return filteredExpenses.slice(startIndex, startIndex + EXPENSE_PAGE_SIZE);
  }, [filteredExpenses, activeExpensePage]);

  const paginatedDeliveries = useMemo(() => {
    const startIndex = (activeDeliveryPage - 1) * DELIVERY_PAGE_SIZE;
    return filteredDeliveries.slice(startIndex, startIndex + DELIVERY_PAGE_SIZE);
  }, [filteredDeliveries, activeDeliveryPage]);

  // Financial calculations based on filtered ledger
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let pendingExpense = 0;
    let fuel = 0;

    filteredExpenses.forEach((exp) => {
      if (exp.type === "INCOME") {
        income += exp.amount;
      } else {
        expense += exp.amount;
        if (!exp.approved) {
          pendingExpense += exp.amount;
        }
        if (exp.category === "fuel") {
          fuel += exp.amount;
        }
      }
    });

    return { income, expense, pendingExpense, fuel, net: income - expense };
  }, [filteredExpenses]);

  // Runsheet and daily order counts based on filtered ledger
  const orderCounts = useMemo(() => {
    let totalRunsheets = filteredDeliveries.length;
    let totalAssigned = 0;
    let totalCompleted = 0;
    let vendorShipOrders = 0;
    let perOrderRateOrders = 0;
    let vendorShipValue = 0;
    let perOrderRateValue = 0;

    const activeMonths = new Set<string>();
    filteredDeliveries.forEach((d) => {
      totalAssigned += d.totalOrders;
      totalCompleted += d.completedOrders;
      if (d.category === "vendor_ship") {
        vendorShipOrders += d.completedOrders;
        vendorShipValue += d.completedOrders * (systemSettings?.rateVendorShip ?? 70);
      } else {
        perOrderRateOrders += d.completedOrders;
        perOrderRateValue += d.completedOrders * (systemSettings?.ratePerOrderWeekly ?? 35);
        const date = new Date(d.createdAt);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        activeMonths.add(`${yyyy}-${mm}`);
      }
    });

    perOrderRateValue += activeMonths.size * (systemSettings?.ratePerOrderMonthlyBase ?? 53000);

    return {
      totalRunsheets,
      totalAssigned,
      totalCompleted,
      vendorShipOrders,
      perOrderRateOrders,
      vendorShipValue,
      perOrderRateValue,
      totalValue: vendorShipValue + perOrderRateValue,
      completionRate: totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0
    };
  }, [filteredDeliveries, systemSettings]);

  // Weekly Payout Tracker memoized calculations
  const weeklyPayouts = useMemo(() => {
    const weeklyGroups: {
      [key: string]: {
        mondayStr: string;
        mondayDate: Date;
        sundayDate: Date;
        category: "vendor_ship" | "per_order_rate_weekly";
        completedOrders: number;
        deliveriesCount: number;
      };
    } = {};

    const monthlyGroups: {
      [key: string]: {
        monthStr: string;
        startDate: Date;
        endDate: Date;
        category: "per_order_rate_monthly";
        completedOrders: number;
        deliveriesCount: number;
      };
    } = {};

    // 1. Pre-generate all weekly slots from Monday, Dec 29, 2025 up to next week
    let currentMonday = new Date(2025, 11, 29, 0, 0, 0, 0);
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + 7);

    while (currentMonday <= limitDate) {
      const yyyy = currentMonday.getFullYear();
      const mm = String(currentMonday.getMonth() + 1).padStart(2, "0");
      const dd = String(currentMonday.getDate()).padStart(2, "0");
      const mondayStr = `${yyyy}-${mm}-${dd}`;

      const sunday = new Date(currentMonday);
      sunday.setDate(currentMonday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      // vendor_ship
      const keyVs = `${mondayStr}_vendor_ship`;
      weeklyGroups[keyVs] = {
        mondayStr,
        mondayDate: new Date(currentMonday),
        sundayDate: sunday,
        category: "vendor_ship",
        completedOrders: 0,
        deliveriesCount: 0,
      };

      // per_order_rate_weekly
      const keyPo = `${mondayStr}_per_order_rate_weekly`;
      weeklyGroups[keyPo] = {
        mondayStr,
        mondayDate: new Date(currentMonday),
        sundayDate: sunday,
        category: "per_order_rate_weekly",
        completedOrders: 0,
        deliveriesCount: 0,
      };

      currentMonday.setDate(currentMonday.getDate() + 7);
    }

    // 2. Pre-generate all monthly slots from Jan 2026 to current month
    const startYear = 2026;
    const startMonth = 0;
    const endYear = new Date().getFullYear();
    const endMonth = new Date().getMonth();

    let curYear = startYear;
    let curMonth = startMonth;

    while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
      const monthStr = `${curYear}-${String(curMonth + 1).padStart(2, "0")}`;
      const mKey = `${monthStr}_per_order_rate_monthly`;

      const startDate = new Date(curYear, curMonth, 1, 0, 0, 0, 0);
      const endDate = new Date(curYear, curMonth + 1, 0, 23, 59, 59, 999);

      monthlyGroups[mKey] = {
        monthStr,
        startDate,
        endDate,
        category: "per_order_rate_monthly",
        completedOrders: 0,
        deliveriesCount: 0,
      };

      curMonth++;
      if (curMonth > 11) {
        curMonth = 0;
        curYear++;
      }
    }

    // 3. Aggregate all deliveries into the generated weekly & monthly buckets
    deliveries.forEach((d) => {
      const date = new Date(d.createdAt);
      
      if (d.category === "vendor_ship") {
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(date);
        monday.setDate(diff);
        monday.setHours(0, 0, 0, 0);

        const yyyy = monday.getFullYear();
        const mm = String(monday.getMonth() + 1).padStart(2, "0");
        const dd = String(monday.getDate()).padStart(2, "0");
        const mondayStr = `${yyyy}-${mm}-${dd}`;
        const key = `${mondayStr}_vendor_ship`;

        if (weeklyGroups[key]) {
          weeklyGroups[key].completedOrders += d.completedOrders;
          weeklyGroups[key].deliveriesCount += 1;
        }
      } else if (d.category === "per_order_rate") {
        // Weekly Portion
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(date);
        monday.setDate(diff);
        monday.setHours(0, 0, 0, 0);

        const yyyy = monday.getFullYear();
        const mm = String(monday.getMonth() + 1).padStart(2, "0");
        const dd = String(monday.getDate()).padStart(2, "0");
        const mondayStr = `${yyyy}-${mm}-${dd}`;
        const key = `${mondayStr}_per_order_rate_weekly`;

        if (weeklyGroups[key]) {
          weeklyGroups[key].completedOrders += d.completedOrders;
          weeklyGroups[key].deliveriesCount += 1;
        }

        // Monthly Portion
        const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const mKey = `${monthStr}_per_order_rate_monthly`;

        if (monthlyGroups[mKey]) {
          monthlyGroups[mKey].completedOrders += d.completedOrders;
          monthlyGroups[mKey].deliveriesCount += 1;
        }
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const list: any[] = [];

    // Map weekly groups
    Object.values(weeklyGroups).forEach((group) => {
      const calculatedPayout = group.category === "vendor_ship"
        ? group.completedOrders * (systemSettings?.rateVendorShip ?? 70)
        : group.completedOrders * (systemSettings?.ratePerOrderWeekly ?? 35);
      
      const expectedDate = new Date(group.mondayDate);
      expectedDate.setDate(group.mondayDate.getDate() + 9); // Wednesday next week
      expectedDate.setHours(0, 0, 0, 0);

      const typeStr = group.category === "vendor_ship" ? "VS" : "PO-orders";
      const refTag = `[Ref: Weekly-Payout-${typeStr}-${group.mondayStr}]`;
      const matchingExpense = expenses.find(
        (exp) => exp.type === "INCOME" && exp.notes && exp.notes.includes(refTag)
      );

      let status: "PAID" | "UNPAID" | "ONGOING" = "UNPAID";
      if (matchingExpense) {
        status = "PAID";
      } else if (group.sundayDate.getTime() > today.getTime()) {
        status = "ONGOING";
      }

      const formatOption: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
      const startStr = group.mondayDate.toLocaleDateString("en-US", formatOption);
      const endStr = group.sundayDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const weekLabel = `${startStr} - ${endStr}`;

      list.push({
        mondayStr: group.mondayStr,
        startDate: group.mondayDate,
        endDate: group.sundayDate,
        category: group.category,
        completedOrders: group.completedOrders,
        deliveriesCount: group.deliveriesCount,
        calculatedPayout,
        expectedDate,
        status,
        matchingExpense,
        refTag,
        weekLabel,
      });
    });

    // Map monthly groups
    Object.values(monthlyGroups).forEach((group) => {
      const calculatedPayout = systemSettings?.ratePerOrderMonthlyBase ?? 53000;

      // Payout of month M is on the 15th of month M+2 (deferred 45 days)
      const mDate = new Date(group.startDate);
      const expectedDate = new Date(mDate.getFullYear(), mDate.getMonth() + 2, 15, 0, 0, 0, 0);

      const refTag = `[Ref: Monthly-Payout-PO-${group.monthStr}]`;
      const matchingExpense = expenses.find(
        (exp) => exp.type === "INCOME" && exp.notes && exp.notes.includes(refTag)
      );

      let status: "PAID" | "UNPAID" | "ONGOING" = "UNPAID";
      if (matchingExpense) {
        status = "PAID";
      } else if (group.endDate.getTime() > today.getTime()) {
        status = "ONGOING";
      }

      const weekLabel = group.startDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

      list.push({
        mondayStr: `${group.monthStr}-01`,
        startDate: group.startDate,
        endDate: group.endDate,
        category: group.category,
        completedOrders: group.completedOrders,
        deliveriesCount: group.deliveriesCount,
        calculatedPayout,
        expectedDate,
        status,
        matchingExpense,
        refTag,
        weekLabel,
      });
    });

    return list.sort((a, b) => b.mondayStr.localeCompare(a.mondayStr));
  }, [deliveries, expenses, systemSettings]);

  const filteredAndSortedPayouts = useMemo(() => {
    let result = [...weeklyPayouts];
    
    // Filter
    if (payoutStatusFilter !== "ALL") {
      result = result.filter(w => w.status === payoutStatusFilter);
    }
    
    // Sort
    result.sort((a, b) => {
      if (payoutSortOrder === "date_desc") {
        return new Date(b.expectedDate).getTime() - new Date(a.expectedDate).getTime();
      } else if (payoutSortOrder === "date_asc") {
        return new Date(a.expectedDate).getTime() - new Date(b.expectedDate).getTime();
      } else if (payoutSortOrder === "amount_desc") {
        return b.calculatedPayout - a.calculatedPayout;
      } else if (payoutSortOrder === "amount_asc") {
        return a.calculatedPayout - b.calculatedPayout;
      }
      return 0;
    });
    
    return result;
  }, [weeklyPayouts, payoutStatusFilter, payoutSortOrder]);

  // Credit Card Fuel Cycles generator (4th-to-4th inclusive logic)
  const ccFuelCycles = useMemo(() => {
    const list: any[] = [];
    const today = new Date();
    today.setHours(0,0,0,0);

    const startYear = 2026;
    const startMonth = 0; // January
    const endYear = today.getFullYear();
    const endMonth = today.getMonth() + 1; // Show current + next cycle

    let curYear = startYear;
    let curMonth = startMonth;

    const endDay = systemSettings?.ccFuelCycleEndDay ?? 4;

    while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
      const billingMonth = `${curYear}-${String(curMonth + 1).padStart(2, "0")}`;
      const startDate = new Date(curYear, curMonth - 1, endDay + 1, 0, 0, 0, 0); 
      const endDate = new Date(curYear, curMonth, endDay, 23, 59, 59, 999); 

      const totalFuelExpense = expenses
        .filter((e) => e.type === "EXPENSE" && e.category === "fuel" && new Date(e.timestamp) >= startDate && new Date(e.timestamp) <= endDate)
        .reduce((sum, e) => sum + e.amount, 0);

      const refTag = `[Ref: Fuel-CC-Bill-${billingMonth}]`;
      const matchingExpense = expenses.find(
        (exp) => exp.type === "EXPENSE" && exp.category === "credit_card" && exp.notes && exp.notes.includes(refTag)
      );

      let status: "PAID" | "UNPAID" | "ONGOING" = "UNPAID";
      if (matchingExpense) {
        status = "PAID";
      } else if (endDate.getTime() > today.getTime()) {
        status = "ONGOING";
      }

      const formatOption: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
      const startStr = startDate.toLocaleDateString("en-US", formatOption);
      const endStr = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const cycleLabel = `${startStr} - ${endStr}`;

      list.push({
        billingMonth,
        startDate,
        endDate,
        totalFuelExpense,
        status,
        matchingExpense,
        refTag,
        cycleLabel,
      });

      curMonth++;
      if (curMonth > 11) {
        curMonth = 0;
        curYear++;
      }
    }

    return list;
  }, [expenses, systemSettings]);

  const filteredAndSortedCcFuelCycles = useMemo(() => {
    let result = [...ccFuelCycles];

    if (payoutStatusFilter !== "ALL") {
      result = result.filter(c => c.status === payoutStatusFilter);
    }

    result.sort((a, b) => {
      if (payoutSortOrder === "date_desc") {
        return new Date(b.endDate).getTime() - new Date(a.endDate).getTime();
      } else if (payoutSortOrder === "date_asc") {
        return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
      } else if (payoutSortOrder === "amount_desc") {
        return b.totalFuelExpense - a.totalFuelExpense;
      } else if (payoutSortOrder === "amount_asc") {
        return a.totalFuelExpense - b.totalFuelExpense;
      }
      return 0;
    });

    return result;
  }, [ccFuelCycles, payoutStatusFilter, payoutSortOrder]);

  const ccSummaryMetrics = useMemo(() => {
    const unpaidCcTotal = ccFuelCycles
      .filter((c) => c.status === "UNPAID")
      .reduce((sum, c) => sum + c.totalFuelExpense, 0);

    const ongoingCcTotal = ccFuelCycles
      .filter((c) => c.status === "ONGOING")
      .reduce((sum, c) => sum + c.totalFuelExpense, 0);

    const lastPaidCycle = ccFuelCycles
      .filter((c) => c.status === "PAID")
      .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0];

    const lastPaidAmount = lastPaidCycle ? lastPaidCycle.totalFuelExpense : 0;

    const totalFuelAllTime = expenses
      .filter((e) => e.type === "EXPENSE" && e.category === "fuel")
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      unpaidCcTotal,
      ongoingCcTotal,
      lastPaidAmount,
      totalFuelAllTime,
    };
  }, [ccFuelCycles, expenses]);

  // Reset raw inputs on action success and set fading success messages
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      // Clear edit states on successful update
      setEditingExpense(null);
      setEditingDelivery(null);

      // If a fuel slip is still pending, do NOT show the success toast yet —
      // the popup modal will handle the remaining workflow.
      const hasPendingSlip = "needsFuelSlip" in actionData && actionData.needsFuelSlip;

      // Always clear the text inputs and primary fuel slip (non-pending)
      setAiRawInput("");
      setFormCompletedOrders("");
      setFuelSlipBase64(null);
      
      // Native browser form reset for all input text fields
      aiFormRef.current?.reset();
      manualExpenseFormRef.current?.reset();
      runsheetFormRef.current?.reset();

      // Only clear pending slip and show success if there is NO pending fuel entry
      if (!hasPendingSlip) {
        setPendingSlipBase64(null);

        if (actionData.action === "create_delivery") {
          setRunsheetSuccessVisible(true);
          const timer = setTimeout(() => setRunsheetSuccessVisible(false), 6000);
          return () => clearTimeout(timer);
        } else if (actionData.action === "create_expense") {
          setExpenseSuccessVisible(true);
          const timer = setTimeout(() => setExpenseSuccessVisible(false), 6000);
          return () => clearTimeout(timer);
        } else if (actionData.action === "mark_payout_paid") {
          setPayoutToPay(null);
          setPayoutSuccessVisible(true);
          const timer = setTimeout(() => setPayoutSuccessVisible(false), 6000);
          return () => clearTimeout(timer);
        } else if (actionData.action === "mark_fuel_cc_paid") {
          setCcBillToPay(null);
          setCcSuccessVisible(true);
          const timer = setTimeout(() => setCcSuccessVisible(false), 6000);
          return () => clearTimeout(timer);
        } else if (actionData.action === "update_weekly_orders") {
          setWeeklyOrdersToEdit(null);
          setPayoutSuccessVisible(true);
          const timer = setTimeout(() => setPayoutSuccessVisible(false), 6000);
          return () => clearTimeout(timer);
        } else if (actionData.action === "update_system_settings") {
          setSettingsSuccessVisible(true);
          const timer = setTimeout(() => setSettingsSuccessVisible(false), 6000);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [actionData]);

  // Manage visibility timers for generic action errors
  useEffect(() => {
    if (actionData) {
      if ("error" in actionData && actionData.error) {
        setActionErrorVisible(true);
        const timer = setTimeout(() => setActionErrorVisible(false), 6000);
        return () => clearTimeout(timer);
      }
    }
  }, [actionData]);

  // Manage visibility timers for AI parsed expense messages
  useEffect(() => {
    if (actionData && "parsedExpense" in actionData && actionData.parsedExpense) {
      setParsedExpenseVisible(true);
      const timer = setTimeout(() => setParsedExpenseVisible(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [actionData]);

  // Manage visibility timers for User Control Center success operations
  useEffect(() => {
    if (actionData && actionData.success && (actionData.action === "create_driver" || actionData.action === "delete_driver" || actionData.action === "create_admin" || actionData.action === "delete_admin" || actionData.action === "toggle_driver_login")) {
      setUserControlSuccessVisible(true);
      const timer = setTimeout(() => setUserControlSuccessVisible(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [actionData]);

  // Synchronize needsFuelSlip action validation to automatically open the step-by-step modal
  useEffect(() => {
    if (actionData && "needsFuelSlip" in actionData && actionData.needsFuelSlip) {
      setShowPendingModal(true);
    } else {
      setShowPendingModal(false);
    }
  }, [actionData]);

  // Live Payout Preview for Runsheet Console
  const parsedCompleted = parseInt(formCompletedOrders) || 0;
  const previewPayout = formCategory === "vendor_ship"
    ? parsedCompleted * 70
    : parsedCompleted * 35;

  const isSubmitting = navigation.state === "submitting";

  return (
    <div className={`notion-app ${sidebarOpen ? "sidebar-open" : ""} text-[#2A3547] dark:text-[#DFE5EF] bg-[#F4F6F9] dark:bg-[#0f172a] min-h-screen flex`}>
      {/* Mobile Drawer Backdrop Overlay */}
      {sidebarOpen && (
        <div
          className="notion-sidebar-backdrop md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Notion Sidebar Navigation */}
      <aside className="notion-sidebar border-r border-neutral-200/60 dark:border-slate-800 bg-white dark:bg-[#1E293B] w-[260px] flex-shrink-0 flex flex-col h-screen fixed md:sticky top-0 z-50 transition-transform duration-300 md:transform-none">
        {/* Workspace Title */}
        <div className="p-4 border-b border-neutral-200/60 dark:border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Logo" className="w-5 h-5 object-contain rounded shrink-0" />
            <span className="font-bold text-sm tracking-tight text-neutral-850 dark:text-neutral-100">
              Dreamline Logistics
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-neutral-400 hover:text-neutral-600 focus:outline-none"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-grow py-4 space-y-1">
          <button
            onClick={() => switchTab("expenses")}
            className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center gap-2.5 px-3.5 py-2.5 mx-2 rounded-md transition-all ${
              activeTab === "expenses"
                ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
            }`}
          >
            <svg className={`w-4 h-4 transition-colors ${activeTab === 'expenses' ? 'text-[#5D87FF]' : 'text-emerald-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Expenses Tracking</span>
          </button>

          <button
            onClick={() => switchTab("orders")}
            className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center gap-2.5 px-3.5 py-2.5 mx-2 rounded-md transition-all ${
              activeTab === "orders"
                ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
            }`}
          >
            <svg className={`w-4 h-4 transition-colors ${activeTab === 'orders' ? 'text-[#5D87FF]' : 'text-blue-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1-1v10M13 16h6m-6 0H6m13 0a2 2 0 002-2V9a1 1 0 00-1-1h-6" />
            </svg>
            <span>Settlement & Cycle Tracker</span>
          </button>

          {/* {loggedInUser?.role !== "DRIVER" && (
            <button
              onClick={() => switchTab("users")}
              className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center gap-2.5 px-3.5 py-2.5 mx-2 rounded-md transition-all ${
                activeTab === "users"
                  ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                  : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
              }`}
            >
              <svg className={`w-4 h-4 transition-colors ${activeTab === 'users' ? 'text-[#5D87FF]' : 'text-purple-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>User Control Center</span>
            </button>
          )} */}
        </nav>

        {/* Persistent Install App Button (Hidden when already standalone) */}
        {!isStandalone && (
          <div className="px-4 pb-4">
            <button
              onClick={() => {
                setShowInstallBanner(true);
                if (isInstallable) {
                  handleInstallApp();
                } else if (isIOS) {
                  // Keep banner open with iOS instructions
                } else {
                  triggerAlert(
                    "Installation Instructions",
                    "To install: tap your browser's menu (three vertical dots in Chrome) and select 'Add to Home screen' or 'Install App'."
                  );
                }
              }}
              className="w-full py-2 text-xs font-bold text-[#5D87FF] hover:text-[#4570EA] bg-[#5D87FF]/10 hover:bg-[#5D87FF]/15 border border-[#5D87FF]/20 dark:border-[#5D87FF]/35 rounded-md flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
            >
              <span>📲</span>
              <span>Install Mobile App</span>
            </button>
          </div>
        )}

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-neutral-200/60 dark:border-slate-800 text-center">
          <div className="text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-widest font-semibold">
            Dreamline Atelier v1.2
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main className="notion-main flex-grow h-screen overflow-y-auto flex flex-col relative w-full font-sans">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200/60 dark:border-slate-800 bg-white/80 dark:bg-[#0f172a]/80 backdrop-blur-md px-6 py-3.5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-850 focus:outline-none"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-200">
                Dreamline Logistics Atelier
              </span>
            </div>
          </div>

          {/* Header Action Items (Theme Toggle) */}
          <div className="flex items-center gap-3.5">
            {/* Light / Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800/60 text-neutral-600 dark:text-neutral-300 transition-all focus:outline-none cursor-pointer flex items-center justify-center"
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? (
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-[18px] h-[18px] text-[#ffae1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707m12.728 12.728A9 9 0 115.636 5.636m12.728 12.728L12 12" />
                </svg>
              )}
            </button>

            {/* Secure Logout Button */}
            <Form method="post" action="/login" className="flex items-center">
              <input type="hidden" name="_action" value="logout" />
              <button
                type="submit"
                className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-rose-500/10 text-neutral-600 hover:text-rose-600 dark:text-neutral-300 dark:hover:text-rose-400 transition-all focus:outline-none cursor-pointer flex items-center justify-center"
                title="Secure Logout"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </Form>
          </div>
        </header>

        {/* Content Container */}
        <div className="flex-grow p-6 max-w-5xl mx-auto w-full space-y-6 pb-24">
          
          {/* EXPENSES TAB VIEW */}
          {activeTab === "expenses" && (
            <div className="animate-fade-in space-y-6">
              {/* Category Header with Toggle Dashboard */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Expenses Log</h1>
                </div>

                <div>
                  <button
                    onClick={() => setShowExpenseDashboard(!showExpenseDashboard)}
                    className="notion-btn text-xs px-3.5 py-2 font-semibold flex items-center gap-1.5 bg-[#5D87FF] hover:bg-[#4570EA] text-white rounded-md shadow-sm border border-transparent transition-all cursor-pointer"
                  >
                    {showExpenseDashboard ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>Log Expense Form</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                        </svg>
                        <span>View Analytics Ledger</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* ACTION NOTIFICATIONS */}
              {actionData && "error" in actionData && actionErrorVisible && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/30 rounded-md text-xs font-semibold animate-fade-in">
                  ⚠️ {actionData.error}
                </div>
              )}
              {expenseSuccessVisible && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-md text-xs font-semibold animate-fade-in flex items-center justify-between">
                  {actionData && "isAi" in actionData && actionData.isAi ? (
                    <span>
                      🤖 AI Parsed and Saved: 
                      {actionData.expensesCreated > 0 && ` 💸 ${actionData.expensesCreated} Expense/Income item(s)`}
                      {actionData.expensesCreated > 0 && actionData.deliveriesCreated > 0 && " and"}
                      {actionData.deliveriesCreated > 0 && ` 📦 ${actionData.deliveriesCreated} Order Runsheet(s)`}
                      !
                    </span>
                  ) : (
                    <span>✅ Operation saved successfully!</span>
                  )}
                  {actionData && "parsedExpense" in actionData && actionData.parsedExpense && (
                    <span className="text-[10px] uppercase font-bold text-neutral-400">
                      Parsed: ₹{actionData.parsedExpense.amount} ({actionData.parsedExpense.category})
                    </span>
                  )}
                </div>
              )}

              {/* FORM MODE (DEFAULT) */}
              {!showExpenseDashboard ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Unified Entry Console */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="notion-card border border-[#edece9] dark:border-[#2f2f2f] rounded-lg p-6 bg-white dark:bg-[#1e1e1e] shadow-sm space-y-6">
                      
                      {/* Interactive Tonal Segmented Pill Control */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                        <div className="flex items-center gap-2">
                          <span className="text-md font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                            Entry Console
                          </span>
                        </div>
                        <div className="inline-flex p-0.5 bg-[#f5f5f4] dark:bg-[#2c2c2c] rounded-lg gap-0.5 select-none self-start sm:self-auto border border-neutral-200/50 dark:border-neutral-800/30">
                          <button
                            type="button"
                            onClick={() => setExpenseFormMode("ai")}
                            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                              expenseFormMode === "ai"
                                ? "bg-[#5D87FF] text-white shadow-sm"
                                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                            }`}
                          >
                            🤖 AI Assistant
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpenseFormMode("manual")}
                            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                              expenseFormMode === "manual"
                                ? "bg-[#5D87FF] text-white shadow-sm"
                                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                            }`}
                          >
                            ✍️ Manual Form
                          </button>
                        </div>
                      </div>

                      {/* Dynamic Form Content */}
                      {expenseFormMode === "ai" ? (
                        <div className="space-y-4 animate-fade-in">
                          <div className="space-y-1">
                            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                              Smart AI Logistics Parser (Expenses & Orders)
                            </h3>
                          </div>

                          <Form ref={aiFormRef} method="post" className="space-y-4">
                            <input type="hidden" name="_action" value="create_expense" />
                            <input type="hidden" name="isAi" value="true" />
                            <textarea
                              name="rawText"
                              rows={3}
                              value={aiRawInput}
                              onChange={(e) => setAiRawInput(e.target.value)}
                              placeholder="Example: diesel bill ₹4500 for MH-12-AB-1234 by sam today + John completed runsheet with 42 orders"
                              className="notion-textarea text-sm w-full border border-neutral-200 dark:border-neutral-800 rounded-md px-3.5 py-2.5 bg-transparent focus:ring-1 focus:ring-[#5D87FF] outline-none min-h-[80px] text-neutral-800 dark:text-neutral-100"
                            />

                            {/* AI Camera Receipt Slip Capture */}
                            <div className="p-3.5 bg-orange-50/30 dark:bg-orange-950/10 border border-orange-200/40 dark:border-orange-900/40 rounded-lg space-y-2.5">
                              <div className="flex justify-between items-center">
                                <div>
                                  <h4 className="text-xs font-bold text-orange-800 dark:text-orange-300 flex items-center gap-1">
                                    <span>⛽ Petrol Pump Slip Receipt</span>
                                  </h4>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => document.getElementById("ai-slip-input-camera")?.click()}
                                    title="Take Photo using Camera"
                                    className="p-2 rounded-full bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => document.getElementById("ai-slip-input-gallery")?.click()}
                                    title="Select from Gallery"
                                    className="p-2 rounded-full bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>

                              <input
                                type="file"
                                id="ai-slip-input-camera"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const compressed = await compressImage(file);
                                    setFuelSlipBase64(compressed);
                                  }
                                }}
                              />
                              <input
                                type="file"
                                id="ai-slip-input-gallery"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const compressed = await compressImage(file);
                                    setFuelSlipBase64(compressed);
                                  }
                                }}
                              />
                              <input type="hidden" name="imageUrl" value={fuelSlipBase64 || ""} />

                              {fuelSlipBase64 ? (
                                <div className="relative w-full max-w-[100px] aspect-[3/4] rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-md">
                                  <img src={fuelSlipBase64} className="w-full h-full object-cover" alt="AI Fuel Slip Preview" />
                                  <button
                                    type="button"
                                    onClick={() => setFuelSlipBase64(null)}
                                    className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-all cursor-pointer"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-col sm:flex-row justify-end sm:items-center gap-3">
                              <button
                                type="submit"
                                disabled={isSubmitting || !aiRawInput.trim()}
                                className="notion-btn text-xs px-4 py-2.5 bg-[#5D87FF] hover:bg-[#4570EA] font-bold text-white rounded-md disabled:opacity-50 cursor-pointer shadow-sm self-end sm:self-auto transition-all"
                              >
                                {isSubmitting ? "Parsing..." : "AI Parse & Save"}
                              </button>
                            </div>
                          </Form>

                        </div>
                      ) : (
                        <div className="space-y-4 animate-fade-in">
                          <div className="space-y-1">
                            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                              Manual Log Entry
                            </h3>
                          </div>

                          <Form ref={manualExpenseFormRef} method="post" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <input type="hidden" name="_action" value="create_expense" />
                            <input type="hidden" name="isAi" value="false" />

                            {/* Transaction Type Segmented Toggle */}
                            <div className="sm:col-span-2">
                              <label className="text-xs font-semibold text-neutral-500 block mb-1">Transaction Type</label>
                              <div className="inline-flex p-0.5 bg-[#f5f5f4] dark:bg-[#2c2c2c] rounded-lg gap-0.5 select-none w-full border border-neutral-200/50 dark:border-neutral-800/30">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setManualType("EXPENSE");
                                    setSelectedCategory("fuel");
                                  }}
                                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer text-center ${
                                    manualType === "EXPENSE"
                                      ? "bg-[#5D87FF] text-white shadow-sm"
                                      : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                                  }`}
                                >
                                  💸 Expense
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setManualType("INCOME");
                                    setSelectedCategory("shadowfax");
                                  }}
                                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer text-center ${
                                    manualType === "INCOME"
                                      ? "bg-[#5D87FF] text-white shadow-sm"
                                      : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                                  }`}
                                >
                                  📈 Income
                                </button>
                              </div>
                              <input type="hidden" name="type" value={manualType} />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Amount (₹ INR)</label>
                              <input
                                type="number"
                                name="amount"
                                required
                                step="1"
                                min="0"
                                placeholder="0"
                                onKeyDown={(e) => {
                                  if ([".", ",", "-", "+", "e", "E"].includes(e.key)) e.preventDefault();
                                }}
                                onPaste={(e) => {
                                  const text = e.clipboardData.getData("text");
                                  if (/[.,\-+eE]/.test(text)) e.preventDefault();
                                }}
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Category</label>
                              <select
                                name="category"
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 dark:bg-[#1e1e1e] focus:ring-1 focus:ring-[#5D87FF] outline-none cursor-pointer"
                              >
                                {manualType === "EXPENSE" ? (
                                  <>
                                    <option value="fuel">⛽ Fuel</option>
                                    <option value="bittu">👤 Payment to Bittu</option>
                                    <option value="service">🔧 Service / Auto-related</option>
                                    <option value="other">📦 Other Expenses</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="shadowfax">🚚 70 Per Order Income</option>
                                    <option value="factory">🚚 Vendor Per Order Income</option>
                                    <option value="vendor_income">🚚 Vendor Income</option>
                                    <option value="other_income">💰 Other Income</option>
                                  </>
                                )}
                              </select>
                            </div>

                            <input type="hidden" name="vehicle" value="" />
                            <input type="hidden" name="senderName" value="Founder" />

                            <div className="sm:col-span-2 space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Notes / Remarks</label>
                              <input
                                type="text"
                                name="notes"
                                placeholder={manualType === "EXPENSE" ? "What was this expense for?" : "70 per order payout, vendor weekly order pay, vendor base pay details"}
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            {/* Petrol Pump Slip Camera Capture */}
                            {manualType === "EXPENSE" && selectedCategory === "fuel" && (
                              <div className="sm:col-span-2 p-4 bg-orange-50/50 dark:bg-orange-950/10 border border-orange-200/50 dark:border-orange-900/30 rounded-lg space-y-3">
                                <div className="flex justify-between items-center">
                                  <div>
                                    <h4 className="text-xs font-bold text-orange-800 dark:text-orange-300 flex items-center gap-1">
                                      <span>⛽ Petrol Pump Slip Required</span>
                                    </h4>
                                    <p className="text-[10px] text-neutral-400 mt-0.5">Attach a photo of the receipt to log fuel expense.</p>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => document.getElementById("fuel-slip-input-camera")?.click()}
                                      title="Take Photo using Camera"
                                      className="p-2 rounded-full bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => document.getElementById("fuel-slip-input-gallery")?.click()}
                                      title="Select from Gallery"
                                      className="p-2 rounded-full bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>

                                <input
                                  type="file"
                                  id="fuel-slip-input-camera"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const compressed = await compressImage(file);
                                      setFuelSlipBase64(compressed);
                                    }
                                  }}
                                />
                                <input
                                  type="file"
                                  id="fuel-slip-input-gallery"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const compressed = await compressImage(file);
                                      setFuelSlipBase64(compressed);
                                    }
                                  }}
                                />
                                <input type="hidden" name="imageUrl" value={fuelSlipBase64 || ""} />

                                {fuelSlipBase64 ? (
                                  <div className="relative w-full max-w-[120px] aspect-[3/4] rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-md">
                                    <img src={fuelSlipBase64} className="w-full h-full object-cover" alt="Fuel Slip Preview" />
                                    <button
                                      type="button"
                                      onClick={() => setFuelSlipBase64(null)}
                                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-all cursor-pointer"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-orange-600/80 dark:text-orange-400/80 italic font-semibold">⚠️ No slip image captured. Snap physical receipt using the camera button to proceed.</p>
                                )}
                              </div>
                            )}

                            <div className="sm:col-span-2 pt-2">
                              <button
                                type="submit"
                                disabled={isSubmitting || (manualType === "EXPENSE" && selectedCategory === "fuel" && !fuelSlipBase64)}
                                className="notion-btn w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-200 dark:hover:bg-neutral-300 text-white dark:text-neutral-900 font-bold rounded-md cursor-pointer transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isSubmitting
                                  ? "Saving log..."
                                  : manualType === "EXPENSE" && selectedCategory === "fuel" && !fuelSlipBase64
                                  ? "⚠️ Snap Receipt Slip Image First"
                                  : "Save Log Entry"}
                              </button>
                            </div>
                          </Form>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Elegant Borderless Recent Activities Feed */}
                  <div className="lg:col-span-1 space-y-4">
                    <div className="px-1">
                      <h3 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest pb-1 border-b border-[#edece9] dark:border-[#2f2f2f]">
                        Recent Activity
                      </h3>
                    </div>
                    <div className="space-y-1">
                      {expenses.slice(0, 5).map((exp) => (
                        <div
                          key={exp.id}
                          className="flex flex-col gap-1.5 p-3 hover:bg-[#fbfbfa] dark:hover:bg-[#202020]/40 rounded-lg transition-all border border-transparent hover:border-[#edece9] dark:hover:border-[#2f2f2f]"
                        >
                          <div className="flex justify-between items-center">
                            <span className="capitalize text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                              {exp.category === "fuel" && "⛽"}
                              {exp.category === "bittu" && "👤"}
                              {exp.category === "service" && "🔧"}
                              {exp.category === "other" && "📦"}
                              {exp.category === "shadowfax" && "🚚"}
                              {exp.category === "rate_change" && "📈"}
                              {exp.category === "factory" && "🚚"}
                              {exp.category === "vendor_income" && "🚚"}
                              {exp.category === "other_income" && "💰"}
                              {exp.category === "shadowfax" ? "70 Per Order Income" : exp.category === "factory" ? "Vendor Per Order Income" : exp.category === "vendor_income" ? "Vendor Income" : exp.category === "other_income" ? "Other Income" : exp.category}
                              {exp.imageUrl && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedSlipImage(exp.imageUrl)}
                                  className="p-0.5 rounded-full bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-all hover:scale-105 cursor-pointer inline-flex items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60"
                                  title="Click to view receipt slip"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </button>
                              )}
                            </span>
                            <span className={`text-xs font-bold ${exp.type === "INCOME" ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-900 dark:text-neutral-100"}`}>
                              {exp.type === "INCOME" ? "+" : ""} ₹{exp.amount}
                            </span>
                          </div>
                          
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 flex justify-between gap-2">
                            <span className="truncate max-w-[140px] italic">"{exp.notes}"</span>
                            <span className="text-[10px] text-neutral-400 shrink-0 font-medium">
                              {new Date(exp.timestamp).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        </div>
                      ))}
                      {expenses.length === 0 && (
                        <p className="text-xs text-neutral-400 p-3 italic">No recent logs.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* LEDGER DASHBOARD VIEW MODE */
                <div className="space-y-6">
                  {/* Financial calculation metrics grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40 rounded-lg">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Total Income</div>
                      <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">₹{totals.income}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40 rounded-lg">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Total Expenses</div>
                      <div className="text-2xl font-bold mt-1 text-neutral-900 dark:text-white">₹{totals.expense}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40 rounded-lg">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Net Margin</div>
                      <div className={`text-2xl font-bold mt-1 ${totals.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-orange-500 dark:text-orange-400"}`}>
                        {totals.net >= 0 ? "+" : ""}₹{totals.net}
                      </div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40 rounded-lg">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Fuel Cost Share</div>
                      <div className="text-2xl font-bold mt-1 text-[#2383e2]">₹{totals.fuel}</div>
                    </div>
                  </div>

                  {/* Timeframe selector pills */}
                  <div className="flex flex-col p-3 border border-[#edece9] dark:border-[#2f2f2f] rounded-lg bg-neutral-50 dark:bg-[#202020]">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                      <div className="flex flex-col md:flex-row md:items-center gap-3 w-full md:w-auto">
                        <span className="text-[11px] sm:text-xs text-neutral-500 font-bold uppercase tracking-wider flex-shrink-0">Filter Timeframe:</span>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Timeframe selector pills */}
                          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0 -mx-1 px-1">
                            {(["ALL", "YEAR", "MONTH", "TODAY", "CUSTOM"] as const).map((filter) => (
                              <button
                                key={filter}
                                type="button"
                                onClick={() => {
                                  setExpenseFilter(filter);
                                  if (filter === "YEAR") {
                                    setSelectedYear(new Date().getFullYear().toString());
                                  } else if (filter === "MONTH") {
                                    setSelectedYear(new Date().getFullYear().toString());
                                    setSelectedMonth(new Date().getMonth().toString());
                                  }
                                }}
                                className={`text-[10px] sm:text-xs px-2.5 py-1 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                                  expenseFilter === filter
                                    ? "bg-neutral-900 border-neutral-900 text-white dark:bg-white dark:border-white dark:text-neutral-900"
                                    : "bg-transparent border-[#edece9] dark:border-[#2f2f2f] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                }`}
                              >
                                {filter}
                              </button>
                            ))}
                          </div>

                          {/* Connected Filter Options (Inline next to buttons) */}
                          {expenseFilter === "YEAR" && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm animate-fadeIn flex-shrink-0">
                              <span className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Year:</span>
                              <select
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(e.target.value)}
                                className="bg-transparent text-[11px] font-bold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                              >
                                <option value="ALL" className="bg-white dark:bg-[#1a1a1a]">All</option>
                                {availableYears.map((yr) => (
                                  <option key={yr} value={yr} className="bg-white dark:bg-[#1a1a1a]">{yr}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {expenseFilter === "MONTH" && (
                            <div className="flex items-center gap-2 animate-fadeIn flex-shrink-0">
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Year:</span>
                                <select
                                  value={selectedYear}
                                  onChange={(e) => setSelectedYear(e.target.value)}
                                  className="bg-transparent text-[11px] font-bold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                >
                                  <option value="ALL" className="bg-white dark:bg-[#1a1a1a]">All</option>
                                  {availableYears.map((yr) => (
                                    <option key={yr} value={yr} className="bg-white dark:bg-[#1a1a1a]">{yr}</option>
                                  ))}
                                </select>
                              </div>
                              
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Month:</span>
                                <select
                                  value={selectedMonth}
                                  onChange={(e) => setSelectedMonth(e.target.value)}
                                  className="bg-transparent text-[11px] font-bold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                >
                                  <option value="ALL" className="bg-white dark:bg-[#1a1a1a]">All</option>
                                  {MONTH_NAMES.map((name, index) => (
                                    <option key={name} value={index.toString()} className="bg-white dark:bg-[#1a1a1a]">{name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}

                            {expenseFilter === "CUSTOM" && (
                            <div className="flex flex-wrap items-center gap-2 animate-fadeIn flex-shrink-0">
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] text-neutral-400 font-bold uppercase">From:</span>
                                <input
                                  type="date"
                                  value={customStartDate}
                                  onChange={(e) => setCustomStartDate(e.target.value)}
                                  className="bg-transparent text-[10px] sm:text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                />
                              </div>
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] text-neutral-400 font-bold uppercase">To:</span>
                                <input
                                  type="date"
                                  value={customEndDate}
                                  onChange={(e) => setCustomEndDate(e.target.value)}
                                  placeholder="Single day"
                                  className="bg-transparent text-[10px] sm:text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase md:text-right flex-shrink-0">
                        Showing {filteredExpenses.length} of {expenses.length} Records
                      </div>
                    </div>

                    {/* Category Selector Row */}
                    <div className="flex flex-col md:flex-row md:items-center gap-3 w-full border-t border-[#edece9]/50 dark:border-[#2f2f2f]/30 pt-3">
                      <span className="text-[11px] sm:text-xs text-neutral-500 font-bold uppercase tracking-wider flex-shrink-0">Filter Category:</span>
                      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0 -mx-1 px-1">
                        {[
                          { value: "ALL", label: "All Transactions" },
                          { value: "EXPENSE", label: "Expenses Only" },
                          { value: "INCOME", label: "Income Only" },
                        ].map((cat) => (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() => setExpenseCategoryFilter(cat.value as any)}
                            className={`text-[10px] sm:text-xs px-2.5 py-1 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                              expenseCategoryFilter === cat.value
                                ? "bg-[#5D87FF] border-[#5D87FF] text-white"
                                : "bg-transparent border-[#edece9] dark:border-[#2f2f2f] hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Interactive full ledger grid/table */}
                  {/* Interactive full ledger grid/table & mobile responsive card view */}
                  <div className="notion-card p-0 border border-[#edece9] dark:border-[#2f2f2f] rounded-lg overflow-hidden bg-white/70 dark:bg-[#202020]/20">
                    {/* Desktop View Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500 text-xs font-semibold border-b border-[#edece9] dark:border-[#2f2f2f]">
                            <th className="p-3.5">Category</th>
                            <th className="p-3.5">Notes</th>
                            <th className="p-3.5">Amount</th>
                            <th className="p-3.5">Timestamp</th>
                            <th className="p-3.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#edece9] dark:divide-[#2f2f2f] text-xs">
                          {filteredExpenses.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="p-8 text-center text-neutral-400 dark:text-neutral-500 font-medium">
                                No expenses logged within selected timeframe.
                              </td>
                            </tr>
                          ) : (
                            paginatedExpenses.map((exp) => (
                              <tr key={exp.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/20">
                                <td className="p-3.5 font-semibold capitalize flex items-center gap-1.5">
                                  {exp.category === "fuel" && "⛽"}
                                  {exp.category === "bittu" && "👤"}
                                  {exp.category === "service" && "🔧"}
                                  {exp.category === "other" && "📦"}
                                  {exp.category === "shadowfax" && "🚚"}
                                  {exp.category === "factory" && "🚚"}
                                  {exp.category === "vendor_income" && "🚚"}
                                  {exp.category === "other_income" && "💰"}
                                  <span>{exp.category === "shadowfax" ? "70 Per Order Income" : exp.category === "factory" ? "Vendor Per Order Income" : exp.category === "vendor_income" ? "Vendor Income" : exp.category === "other_income" ? "Other Income" : exp.category}</span>
                                  {exp.imageUrl && (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedSlipImage(exp.imageUrl)}
                                      className="p-1 rounded-full bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-all hover:scale-105 cursor-pointer inline-flex items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60 shadow-sm"
                                      title="View fuel slip image"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                      </svg>
                                    </button>
                                  )}
                                </td>
                                <td className="p-3.5 max-w-[200px] truncate">{exp.notes}</td>
                                <td className={`p-3.5 font-bold ${exp.type === "INCOME" ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-900 dark:text-white"}`}>
                                  {exp.type === "INCOME" ? "+" : ""} ₹{exp.amount}
                                </td>
                                <td className="p-3.5 text-neutral-400">{new Date(exp.timestamp).toLocaleString()}</td>
                                <td className="p-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setEditingExpense(exp)}
                                      className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-900 cursor-pointer text-[10px]"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        triggerConfirm(
                                          "Delete Log?",
                                          "Are you sure you want to permanently delete this log?",
                                          () => {
                                            const fd = new FormData();
                                            fd.append("_action", "reject_expense");
                                            fd.append("id", exp.id.toString());
                                            submit(fd, { method: "post" });
                                          }
                                        );
                                      }}
                                      className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 cursor-pointer text-[10px]"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View Card List */}
                    <div className="block md:hidden divide-y divide-[#edece9] dark:divide-[#2f2f2f] text-xs">
                      {filteredExpenses.length === 0 ? (
                        <div className="p-8 text-center text-neutral-400 dark:text-neutral-500 font-medium">
                          No expenses logged within selected timeframe.
                        </div>
                      ) : (
                        paginatedExpenses.map((exp) => (
                          <div key={exp.id} className="p-4 flex flex-col gap-2 hover:bg-neutral-50/40 dark:hover:bg-neutral-900/10">
                            {/* Top row: Category, image link */}
                            <div className="flex justify-between items-center w-full">
                              <div className="flex items-center gap-1.5 font-bold capitalize text-neutral-800 dark:text-neutral-200">
                                {exp.category === "fuel" && "⛽"}
                                {exp.category === "bittu" && "👤"}
                                {exp.category === "service" && "🔧"}
                                {exp.category === "other" && "📦"}
                                {exp.category === "shadowfax" && "🚚"}
                                {exp.category === "factory" && "🚚"}
                                {exp.category === "vendor_income" && "🚚"}
                                {exp.category === "other_income" && "💰"}
                                <span>{exp.category === "shadowfax" ? "70 Per Order Income" : exp.category === "factory" ? "Vendor Per Order Income" : exp.category === "vendor_income" ? "Vendor Income" : exp.category === "other_income" ? "Other Income" : exp.category}</span>
                                {exp.imageUrl && (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedSlipImage(exp.imageUrl)}
                                    className="p-1 rounded-full bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-all hover:scale-105 cursor-pointer inline-flex items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60 shadow-sm"
                                    title="View receipt image"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Middle row: Notes */}
                            <div className="text-[11px] text-neutral-600 dark:text-neutral-400 italic py-0.5">
                              "{exp.notes}"
                            </div>

                            {/* Bottom row: Amount, Date & Actions */}
                            <div className="flex justify-between items-center mt-1 pt-1 border-t border-[#edece9]/50 dark:border-[#2f2f2f]/30">
                              <div className="flex flex-col gap-0.5">
                                <span className={`text-sm font-extrabold ${exp.type === "INCOME" ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-900 dark:text-white"}`}>
                                  {exp.type === "INCOME" ? "+" : ""} ₹{exp.amount}
                                </span>
                                <span className="text-[9px] text-neutral-400 font-medium">
                                  {new Date(exp.timestamp).toLocaleString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit"
                                  })}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingExpense(exp)}
                                  className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-900 text-[10px] cursor-pointer"
                                >
                                  Edit
                                </button>
                                <Form method="post" style={{ display: "inline" }} onSubmit={(e) => {
                                  if (!confirm("Are you sure you want to permanently delete this log?")) {
                                    e.preventDefault();
                                  }
                                }}>
                                  <input type="hidden" name="_action" value="reject_expense" />
                                  <input type="hidden" name="id" value={exp.id} />
                                  <button
                                    type="submit"
                                    className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 text-[10px] cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </Form>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Pagination Bar for Expenses */}
                    {filteredExpenses.length > 0 && (
                      <div className="flex flex-col sm:flex-row items-center justify-between border-t border-[#edece9] dark:border-[#2f2f2f] bg-neutral-50/50 dark:bg-neutral-900/30 p-4 gap-4">
                        <span className="text-xs text-neutral-500 font-medium">
                          Showing <span className="font-semibold text-neutral-800 dark:text-neutral-200">{(activeExpensePage - 1) * EXPENSE_PAGE_SIZE + 1}</span> to{" "}
                          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                            {Math.min(activeExpensePage * EXPENSE_PAGE_SIZE, filteredExpenses.length)}
                          </span> of <span className="font-semibold text-neutral-800 dark:text-neutral-200">{filteredExpenses.length}</span> records
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setExpensePage(p => Math.max(1, p - 1))}
                            disabled={activeExpensePage === 1}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-700 dark:text-neutral-300 transition-all active:scale-95 cursor-pointer"
                          >
                            ◀ Prev
                          </button>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalExpensePages }, (_, i) => i + 1).map((p) => {
                              if (p === 1 || p === totalExpensePages || Math.abs(p - activeExpensePage) <= 1) {
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setExpensePage(p)}
                                    className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-md transition-all active:scale-95 cursor-pointer ${
                                      p === activeExpensePage
                                        ? "bg-[#5D87FF]/15 text-[#5D87FF] dark:bg-[#5D87FF]/25"
                                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                                    }`}
                                  >
                                    {p}
                                  </button>
                                );
                              }
                              if ((p === 2 && activeExpensePage > 3) || (p === totalExpensePages - 1 && activeExpensePage < totalExpensePages - 2)) {
                                return (
                                  <span key={p} className="text-neutral-400 text-xs px-1 select-none">
                                    ...
                                  </span>
                                );
                              }
                              return null;
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpensePage(p => Math.min(totalExpensePages, p + 1))}
                            disabled={activeExpensePage === totalExpensePages}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-700 dark:text-neutral-300 transition-all active:scale-95 cursor-pointer"
                          >
                            Next ▶
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ORDER TRACKING TAB VIEW */}
          {activeTab === "orders" && (
            <div className="animate-fade-in space-y-6">
              {/* Category Header with Toggle Dashboard */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Settlement & Cycle Tracker</h1>
                  {/* Small subheader description removed */}
                </div>

                <div className="flex gap-1.5 p-1 bg-[#f1f0ec] dark:bg-neutral-900 rounded-lg shrink-0 w-full sm:w-auto overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setOrdersViewMode("form")}
                    className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      ordersViewMode === "form"
                        ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                        : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-450 dark:hover:text-neutral-300"
                    }`}
                  >
                    📝 Log Runsheet
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdersViewMode("dashboard")}
                    className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      ordersViewMode === "dashboard"
                        ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                        : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-450 dark:hover:text-neutral-300"
                    }`}
                  >
                    📊 Runsheets History
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdersViewMode("payouts")}
                    className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      ordersViewMode === "payouts"
                        ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                        : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-450 dark:hover:text-neutral-300"
                    }`}
                  >
                    💰 Weekly Payouts
                  </button>
                </div>
              </div>

              {/* ACTION NOTIFICATIONS */}
              {actionData && "error" in actionData && actionErrorVisible && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/30 rounded-md text-xs font-semibold animate-fade-in">
                  ⚠️ {actionData.error}
                </div>
              )}
              {runsheetSuccessVisible && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-md text-xs font-semibold animate-fade-in">
                  ✅ Daily runsheet status logged successfully!
                </div>
              )}
              {payoutSuccessVisible && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-md text-xs font-semibold animate-fade-in">
                  ✅ Payout recorded and logged in ledger successfully!
                </div>
              )}
              {ccSuccessVisible && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-md text-xs font-semibold animate-fade-in">
                  ✅ Credit card fuel billing cycle paid and expensed successfully!
                </div>
              )}

              {/* FORM MODE */}
              {ordersViewMode === "form" && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Unified Dispatch Console */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="notion-card border border-[#edece9] dark:border-[#2f2f2f] rounded-lg p-6 bg-white dark:bg-[#1e1e1e] shadow-sm space-y-6">
                      
                      <div className="pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                        <h3 className="text-md font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                          Daily Runsheet Console
                        </h3>
                      </div>

                      <Form ref={runsheetFormRef} method="post" className="space-y-4">
                        <input type="hidden" name="_action" value="create_delivery" />

                        <input type="hidden" name="title" value="Daily Runsheet Summary" />
                        <input type="hidden" name="totalOrders" value={formCompletedOrders} />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="space-y-1 flex flex-col">
                            <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400">Field Operator</label>
                            <select
                              name="driverName"
                              className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2.5 bg-white dark:bg-[#1e1e1e] text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] focus:border-[#2383e2] outline-none cursor-pointer font-semibold shadow-sm"
                            >
                              {drivers.length > 0 ? (
                                drivers.map((d: any) => (
                                  <option key={d.id} value={d.name}>
                                    👤 {d.name}
                                  </option>
                                ))
                              ) : (
                                <option value="John Driver">👤 John Driver</option>
                              )}
                            </select>
                          </div>

                          <div className="space-y-1 flex flex-col">
                            <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400">Order Category</label>
                            <select
                              name="category"
                              value={formCategory}
                              onChange={(e) => setFormCategory(e.target.value as "vendor_ship" | "per_order_rate")}
                              className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2.5 bg-white dark:bg-[#1e1e1e] text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] focus:border-[#2383e2] outline-none cursor-pointer font-semibold shadow-sm"
                            >
                              <option value="vendor_ship">🚚 Vendor Ship (₹70/order Weekly)</option>
                              <option value="per_order_rate">🚚 Split Plan (₹35/order Weekly + ₹53k Base)</option>
                            </select>
                          </div>

                          <div className="space-y-1 flex flex-col">
                            <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400">Completed Orders</label>
                            <input
                              type="number"
                              name="completedOrders"
                              value={formCompletedOrders}
                              onChange={(e) => setFormCompletedOrders(e.target.value)}
                              required
                              step="1"
                              min="0"
                              placeholder="e.g. 48"
                              onKeyDown={(e) => {
                                if ([".", ",", "-", "+", "e", "E"].includes(e.key)) e.preventDefault();
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                if (/[.,\-+eE]/.test(text)) e.preventDefault();
                              }}
                              className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2.5 bg-white dark:bg-[#1e1e1e] text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] focus:border-[#2383e2] outline-none font-semibold shadow-sm"
                            />
                          </div>

                          <div className="space-y-1 flex flex-col">
                            <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400">Runsheet Week Cycle</label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const current = parseLocalDate(runsheetDate);
                                  current.setDate(current.getDate() - 7);
                                  setRunsheetDate(formatLocalDate(getMonday(current)));
                                }}
                                className="px-3 py-2 border border-neutral-200 dark:border-neutral-800 rounded-md bg-white dark:bg-[#1e1e1e] hover:bg-neutral-50 dark:hover:bg-neutral-850 text-neutral-600 dark:text-neutral-300 font-bold transition-all shadow-sm cursor-pointer"
                                title="Previous Week"
                              >
                                ◀
                              </button>
                              <div className="relative flex-1">
                                <input
                                  type="date"
                                  name="createdAt"
                                  value={runsheetDate}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val) {
                                      const mon = getMonday(val);
                                      setRunsheetDate(formatLocalDate(mon));
                                    }
                                  }}
                                  required
                                  className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2.5 bg-white dark:bg-[#1e1e1e] text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] focus:border-[#2383e2] outline-none cursor-pointer font-semibold shadow-sm"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const current = parseLocalDate(runsheetDate);
                                  current.setDate(current.getDate() + 7);
                                  setRunsheetDate(formatLocalDate(getMonday(current)));
                                }}
                                className="px-3 py-2 border border-neutral-200 dark:border-neutral-800 rounded-md bg-white dark:bg-[#1e1e1e] hover:bg-neutral-50 dark:hover:bg-neutral-850 text-neutral-600 dark:text-neutral-300 font-bold transition-all shadow-sm cursor-pointer"
                                title="Next Week"
                              >
                                ▶
                              </button>
                            </div>
                            {runsheetDate && (
                              <div className="text-[10px] font-bold text-[#2383e2] dark:text-[#3894f2] mt-1.5 bg-[#2383e2]/5 dark:bg-[#2383e2]/15 px-2.5 py-1.5 rounded-lg border border-[#2383e2]/10 flex items-center justify-between">
                                <span>📅 Week Cycle:</span>
                                <span>
                                  {formatRange(runsheetDate)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Interactive live payout calculation preview */}
                        {parsedCompleted > 0 && (
                          <div className="p-3.5 rounded-lg border border-[#2383e2]/20 bg-[#2383e2]/5 dark:bg-[#2383e2]/10 space-y-1.5 animate-fadeIn">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">
                                {formCategory === "vendor_ship" ? "Weekly Runsheet Payout:" : "Weekly Portion Payout:"}
                              </span>
                              <span className="text-sm font-bold text-[#2383e2]">₹{previewPayout.toLocaleString()}</span>
                            </div>
                            {formCategory === "per_order_rate" && (
                              <p className="text-[10px] text-neutral-450 dark:text-neutral-400 italic font-semibold leading-normal">
                                Note: The monthly fixed base pay of ₹53,000 (deferred by 45 days) is tracked separately on the Payouts board.
                              </p>
                            )}
                          </div>
                        )}

                        <div className="pt-2">
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="notion-btn w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-200 dark:hover:bg-neutral-300 text-white dark:text-neutral-900 font-bold rounded-md cursor-pointer transition-all shadow-sm"
                          >
                            {isSubmitting ? "Logging daily status..." : "Log Daily Runsheet"}
                          </button>
                        </div>
                      </Form>
                    </div>
                  </div>

                  {/* Elegant Borderless Recent Runsheet Feed */}
                  <div className="lg:col-span-1 space-y-4">
                    <div className="px-1 flex justify-between items-center border-b border-[#edece9] dark:border-[#2f2f2f] pb-1">
                      <h3 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">
                        Recent Daily Logs
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          const driverInfo = users.find(u => u.role === "DRIVER") || { name: "John Driver", phone: "+91 88888 88888" };
                          setSelectedDriverProfile(driverInfo);
                        }}
                        className="text-[10px] text-[#2383e2] hover:text-[#1a6ab8] font-bold transition-all cursor-pointer flex items-center gap-0.5"
                      >
                        👤 Active Driver
                      </button>
                    </div>

                    <div className="space-y-1">
                      {deliveries.slice(0, 5).map((del) => {
                        const payout = del.category === "vendor_ship"
                          ? del.completedOrders * 70
                          : del.completedOrders * 35;
                        return (
                          <div
                            key={del.id}
                            onClick={() => {
                              const driverInfo = users.find(u => u.name === del.driverName && u.role === "DRIVER") || { name: del.driverName, phone: "N/A" };
                              setSelectedDriverProfile(driverInfo);
                            }}
                            className="flex flex-col gap-1.5 p-3 hover:bg-[#fbfbfa] dark:hover:bg-[#202020]/40 rounded-lg transition-all border border-transparent hover:border-[#edece9] dark:hover:border-[#2f2f2f] cursor-pointer"
                            title="Click to view driver details"
                          >
                            <div className="flex justify-between items-center">
                              <span className="capitalize text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                                🚚 {del.category === "vendor_ship" ? "70 Per Order" : "Vendor Per Order"}
                              </span>
                              <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                                ₹{payout.toLocaleString()}
                              </span>
                            </div>
                            
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 flex justify-between gap-2 text-right">
                              <span className="truncate max-w-[140px] text-left">
                                {del.completedOrders} completed
                              </span>
                              <span className="text-[10px] text-neutral-450 shrink-0 font-bold">
                                {formatRange(del.createdAt)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {deliveries.length === 0 && (
                        <p className="text-xs text-neutral-400 p-3 italic">No recent runsheets.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* RUNSHEET DASHBOARD VIEW MODE */}
              {ordersViewMode === "dashboard" && (
                <div className="space-y-6">
                  {/* Daily runsheet stats cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Completed Orders</div>
                      <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{orderCounts.totalCompleted}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">70 Per Order Volume</div>
                      <div className="text-2xl font-bold mt-1 text-[#2383e2]">{orderCounts.vendorShipOrders} <span className="text-xs text-neutral-400 font-normal">orders</span></div>
                      <div className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mt-1">₹{orderCounts.vendorShipValue.toLocaleString()}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Vendor Per Order Volume</div>
                      <div className="text-2xl font-bold mt-1 text-purple-600 dark:text-purple-400">{orderCounts.perOrderRateOrders} <span className="text-xs text-neutral-400 font-normal">orders</span></div>
                      <div className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mt-1">₹{orderCounts.perOrderRateValue.toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Timeframe & Category selectors */}
                  <div className="flex flex-col gap-3.5 p-3 border border-[#edece9] dark:border-[#2f2f2f] rounded-lg bg-neutral-50 dark:bg-[#202020]">
                    {/* Timeframe Selectors Row */}
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                      <div className="flex flex-col md:flex-row md:items-center gap-3 w-full md:w-auto">
                        <span className="text-[11px] sm:text-xs text-neutral-500 font-bold uppercase tracking-wider flex-shrink-0">Filter Timeframe:</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0 -mx-1 px-1">
                            {(["ALL", "YEAR", "MONTH", "TODAY", "CUSTOM"] as const).map((filter) => (
                              <button
                                key={filter}
                                type="button"
                                onClick={() => {
                                  setDeliveryFilter(filter);
                                  if (filter === "YEAR") {
                                    setSelectedDeliveryYear(new Date().getFullYear().toString());
                                  } else if (filter === "MONTH") {
                                    setSelectedDeliveryYear(new Date().getFullYear().toString());
                                    setSelectedDeliveryMonth(new Date().getMonth().toString());
                                  }
                                }}
                                className={`text-[10px] sm:text-xs px-2.5 py-1 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                                  deliveryFilter === filter
                                    ? "bg-neutral-900 border-neutral-900 text-white dark:bg-white dark:border-white dark:text-neutral-900"
                                    : "bg-transparent border-[#edece9] dark:border-[#2f2f2f] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                }`}
                              >
                                {filter}
                              </button>
                            ))}
                          </div>

                          {/* Connected Filter Options (Inline next to buttons) */}
                          {deliveryFilter === "YEAR" && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm animate-fadeIn flex-shrink-0">
                              <span className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Year:</span>
                              <select
                                value={selectedDeliveryYear}
                                onChange={(e) => setSelectedDeliveryYear(e.target.value)}
                                className="bg-transparent text-[11px] font-bold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                              >
                                <option value="ALL" className="bg-white dark:bg-[#1a1a1a]">All</option>
                                {availableDeliveryYears.map((yr) => (
                                  <option key={yr} value={yr} className="bg-white dark:bg-[#1a1a1a]">{yr}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {deliveryFilter === "MONTH" && (
                            <div className="flex items-center gap-2 animate-fadeIn flex-shrink-0">
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Year:</span>
                                <select
                                  value={selectedDeliveryYear}
                                  onChange={(e) => setSelectedDeliveryYear(e.target.value)}
                                  className="bg-transparent text-[11px] font-bold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                >
                                  <option value="ALL" className="bg-white dark:bg-[#1a1a1a]">All</option>
                                  {availableDeliveryYears.map((yr) => (
                                    <option key={yr} value={yr} className="bg-white dark:bg-[#1a1a1a]">{yr}</option>
                                  ))}
                                </select>
                              </div>
                              
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Month:</span>
                                <select
                                  value={selectedDeliveryMonth}
                                  onChange={(e) => setSelectedDeliveryMonth(e.target.value)}
                                  className="bg-transparent text-[11px] font-bold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                >
                                  <option value="ALL" className="bg-white dark:bg-[#1a1a1a]">All</option>
                                  {MONTH_NAMES.map((name, index) => (
                                    <option key={name} value={index.toString()} className="bg-white dark:bg-[#1a1a1a]">{name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}

                          {deliveryFilter === "CUSTOM" && (
                            <div className="flex flex-wrap items-center gap-2 animate-fadeIn flex-shrink-0">
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] text-neutral-400 font-bold uppercase">From:</span>
                                <input
                                  type="date"
                                  value={customDeliveryStartDate}
                                  onChange={(e) => setCustomDeliveryStartDate(e.target.value)}
                                  className="bg-transparent text-[10px] sm:text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                />
                              </div>
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <span className="text-[9px] text-neutral-400 font-bold uppercase">To:</span>
                                <input
                                  type="date"
                                  value={customDeliveryEndDate}
                                  onChange={(e) => setCustomDeliveryEndDate(e.target.value)}
                                  placeholder="Single day"
                                  className="bg-transparent text-[10px] sm:text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 outline-none cursor-pointer"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-[9px] sm:text-[10px] text-neutral-400 font-bold uppercase md:text-right flex-shrink-0">
                        Showing {filteredDeliveries.length} of {deliveries.length} daily logs
                      </div>
                    </div>

                    {/* Category Selector Row */}
                    <div className="flex flex-col md:flex-row md:items-center gap-3 w-full border-t border-[#edece9]/50 dark:border-[#2f2f2f]/30 pt-3">
                      <span className="text-[11px] sm:text-xs text-neutral-500 font-bold uppercase tracking-wider flex-shrink-0">Filter Category:</span>
                      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0 -mx-1 px-1">
                        {[
                          { value: "ALL", label: "All Categories" },
                          { value: "VENDOR_SHIP", label: "70 Per Order" },
                          { value: "PER_ORDER", label: "Vendor Per Order" },
                        ].map((cat) => (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() => setDeliveryCategoryFilter(cat.value as any)}
                            className={`text-[10px] sm:text-xs px-2.5 py-1 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                              deliveryCategoryFilter === cat.value
                                ? "bg-[#5D87FF] border-[#5D87FF] text-white"
                                : "bg-transparent border-[#edece9] dark:border-[#2f2f2f] hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Driver Selector Row */}
                    <div className="flex flex-col md:flex-row md:items-center gap-3 w-full border-t border-[#edece9]/50 dark:border-[#2f2f2f]/30 pt-3">
                      <span className="text-[11px] sm:text-xs text-neutral-500 font-bold uppercase tracking-wider flex-shrink-0">Filter Driver:</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={deliveryDriverFilter}
                          onChange={(e) => setDeliveryDriverFilter(e.target.value)}
                          className="bg-white dark:bg-[#1a1a1a] border border-[#edece9] dark:border-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 rounded-md px-3 py-1.5 outline-none cursor-pointer"
                        >
                          <option value="ALL">All Field Operators / Drivers</option>
                          {Array.from(new Set([
                            ...drivers.map((d: any) => d.name),
                            ...deliveries.map((del: any) => del.driverName)
                          ])).filter(Boolean).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Table of Daily Runsheet Logs (Desktop Only) */}
                  <div className="hidden md:block notion-card p-0 border border-[#edece9] dark:border-[#2f2f2f] rounded-lg overflow-hidden bg-white/70 dark:bg-[#202020]/20">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500 text-xs font-semibold border-b border-[#edece9] dark:border-[#2f2f2f]">
                            <th className="p-3.5">Log Date</th>
                            <th className="p-3.5">Field Operator</th>
                            <th className="p-3.5">Category</th>
                            <th className="p-3.5 text-center">Completed</th>
                            <th className="p-3.5 text-center">Payout</th>
                            <th className="p-3.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#edece9] dark:divide-[#2f2f2f] text-xs">
                          {filteredDeliveries.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-8 text-center text-neutral-400 dark:text-neutral-500 font-medium">
                                No runsheet logs found in this timeframe.
                              </td>
                            </tr>
                          ) : (
                            paginatedDeliveries.map((del) => {
                              const rate = del.totalOrders > 0 ? Math.round((del.completedOrders / del.totalOrders) * 100) : 0;
                              const payout = del.category === "vendor_ship"
                                ? del.completedOrders * (systemSettings?.rateVendorShip ?? 70)
                                : del.completedOrders * (systemSettings?.ratePerOrderWeekly ?? 35);
                              return (
                                <tr key={del.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/20">
                                  <td className="p-3.5 text-neutral-500 font-semibold">
                                    {formatRange(del.createdAt)}
                                  </td>
                                  <td className="p-3.5 font-bold text-neutral-800 dark:text-neutral-200">
                                    👤 {del.driverName}
                                  </td>
                                  <td className="p-3.5">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase shrink-0 ${
                                      del.category === "vendor_ship"
                                        ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900/30"
                                        : "bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-900/30"
                                    }`}>
                                      {del.category === "vendor_ship" ? "70 Per Order" : "Vendor Per Order"}
                                    </span>
                                  </td>
                                  <td className="p-3.5 text-center font-semibold text-emerald-600 dark:text-emerald-400">
                                    {del.completedOrders}
                                  </td>
                                  <td className="p-3.5 text-center font-bold text-neutral-800 dark:text-neutral-200">
                                    ₹{payout.toLocaleString()}
                                  </td>
                                  <td className="p-3.5 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditingDelivery(del)}
                                        className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-900 text-[10px] cursor-pointer"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          triggerConfirm(
                                            "Delete Runsheet?",
                                            "Are you sure you want to permanently delete this runsheet?",
                                            () => {
                                              const fd = new FormData();
                                              fd.append("_action", "delete_delivery");
                                              fd.append("id", del.id.toString());
                                              submit(fd, { method: "post" });
                                            }
                                          );
                                        }}
                                        className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 text-[10px] cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Desktop Pagination Bar for Deliveries */}
                    {filteredDeliveries.length > 0 && (
                      <div className="hidden md:flex items-center justify-between border-t border-[#edece9] dark:border-[#2f2f2f] bg-neutral-50/50 dark:bg-neutral-900/30 p-4">
                        <span className="text-xs text-neutral-500 font-medium">
                          Showing <span className="font-semibold text-neutral-800 dark:text-neutral-200">{(activeDeliveryPage - 1) * DELIVERY_PAGE_SIZE + 1}</span> to{" "}
                          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                            {Math.min(activeDeliveryPage * DELIVERY_PAGE_SIZE, filteredDeliveries.length)}
                          </span> of <span className="font-semibold text-neutral-800 dark:text-neutral-200">{filteredDeliveries.length}</span> daily logs
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDeliveryPage(p => Math.max(1, p - 1))}
                            disabled={activeDeliveryPage === 1}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-700 dark:text-neutral-300 transition-all active:scale-95 cursor-pointer"
                          >
                            ◀ Prev
                          </button>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalDeliveryPages }, (_, i) => i + 1).map((p) => {
                              if (p === 1 || p === totalDeliveryPages || Math.abs(p - activeDeliveryPage) <= 1) {
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setDeliveryPage(p)}
                                    className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-md transition-all active:scale-95 cursor-pointer ${
                                      p === activeDeliveryPage
                                        ? "bg-[#5D87FF]/15 text-[#5D87FF] dark:bg-[#5D87FF]/25"
                                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                                    }`}
                                  >
                                    {p}
                                  </button>
                                );
                              }
                              if ((p === 2 && activeDeliveryPage > 3) || (p === totalDeliveryPages - 1 && activeDeliveryPage < totalDeliveryPages - 2)) {
                                return (
                                  <span key={p} className="text-neutral-400 text-xs px-1 select-none">
                                    ...
                                  </span>
                                );
                              }
                              return null;
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeliveryPage(p => Math.min(totalDeliveryPages, p + 1))}
                            disabled={activeDeliveryPage === totalDeliveryPages}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-700 dark:text-neutral-300 transition-all active:scale-95 cursor-pointer"
                          >
                            Next ▶
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mobile-Responsive Daily Runsheets Card Feed (Mobile Only) */}
                  <div className="md:hidden space-y-3">
                    {filteredDeliveries.length === 0 ? (
                      <div className="p-6 text-center text-neutral-400 bg-neutral-50 dark:bg-neutral-900/30 rounded-lg italic text-xs">
                        No runsheet logs found in this timeframe.
                      </div>
                    ) : (
                      paginatedDeliveries.map((del) => {
                        const rate = del.totalOrders > 0 ? Math.round((del.completedOrders / del.totalOrders) * 100) : 0;
                        return (
                          <div
                            key={del.id}
                            className="p-4 border border-[#edece9] dark:border-[#2f2f2f] rounded-lg bg-white dark:bg-[#1e1e1e] shadow-sm flex flex-col gap-2.5"
                          >
                            {/* Card Top Row: Date & Operator */}
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-bold text-neutral-400">
                                📅 {formatRange(del.createdAt)}
                              </span>
                              <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                                👤 {del.driverName}
                              </span>
                            </div>

                            {/* Card Middle Row: Category and counts */}
                            <div className="flex justify-between items-center py-1.5 border-y border-[#edece9]/50 dark:border-[#2f2f2f]/30">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                                del.category === "vendor_ship"
                                  ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900/30"
                                  : "bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-900/30"
                              }`}>
                                {del.category === "vendor_ship" ? "70 Per Order" : "Vendor Per Order"}
                              </span>
                              
                              <div className="text-xs text-neutral-600 dark:text-neutral-300">
                                <span className="font-semibold text-neutral-800 dark:text-neutral-100">{del.completedOrders}</span>
                                <span className="text-neutral-400"> completed</span>
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-xs pt-1">
                              <span className="text-neutral-500 font-semibold">Payout:</span>
                              <span className="font-bold text-neutral-800 dark:text-neutral-200">
                                ₹{(del.category === "vendor_ship" ? del.completedOrders * (systemSettings?.rateVendorShip ?? 70) : del.completedOrders * (systemSettings?.ratePerOrderWeekly ?? 35)).toLocaleString()}
                              </span>
                            </div>

                            {/* Card Bottom Row: Actions */}
                            <div className="flex justify-end items-center pt-1 border-t border-[#edece9]/30 dark:border-[#2f2f2f]/10">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingDelivery(del)}
                                  className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-900 text-[10px] cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    triggerConfirm(
                                      "Delete Runsheet?",
                                      "Are you sure you want to permanently delete this runsheet?",
                                      () => {
                                        const fd = new FormData();
                                        fd.append("_action", "delete_delivery");
                                        fd.append("id", del.id.toString());
                                        submit(fd, { method: "post" });
                                      }
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 text-[10px] cursor-pointer"
                                >
                                  Delete Log
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Mobile Pagination Bar for Deliveries */}
                    {filteredDeliveries.length > 0 && (
                      <div className="flex md:hidden flex-col items-center justify-between border border-[#edece9] dark:border-[#2f2f2f] rounded-lg bg-white dark:bg-[#1e1e1e] p-4 gap-3 mt-3 shadow-sm">
                        <span className="text-xs text-neutral-500 font-medium">
                          Showing <span className="font-semibold text-neutral-800 dark:text-neutral-200">{(activeDeliveryPage - 1) * DELIVERY_PAGE_SIZE + 1}</span> to{" "}
                          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                            {Math.min(activeDeliveryPage * DELIVERY_PAGE_SIZE, filteredDeliveries.length)}
                          </span> of <span className="font-semibold text-neutral-800 dark:text-neutral-200">{filteredDeliveries.length}</span> daily logs
                        </span>
                        <div className="flex gap-1.5 w-full justify-between sm:justify-center">
                          <button
                            type="button"
                            onClick={() => setDeliveryPage(p => Math.max(1, p - 1))}
                            disabled={activeDeliveryPage === 1}
                            className="px-3 py-2 text-xs font-semibold rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-[#fbfbfa] dark:bg-[#202020] hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-700 dark:text-neutral-300 transition-all active:scale-95 cursor-pointer"
                          >
                            ◀ Prev
                          </button>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalDeliveryPages }, (_, i) => i + 1).map((p) => {
                              if (p === 1 || p === totalDeliveryPages || Math.abs(p - activeDeliveryPage) <= 1) {
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setDeliveryPage(p)}
                                    className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-md transition-all active:scale-95 cursor-pointer ${
                                      p === activeDeliveryPage
                                        ? "bg-[#5D87FF]/15 text-[#5D87FF] dark:bg-[#5D87FF]/25"
                                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                                    }`}
                                  >
                                    {p}
                                  </button>
                                );
                              }
                              if ((p === 2 && activeDeliveryPage > 3) || (p === totalDeliveryPages - 1 && activeDeliveryPage < totalDeliveryPages - 2)) {
                                return (
                                  <span key={p} className="text-neutral-400 text-xs px-1 select-none">
                                    ...
                                  </span>
                                );
                              }
                              return null;
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeliveryPage(p => Math.min(totalDeliveryPages, p + 1))}
                            disabled={activeDeliveryPage === totalDeliveryPages}
                            className="px-3 py-2 text-xs font-semibold rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-[#fbfbfa] dark:bg-[#202020] hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-700 dark:text-neutral-300 transition-all active:scale-95 cursor-pointer"
                          >
                            Next ▶
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* WEEKLY PAYOUT TRACKER BOARD */}
              {ordersViewMode === "payouts" && (
                <div className="space-y-6 animate-fade-in">
                  {/* Summary Cards */}
                  {payoutSubTab === "payouts" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Unpaid 70 Per Order (Weekly)</div>
                        <div className="text-2xl font-bold mt-1 text-[#2383e2]">
                          ₹{weeklyPayouts
                            .filter(w => w.category === "vendor_ship" && w.status === "UNPAID")
                            .reduce((sum, w) => sum + w.calculatedPayout, 0)
                            .toLocaleString()}
                        </div>
                      </div>

                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Unpaid Vendor Per Order (Weekly)</div>
                        <div className="text-2xl font-bold mt-1 text-indigo-600 dark:text-indigo-400">
                          ₹{weeklyPayouts
                            .filter(w => w.category === "per_order_rate_weekly" && w.status === "UNPAID")
                            .reduce((sum, w) => sum + w.calculatedPayout, 0)
                            .toLocaleString()}
                        </div>
                      </div>
                      
                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Unpaid Vendor Income (Monthly)</div>
                        <div className="text-2xl font-bold mt-1 text-purple-600 dark:text-purple-400">
                          ₹{weeklyPayouts
                            .filter(w => w.category === "per_order_rate_monthly" && w.status === "UNPAID")
                            .reduce((sum, w) => sum + w.calculatedPayout, 0)
                            .toLocaleString()}
                        </div>
                      </div>

                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Total Payouts Received (Month)</div>
                        <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                          ₹{expenses
                            .filter(e => e.type === "INCOME" && (e.category === "shadowfax" || e.category === "factory" || e.category === "vendor_income") && new Date(e.timestamp).getMonth() === new Date().getMonth())
                            .reduce((sum, e) => sum + e.amount, 0)
                            .toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Unpaid Fuel CC Bills (Due)</div>
                        <div className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">
                          ₹{ccSummaryMetrics.unpaidCcTotal.toLocaleString()}
                        </div>
                      </div>

                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Current Cycle (Ongoing)</div>
                        <div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
                          ₹{ccSummaryMetrics.ongoingCcTotal.toLocaleString()}
                        </div>
                      </div>
                      
                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Last Paid CC Bill</div>
                        <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                          ₹{ccSummaryMetrics.lastPaidAmount.toLocaleString()}
                        </div>
                      </div>

                      <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                        <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Total Fuel Expensed (All-Time)</div>
                        <div className="text-2xl font-bold mt-1 text-[#2383e2]">
                          ₹{ccSummaryMetrics.totalFuelAllTime.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Main Board */}
                  <div className="notion-card border border-[#edece9] dark:border-[#2f2f2f] rounded-lg bg-white dark:bg-[#1e1e1e] shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-[#edece9] dark:border-[#2f2f2f] bg-[#fbfbfa] dark:bg-neutral-900/30 flex justify-between items-center">
                      <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                        Settlements & Cycle Tracker
                      </h3>
                      <span className="text-xs text-neutral-450">Manage Credit Card Fuel cycles and weekly/monthly payout streams</span>
                    </div>

                    {/* Sub-tab Navigation */}
                    <div className="flex border-b border-[#edece9] dark:border-[#2f2f2f] px-4 bg-[#fbfbfa] dark:bg-neutral-900/10">
                      <button
                        type="button"
                        onClick={() => setPayoutSubTab("payouts")}
                        className={`px-4 py-2.5 text-xs font-extrabold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                          payoutSubTab === "payouts"
                            ? "border-neutral-800 text-neutral-800 dark:border-neutral-200 dark:text-neutral-200"
                            : "border-transparent text-neutral-450 hover:text-neutral-600 dark:text-neutral-450 dark:hover:text-neutral-300"
                        }`}
                      >
                        💰 Payout Streams
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayoutSubTab("fuel_cycles")}
                        className={`px-4 py-2.5 text-xs font-extrabold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                          payoutSubTab === "fuel_cycles"
                            ? "border-neutral-800 text-neutral-800 dark:border-neutral-200 dark:text-neutral-200"
                            : "border-transparent text-neutral-450 hover:text-neutral-600 dark:text-neutral-450 dark:hover:text-neutral-300"
                        }`}
                      >
                        ⛽ Credit Card Fuel Cycles ({systemSettings ? `${getOrdinal(systemSettings.ccFuelCycleEndDay)} - ${getOrdinal(systemSettings.ccFuelCycleEndDay)}` : "4th - 4th"})
                      </button>
                      {loggedInUser?.role !== "DRIVER" && (
                        <button
                          type="button"
                          onClick={() => setPayoutSubTab("settings")}
                          className={`px-4 py-2.5 text-xs font-extrabold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                            payoutSubTab === "settings"
                              ? "border-neutral-800 text-neutral-800 dark:border-neutral-200 dark:text-neutral-200"
                              : "border-transparent text-neutral-450 hover:text-neutral-600 dark:text-neutral-450 dark:hover:text-neutral-300"
                          }`}
                        >
                          ⚙️ Config & Rates
                        </button>
                      )}
                    </div>

                    {/* Filter and Sort Row */}
                    {payoutSubTab !== "settings" && (
                      <div className="p-4 border-b border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                      {/* Status Filter Pills */}
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className="text-xs font-semibold text-[#5A6A85] dark:text-[#7C8BA1] mr-1.5">Status:</span>
                        {[
                          { label: "All", value: "ALL" },
                          { label: "Unpaid", value: "UNPAID" },
                          { label: "Paid", value: "PAID" },
                          { label: "In Progress", value: "ONGOING" }
                        ].map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setPayoutStatusFilter(item.value as any)}
                            className={`text-xs px-3 py-1 rounded-md font-semibold border transition-all cursor-pointer ${
                              payoutStatusFilter === item.value
                                ? "bg-[#5D87FF] border-[#5D87FF] text-white"
                                : "bg-transparent border-[#edece9] dark:border-[#2f2f2f] hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      {/* Sort Controls */}
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-xs font-semibold text-[#5A6A85] dark:text-[#7C8BA1] whitespace-nowrap">Sort By:</span>
                        <select
                          value={payoutSortOrder}
                          onChange={(e) => setPayoutSortOrder(e.target.value as any)}
                          className="text-xs px-2 py-1 rounded-md border border-[#edece9] dark:border-[#2f2f2f] bg-transparent dark:bg-[#1e1e1e] text-neutral-700 dark:text-neutral-300 font-semibold focus:outline-none focus:border-[#5D87FF]"
                        >
                          <option value="date_desc">Due Date: Newest First</option>
                          <option value="date_asc">Due Date: Oldest First</option>
                          <option value="amount_desc">Amount: High to Low</option>
                          <option value="amount_asc">Amount: Low to High</option>
                        </select>
                      </div>
                    </div>
                  )}

                    <div className="divide-y divide-[#edece9]/60 dark:divide-neutral-800/60">
                      {payoutSubTab === "settings" ? (
                        <div className="p-6 bg-white dark:bg-[#181818] rounded-b-lg">
                          <div className="max-w-2xl mx-auto space-y-6">
                            <div>
                              <h4 className="text-base font-bold text-neutral-800 dark:text-neutral-200">
                                Operational & Financial Configuration
                              </h4>
                              <p className="text-xs text-neutral-400 mt-1">
                                Adjust payout rates, base monthly packages, and credit card cutoff days. Changes propagate immediately to all metric cards and ledger generators.
                              </p>
                            </div>

                            {settingsSuccessVisible && (
                              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-300 rounded-md text-xs font-semibold flex items-center gap-2">
                                <span>✅</span> Settings updated successfully!
                              </div>
                            )}

                            {actionData?.error && actionData?.action === "update_system_settings" && (
                              <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 text-rose-800 dark:text-rose-300 rounded-md text-xs font-semibold flex items-center gap-2">
                                <span>⚠️</span> {actionData.error}
                              </div>
                            )}

                            <Form method="post" className="space-y-4">
                              <input type="hidden" name="_action" value="update_system_settings" />
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-extrabold text-neutral-500 uppercase tracking-wider block">
                                    70 Per Order Rate (₹)
                                  </label>
                                  <input
                                    type="number"
                                    name="rateVendorShip"
                                    step="0.01"
                                    defaultValue={systemSettings?.rateVendorShip ?? 70}
                                    className="w-full text-sm px-3 py-2 border border-[#edece9] dark:border-[#2f2f2f] rounded bg-transparent dark:bg-[#1a1a1a] text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[#5D87FF]"
                                    required
                                  />
                                  <p className="text-[10px] text-neutral-400">
                                    Vendor weekly payout per completed order (e.g. Shadowfax runsheets).
                                  </p>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-extrabold text-neutral-500 uppercase tracking-wider block">
                                    Vendor Per Order Weekly Rate (₹)
                                  </label>
                                  <input
                                    type="number"
                                    name="ratePerOrderWeekly"
                                    step="0.01"
                                    defaultValue={systemSettings?.ratePerOrderWeekly ?? 35}
                                    className="w-full text-sm px-3 py-2 border border-[#edece9] dark:border-[#2f2f2f] rounded bg-transparent dark:bg-[#1a1a1a] text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[#5D87FF]"
                                    required
                                  />
                                  <p className="text-[10px] text-neutral-400">
                                    Per-order rate for vendor drivers, paid weekly.
                                  </p>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-extrabold text-neutral-500 uppercase tracking-wider block">
                                    Vendor Monthly Base Salary (₹)
                                  </label>
                                  <input
                                    type="number"
                                    name="ratePerOrderMonthlyBase"
                                    step="1"
                                    defaultValue={systemSettings?.ratePerOrderMonthlyBase ?? 53000}
                                    className="w-full text-sm px-3 py-2 border border-[#edece9] dark:border-[#2f2f2f] rounded bg-transparent dark:bg-[#1a1a1a] text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[#5D87FF]"
                                    required
                                  />
                                  <p className="text-[10px] text-neutral-400">
                                    Fixed monthly base pay for per-order drivers (default: ₹53,000).
                                  </p>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-extrabold text-neutral-500 uppercase tracking-wider block">
                                    CC Fuel Cycle Billing Day
                                  </label>
                                  <input
                                    type="number"
                                    name="ccFuelCycleEndDay"
                                    min="1"
                                    max="28"
                                    defaultValue={systemSettings?.ccFuelCycleEndDay ?? 4}
                                    className="w-full text-sm px-3 py-2 border border-[#edece9] dark:border-[#2f2f2f] rounded bg-transparent dark:bg-[#1a1a1a] text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-[#5D87FF]"
                                    required
                                  />
                                  <p className="text-[10px] text-neutral-400">
                                    Credit Card statement end date (1-28). The next cycle automatically starts on the following day.
                                  </p>
                                </div>
                              </div>

                              <div className="pt-2 border-t border-[#edece9] dark:border-[#2f2f2f] flex justify-end">
                                <button
                                  type="submit"
                                  disabled={navigation.state === "submitting"}
                                  className="px-4 py-2 text-xs font-bold bg-[#5D87FF] hover:bg-[#4570E6] text-white rounded transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                                >
                                  {navigation.state === "submitting" ? "Saving..." : "Save Configuration"}
                                </button>
                              </div>
                            </Form>
                          </div>
                        </div>
                      ) : payoutSubTab === "payouts" ? (
                        filteredAndSortedPayouts.length === 0 ? (
                          <div className="p-8 text-center text-neutral-400 italic text-xs">
                            No payouts match the selected status filter.
                          </div>
                        ) : (
                          filteredAndSortedPayouts.map((w) => {
                            const isOverdue = w.status === "UNPAID" && new Date().getTime() > new Date(w.expectedDate).getTime();
                            const diffTime = new Date(w.expectedDate).getTime() - new Date().getTime();
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                            return (
                              <div 
                                key={`${w.mondayStr}_${w.category}`} 
                                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/10 transition-colors"
                              >
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                      w.category === "vendor_ship"
                                        ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900/30"
                                        : w.category === "per_order_rate_weekly"
                                        ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-900/30"
                                        : "bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-900/30"
                                    }`}>
                                      {w.category === "vendor_ship"
                                        ? "70 Per Order Income"
                                        : w.category === "per_order_rate_weekly"
                                        ? "Vendor Per Order Income"
                                        : "Vendor Income"}
                                    </span>

                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                      w.status === "PAID"
                                        ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200/30 dark:border-emerald-900/30"
                                        : w.status === "ONGOING"
                                        ? "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200/30 dark:border-amber-900/30"
                                        : "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-200/30 dark:border-rose-900/30"
                                    }`}>
                                      {w.status === "PAID" ? "PAID" : w.status === "ONGOING" ? "IN PROGRESS" : "UNPAID"}
                                    </span>
                                  </div>

                                  <div className="text-sm font-bold text-neutral-800 dark:text-neutral-100">
                                    {w.weekLabel}
                                  </div>

                                  <div className="text-xs text-neutral-450 dark:text-neutral-400 flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
                                    <span>📊 {w.deliveriesCount} runsheets</span>
                                    <span>•</span>
                                    <span>📦 {w.completedOrders} completed orders</span>
                                  </div>
                                </div>

                                <div className="flex flex-col md:items-end justify-center gap-2">
                                  <div className="text-left md:text-right">
                                    <div className="text-xs text-neutral-400 font-semibold uppercase">Calculated Payout</div>
                                    <div className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50">
                                      ₹{w.calculatedPayout.toLocaleString()}
                                    </div>
                                    {w.status === "PAID" && w.matchingExpense && (
                                      <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                        Received: ₹{w.matchingExpense.amount.toLocaleString()}
                                        {w.matchingExpense.amount !== w.calculatedPayout && (
                                          <span className="text-amber-600 dark:text-amber-400 ml-1">
                                            (Diff: ₹{(w.matchingExpense.amount - w.calculatedPayout).toLocaleString()})
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">
                                    {w.status === "PAID" && w.matchingExpense ? (
                                      <div className="flex flex-col md:items-end gap-0.5">
                                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-bold">
                                          ✨ Recorded in Ledger on {new Date(w.matchingExpense.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                        </span>
                                        {w.matchingExpense.notes && w.matchingExpense.notes.replace(/\[Ref: (Weekly|Monthly)-Payout-.*\]/, '').trim() && (
                                          <span className="text-[10px] text-neutral-400 italic max-w-[200px] text-right truncate" title={w.matchingExpense.notes.replace(/\[Ref: (Weekly|Monthly)-Payout-.*\]/, '').trim()}>
                                            Note: "{w.matchingExpense.notes.replace(/\[Ref: (Weekly|Monthly)-Payout-.*\]/, '').trim()}"
                                          </span>
                                        )}
                                      </div>
                                    ) : w.status === "ONGOING" ? (
                                      <span className="text-amber-600 dark:text-amber-450 font-bold">
                                        Settlement expected on {new Date(w.expectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                      </span>
                                    ) : (
                                      <span className={isOverdue ? "text-rose-600 dark:text-rose-450 font-extrabold" : "text-neutral-550 dark:text-neutral-350"}>
                                        📅 Due date: {new Date(w.expectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} 
                                        {isOverdue ? " (Overdue!)" : ` (in ${diffDays} days)`}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex gap-2 mt-1">
                                    {w.status !== "PAID" && w.category !== "per_order_rate_monthly" && (
                                      <button
                                        type="button"
                                        onClick={() => setWeeklyOrdersToEdit(w)}
                                        className="px-2.5 py-1.5 text-xs font-bold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-md border border-neutral-200 dark:border-neutral-700 transition-all cursor-pointer flex items-center gap-1"
                                      >
                                        ✏️ Set Orders
                                      </button>
                                    )}
                                    {w.status === "UNPAID" && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPayoutToPay(w);
                                        }}
                                        className="px-3 py-1.5 text-xs font-bold bg-neutral-900 hover:bg-neutral-855 dark:bg-neutral-200 dark:hover:bg-white text-white dark:text-neutral-900 rounded-md shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                                      >
                                        Record Payout
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )
                      ) : (
                        filteredAndSortedCcFuelCycles.length === 0 ? (
                          <div className="p-8 text-center text-neutral-400 italic text-xs">
                            No credit card fuel billing cycles match the selected status filter.
                          </div>
                        ) : (
                          filteredAndSortedCcFuelCycles.map((c) => {
                            const isOverdue = c.status === "UNPAID" && new Date().getTime() > new Date(c.endDate).getTime();
                            return (
                              <div 
                                key={c.billingMonth} 
                                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/10 transition-colors"
                              >
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30">
                                      ⛽ Fuel CC Cycle
                                    </span>

                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                      c.status === "PAID"
                                        ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200/30 dark:border-emerald-900/30"
                                        : c.status === "ONGOING"
                                        ? "bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200/30 dark:border-amber-900/30"
                                        : "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-200/30 dark:border-rose-900/30"
                                    }`}>
                                      {c.status === "PAID" ? "PAID" : c.status === "ONGOING" ? "IN PROGRESS" : "UNPAID"}
                                    </span>
                                  </div>

                                  <div className="text-sm font-bold text-neutral-800 dark:text-neutral-100">
                                    {c.cycleLabel}
                                  </div>

                                  <div className="text-xs text-neutral-450 dark:text-neutral-400 font-medium">
                                    Statement Month: {c.billingMonth}
                                  </div>
                                </div>

                                <div className="flex flex-col md:items-end justify-center gap-2">
                                  <div className="text-left md:text-right">
                                    <div className="text-xs text-neutral-400 font-semibold uppercase">Total Fuel Expensed</div>
                                    <div className="text-lg font-extrabold text-neutral-900 dark:text-neutral-50">
                                      ₹{c.totalFuelExpense.toLocaleString()}
                                    </div>
                                    {c.status === "PAID" && c.matchingExpense && (
                                      <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                        Paid CC Bill: ₹{c.matchingExpense.amount.toLocaleString()}
                                      </div>
                                    )}
                                  </div>

                                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">
                                    {c.status === "PAID" && c.matchingExpense ? (
                                      <div className="flex flex-col md:items-end gap-0.5">
                                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-bold">
                                          💳 Paid on {new Date(c.matchingExpense.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                        </span>
                                      </div>
                                    ) : c.status === "ONGOING" ? (
                                      <span className="text-amber-600 dark:text-amber-450 font-bold">
                                        Statement ends on {new Date(c.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                      </span>
                                    ) : (
                                      <span className={isOverdue ? "text-rose-600 dark:text-rose-450 font-extrabold" : "text-neutral-550 dark:text-neutral-350"}>
                                        📅 Bill due for reconciliation (Cycle ended)
                                      </span>
                                    )}
                                  </div>

                                  {c.status === "UNPAID" && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCcBillToPay(c);
                                      }}
                                      className="mt-1 px-3 py-1.5 text-xs font-bold bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-200 dark:hover:bg-white text-white dark:text-neutral-900 rounded-md shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                                    >
                                      Reconcile & Pay Bill
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* USER MANAGEMENT TAB VIEW */}
          {activeTab === "users" && (
            <div className="animate-fade-in space-y-6">
                  {/* Category Header */}
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                    <div>
                      <h1 className="text-2xl font-bold tracking-tight">User Control Center</h1>
                    </div>
                  </div>

                  {/* ACTION NOTIFICATIONS */}
                  {actionData && actionData.error && actionErrorVisible && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/30 rounded-md text-xs font-semibold animate-fade-in">
                      ⚠️ {actionData.error}
                    </div>
                  )}
                  {actionData && actionData.success && userControlSuccessVisible && (actionData.action === "create_driver" || actionData.action === "delete_driver" || actionData.action === "create_admin" || actionData.action === "delete_admin" || actionData.action === "toggle_driver_login") && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-md text-xs font-semibold animate-fade-in">
                      ✨ Operation completed successfully!
                    </div>
                  )}

                  {/* Sub-tab Selection */}
                  <div className="flex gap-2 p-1 bg-[#f1f0ec] dark:bg-neutral-900 rounded-lg max-w-xs">
                    <button
                      type="button"
                      onClick={() => setUserSubTab("drivers")}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        userSubTab === "drivers"
                          ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                          : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-450 dark:hover:text-neutral-300"
                      }`}
                    >
                      🚚 Fleet
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserSubTab("admins")}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        userSubTab === "admins"
                          ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                          : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-450 dark:hover:text-neutral-300"
                      }`}
                    >
                      🔑 Admins
                    </button>
                  </div>

                  {/* Grid Content */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* LIST OF CURRENT ENTRIES */}
                    <div className="lg:col-span-2 space-y-4">
                      {userSubTab === "drivers" ? (
                        <div className="bg-white dark:bg-[#151515] border border-[#edece9] dark:border-neutral-800 rounded-xl overflow-hidden shadow-sm">
                          <div className="p-4 border-b border-[#edece9] dark:border-neutral-800 flex justify-between items-center">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-205">
                              Registered Field Operators ({users.length})
                            </h3>
                          </div>
                          {users.length === 0 ? (
                            <div className="p-8 text-center text-xs text-neutral-400">
                              No registered drivers found. Use the form on the right to add a driver.
                            </div>
                          ) : (
                            <div className="divide-y divide-[#edece9] dark:divide-neutral-800">
                              {users.map((u: any) => (
                                <div key={u.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/40 transition-colors">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-[#ECF2FF] dark:bg-[#5D87FF]/10 text-[#5D87FF] flex items-center justify-center font-bold text-sm shrink-0">
                                      {u.name?.charAt(0) || "D"}
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-bold text-neutral-850 dark:text-neutral-100 flex items-center gap-2 flex-wrap">
                                        {u.name}
                                        {u.role === "DRIVER" && (
                                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                                            u.loginEnabled 
                                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400" 
                                              : "bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400"
                                          }`}>
                                            {u.loginEnabled ? "Login Allowed" : "Login Blocked"}
                                          </span>
                                        )}
                                      </h4>
                                      <div className="text-[10px] font-mono text-neutral-450 dark:text-neutral-400 mt-0.5 space-y-0.5">
                                        <div>
                                          📞 {u.phone} • 🚗 {u.vehicleNumber || "No Vehicle Number"}
                                          {u.passwordText && (
                                            <>
                                              {" • 🔑 Pwd: "}
                                              <span className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded font-bold text-neutral-800 dark:text-neutral-200 select-all">
                                                {u.passwordText}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                        {u.role === "DRIVER" && !u.passwordHash && (
                                          <div className="text-rose-500 font-semibold text-[9px]">⚠️ No password set! Admin needs to set one.</div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDriverProfile(u)}
                                      className="px-2.5 py-1.5 rounded-md text-[10px] font-bold bg-[#5D87FF]/10 text-[#5D87FF] hover:bg-[#5D87FF]/15 transition-all cursor-pointer shrink-0"
                                    >
                                      View Card
                                    </button>
                                    {u.role !== "FOUNDER" && (
                                      <>
                                        <Form method="post" className="shrink-0">
                                          <input type="hidden" name="_action" value="toggle_driver_login" />
                                          <input type="hidden" name="id" value={u.id} />
                                          <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                                              u.loginEnabled
                                                ? "bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 dark:hover:bg-amber-950/40"
                                                : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                            }`}
                                          >
                                            {u.loginEnabled ? "Block Login" : "Allow Login"}
                                          </button>
                                        </Form>
                                        <button
                                          type="button"
                                          disabled={isSubmitting}
                                          onClick={() => {
                                            triggerConfirm(
                                              "Remove Driver?",
                                              `Are you sure you want to remove driver ${u.name}?`,
                                              () => {
                                                const fd = new FormData();
                                                fd.append("_action", "delete_driver");
                                                fd.append("id", u.id.toString());
                                                submit(fd, { method: "post" });
                                              }
                                            );
                                          }}
                                          className="p-1.5 rounded-md text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer disabled:opacity-40 shrink-0"
                                          title="Remove Driver"
                                        >
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-white dark:bg-[#151515] border border-[#edece9] dark:border-neutral-800 rounded-xl overflow-hidden shadow-sm">
                          <div className="p-4 border-b border-[#edece9] dark:border-neutral-800">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-205">
                              Console Administrators ({adminCredentials.length})
                            </h3>
                          </div>
                          {adminCredentials.length === 0 ? (
                            <div className="p-8 text-center text-xs text-neutral-400">
                              No administrators found.
                            </div>
                          ) : (
                            <div className="divide-y divide-[#edece9] dark:divide-neutral-800">
                              {adminCredentials.map((admin: any) => (
                                <div key={admin.id} className="p-4 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-900/40 transition-colors">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-sm shrink-0">
                                      🔑
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-bold text-neutral-850 dark:text-neutral-100">
                                        {admin.username}
                                      </h4>
                                      <p className="text-[10px] text-neutral-400 mt-0.5">
                                        Registered: {new Date(admin.createdAt).toLocaleDateString()}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isSubmitting || adminCredentials.length <= 1}
                                    onClick={() => {
                                      if (adminCredentials.length <= 1) {
                                        triggerAlert("Action Blocked", "Cannot delete the last remaining administrator account.");
                                        return;
                                      }
                                      triggerConfirm(
                                        "Remove Admin?",
                                        `Are you sure you want to remove administrator ${admin.username}?`,
                                        () => {
                                          const fd = new FormData();
                                          fd.append("_action", "delete_admin");
                                          fd.append("id", admin.id.toString());
                                          submit(fd, { method: "post" });
                                        }
                                      );
                                    }}
                                    className="p-1.5 rounded-md text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent shrink-0"
                                    title={adminCredentials.length <= 1 ? "Cannot delete the last admin" : "Remove Admin"}
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* FORM COLUMN */}
                    <div>
                      {userSubTab === "drivers" ? (
                        <div className="bg-white dark:bg-[#151515] border border-[#edece9] dark:border-neutral-800 rounded-xl p-5 space-y-4 shadow-sm">
                          <div className="border-b border-[#edece9] dark:border-neutral-800 pb-3">
                            <h3 className="text-sm font-bold text-neutral-850 dark:text-neutral-100 flex items-center gap-1.5">
                              <span>➕</span> Register Driver Operator
                            </h3>
                          </div>
                          <Form method="post" className="space-y-4">
                            <input type="hidden" name="_action" value="create_driver" />

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Driver Name</label>
                              <input
                                type="text"
                                name="name"
                                required
                                placeholder="John Doe"
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Phone Number</label>
                              <input
                                type="tel"
                                name="phone"
                                required
                                placeholder="+91 99999 99999"
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Vehicle Number</label>
                              <input
                                type="text"
                                name="vehicleNumber"
                                placeholder="MH-12-AB-1234"
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500 flex justify-between items-center">
                                <span>Password</span>
                                <button
                                  type="button"
                                  onClick={generateRandomPassword}
                                  className="text-[10px] text-[#5D87FF] hover:underline font-bold"
                                >
                                  ⚡ Generate Password
                                </button>
                              </label>
                              <input
                                type="text"
                                name="password"
                                value={driverPassword}
                                onChange={(e) => setDriverPassword(e.target.value)}
                                placeholder="Secure password"
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 font-mono focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            <div className="flex items-center gap-2 py-1">
                              <input
                                type="checkbox"
                                name="loginEnabled"
                                id="loginEnabled"
                                defaultChecked
                                className="w-4 h-4 text-[#5D87FF] border-neutral-300 rounded focus:ring-[#5D87FF]"
                              />
                              <label htmlFor="loginEnabled" className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 select-none">
                                Enable dashboard login
                              </label>
                            </div>

                            <button
                              type="submit"
                              disabled={isSubmitting}
                              className="w-full py-2 bg-[#5D87FF] hover:bg-[#4570EA] text-white rounded-md text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {isSubmitting ? "Registering..." : "Register Operator"}
                            </button>
                          </Form>
                        </div>
                      ) : (
                        <div className="bg-white dark:bg-[#151515] border border-[#edece9] dark:border-neutral-800 rounded-xl p-5 space-y-4 shadow-sm">
                          <div className="border-b border-[#edece9] dark:border-neutral-800 pb-3">
                            <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-100 flex items-center gap-1.5">
                              <span>➕</span> Create Admin Account
                            </h3>
                          </div>
                          <Form method="post" className="space-y-4">
                            <input type="hidden" name="_action" value="create_admin" />

                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Username</label>
                              <input
                                type="text"
                                name="username"
                                required
                                placeholder="admin_name"
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                             <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Password / Access Code</label>
                              <div className="relative">
                                <input
                                  type={showAdminPassword ? "text" : "password"}
                                  name="password"
                                  required
                                  placeholder="••••••••"
                                  className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md pl-3 pr-10 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowAdminPassword(!showAdminPassword)}
                                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                                >
                                  {showAdminPassword ? (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112  19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                  ) : (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </div>

                            <button
                              type="submit"
                              disabled={isSubmitting}
                              className="w-full py-2 bg-[#5D87FF] hover:bg-[#4570EA] text-white rounded-md text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {isSubmitting ? "Creating..." : "Create Administrator"}
                            </button>
                          </Form>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
        </div>

        {/* Mobile Sticky Bottom Tab Bar (Exactly 2 Tabs) */}
        <div className="mobile-bottom-nav md:hidden border-t border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#191919] w-full flex items-center justify-around z-50">
          <button
            onClick={() => switchTab("expenses")}
            className={`flex flex-col items-center justify-center w-1/2 py-2 text-xs font-semibold gap-1 transition-all ${
              activeTab === "expenses"
                ? "text-[#2383e2] border-t-2 border-[#2383e2]"
                : "text-neutral-400 hover:text-neutral-500"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Expenses</span>
          </button>

          <button
            onClick={() => switchTab("orders")}
            className={`flex flex-col items-center justify-center w-1/2 py-2 text-xs font-semibold gap-1 transition-all ${
              activeTab === "orders"
                ? "text-[#2383e2] border-t-2 border-[#2383e2]"
                : "text-neutral-400 hover:text-neutral-500"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10M13 16h6m-6 0H6m13 0a2 2 0 002-2V9a1 1 0 00-1-1h-6" />
            </svg>
            <span>Settlement & Cycles</span>
          </button>
        </div>

        {/* Active Driver Profile Modal Overlay */}
        {selectedDriverProfile && (
          <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800 w-full max-w-sm shadow-2xl relative">
              <div className="flex justify-between items-center p-4 border-b border-neutral-100 dark:border-neutral-800">
                <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 uppercase tracking-wider">
                  Active Field Driver Profile
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDriverProfile(null)}
                  className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-300 transition-all cursor-pointer text-[10px] font-bold"
                >
                  Close
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-lg font-bold text-neutral-600 dark:text-neutral-300 border border-neutral-200/50 dark:border-neutral-700/50 flex-shrink-0">
                    {selectedDriverProfile.name?.charAt(0) || "J"}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                      {selectedDriverProfile.name || "John Driver"}
                    </h4>
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      Active & On Duty
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs space-y-2.5 text-neutral-500 dark:text-neutral-400">
                  <div className="flex justify-between">
                    <span>Fleet Assignment:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">Dreamline Primary</span>
                  </div>
                   <div className="flex justify-between">
                    <span>Contact:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                      {selectedDriverProfile.phone || "+91 88888 88888"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Vehicle Number:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                      {selectedDriverProfile.vehicleNumber || "Not Set"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Login Status:</span>
                    <span className={`font-semibold ${selectedDriverProfile.loginEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-450"}`}>
                      {selectedDriverProfile.loginEnabled ? "Allowed" : "Blocked"}
                    </span>
                  </div>
                  {selectedDriverProfile.passwordText && (
                    <div className="flex justify-between">
                      <span>Console Password:</span>
                      <span className="font-mono font-bold text-neutral-750 dark:text-neutral-250 select-all bg-neutral-100 dark:bg-neutral-800 px-1 rounded">
                        {selectedDriverProfile.passwordText}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Role:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">{selectedDriverProfile.role}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Visual Slip Viewer Modal Overlay */}
        {selectedSlipImage && (
          <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800 w-full max-w-sm shadow-2xl relative">
              <div className="flex justify-between items-center p-3 border-b border-neutral-100 dark:border-neutral-800">
                <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                  ⛽ Petrol Slip Receipt
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSlipImage(null)}
                  className="p-1.5 rounded-md bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-300 transition-all cursor-pointer text-xs font-bold"
                >
                  Close
                </button>
              </div>
              <div className="aspect-[3/4] w-full bg-neutral-50 dark:bg-neutral-900 p-2">
                <img
                  src={selectedSlipImage}
                  alt="Petrol Slip Attachment"
                  className="w-full h-full object-contain rounded-md"
                />
              </div>
            </div>
          </div>
        )}

        {/* Premium PWA Install Sheet Modal Overlay */}
        {showInstallBanner && (
          <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in">
            <div 
              className="absolute inset-0 cursor-pointer" 
              onClick={handleDismissBanner} 
              aria-label="Dismiss banner"
            />
            
            <div className="bg-white dark:bg-[#1c1c1e] rounded-t-2xl sm:rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 w-full max-w-md shadow-2xl relative z-10 animate-slide-up flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="flex justify-between items-center p-4 border-b border-neutral-100 dark:border-neutral-800">
                <span className="text-xs font-extrabold text-neutral-800 dark:text-neutral-200 uppercase tracking-widest flex items-center gap-1.5">
                  📲 Convert to Mobile App
                </span>
                <button
                  type="button"
                  onClick={handleDismissBanner}
                  className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-300 transition-all cursor-pointer text-[10px] font-bold"
                >
                  Close
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 overflow-y-auto space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-[#5D87FF]/10 flex items-center justify-center text-2xl shadow-inner flex-shrink-0">
                    🚚
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-neutral-800 dark:text-neutral-100">
                      Dreamline Logistics
                    </h3>
                    <p className="text-[10px] text-[#5D87FF] font-bold uppercase tracking-wider mt-0.5">
                      Premium Field Console
                    </p>
                  </div>
                </div>

                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  Install Dreamline Logistics on your device for instant launch, offline receipt storage, smoother navigation, and real-time ledger updates right from your home screen.
                </p>

                {isIOS ? (
                  /* iOS / Safari Steps */
                  <div className="bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-150 dark:border-neutral-800/80 rounded-xl p-4 text-left space-y-3">
                    <h4 className="text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                      <span>🍏</span> iOS Installation Steps:
                    </h4>
                    <ol className="text-xs text-neutral-500 dark:text-neutral-400 space-y-2.5 list-decimal list-inside pl-1">
                      <li>
                        Tap the <strong className="text-neutral-700 dark:text-neutral-300 font-extrabold">Share button</strong> at the bottom of Safari: <span className="inline-block p-1 bg-white dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 text-xs">📤</span>
                      </li>
                      <li>
                        Scroll down and select <strong className="text-neutral-700 dark:text-neutral-300 font-extrabold">"Add to Home Screen"</strong> (with the <span className="font-normal inline-block text-[10px] w-4 h-4 text-center border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800 font-bold leading-3">＋</span> icon)
                      </li>
                      <li>
                        Confirm the name <strong className="text-[#5D87FF]">"Dreamline"</strong> and tap <strong className="text-neutral-850 dark:text-neutral-100 font-bold">Add</strong> in the top right.
                      </li>
                    </ol>
                  </div>
                ) : isInstallable ? (
                  /* Direct PWA prompt available */
                  <div className="bg-blue-50/40 dark:bg-blue-950/10 border border-blue-100/50 dark:border-blue-900/30 rounded-xl p-4 text-left">
                    <div className="flex items-start gap-2.5">
                      <span className="text-base">✨</span>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                        Your device fully supports one-tap install. Click the button below to prompt the system's quick installation wizard.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Android / Chrome Manual / Other Browser */
                  <div className="bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-150 dark:border-neutral-800/80 rounded-xl p-4 text-left space-y-3">
                    <h4 className="text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                      <span>🤖</span> Android / Chrome Manual Steps:
                    </h4>
                    <ol className="text-xs text-neutral-500 dark:text-neutral-400 space-y-2.5 list-decimal list-inside pl-1">
                      <li>
                        Tap the browser <strong className="text-neutral-700 dark:text-neutral-300 font-extrabold">menu button</strong> (three dots <span className="font-normal inline-block border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 rounded bg-white dark:bg-neutral-800">⋮</span> or <span className="font-normal inline-block border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 rounded bg-white dark:bg-neutral-800">⋯</span>)
                      </li>
                      <li>
                        Tap <strong className="text-neutral-700 dark:text-neutral-300 font-extrabold">"Add to Home screen"</strong> or <strong className="text-neutral-700 dark:text-neutral-300 font-extrabold">"Install App"</strong>
                      </li>
                      <li>
                        Confirm the prompt to pin it to your desktop.
                      </li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Modal Footer / Action Buttons */}
              <div className="p-4 bg-neutral-50 dark:bg-[#151515] border-t border-neutral-100 dark:border-neutral-800 flex gap-3">
                {isInstallable && !isIOS ? (
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="flex-grow py-2.5 px-4 text-xs font-extrabold text-white bg-[#5D87FF] hover:bg-[#4570EA] rounded-lg shadow-md hover:shadow-lg transition-all cursor-pointer text-center"
                  >
                    🚀 Install Now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleDismissBanner}
                    className="flex-grow py-2.5 px-4 text-xs font-extrabold text-white bg-[#5D87FF] hover:bg-[#4570EA] rounded-lg shadow-md hover:shadow-lg transition-all cursor-pointer text-center"
                  >
                    👍 Got It, Done!
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDismissBanner}
                  className="py-2.5 px-4 text-xs font-bold text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-200/50 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 rounded-lg transition-all cursor-pointer text-center"
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Premium Step-by-Step Pending CNG/Fuel Slip Modal */}
        {showPendingModal && actionData && "needsFuelSlip" in actionData && actionData.needsFuelSlip && actionData.pendingFuelExpense && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            {/* Glass backdrop */}
            <div 
              className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
              onClick={() => {
                setPendingSlipBase64(null);
                setShowPendingModal(false);
              }}
            />
            
            {/* Premium Modal Card */}
            <div className="relative bg-[#ffffff] dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-5 animate-slide-up text-neutral-800 dark:text-neutral-200">
              
              {/* Header */}
              <div className="flex items-center gap-3.5 border-b border-[#edece9]/60 dark:border-neutral-800/60 pb-4">
                <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-md font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
                    CNG / Fuel Slip Required
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-600 dark:text-amber-400">
                    Step 2 of 2: Upload Receipt
                  </span>
                </div>
              </div>

              {/* Message Details */}
              <div className="space-y-3.5">
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  Your other parsed logs have been saved <strong className="text-emerald-600 dark:text-emerald-400 font-bold">successfully</strong>! However, the fuel/CNG expense of <span className="font-bold text-neutral-800 dark:text-white">₹{actionData.pendingFuelExpense.amount}</span> requires a receipt photo to save.
                </p>
                
                <div className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border border-neutral-150/60 dark:border-neutral-800/40 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400 font-medium">Category:</span>
                    <span className="font-extrabold uppercase text-[10px] tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded font-mono">
                      ⛽ {actionData.pendingFuelExpense.category}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-400 font-medium">Amount:</span>
                    <span className="font-extrabold text-neutral-900 dark:text-white text-sm">
                      ₹{actionData.pendingFuelExpense.amount}
                    </span>
                  </div>
                  <div className="flex justify-between items-start text-xs gap-4">
                    <span className="text-neutral-400 font-medium shrink-0">Notes:</span>
                    <span className="font-semibold text-neutral-705 dark:text-neutral-300 text-right line-clamp-2 break-all">
                      "{actionData.pendingFuelExpense.notes}"
                    </span>
                  </div>
                  {actionData.pendingFuelExpense.vehicle && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-neutral-400 font-medium">Vehicle Plate:</span>
                      <span className="font-bold font-mono text-[#5D87FF] bg-[#5D87FF]/10 px-1.5 py-0.5 rounded text-[10px]">
                        {actionData.pendingFuelExpense.vehicle}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Photo Input Picker Area */}
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-200 dark:border-neutral-800/70 rounded-xl p-4 bg-neutral-50/30 dark:bg-neutral-900/10 min-h-[150px] transition-all relative overflow-hidden">
                  
                  {pendingSlipBase64 ? (
                    <div className="relative w-full max-w-[130px] aspect-[3/4] rounded-lg border border-neutral-300 dark:border-neutral-700 overflow-hidden shadow-lg animate-scale-in">
                      <img src={pendingSlipBase64} className="w-full h-full object-cover" alt="Captured receipt preview" />
                      <button
                        type="button"
                        onClick={() => setPendingSlipBase64(null)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/85 transition-all cursor-pointer shadow-md"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="text-center space-y-2.5">
                      <div className="text-3xl animate-bounce">📸</div>
                      <p className="text-[11px] text-neutral-400 font-medium">Please snap or upload the receipt slip</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => document.getElementById("modal-pending-slip-input-camera")?.click()}
                          className="notion-btn text-[11px] px-3 py-1.5 bg-[#5D87FF] hover:bg-[#4570EA] text-white rounded-lg font-bold transition-all shadow-md cursor-pointer inline-flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Snap Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => document.getElementById("modal-pending-slip-input-gallery")?.click()}
                          className="notion-btn text-[11px] px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-805 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 rounded-lg font-bold transition-all shadow-md cursor-pointer inline-flex items-center gap-1 border border-neutral-200 dark:border-neutral-800"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          From Gallery
                        </button>
                      </div>
                    </div>
                  )}

                  <input
                    type="file"
                    id="modal-pending-slip-input-camera"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const compressed = await compressImage(file);
                        setPendingSlipBase64(compressed);
                      }
                    }}
                  />
                  <input
                    type="file"
                    id="modal-pending-slip-input-gallery"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const compressed = await compressImage(file);
                        setPendingSlipBase64(compressed);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Action Dialog Controls */}
              <div className="flex items-center gap-3 pt-2.5 border-t border-[#edece9]/60 dark:border-neutral-800/60">
                <button
                  type="button"
                  onClick={() => {
                    setPendingSlipBase64(null);
                    setShowPendingModal(false);
                  }}
                  className="flex-1 py-2.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-xl border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                >
                  Cancel / Discard
                </button>
                
                {pendingSlipBase64 ? (
                  <Form method="post" className="flex-1">
                    <input type="hidden" name="_action" value="create_expense" />
                    <input type="hidden" name="isAi" value="false" />
                    <input type="hidden" name="amount" value={actionData.pendingFuelExpense.amount} />
                    <input type="hidden" name="type" value={actionData.pendingFuelExpense.type} />
                    <input type="hidden" name="category" value={actionData.pendingFuelExpense.category} />
                    <input type="hidden" name="notes" value={actionData.pendingFuelExpense.notes} />
                    <input type="hidden" name="vehicle" value={actionData.pendingFuelExpense.vehicle || ""} />
                    <input type="hidden" name="senderName" value="AI Assistant" />
                    <input type="hidden" name="imageUrl" value={pendingSlipBase64} />
                    <input type="hidden" name="date" value={actionData.pendingFuelExpense.date || ""} />
                    
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer text-center disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                    >
                      {isSubmitting ? "Saving..." : "Complete Log Save"}
                    </button>
                  </Form>
                ) : (
                  <button
                    type="button"
                    onClick={() => document.getElementById("modal-pending-slip-input")?.click()}
                    className="flex-1 py-2.5 text-xs bg-[#5D87FF]/10 hover:bg-[#5D87FF]/20 text-[#5D87FF] dark:bg-[#5D87FF]/20 dark:hover:bg-[#5D87FF]/35 font-bold rounded-xl transition-all cursor-pointer text-center"
                  >
                    Snap Slip First
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Edit Expense Modal */}
        {editingExpense && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div 
              className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
              onClick={() => setEditingExpense(null)}
            />
            
            <div className="relative bg-[#ffffff] dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-5 animate-slide-up text-neutral-800 dark:text-neutral-200">
              
              <div className="flex items-center gap-3.5 border-b border-[#edece9]/60 dark:border-neutral-800/60 pb-4">
                <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-md font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
                    Edit Ledger Log
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600 dark:text-blue-400">
                    Modify Transaction ID: #{editingExpense.id}
                  </span>
                </div>
              </div>

              <Form method="post" className="space-y-4">
                <input type="hidden" name="_action" value="update_expense" />
                <input type="hidden" name="id" value={editingExpense.id} />

                {/* Type toggle */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500">Transaction Type</label>
                  <div className="grid grid-cols-2 gap-2 bg-neutral-100 dark:bg-neutral-900 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setEditingExpense({ ...editingExpense, type: "EXPENSE", category: "fuel" })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        editingExpense.type === "EXPENSE"
                          ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                          : "text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      Expense
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingExpense({ ...editingExpense, type: "INCOME", category: "shadowfax" })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        editingExpense.type === "INCOME"
                          ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                          : "text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      Income
                    </button>
                  </div>
                  <input type="hidden" name="type" value={editingExpense.type} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Category Select */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Category</label>
                    <select
                      name="category"
                      value={editingExpense.category}
                      onChange={(e) => setEditingExpense({ ...editingExpense, category: e.target.value })}
                      className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 dark:bg-[#1e1e1e] focus:ring-1 focus:ring-[#2383e2] outline-none cursor-pointer font-bold capitalize"
                    >
                      {editingExpense.type === "INCOME" ? (
                        <>
                          <option value="shadowfax">🚚 70 Per Order Income</option>
                          <option value="factory">🚚 Vendor Per Order Income</option>
                          <option value="vendor_income">🚚 Vendor Income</option>
                          <option value="other_income">💰 Other Income</option>
                        </>
                      ) : (
                        <>
                          <option value="fuel">⛽ Fuel/CNG</option>
                          <option value="bittu">👤 Bittu</option>
                          <option value="service">🔧 Service</option>
                          <option value="other">📦 Other Expense</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Amount Input */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Amount (₹)</label>
                    <input
                      type="number"
                      name="amount"
                      required
                      step="any"
                      min="0"
                      value={editingExpense.amount}
                      onChange={(e) => setEditingExpense({ ...editingExpense, amount: e.target.value })}
                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-bold"
                    />
                  </div>
                </div>

                {/* Notes/Remarks */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500">Notes / Remarks</label>
                  <textarea
                    name="notes"
                    value={editingExpense.notes}
                    onChange={(e) => setEditingExpense({ ...editingExpense, notes: e.target.value })}
                    rows={2}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none"
                    placeholder="Describe transaction details..."
                  />
                </div>

                {/* Keep existing vehicle plate value hidden and safe */}
                <input type="hidden" name="vehicle" value={editingExpense.vehicle || ""} />

                {/* Dialog Controls */}
                <div className="flex items-center gap-3 pt-4 border-t border-[#edece9]/60 dark:border-neutral-800/60">
                  <button
                    type="button"
                    onClick={() => setEditingExpense(null)}
                    className="flex-1 py-2.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-xl border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer text-center"
                  >
                    Save Changes
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* Edit Runsheet Modal */}
        {editingDelivery && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div 
              className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
              onClick={() => setEditingDelivery(null)}
            />
            
            <div className="relative bg-[#ffffff] dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800/80 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-5 animate-slide-up text-neutral-800 dark:text-neutral-200">
              
              <div className="flex items-center gap-3.5 border-b border-[#edece9]/60 dark:border-neutral-800/60 pb-4">
                <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-md font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
                    Edit Daily Runsheet
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-purple-600 dark:text-purple-400">
                    Modify Runsheet ID: #{editingDelivery.id}
                  </span>
                </div>
              </div>

              <Form method="post" className="space-y-4">
                <input type="hidden" name="_action" value="update_delivery" />
                <input type="hidden" name="id" value={editingDelivery.id} />

                {/* Operator/Driver Selection */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500">Field Operator Name</label>
                  <select
                    name="driverName"
                    value={editingDelivery.driverName}
                    onChange={(e) => setEditingDelivery({ ...editingDelivery, driverName: e.target.value })}
                    className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 dark:bg-[#1e1e1e] focus:ring-1 focus:ring-[#2383e2] outline-none cursor-pointer font-bold"
                  >
                    {users.map((u: any) => (
                      <option key={u.id} value={u.name}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>

                {/* Runsheet Date Selection */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500">Runsheet Week Cycle</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const current = parseLocalDate(editingDelivery.createdAt || new Date());
                        current.setDate(current.getDate() - 7);
                        const mon = getMonday(current);
                        setEditingDelivery({ ...editingDelivery, createdAt: toUTCISOString(mon) });
                      }}
                      className="px-2.5 py-1.5 border border-neutral-200 dark:border-neutral-800 rounded-md bg-transparent hover:bg-neutral-50 dark:hover:bg-neutral-850 text-neutral-600 dark:text-neutral-300 font-bold transition-all shadow-sm cursor-pointer"
                      title="Previous Week"
                    >
                      ◀
                    </button>
                    <input
                      type="date"
                      name="createdAt"
                      required
                      value={editingDelivery.createdAt ? formatLocalDate(getMonday(editingDelivery.createdAt)) : ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          const mon = getMonday(val);
                          setEditingDelivery({ ...editingDelivery, createdAt: toUTCISOString(mon) });
                        }
                      }}
                      className="notion-input flex-1 text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-1.5 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-semibold cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const current = parseLocalDate(editingDelivery.createdAt || new Date());
                        current.setDate(current.getDate() + 7);
                        const mon = getMonday(current);
                        setEditingDelivery({ ...editingDelivery, createdAt: toUTCISOString(mon) });
                      }}
                      className="px-2.5 py-1.5 border border-neutral-200 dark:border-neutral-800 rounded-md bg-transparent hover:bg-neutral-50 dark:hover:bg-neutral-850 text-neutral-600 dark:text-neutral-300 font-bold transition-all shadow-sm cursor-pointer"
                      title="Next Week"
                    >
                      ▶
                    </button>
                  </div>
                  {editingDelivery.createdAt && (
                    <div className="text-[10px] font-bold text-[#2383e2] dark:text-[#3894f2] mt-1.5 bg-[#2383e2]/5 dark:bg-[#2383e2]/15 px-2.5 py-1.5 rounded-lg border border-[#2383e2]/10 flex items-center justify-between">
                      <span>📅 Cycle Range:</span>
                      <span>
                        {formatRange(editingDelivery.createdAt)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Category Select */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Order Category</label>
                    <select
                      name="category"
                      value={editingDelivery.category}
                      onChange={(e) => setEditingDelivery({ ...editingDelivery, category: e.target.value })}
                      className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 dark:bg-[#1e1e1e] focus:ring-1 focus:ring-[#2383e2] outline-none cursor-pointer font-semibold"
                    >
                      <option value="vendor_ship">🚚 Vendor Ship (₹70/order Weekly)</option>
                      <option value="per_order_rate">🚚 Split Plan (₹35/order Weekly + ₹53k Base)</option>
                    </select>
                  </div>

                  {/* Calculated Payout Info */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Preview Payout</label>
                    <div className="w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-neutral-50 dark:bg-[#1a1a1a] text-neutral-800 dark:text-neutral-100 font-bold">
                      ₹{
                        editingDelivery.category === "vendor_ship"
                          ? (Number(editingDelivery.completedOrders || 0) * 70).toLocaleString()
                          : (Number(editingDelivery.completedOrders || 0) * 35).toLocaleString()
                      }
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <input type="hidden" name="totalOrders" value={editingDelivery.completedOrders} />
                  <label className="text-xs font-semibold text-neutral-500">Completed Orders</label>
                  <input
                    type="number"
                    name="completedOrders"
                    required
                    step="1"
                    min="0"
                    value={editingDelivery.completedOrders}
                    onKeyDown={(e) => {
                      if ([".", ",", "-", "+", "e", "E"].includes(e.key)) e.preventDefault();
                    }}
                    onChange={(e) => setEditingDelivery({ ...editingDelivery, completedOrders: e.target.value })}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-semibold"
                  />
                </div>

                {/* Notes/Remarks */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-500">Notes / Remarks</label>
                  <textarea
                    name="notes"
                    value={editingDelivery.notes}
                    onChange={(e) => setEditingDelivery({ ...editingDelivery, notes: e.target.value })}
                    rows={2}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none"
                    placeholder="Additional details..."
                  />
                </div>

                {/* Dialog Controls */}
                <div className="flex items-center gap-3 pt-4 border-t border-[#edece9]/60 dark:border-neutral-800/60">
                  <button
                    type="button"
                    onClick={() => setEditingDelivery(null)}
                    className="flex-1 py-2.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-xl border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer text-center"
                  >
                    Save Changes
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* Payout Confirmation Modal */}
        {payoutToPay && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
            <div className="notion-card w-full max-w-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] p-6 shadow-2xl space-y-5 rounded-2xl animate-scale-up">
              
              <div className="pb-3 border-b border-[#edece9] dark:border-[#2f2f2f] flex justify-between items-start">
                <div>
                  <h3 className="text-md font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                    Verify & Confirm Payout Receipt
                  </h3>
                  <p className="text-[11px] text-neutral-450 mt-1 font-semibold">
                    Ensure the received amount matches the week's calculated payout before marking as paid.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPayoutToPay(null)}
                  className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-semibold">Settlement Period:</span>
                  <span className="text-neutral-800 dark:text-neutral-200 font-bold">{payoutToPay.weekLabel}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-semibold">Category Type:</span>
                  <span className="text-neutral-800 dark:text-neutral-200 font-bold capitalize text-right">
                    {payoutToPay.category === "vendor_ship" 
                      ? "70 Per Order Income" 
                      : payoutToPay.category === "per_order_rate_weekly"
                      ? "Vendor Per Order Income"
                      : "Vendor Income"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-semibold">Expected On:</span>
                  <span className="text-neutral-850 dark:text-neutral-150 font-semibold flex items-center">
                    {new Date(payoutToPay.expectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <div className="pt-2 border-t border-neutral-200/50 dark:border-neutral-800/50 flex justify-between items-center text-sm">
                  <span className="text-neutral-500 font-bold">Calculated Amount:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-extrabold text-base">
                    ₹{payoutToPay.calculatedPayout.toLocaleString()}
                  </span>
                </div>
              </div>

              <Form method="post" className="space-y-4">
                <input type="hidden" name="_action" value="mark_payout_paid" />
                <input type="hidden" name="mondayStr" value={payoutToPay.mondayStr} />
                <input type="hidden" name="category" value={payoutToPay.category} />

                {/* Amount Cross-Check */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Received Amount (₹)</label>
                  <input
                    type="number"
                    name="amount"
                    required
                    step="any"
                    min="0"
                    defaultValue={payoutToPay.calculatedPayout}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-bold"
                  />
                </div>

                {/* Payment Date Selection */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Date Received</label>
                  <input
                    type="date"
                    name="paymentDate"
                    required
                    defaultValue={formatLocalDate(new Date())}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-semibold cursor-pointer"
                  />
                </div>

                {/* Optional reference notes */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Transaction Notes (Optional)</label>
                  <textarea
                    name="notes"
                    rows={2}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none"
                    placeholder="e.g. Bank Ref #, cross check adjustments..."
                  />
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setPayoutToPay(null)}
                    className="flex-1 py-2.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-xl border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 text-xs bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-200 dark:hover:bg-white text-white dark:text-neutral-900 font-bold rounded-xl shadow-lg transition-all cursor-pointer text-center"
                  >
                    Confirm & Record
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* Weekly Orders Edit Modal */}
        {weeklyOrdersToEdit && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
            <div className="notion-card w-full max-w-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] p-6 shadow-2xl space-y-5 rounded-2xl animate-scale-up">
              
              <div className="pb-3 border-b border-[#edece9] dark:border-[#2f2f2f] flex justify-between items-start">
                <div>
                  <h3 className="text-md font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                    Update Weekly Order Counts
                  </h3>
                  <p className="text-[11px] text-neutral-450 mt-1 font-semibold">
                    Enter completed orders for this week to calculate payouts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWeeklyOrdersToEdit(null)}
                  className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <Form method="post" className="space-y-4">
                <input type="hidden" name="_action" value="update_weekly_orders" />
                <input type="hidden" name="mondayStr" value={weeklyOrdersToEdit.mondayStr} />

                <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-400">
                  Week: <span className="font-bold text-neutral-800 dark:text-neutral-250">{weeklyOrdersToEdit.weekLabel}</span>
                </div>

                {/* 70 Per Order Orders Input */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">70 Per Order Income Completed Orders</label>
                  <input
                    type="number"
                    name="vendorShipOrders"
                    required
                    min="0"
                    step="1"
                    defaultValue={
                      deliveries
                        .filter(d => d.category === "vendor_ship" && new Date(d.createdAt) >= new Date(weeklyOrdersToEdit.startDate) && new Date(d.createdAt) <= new Date(weeklyOrdersToEdit.endDate))
                        .reduce((sum, d) => sum + d.completedOrders, 0)
                    }
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-bold"
                  />
                </div>

                {/* Vendor Per Order Orders Input */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Vendor Per Order Income Completed Orders</label>
                  <input
                    type="number"
                    name="perOrderOrders"
                    required
                    min="0"
                    step="1"
                    defaultValue={
                      deliveries
                        .filter(d => d.category === "per_order_rate" && new Date(d.createdAt) >= new Date(weeklyOrdersToEdit.startDate) && new Date(d.createdAt) <= new Date(weeklyOrdersToEdit.endDate))
                        .reduce((sum, d) => sum + d.completedOrders, 0)
                    }
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-bold"
                  />
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setWeeklyOrdersToEdit(null)}
                    className="flex-1 py-2.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-xl border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 text-xs bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-200 dark:hover:bg-white text-white dark:text-neutral-900 font-bold rounded-xl shadow-lg transition-all cursor-pointer text-center"
                  >
                    Save Changes
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* Fuel CC Bill Payment Modal */}
        {ccBillToPay && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
            <div className="notion-card w-full max-w-md border border-[#edece9] dark:border-[#2f2f2f] bg-white dark:bg-[#1e1e1e] p-6 shadow-2xl space-y-5 rounded-2xl animate-scale-up">
              
              <div className="pb-3 border-b border-[#edece9] dark:border-[#2f2f2f] flex justify-between items-start">
                <div>
                  <h3 className="text-md font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                    Confirm CC Fuel Bill Payment
                  </h3>
                  <p className="text-[11px] text-neutral-450 mt-1 font-semibold">
                    Record the card bill payment in the main expense ledger.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCcBillToPay(null)}
                  className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-semibold">Billing Cycle:</span>
                  <span className="text-neutral-800 dark:text-neutral-200 font-bold">{ccBillToPay.cycleLabel}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-semibold">Statement Month:</span>
                  <span className="text-neutral-800 dark:text-neutral-200 font-bold">{ccBillToPay.billingMonth}</span>
                </div>
                <div className="pt-2 border-t border-neutral-200/50 dark:border-neutral-800/50 flex justify-between items-center text-sm">
                  <span className="text-neutral-500 font-bold">Accumulated Fuel Cost:</span>
                  <span className="text-neutral-900 dark:text-neutral-100 font-extrabold text-base">
                    ₹{ccBillToPay.totalFuelExpense.toLocaleString()}
                  </span>
                </div>
              </div>

              <Form method="post" className="space-y-4">
                <input type="hidden" name="_action" value="mark_fuel_cc_paid" />
                <input type="hidden" name="billingMonth" value={ccBillToPay.billingMonth} />

                {/* Amount Input */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Payment Amount (₹)</label>
                  <input
                    type="number"
                    name="amount"
                    required
                    step="any"
                    min="0"
                    defaultValue={ccBillToPay.totalFuelExpense}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-bold"
                  />
                </div>

                {/* Payment Date Selection */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Date Paid</label>
                  <input
                    type="date"
                    name="paymentDate"
                    required
                    defaultValue={formatLocalDate(new Date())}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none font-semibold cursor-pointer"
                  />
                </div>

                {/* Optional reference notes */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-neutral-500">Transaction Notes (Optional)</label>
                  <textarea
                    name="notes"
                    rows={2}
                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none"
                    placeholder="e.g. Card statement reference, cash back offset..."
                  />
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setCcBillToPay(null)}
                    className="flex-1 py-2.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-xl border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 text-xs bg-neutral-900 hover:bg-neutral-850 dark:bg-neutral-200 dark:hover:bg-white text-white dark:text-neutral-900 font-bold rounded-xl shadow-lg transition-all cursor-pointer text-center"
                  >
                    Confirm CC Payment
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}
        {/* Custom Confirmation / Alert Dialog Modal */}
        {customDialog.isOpen && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 animate-fade-in">
            {/* Glass backdrop */}
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
              onClick={() => {
                if (customDialog.type === "alert") {
                  setCustomDialog(prev => ({ ...prev, isOpen: false }));
                }
              }}
            />
            
            {/* Modal Card */}
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200 dark:border-neutral-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-6 space-y-5 animate-slide-up text-neutral-800 dark:text-neutral-200">
              {/* Title & Icon */}
              <div className="flex items-center gap-3 pb-3 border-b border-[#edece9]/60 dark:border-neutral-800/60">
                <div className={`p-2.5 rounded-xl ${
                  customDialog.type === "confirm" 
                    ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-450" 
                    : "bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
                }`}>
                  {customDialog.type === "confirm" ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <h3 className="text-sm font-bold text-neutral-950 dark:text-neutral-50">
                  {customDialog.title}
                </h3>
              </div>

              {/* Message */}
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed font-sans">
                {customDialog.message}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                {customDialog.type === "confirm" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setCustomDialog(prev => ({ ...prev, isOpen: false }))}
                      className="flex-1 py-2 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 font-bold rounded-lg border border-neutral-200 dark:border-neutral-800 transition-all cursor-pointer text-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomDialog(prev => ({ ...prev, isOpen: false }));
                        if (customDialog.onConfirm) customDialog.onConfirm();
                      }}
                      className="flex-1 py-2 text-xs bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg shadow-lg hover:shadow-xl transition-all cursor-pointer text-center"
                    >
                      Confirm Delete
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCustomDialog(prev => ({ ...prev, isOpen: false }))}
                    className="w-full py-2 text-xs bg-[#5D87FF] hover:bg-[#4570EA] text-white font-bold rounded-lg shadow-md transition-all cursor-pointer text-center"
                  >
                    OK
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
