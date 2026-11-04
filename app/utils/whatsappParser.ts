// ─── Dreamline Logistics: WhatsApp Group Chat Parser & Transaction Engine ─── //

export interface WhatsAppMessage {
  id: string;
  rawTimestamp: string;
  parsedDate: string; // YYYY-MM-DD
  sender: string;
  text: string;
  createdAt: string;
}

export interface ExpenseRowItem {
  id: string;
  category: string;
  amount: number;
  note: string;
}

export interface DetectedTransaction {
  id: string;
  sourceMessageId: string;
  date: string;
  sender: string;
  rawText: string;
  type: "earning" | "expense" | "staff_advance";
  summary: string;
  totalAmount: number;
  selected: boolean;
  earningDetails?: {
    vendor1Gross: number;
    vendor1TDS: number;
    vendor1Net: number;
    vendor2: number;
    perOrder: number;
    extra: number;
    total: number;
    note: string;
  };
  expenseDetails?: {
    rows: ExpenseRowItem[];
    total: number;
  };
  advanceDetails?: {
    staffName: string;
    amount: number;
    tag: string;
    note: string;
  };
}

/**
 * Parses "3k", "12k", "50k", "5.5k" or raw numeric strings into numbers
 */
export function parseKAmount(val: string | number): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const clean = val.toString().trim().toLowerCase();
  if (clean.endsWith("k")) {
    const num = parseFloat(clean.slice(0, -1));
    return isNaN(num) ? 0 : Math.round(num * 1000);
  }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.round(num);
}

/**
 * Parses raw exported WhatsApp chat text into individual structured messages.
 * Supports iOS & Android WhatsApp timestamp headers:
 * - [25/09, 11:51 pm] Sumit Morya: ...
 * - [01/10/26, 12:37:00 pm] Sumit Morya: ...
 * - 01/10/2026, 12:37 - Sumit Morya: ...
 */
export function parseWhatsAppChat(rawText: string): WhatsAppMessage[] {
  const lines = rawText.split(/\r?\n/);
  const messages: WhatsAppMessage[] = [];

  const bracketRegex =
    /^\[(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?,\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[ap]m|[0-2]?[0-9]:[0-5][0-9])\]\s*([^:]+):\s*(.*)$/i;
  const standardRegex =
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[ap]m|[0-2]?[0-9]:[0-5][0-9])\s*-\s*([^:]+):\s*(.*)$/i;

  let currentMsg: WhatsAppMessage | null = null;
  const currentYear = new Date().getFullYear();

  for (const line of lines) {
    if (!line.trim()) continue;

    let match = line.match(bracketRegex);
    let isStandard = false;

    if (!match) {
      match = line.match(standardRegex);
      isStandard = true;
    }

    if (match) {
      if (currentMsg) {
        messages.push(currentMsg);
      }

      const day = match[1].padStart(2, "0");
      const month = match[2].padStart(2, "0");
      let year = match[3] || String(currentYear);
      if (year.length === 2) year = `20${year}`;

      const rawTime = match[4];
      const sender = match[5].trim();
      const text = match[6] || "";

      const rawTimestamp = isStandard
        ? `${day}/${month}/${year}, ${rawTime}`
        : `[${day}/${month}${match[3] ? `/${match[3]}` : ""}, ${rawTime}]`;

      const parsedDate = `${year}-${month}-${day}`;

      currentMsg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        rawTimestamp,
        parsedDate,
        sender,
        text,
        createdAt: new Date().toISOString(),
      };
    } else if (currentMsg) {
      currentMsg.text += `\n${line}`;
    }
  }

  if (currentMsg) {
    messages.push(currentMsg);
  }

  return messages;
}

/**
 * Scans messages and detects Earnings, Expenses, and Staff Advances using instant local regex
 */
export function detectTransactions(messages: WhatsAppMessage[]): DetectedTransaction[] {
  const detected: DetectedTransaction[] = [];

  for (const msg of messages) {
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    // 1. Detect Earning (Wednesday Payout)
    const isEarning =
      lower.includes("earning") ||
      ((lower.includes("vendor") || lower.includes("vandor") || lower.includes("wender")) &&
        (lower.includes("per order") || lower.includes("tds")));

    if (isEarning) {
      const earning = parseEarningText(text, msg);
      if (earning && earning.totalAmount > 0) {
        detected.push(earning);
        continue;
      }
    }

    // 2. Detect Expenses
    const isExpense =
      lower.startsWith("expense") ||
      lower.startsWith("experience") || // voice typo
      lower.startsWith("expence") ||
      lower.includes("\n- ") ||
      lower.includes("\n• ") ||
      (lower.includes("commission") && (lower.includes("800") || lower.includes("12k") || lower.includes("12000")));

    if (isExpense) {
      const expense = parseExpenseText(text, msg);
      if (expense && expense.totalAmount > 0) {
        detected.push(expense);
        continue;
      }
    }

    // 3. Detect Staff Advance
    const isAdvance =
      (lower.includes("bittu") || lower.includes("betu") || lower.includes("gaurav")) &&
      (lower.includes("advance") || lower.includes("emi") || lower.includes("salary") || lower.includes("loan"));

    if (isAdvance) {
      const advance = parseAdvanceText(text, msg);
      if (advance) {
        detected.push(advance);
        continue;
      }
    }
  }

  return detected;
}

