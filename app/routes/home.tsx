import { useState, useMemo, useEffect } from "react";
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
import type { Route } from "./+types/home";
import { prisma } from "../db.server";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Brain - Logistics Control" },
    { name: "description", content: "Notion-styled premium Logistics Entry & Analytics Platform" },
  ];
}

// Server Loader - Fetches data, executes auto-seeding if empty
export async function loader() {
  let users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  let expenses = await prisma.expense.findMany({ orderBy: { timestamp: "desc" } });
  let deliveries = await prisma.delivery.findMany({ orderBy: { createdAt: "desc" } });

  // Auto-seed mock data if empty
  if (users.length === 0) {
    await prisma.user.createMany({
      data: [
        { name: "Founder User", phone: "+919999999999", role: "FOUNDER" },
        { name: "John Driver", phone: "+918888888888", role: "DRIVER" },
        { name: "Sam Driver", phone: "+917777777777", role: "DRIVER" },
      ],
    });
    users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
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
    expenses = await prisma.expense.findMany({ orderBy: { timestamp: "desc" } });
  }

  if (deliveries.length === 0) {
    await prisma.delivery.createMany({
      data: [
        { title: "Daily Runsheet - Vendor Shipments", category: "vendor_ship", totalOrders: 42, completedOrders: 40, driverName: "John Driver", notes: "Completed all regular shipments. 2 pending due to customer unavailability.", createdAt: new Date() },
        { title: "Daily Runsheet - Per Order Deliveries", category: "per_order_rate", totalOrders: 25, completedOrders: 25, driverName: "Sam Driver", notes: "All orders completed successfully.", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { title: "Daily Runsheet - Vendor Shipments", category: "vendor_ship", totalOrders: 50, completedOrders: 48, driverName: "John Driver", notes: "Slight delay at Shadowfax hub.", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      ],
    });
    deliveries = await prisma.delivery.findMany({ orderBy: { createdAt: "desc" } });
  }

  return { users, expenses, deliveries };
}

// Server Action - Database Writes & Gemini AI smart parser integration
export async function action({ request }: { request: Request }) {
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

          If targetTable is "expense":
          - amount: (number) The cost or income in rupees/INR.
          - type: (string) Must be either "EXPENSE" or "INCOME".
          - category: (string) Must be one of the following exactly:
            For "EXPENSE": 'fuel', 'bittu', 'service', 'other'
            For "INCOME": 'shadowfax', 'factory', 'other_income'
          - notes: (string) Clean and concise description of the transaction.
          - vehicle: (string or null) The vehicle plate/license number if mentioned (e.g. MH-12-AB-1234), otherwise null.

          If targetTable is "delivery":
          - title: (string) A clean title, e.g., "Daily Runsheet - Vendor Shipments" or "Per Order Runsheet".
          - category: (string) Must be either "vendor_ship" or "per_order_rate" based on context.
          - totalOrders: (number) Total orders assigned to the driver (default to completedOrders if not explicitly mentioned).
          - completedOrders: (number) Number of successfully completed orders.
          - driverName: (string) The driver's name if mentioned (e.g. "John Driver" or "Sam Driver"), otherwise "Unassigned".
          - notes: (string) Clean operational notes or remarks.

          User Input: "${rawText}"

          Return ONLY a valid, raw, double-quoted JSON array of these objects. Do not include markdown code block formatting (like \`\`\`json or \`\`\`).
        `;

        // Fast Model Failover Chain — instantly switches to next model on failure instead of slow retries
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

            // If server-side capacity error → instantly try next model (no waiting)
            if (res.status === 503 || res.status === 429 || res.status >= 500) {
              console.warn(`⚡ ${model} busy (${res.status}). Switching to next model...`);
              continue;
            }

            // For client errors (400, 403, etc.) → no point trying other models
            const errText = await res.text();
            throw new Error(`Gemini API error: ${errText}`);
          } catch (err: any) {
            lastError = err.message || String(err);
            if (err.message?.includes("Gemini API error")) throw err; // Don't retry client errors
            console.warn(`⚡ ${model} network error. Switching to next model...`);
            continue;
          }
        }

        if (!response) {
          throw new Error(`All Gemini models are currently busy. Please try again in a moment. Last error: ${lastError}`);
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const cleanedText = generatedText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedText);

        if (!Array.isArray(parsed)) {
          throw new Error("AI did not return a valid list of entries.");
        }

        let expensesCreated = 0;
        let deliveriesCreated = 0;
        const imageUrl = formData.get("imageUrl")?.toString() || null;

        for (const item of parsed) {
          if (item.targetTable === "expense") {
            const amount = parseFloat(item.amount) || 0;
            const type = item.type === "INCOME" ? "INCOME" : "EXPENSE";
            const category = item.category || "other";
            const notes = item.notes || rawText;
            const vehicle = item.vehicle || null;

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
        };
      } catch (err: any) {
        console.error("AI Parse failed:", err);
        return { error: "Failed to parse text: " + err.message };
      }
    } else {
      // Manual entry
      const amount = parseFloat(formData.get("amount")?.toString() || "0") || 0;
      const type = formData.get("type")?.toString() || "EXPENSE";
      const category = formData.get("category")?.toString() || "other";
      const notes = formData.get("notes")?.toString() || "";
      const vehicle = formData.get("vehicle")?.toString() || null;
      const senderName = formData.get("senderName")?.toString() || "Founder";
      const imageUrl = formData.get("imageUrl")?.toString() || null;

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

  if (actionType === "create_delivery") {
    const title = formData.get("title")?.toString() || "Daily Runsheet";
    const category = formData.get("category")?.toString() || "vendor_ship";
    const totalOrders = parseInt(formData.get("totalOrders")?.toString() || "0") || 0;
    const completedOrders = parseInt(formData.get("completedOrders")?.toString() || "0") || 0;
    const driverName = formData.get("driverName")?.toString() || "Unassigned";
    const notes = formData.get("notes")?.toString() || "";

    await prisma.delivery.create({
      data: {
        title,
        category,
        totalOrders,
        completedOrders,
        driverName,
        notes,
      },
    });
    return { success: true, action: "create_delivery" };
  }

  if (actionType === "delete_delivery") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    await prisma.delivery.delete({
      where: { id },
    });
    return { success: true };
  }

  return null;
}

export default function Home() {
  const { users, expenses, deliveries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();

  // Tab state & Dashboard workflow controls
  const [activeTab, setActiveTab] = useState<"expenses" | "orders">("expenses");
  const [showExpenseDashboard, setShowExpenseDashboard] = useState(false);
  const [showDeliveryDashboard, setShowDeliveryDashboard] = useState(false);

  // Timeframe filter state
  const [expenseFilter, setExpenseFilter] = useState<"ALL" | "YEAR" | "MONTH" | "TODAY" | "CUSTOM">("ALL");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<"ALL" | "EXPENSE" | "INCOME">("ALL");
  const [deliveryFilter, setDeliveryFilter] = useState<"ALL" | "YEAR" | "MONTH" | "TODAY" | "CUSTOM">("ALL");
  const [deliveryCategoryFilter, setDeliveryCategoryFilter] = useState<"ALL" | "VENDOR_SHIP" | "PER_ORDER">("ALL");

  // Auto-hiding notification and driver profile states
  const [runsheetSuccessVisible, setRunsheetSuccessVisible] = useState(false);
  const [expenseSuccessVisible, setExpenseSuccessVisible] = useState(false);
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

  // AI manual feedback state
  const [aiRawInput, setAiRawInput] = useState("");
  const [expenseFormMode, setExpenseFormMode] = useState<"ai" | "manual">("ai");

  // Controlled runsheet form inputs for live payout preview
  const [formCategory, setFormCategory] = useState<"vendor_ship" | "per_order_rate">("vendor_ship");
  const [formCompletedOrders, setFormCompletedOrders] = useState<string>("");

  // New Dreamline Logistics transaction and camera state hooks
  const [manualType, setManualType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [selectedCategory, setSelectedCategory] = useState("fuel");
  const [fuelSlipBase64, setFuelSlipBase64] = useState<string | null>(null);
  const [selectedSlipImage, setSelectedSlipImage] = useState<string | null>(null);

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
  const switchTab = (tab: "expenses" | "orders") => {
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
  }, [deliveries, deliveryFilter, deliveryCategoryFilter, selectedDeliveryYear, selectedDeliveryMonth, customDeliveryStartDate, customDeliveryEndDate]);

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

    filteredDeliveries.forEach((d) => {
      totalAssigned += d.totalOrders;
      totalCompleted += d.completedOrders;
      if (d.category === "vendor_ship") {
        vendorShipOrders += d.completedOrders;
        vendorShipValue += 40000 + (d.completedOrders * 35);
      } else {
        perOrderRateOrders += d.completedOrders;
        perOrderRateValue += d.completedOrders * 75;
      }
    });

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
  }, [filteredDeliveries]);

  // Reset raw inputs on action success and set fading success messages
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setAiRawInput("");
      setFormCompletedOrders("");
      if (actionData.action === "create_delivery") {
        setRunsheetSuccessVisible(true);
        const timer = setTimeout(() => setRunsheetSuccessVisible(false), 6000);
        return () => clearTimeout(timer);
      } else if (actionData.action === "create_expense") {
        setExpenseSuccessVisible(true);
        const timer = setTimeout(() => setExpenseSuccessVisible(false), 6000);
        return () => clearTimeout(timer);
      }
    }
  }, [actionData]);

  // Live Payout Preview for Runsheet Console
  const parsedCompleted = parseInt(formCompletedOrders) || 0;
  const previewPayout = formCategory === "vendor_ship"
    ? 40000 + (parsedCompleted * 35)
    : parsedCompleted * 75;

  const isSubmitting = navigation.state !== "idle";

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
            <svg className="w-5 h-5 text-neutral-800 dark:text-neutral-100 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h7a8 8 0 0 1 8 8 8 8 0 0 1-8 8H4z" />
              <path d="M12 4v16" />
            </svg>
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10M13 16h6m-6 0H6m13 0a2 2 0 002-2V9a1 1 0 00-1-1h-6" />
            </svg>
            <span>Order Tracking</span>
          </button>
        </nav>

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
              {actionData && "error" in actionData && (
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

                          <Form method="post" className="space-y-4">
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
                                <button
                                  type="button"
                                  onClick={() => document.getElementById("ai-slip-input")?.click()}
                                  className="p-2.5 rounded-full bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </button>
                              </div>

                              <input
                                type="file"
                                id="ai-slip-input"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                      setFuelSlipBase64(reader.result as string);
                                    };
                                    reader.readAsDataURL(file);
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
                                disabled={
                                  isSubmitting ||
                                  !aiRawInput.trim() ||
                                  ((aiRawInput.toLowerCase().includes("fuel") || aiRawInput.toLowerCase().includes("diesel")) && !fuelSlipBase64)
                                }
                                className="notion-btn text-xs px-4 py-2.5 bg-[#5D87FF] hover:bg-[#4570EA] font-bold text-white rounded-md disabled:opacity-50 cursor-pointer shadow-sm self-end sm:self-auto transition-all"
                              >
                                {isSubmitting
                                  ? "Parsing..."
                                  : (aiRawInput.toLowerCase().includes("fuel") || aiRawInput.toLowerCase().includes("diesel")) && !fuelSlipBase64
                                  ? "⚠️ Snap Receipt Slip First"
                                  : "AI Parse & Save"}
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

                          <Form method="post" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                step="0.01"
                                placeholder="0.00"
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
                                    <option value="shadowfax">🚚 Vendor Ship - Shadowfax</option>
                                    <option value="factory">🏭 Factory</option>
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
                                required
                                placeholder={manualType === "EXPENSE" ? "What was this expense for?" : "Vendor payout, factory cash receipt details"}
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
                                  <button
                                    type="button"
                                    onClick={() => document.getElementById("fuel-slip-input")?.click()}
                                    className="p-2.5 rounded-full bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                  </button>
                                </div>

                                <input
                                  type="file"
                                  id="fuel-slip-input"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onloadend = () => {
                                        setFuelSlipBase64(reader.result as string);
                                      };
                                      reader.readAsDataURL(file);
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
                              {exp.category === "factory" && "🏭"}
                              {exp.category === "other_income" && "💰"}
                              {exp.category}
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
                              {exp.type === "INCOME" ? "+" : "-"} ₹{exp.amount}
                            </span>
                          </div>
                          
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 flex justify-between gap-2">
                            <span className="truncate max-w-[140px] italic">"{exp.notes}"</span>
                            <span className="text-[10px] text-neutral-400 shrink-0 font-medium">
                              {new Date(exp.timestamp).toLocaleDateString(undefined, {
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
                            filteredExpenses.map((exp) => (
                              <tr key={exp.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/20">
                                <td className="p-3.5 font-semibold capitalize flex items-center gap-1.5">
                                  {exp.category === "fuel" && "⛽"}
                                  {exp.category === "bittu" && "👤"}
                                  {exp.category === "service" && "🔧"}
                                  {exp.category === "other" && "📦"}
                                  {exp.category === "shadowfax" && "🚚"}
                                  {exp.category === "factory" && "🏭"}
                                  {exp.category === "other_income" && "💰"}
                                  <span>{exp.category}</span>
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
                                  {exp.type === "INCOME" ? "+" : "-"} ₹{exp.amount}
                                </td>
                                <td className="p-3.5 text-neutral-400">{new Date(exp.timestamp).toLocaleString()}</td>
                                <td className="p-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Form method="post" style={{ display: "inline" }}>
                                      <input type="hidden" name="_action" value="reject_expense" />
                                      <input type="hidden" name="id" value={exp.id} />
                                      <button
                                        type="submit"
                                        className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    </Form>
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
                        filteredExpenses.map((exp) => (
                          <div key={exp.id} className="p-4 flex flex-col gap-2 hover:bg-neutral-50/40 dark:hover:bg-neutral-900/10">
                            {/* Top row: Category, image link */}
                            <div className="flex justify-between items-center w-full">
                              <div className="flex items-center gap-1.5 font-bold capitalize text-neutral-800 dark:text-neutral-200">
                                {exp.category === "fuel" && "⛽"}
                                {exp.category === "bittu" && "👤"}
                                {exp.category === "service" && "🔧"}
                                {exp.category === "other" && "📦"}
                                {exp.category === "shadowfax" && "🚚"}
                                {exp.category === "factory" && "🏭"}
                                {exp.category === "other_income" && "💰"}
                                <span>{exp.category}</span>
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
                                  {exp.type === "INCOME" ? "+" : "-"} ₹{exp.amount}
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

                              <div className="flex items-center gap-1">
                                <Form method="post" style={{ display: "inline" }}>
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
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ORDER TRACKING TAB VIEW */}
          {activeTab === "orders" && (
            <div className="animate-fade-in space-y-6">
              {/* Category Header with Toggle Dashboard */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Orders Summary Board</h1>
                </div>

                <div>
                  <button
                    onClick={() => setShowDeliveryDashboard(!showDeliveryDashboard)}
                    className="notion-btn text-xs px-3.5 py-2 font-semibold flex items-center gap-1.5 bg-[#2383e2] hover:bg-[#1a6ab8] text-white rounded-md shadow-sm border border-transparent transition-all cursor-pointer"
                  >
                    {showDeliveryDashboard ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>New Daily Entry Form</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                        </svg>
                        <span>View Runsheets Dashboard</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* ACTION NOTIFICATIONS */}
              {runsheetSuccessVisible && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-md text-xs font-semibold animate-fade-in">
                  ✅ Daily runsheet status logged successfully!
                </div>
              )}

              {/* FORM MODE (DEFAULT) */}
              {!showDeliveryDashboard ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Unified Dispatch Console */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="notion-card border border-[#edece9] dark:border-[#2f2f2f] rounded-lg p-6 bg-white dark:bg-[#1e1e1e] shadow-sm space-y-6">
                      
                      <div className="pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                        <h3 className="text-md font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                          Daily Runsheet Console
                        </h3>
                      </div>

                      <Form method="post" className="space-y-4">
                        <input type="hidden" name="_action" value="create_delivery" />

                        <input type="hidden" name="title" value="Daily Runsheet Summary" />
                        <input type="hidden" name="driverName" value={users.find(u => u.role === "DRIVER")?.name || "John Driver"} />


                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-neutral-500">Order Category</label>
                            <select
                              name="category"
                              value={formCategory}
                              onChange={(e) => setFormCategory(e.target.value as "vendor_ship" | "per_order_rate")}
                              className="notion-select w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 dark:bg-[#1e1e1e] focus:ring-1 focus:ring-[#2383e2] outline-none cursor-pointer"
                            >
                              <option value="vendor_ship">Vendor Ship</option>
                              <option value="per_order_rate">Per Order Rate</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-neutral-500">Total Orders Assigned</label>
                            <input
                              type="number"
                              name="totalOrders"
                              required
                              min="0"
                              placeholder="e.g. 50"
                              className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-neutral-500">Completed Orders</label>
                            <input
                              type="number"
                              name="completedOrders"
                              value={formCompletedOrders}
                              onChange={(e) => setFormCompletedOrders(e.target.value)}
                              required
                              min="0"
                              placeholder="e.g. 48"
                              className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#2383e2] outline-none"
                            />
                          </div>
                        </div>

                        {/* Interactive live payout calculation preview */}
                        {parsedCompleted > 0 && (
                          <div className="p-3.5 rounded-lg border border-[#2383e2]/20 bg-[#2383e2]/5 dark:bg-[#2383e2]/10 space-y-1 animate-fadeIn">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">Runsheet Payout:</span>
                              <span className="text-sm font-bold text-[#2383e2]">₹{previewPayout.toLocaleString()}</span>
                            </div>
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
                          ? 40000 + (del.completedOrders * 35)
                          : del.completedOrders * 75;
                        return (
                          <div
                            key={del.id}
                            onClick={() => {
                              const driverInfo = users.find(u => u.role === "DRIVER") || { name: "John Driver", phone: "+91 88888 88888" };
                              setSelectedDriverProfile(driverInfo);
                            }}
                            className="flex flex-col gap-1.5 p-3 hover:bg-[#fbfbfa] dark:hover:bg-[#202020]/40 rounded-lg transition-all border border-transparent hover:border-[#edece9] dark:hover:border-[#2f2f2f] cursor-pointer"
                            title="Click to view driver details"
                          >
                            <div className="flex justify-between items-center">
                              <span className="capitalize text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                                {del.category === "vendor_ship" ? "🚚" : "📦"}
                                {del.category === "vendor_ship" ? "Vendor Ship" : "Per Order"}
                              </span>
                              <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                                ₹{payout.toLocaleString()}
                              </span>
                            </div>
                            
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 flex justify-between gap-2 text-right">
                              <span className="truncate max-w-[140px] text-left">
                                {del.completedOrders} / {del.totalOrders} completed
                              </span>
                              <span className="text-[10px] text-neutral-400 shrink-0 font-medium">
                                {new Date(del.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
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
              ) : (
                /* RUNSHEET DASHBOARD VIEW MODE */
                <div className="space-y-6">
                  {/* Daily runsheet stats cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Assigned Orders</div>
                      <div className="text-2xl font-bold mt-1 text-neutral-900 dark:text-white">{orderCounts.totalAssigned}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Completed Orders</div>
                      <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{orderCounts.totalCompleted}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Vendor Ship Volume</div>
                      <div className="text-2xl font-bold mt-1 text-[#2383e2]">{orderCounts.vendorShipOrders} <span className="text-xs text-neutral-400 font-normal">orders</span></div>
                      <div className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 mt-1">₹{orderCounts.vendorShipValue.toLocaleString()}</div>
                    </div>

                    <div className="notion-card p-4 border border-[#edece9] dark:border-[#2f2f2f] bg-white/70 dark:bg-[#202020]/40">
                      <div className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">Per Order Volume</div>
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
                          { value: "VENDOR_SHIP", label: "Vendor Ship" },
                          { value: "PER_ORDER", label: "Per Order Rate" },
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
                            <th className="p-3.5 text-center">Assigned</th>
                            <th className="p-3.5 text-center">Completed</th>
                            <th className="p-3.5 text-center">Payout</th>
                            <th className="p-3.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#edece9] dark:divide-[#2f2f2f] text-xs">
                          {filteredDeliveries.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="p-8 text-center text-neutral-400 dark:text-neutral-500 font-medium">
                                No runsheet logs found in this timeframe.
                              </td>
                            </tr>
                          ) : (
                            filteredDeliveries.map((del) => {
                              const rate = del.totalOrders > 0 ? Math.round((del.completedOrders / del.totalOrders) * 100) : 0;
                              const payout = del.category === "vendor_ship"
                                ? 40000 + (del.completedOrders * 35)
                                : del.completedOrders * 75;
                              return (
                                <tr key={del.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/20">
                                  <td className="p-3.5 text-neutral-500">
                                    {new Date(del.createdAt).toLocaleDateString(undefined, {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric'
                                    })}
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
                                      {del.category === "vendor_ship" ? "Vendor Ship" : "Per Order"}
                                    </span>
                                  </td>
                                  <td className="p-3.5 text-center font-semibold text-neutral-700 dark:text-neutral-300">
                                    {del.totalOrders}
                                  </td>
                                  <td className="p-3.5 text-center font-semibold text-emerald-600 dark:text-emerald-400">
                                    {del.completedOrders}
                                  </td>
                                  <td className="p-3.5 text-center font-bold text-neutral-800 dark:text-neutral-200">
                                    ₹{payout.toLocaleString()}
                                  </td>
                                  <td className="p-3.5 text-right">
                                    <Form method="post" className="inline-block" style={{ display: "inline" }}>
                                      <input type="hidden" name="_action" value="delete_delivery" />
                                      <input type="hidden" name="id" value={del.id} />
                                      <button
                                        type="submit"
                                        className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 text-[10px] cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    </Form>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile-Responsive Daily Runsheets Card Feed (Mobile Only) */}
                  <div className="md:hidden space-y-3">
                    {filteredDeliveries.length === 0 ? (
                      <div className="p-6 text-center text-neutral-400 bg-neutral-50 dark:bg-neutral-900/30 rounded-lg italic text-xs">
                        No runsheet logs found in this timeframe.
                      </div>
                    ) : (
                      filteredDeliveries.map((del) => {
                        const rate = del.totalOrders > 0 ? Math.round((del.completedOrders / del.totalOrders) * 100) : 0;
                        return (
                          <div
                            key={del.id}
                            className="p-4 border border-[#edece9] dark:border-[#2f2f2f] rounded-lg bg-white dark:bg-[#1e1e1e] shadow-sm flex flex-col gap-2.5"
                          >
                            {/* Card Top Row: Date & Operator */}
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-bold text-neutral-400">
                                📅 {new Date(del.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
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
                                {del.category === "vendor_ship" ? "Vendor Ship" : "Per Order"}
                              </span>
                              
                              <div className="text-xs text-neutral-600 dark:text-neutral-300">
                                <span className="font-semibold text-neutral-800 dark:text-neutral-100">{del.completedOrders}</span>
                                <span className="text-neutral-400"> / {del.totalOrders} completed</span>
                                <span className="ml-1.5 font-bold text-emerald-600 dark:text-emerald-400">({rate}%)</span>
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-xs pt-1">
                              <span className="text-neutral-500 font-semibold">Payout:</span>
                              <span className="font-bold text-neutral-800 dark:text-neutral-200">
                                ₹{(del.category === "vendor_ship" ? 40000 + (del.completedOrders * 35) : del.completedOrders * 75).toLocaleString()}
                              </span>
                            </div>

                            {/* Card Bottom Row: Progress & Delete */}
                            <div className="flex justify-between items-center pt-1 border-t border-[#edece9]/30 dark:border-[#2f2f2f]/10">
                              <div className="w-1/2 bg-neutral-100 dark:bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    rate === 100
                                      ? "bg-emerald-500"
                                      : rate >= 80
                                      ? "bg-blue-500"
                                      : "bg-amber-500"
                                  }`}
                                  style={{ width: `${rate}%` }}
                                />
                              </div>

                              <Form method="post" className="inline-block" style={{ display: "inline" }}>
                                <input type="hidden" name="_action" value="delete_delivery" />
                                <input type="hidden" name="id" value={del.id} />
                                <button
                                  type="submit"
                                  className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-bold border border-red-200 dark:border-red-900 text-[10px] cursor-pointer"
                                >
                                  Delete Log
                                </button>
                              </Form>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
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
            <span>Orders</span>
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
                    <span>Role:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">Field Operator</span>
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
      </main>
    </div>
  );
}