function parseEarningText(text: string, msg: WhatsAppMessage): DetectedTransaction | null {
  const lines = text.split(/\r?\n/);

  let v1Net = 0;
  let v1Gross = 0;
  let v1Tds = 0;
  let v2 = 0;
  let perOrder = 0;
  let extra = 0;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // Vendor 1: e.g. "2247-(3249-1002 TDS)wender-1" or "Vandor 1 :- 3031"
    const v1TdsMatch = l.match(
      /(\d+)\s*-\s*\((\d+)\s*-\s*(\d+)\s*TDS\)\s*(?:wender|vendor|vandor|v)[-_]?1/i
    );
    if (v1TdsMatch) {
      v1Net = parseInt(v1TdsMatch[1], 10);
      v1Gross = parseInt(v1TdsMatch[2], 10);
      v1Tds = parseInt(v1TdsMatch[3], 10);
      continue;
    }

    const v1SimpleMatch = l.match(/(?:vendor|vandor|wender|v)[\s_-]*1\s*[:=-]+\s*(\d+)/i);
    if (v1SimpleMatch) {
      v1Net = parseInt(v1SimpleMatch[1], 10);
      v1Gross = v1Net;
      continue;
    }

    // Vendor 2: e.g. "3639-wender-2" or "Vandor 2 :- 2903"
    const v2PrefixMatch = l.match(/(\d+)\s*[-:=]+\s*(?:wender|vendor|vandor|v)[-_]?2/i);
    if (v2PrefixMatch) {
      v2 = parseInt(v2PrefixMatch[1], 10);
      continue;
    }

    const v2Match = l.match(/(?:vendor|vandor|wender|v)[\s_-]*2\s*[:=-]+\s*(\d+)/i);
    if (v2Match) {
      v2 = parseInt(v2Match[1], 10);
      continue;
    }

    // Per Order: e.g. "5287 per order" or "Per order :- 5955"
    const perOrderPrefixMatch = l.match(/(\d+)\s*(?:per\s*order)/i);
    if (perOrderPrefixMatch) {
      perOrder = parseInt(perOrderPrefixMatch[1], 10);
      continue;
    }

    const perOrderMatch = l.match(/per\s*order\s*[:=-]+\s*(\d+)/i);
    if (perOrderMatch) {
      perOrder = parseInt(perOrderMatch[1], 10);
      continue;
    }

    // Extra: e.g. "Extra :- 500" or "500 extra"
    const extraMatch = l.match(/extra\s*[:=-]+\s*(\d+)/i);
    if (extraMatch) {
      extra = parseInt(extraMatch[1], 10);
      continue;
    }
  }

  const total = v1Net + v2 + perOrder + extra;
  if (total === 0) return null;

  return {
    id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sourceMessageId: msg.id,
    date: msg.parsedDate,
    sender: msg.sender,
    rawText: text,
    type: "earning",
    summary: `Weekly Payout (V1: ₹${v1Net}, V2: ₹${v2}, Orders: ₹${perOrder}${extra > 0 ? `, Extra: ₹${extra}` : ""})`,
    totalAmount: total,
    earningDetails: {
      vendor1Gross: v1Gross,
      vendor1TDS: v1Tds,
      vendor1Net: v1Net,
      vendor2: v2,
      perOrder,
      extra,
      total,
      note: `Imported from WhatsApp (${msg.sender})`,
    },
    selected: true,
  };
}

function parseExpenseText(text: string, msg: WhatsAppMessage): DetectedTransaction | null {
  const lines = text.split(/\r?\n/);
  const rows: ExpenseRowItem[] = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    const lower = l.toLowerCase();
    if (lower === "expenses" || lower === "expense" || lower === "experience" || lower === "expence") {
      continue;
    }

    // Clean leading bullets: "- 20k bill payments" -> "20k bill payments"
    const cleaned = l.replace(/^[-*•\d.)]+\s*/, "").trim();

    let amount = 0;
    let note = "";
    const startAmountMatch = cleaned.match(/^(\d+(?:\.\d+)?k|\d+)\s*(.*)$/i);

    if (startAmountMatch) {
      amount = parseKAmount(startAmountMatch[1]);
      note = startAmountMatch[2].trim();
    } else {
      const anyAmountMatch = cleaned.match(/(\d+(?:\.\d+)?k|\d+)/i);
      if (anyAmountMatch) {
        amount = parseKAmount(anyAmountMatch[1]);
        note = cleaned.replace(anyAmountMatch[0], "").replace(/expenses|expense|experience/i, "").trim();
      }
    }

    if (amount <= 0) continue;

    const category = categorizeExpense(note || cleaned);

    rows.push({
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      category,
      amount,
      note: note || cleaned,
    });
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (total === 0) return null;

  return {
    id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sourceMessageId: msg.id,
    date: msg.parsedDate,
    sender: msg.sender,
    rawText: text,
    type: "expense",
    summary: `Expense (${rows.length} items: ${rows.map((r) => `${r.note || r.category}: ₹${r.amount}`).join(", ")})`,
    totalAmount: total,
    expenseDetails: {
      rows,
      total,
    },
    selected: true,
  };
}

export function categorizeExpense(desc: string): string {
  const d = desc.toLowerCase();

  if (d.includes("manager") || d.includes("commission to manager")) {
    return "manager_commission";
  }
  if (d.includes("police")) {
    return "police_commission";
  }
  if (d.includes("salary") || d.includes("salary all clear")) {
    return "salary_payment";
  }
  if (d.includes("wages") || d.includes("daily wages") || d.includes("helper")) {
    return "daily_wages";
  }
  if (d.includes("short") || d.includes("cash short")) {
    return "cash_short";
  }
  if (d.includes("cng")) {
    if (d.includes("card") || d.includes("credit")) {
      return "credit_card_cng";
    }
    return "cash_cng";
  }
  if (d.includes("repair") || d.includes("service") || d.includes("auto")) {
    return "auto_repair";
  }
  if (d.includes("byaaj") || d.includes("interest") || d.includes("loan")) {
    return "byaaj";
  }
  if (d.includes("recharge") || d.includes("bill") || d.includes("payment")) {
    return "bill_recharge";
  }
  if (d.includes("bittu") || d.includes("betu")) {
    return "bittu_advance";
  }
  if (d.includes("gaurav")) {
    return "gaurav_advance";
  }

  return "other";
}

function parseAdvanceText(text: string, msg: WhatsAppMessage): DetectedTransaction | null {
  const lower = text.toLowerCase();
  const isBittu = lower.includes("bittu") || lower.includes("betu");
  const isGaurav = lower.includes("gaurav");

  if (!isBittu && !isGaurav) return null;
  const staffName = isBittu ? "Bittu" : "Gaurav";

  const amountMatch = text.match(/(\d+(?:\.\d+)?k|\d+)/i);
  if (!amountMatch) return null;

  const amount = parseKAmount(amountMatch[1]);
  if (amount <= 0) return null;

  let tag = "advance";
  if (lower.includes("emi")) tag = "emi";
  else if (lower.includes("accident")) tag = "accident";
  else if (lower.includes("tool")) tag = "tools";

  return {
    id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sourceMessageId: msg.id,
    date: msg.parsedDate,
    sender: msg.sender,
    rawText: text,
    type: "staff_advance",
    summary: `${staffName} ${tag} (₹${amount})`,
    totalAmount: amount,
    advanceDetails: {
      staffName,
      amount,
      tag,
      note: text.replace(/\n/g, " "),
    },
    selected: true,
  };
}

export const SAMPLE_WHATSAPP_CHAT = `[25/09, 11:51 pm] Sumit Morya: Expenses 3k other
[01/10, 12:37 pm] Sumit Morya: Earning 
Vandor 1 :- 3031 
Vandor 2 :- 2903
Per order :- 5955
[01/10, 12:44 pm] Sumit Morya: Expenses 
- 20k bill payments 
- 12k commission to manager
- 1144 recharge bill payment 
- 800 police commission
[07/10, 3:42 pm] Betu Jaan 😛😛: 5287 per order 
3639-wender-2
2247-(3249-1002 TDS)wender-1
[19/10, 10:08 am] Sumit Morya: Experience 
- 13801 Gaurav salary all clear 
- 1600 daily wages 
- 44300 cash short 
- 400 cng experience`;

