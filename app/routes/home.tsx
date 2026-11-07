import { useState, useMemo, useEffect, useRef } from "react";
import { useLoaderData, Form, useNavigation, useActionData, useSubmit } from "react-router";
import type { Route } from "./+types/home";
import { prisma, withDbRetry } from "../db.server";
import { initKeepAwake } from "../utils/keepAwake.server";
import {
  parseKAmount,
  parseWhatsAppChat,
  detectTransactions,
  SAMPLE_WHATSAPP_CHAT,
  type DetectedTransaction,
} from "../utils/whatsappParser";

const FAST_EXPENSE_PILLS = [
  { label: "Manager Commission", value: "manager_commission", icon: "👔", defaultNotes: "Manager commission payout" },
  { label: "Police Commission", value: "police_commission", icon: "👮", defaultNotes: "Police commission entry" },
  { label: "Credit Card CNG", value: "credit_card_cng", icon: "💳", defaultNotes: "Credit card CNG fuel refill" },
  { label: "Cash CNG", value: "fuel", icon: "⛽", defaultNotes: "Cash CNG fuel refill" },
  { label: "Auto Service/Repair", value: "service", icon: "🔧", defaultNotes: "Auto repair & servicing" },
  { label: "Bittu Advance", value: "bittu", icon: "👤", defaultNotes: "Bittu advance", defaultSender: "Bittu" },
  { label: "Gaurav Advance", value: "gaurav_advance", icon: "👤", defaultNotes: "Gaurav advance", defaultSender: "Gaurav" },
  { label: "Parking", value: "parking", icon: "🅿️", defaultNotes: "Parking charges" },
  { label: "Auto Engine Oil", value: "engine_oil", icon: "🛢️", defaultNotes: "Auto engine oil replacement" },
  { label: "Challan / Fine", value: "challan", icon: "⚖️", defaultNotes: "Traffic challan / fine payment" },
  { label: "Spare Parts", value: "spare_parts", icon: "🔩", defaultNotes: "Auto spare parts" },
  { label: "General Kharcha", value: "other", icon: "📦", defaultNotes: "General kharcha" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Dreamline Logistics" },
    { name: "description", content: "Daily Hisaab & Cashflow Management" },
  ];
}

import { type LoaderFunctionArgs, type ActionFunctionArgs, redirect } from "react-router";
import { requireAdmin, hashPassword } from "../session.server";

// Server Loader - Parallelized database queries (cuts Neon cloud DB lag by 66%)
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireAdmin(request);
  initKeepAwake();
  const isTempPass = session.get("isTempPass") || false;
  const permission = session.get("permission") || "FULL_ADMIN";
  const expiresAt = session.get("expiresAt") || null;

  const loggedInUser = {
    name: session.get("userName") || "User",
    role: session.get("userRole") || "ADMIN",
    phone: session.get("userPhone") || null,
    isTempPass,
    permission,
    expiresAt,
  };

  // Batch 1: Primary financial ledgers (Expenses, Pending Bills, Driver Salaries)
  const [expenses, pendingPayments, salarySettlements] = await Promise.all([
    withDbRetry(() => prisma.$queryRaw<Array<{
      id: number;
      amount: number;
      currency: string;
      category: string;
      notes: string;
      vehicle: string | null;
      senderName: string;
      timestamp: Date;
      approved: boolean;
      type: string;
      settled: boolean;
      settledAt: Date | null;
      hasImage: boolean;
    }>>`
      SELECT 
        id, amount, currency, category, notes, vehicle, "senderName", timestamp, approved, type, settled, "settledAt",
        CASE WHEN "imageUrl" IS NOT NULL AND LENGTH("imageUrl") > 10 THEN true ELSE false END AS "hasImage"
      FROM "Expense"
      WHERE category != 'shared_temp'
      ORDER BY timestamp DESC
      LIMIT 500
    `),
    (prisma as any).pendingPayment ? withDbRetry(() => (prisma as any).pendingPayment.findMany({ orderBy: { createdAt: "desc" } })) : Promise.resolve([]),
    (prisma as any).driverSalarySettlement ? withDbRetry(() => (prisma as any).driverSalarySettlement.findMany({ orderBy: { paymentDate: "desc" } })) : Promise.resolve([]),
  ]);

  // Batch 2: User profiles, fleet & CNG Card swipes
  const [users, autos, cngSwipes] = await Promise.all([
    withDbRetry(() => prisma.user.findMany({ orderBy: { createdAt: "desc" } })),
    withDbRetry(() => prisma.auto.findMany({ orderBy: { createdAt: "desc" } })),
    withDbRetry(() => prisma.expense.findMany({
      where: { type: "CNG_CARD_SWIPE" },
      orderBy: { timestamp: "desc" },
    })),
  ]);

  return { users, expenses, loggedInUser, autos, pendingPayments, salarySettlements, cngSwipes };
}

// Server Action - Database Writes & Gemini AI smart parser integration
export async function action({ request }: ActionFunctionArgs) {
  const session = await requireAdmin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action")?.toString();

  const isViewOnly = session.get("permission") === "VIEW_ONLY";
  const isMutation = [
    "create_expense", "delete_expense", "create_user", "delete_user",
    "update_user_password", "create_pending_payment", "collect_pending_payment",
    "mark_pending_received", "delete_pending_payment", "create_borrowed_due", "repay_borrowed_payment", "settle_driver_salary",
    "create_weekly_earning", "import_whatsapp_transactions",
    "create_cng_swipe", "delete_cng_swipe", "pay_cc_bill"
  ].includes(actionType || "");

  if (isViewOnly && isMutation) {
    return { error: "Permission Denied: Your temporary access pass is set to View Only. You cannot perform write operations." };
  }



  if (actionType === "create_expense") {
    // Manual entry
    const amount = Math.round(parseFloat(formData.get("amount")?.toString() || "0") || 0);
    const type = formData.get("type")?.toString() || "EXPENSE";
    let category = formData.get("category")?.toString() || "other";
    const notes = formData.get("notes")?.toString() || "";
    const vehicle = formData.get("vehicle")?.toString() || null;
    let senderName = formData.get("senderName")?.toString() || "Founder";
    const imageUrlsStr = formData.get("imageUrls")?.toString() || "[]";
    let imageUrl = null;
    try {
      const urls = JSON.parse(imageUrlsStr);
      imageUrl = urls[0] || null;
    } catch (e) {
      imageUrl = formData.get("imageUrl")?.toString() || null;
    }
    const customDateStr = formData.get("date")?.toString() || null;
    const entryDate = customDateStr ? new Date(customDateStr) : new Date();

    // Guarantee Bittu / Gaurav advances link directly to Driver profile
    if (category === "bittu" || category === "bittu_advance" || /bittu/i.test(notes)) {
      category = "bittu";
      senderName = "Bittu";
    } else if (category === "gaurav_advance" || /gaurav/i.test(notes)) {
      category = "gaurav_advance";
      senderName = "Gaurav";
    }

    await prisma.expense.create({
      data: {
        amount,
        category,
        notes,
        vehicle,
        senderName,
        approved: true,
        settled: false,
        imageUrl,
        type,
        timestamp: entryDate,
      },
    });

    const pillObj = FAST_EXPENSE_PILLS.find(p => p.value === category);
    const catLabel = pillObj ? pillObj.label : category.replace(/_/g, " ").toUpperCase();
    const noteSuffix = notes && notes.trim() && notes.trim() !== pillObj?.defaultNotes ? ` (${notes.trim()})` : "";

    const waText = type === "INCOME"
      ? `INCOME\n• ${catLabel}: ₹${amount.toLocaleString("en-IN")}${noteSuffix}\n💰 TOTAL: ₹${amount.toLocaleString("en-IN")}`
      : `EXPENSES\n• ${catLabel}: ₹${amount.toLocaleString("en-IN")}${noteSuffix}\n💸 TOTAL: ₹${amount.toLocaleString("en-IN")}`;

    return {
      success: true,
      action: "create_expense",
      whatsappText: waText,
      whatsappTitle: type === "INCOME" ? "Income Logged" : "Expense Logged",
    };
  }

  if (actionType === "create_weekly_earning") {
    const v1 = parseKAmount(formData.get("vendor1")?.toString() || formData.get("vendor1Gross")?.toString() || "0");
    const v2 = parseKAmount(formData.get("vendor2")?.toString() || "0");
    const perOrder = parseKAmount(formData.get("perOrder")?.toString() || "0");
    const extra = parseKAmount(formData.get("extra")?.toString() || "0");
    const senderName = formData.get("senderName")?.toString() || "Sumit Morya";
    const customDateStr = formData.get("date")?.toString() || null;
    const entryDate = customDateStr ? new Date(customDateStr) : new Date();

    if (v1 > 0) {
      await prisma.expense.create({
        data: {
          amount: v1,
          category: "shadowfax",
          notes: "Vendor 1 Payout",
          senderName,
          type: "INCOME",
          approved: true,
          timestamp: entryDate,
        },
      });
    }

    if (v2 > 0) {
      await prisma.expense.create({
        data: {
          amount: v2,
          category: "shadowfax",
          notes: "Vendor 2 Payout",
          senderName,
          type: "INCOME",
          approved: true,
          timestamp: entryDate,
        },
      });
    }

    if (perOrder > 0) {
      await prisma.expense.create({
        data: {
          amount: perOrder,
          category: "shadowfax",
          notes: "Per Order Payout",
          senderName,
          type: "INCOME",
          approved: true,
          timestamp: entryDate,
        },
      });
    }

    if (extra > 0) {
      await prisma.expense.create({
        data: {
          amount: extra,
          category: "other_income",
          notes: "Extra Delivery Payout",
          senderName,
          type: "INCOME",
          approved: true,
          timestamp: entryDate,
        },
      });
    }

    const total = v1 + v2 + perOrder + extra;

    const waLines = [
      "WEEKLY EARNING",
      `• Vendor 1: ₹${v1.toLocaleString("en-IN")}`,
      `• Vendor 2: ₹${v2.toLocaleString("en-IN")}`,
      `• Per Order: ₹${perOrder.toLocaleString("en-IN")}`,
    ];
    if (extra > 0) {
      waLines.push(`• Extra: ₹${extra.toLocaleString("en-IN")}`);
    }
    waLines.push(`💵 TOTAL EARNED: ₹${total.toLocaleString("en-IN")}`);
    const waText = waLines.join("\n");

    return {
      success: true,
      action: "create_weekly_earning",
      total,
      whatsappText: waText,
      whatsappTitle: "Weekly Payout Confirmation",
    };
  }

  // Action: 45-Day Bill Payment Direct Logging
  if (actionType === "create_bill_payment") {
    const amount = parseKAmount(formData.get("amount")?.toString() || "0");
    const clientName = formData.get("clientName")?.toString()?.trim() || "Client";
    const billNote = formData.get("billNote")?.toString()?.trim() || "";
    const pendingPaymentId = parseInt(formData.get("pendingPaymentId")?.toString() || "0") || 0;
    const senderName = formData.get("senderName")?.toString() || clientName;
    const customDateStr = formData.get("date")?.toString() || null;
    const entryDate = customDateStr ? new Date(customDateStr) : new Date();

    if (amount <= 0) {
      return { error: "Please enter a valid bill payment amount." };
    }

    const note = billNote ? `45-Day Bill: ${clientName} (${billNote})` : `45-Day Bill: ${clientName}`;

    await prisma.expense.create({
      data: {
        amount,
        category: "vendor_income",
        notes: note,
        senderName,
        type: "INCOME",
        approved: true,
        timestamp: entryDate,
      },
    });

    if (pendingPaymentId > 0 && (prisma as any).pendingPayment) {
      try {
        const cur = await (prisma as any).pendingPayment.findUnique({ where: { id: pendingPaymentId } });
        if (cur) {
          const newReceived = cur.receivedAmount + amount;
          const newStatus = newReceived >= cur.totalAmount ? "PAID" : "PARTIAL";
          await (prisma as any).pendingPayment.update({
            where: { id: pendingPaymentId },
            data: {
              receivedAmount: newReceived,
              status: newStatus,
            },
          });
        }
      } catch (e) {
        console.error("Failed to link pending payment:", e);
      }
    }

    const noteSuffix = billNote ? ` (${billNote})` : "";
    const waText = `INCOME\n• 45-Day Bill - ${clientName}: ₹${amount.toLocaleString("en-IN")}${noteSuffix}\n💰 TOTAL: ₹${amount.toLocaleString("en-IN")}`;

    return {
      success: true,
      action: "create_bill_payment",
      amount,
      whatsappText: waText,
      whatsappTitle: "Bill Payment Received",
    };
  }

  if (actionType === "import_whatsapp_transactions") {
    const transactionsJson = formData.get("transactions")?.toString() || "[]";
    let transactions: any[] = [];
    try {
      transactions = JSON.parse(transactionsJson);
    } catch (e) {
      return { error: "Failed to parse transactions payload." };
    }

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return { error: "No transactions selected for import." };
    }

    let savedCount = 0;
    let savedTotal = 0;
    const summaryLines: string[] = [];

    for (const tx of transactions) {
      const txDate = tx.date ? new Date(tx.date) : new Date();
      const sender = tx.sender || "WhatsApp Group";

      if (tx.type === "earning" && tx.earningDetails) {
        const d = tx.earningDetails;
        if (d.vendor1Net > 0) {
          await prisma.expense.create({
            data: {
              amount: d.vendor1Net,
              category: "shadowfax",
              notes: `Vendor 1 Payout${d.vendor1TDS > 0 ? ` (Gross: ₹${d.vendor1Gross} - TDS: ₹${d.vendor1TDS})` : ""}`,
              senderName: sender,
              type: "INCOME",
              approved: true,
              timestamp: txDate,
            },
          });
          savedCount++;
        }
        if (d.vendor2 > 0) {
          await prisma.expense.create({
            data: {
              amount: d.vendor2,
              category: "shadowfax",
              notes: "Vendor 2 Payout",
              senderName: sender,
              type: "INCOME",
              approved: true,
              timestamp: txDate,
            },
          });
          savedCount++;
        }
        if (d.perOrder > 0) {
          await prisma.expense.create({
            data: {
              amount: d.perOrder,
              category: "shadowfax",
              notes: "Per Order Payout",
              senderName: sender,
              type: "INCOME",
              approved: true,
              timestamp: txDate,
            },
          });
          savedCount++;
        }
        if (d.extra > 0) {
          await prisma.expense.create({
            data: {
              amount: d.extra,
              category: "other_income",
              notes: "Extra Delivery Payout",
              senderName: sender,
              type: "INCOME",
              approved: true,
              timestamp: txDate,
            },
          });
          savedCount++;
        }
        savedTotal += (tx.totalAmount || 0);
        summaryLines.push(`• Earning: ₹${(tx.totalAmount || 0).toLocaleString("en-IN")}`);
      } else if (tx.type === "expense" && tx.expenseDetails) {
        for (const row of tx.expenseDetails.rows) {
          await prisma.expense.create({
            data: {
              amount: row.amount,
              category: row.category,
              notes: row.note || row.category,
              senderName: sender,
              type: "EXPENSE",
              approved: true,
              timestamp: txDate,
            },
          });
          savedCount++;
          savedTotal += row.amount;
          summaryLines.push(`• ${row.note || row.category}: ₹${row.amount.toLocaleString("en-IN")}`);
        }
      } else if (tx.type === "staff_advance" && tx.advanceDetails) {
        const ad = tx.advanceDetails;
        const cat = (ad.staffName || "").toLowerCase().includes("gaurav") ? "gaurav_advance" : "bittu";
        await prisma.expense.create({
          data: {
            amount: ad.amount,
            category: cat,
            notes: `${ad.staffName} Advance (${ad.tag}): ${ad.note}`,
            senderName: ad.staffName,
            type: "EXPENSE",
            approved: true,
            timestamp: txDate,
          },
        });
        savedCount++;
        savedTotal += ad.amount;
        summaryLines.push(`• ${ad.staffName} Advance: ₹${ad.amount.toLocaleString("en-IN")}`);
      }
    }

    const waText = [
      "WHATSAPP IMPORT",
      ...summaryLines.slice(0, 15),
      (summaryLines.length > 15 ? `...and ${summaryLines.length - 15} more` : null),
      `💸 TOTAL: ₹${savedTotal.toLocaleString("en-IN")}`,
    ].filter(Boolean).join("\n");

    return {
      success: true,
      action: "import_whatsapp_transactions",
      count: savedCount,
      total: savedTotal,
      whatsappText: waText,
      whatsappTitle: "WhatsApp Import Complete",
    };
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



  if (actionType === "create_driver") {
    const name = formData.get("name")?.toString()?.trim() || "";
    const phone = formData.get("phone")?.toString()?.trim() || "";
    const password = formData.get("password")?.toString() || "";
    const vehicleNumber = formData.get("vehicleNumber")?.toString()?.trim() || null;
    const salary = parseInt(formData.get("salary")?.toString() || "0") || null;
    const loginEnabled = false; // Disable login portal access for drivers as requested

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
        salary,
        loginEnabled,
      },
    });

    if (vehicleNumber) {
      // Clean up previous driver assignment for this auto
      const previousDriver = await prisma.user.findFirst({
        where: { vehicleNumber }
      });
      if (previousDriver) {
        await prisma.user.update({
          where: { id: previousDriver.id },
          data: { vehicleNumber: null }
        });
      }

      const auto = await prisma.auto.findUnique({ where: { plateNumber: vehicleNumber } });
      if (auto) {
        await prisma.auto.update({
          where: { id: auto.id },
          data: { driverPhone: phone },
        });
      }
    }

    return { success: true, action: "create_driver" };
  }

  if (actionType === "delete_driver") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const user = await prisma.user.findUnique({ where: { id } });
    if (user) {
      if (user.phone) {
        const auto = await prisma.auto.findFirst({ where: { driverPhone: user.phone } });
        if (auto) {
          await prisma.auto.update({
            where: { id: auto.id },
            data: { driverPhone: null },
          });
        }
      }
      await prisma.user.delete({
        where: { id },
      });
    }
    return { success: true, action: "delete_driver" };
  }

  if (actionType === "update_driver") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const name = formData.get("name")?.toString()?.trim() || "";
    const phone = formData.get("phone")?.toString()?.trim() || "";
    const salary = parseInt(formData.get("salary")?.toString() || "0") || null;
    const vehicleNumber = formData.get("vehicleNumber")?.toString()?.trim() || null;

    if (!id || !name || !phone) {
      return { error: "Driver ID, Name, and Phone are required." };
    }

    const driver = await prisma.user.findUnique({ where: { id } });
    if (!driver) {
      return { error: "Driver not found." };
    }

    if (phone !== driver.phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) {
        return { error: `A driver with phone number "${phone}" already exists.` };
      }
    }

    let transferredFromName: string | null = null;

    // Auto assignment logic
    if (vehicleNumber) {
      // Find if anyone else is assigned to this auto
      const previousDriver = await prisma.user.findFirst({
        where: {
          vehicleNumber,
          id: { not: id }
        }
      });

      if (previousDriver) {
        transferredFromName = previousDriver.name;
        // Unassign them
        await prisma.user.update({
          where: { id: previousDriver.id },
          data: { vehicleNumber: null }
        });
      }

      // Assign to this driver in Auto model
      const auto = await prisma.auto.findUnique({ where: { plateNumber: vehicleNumber } });
      if (auto) {
        await prisma.auto.update({
          where: { id: auto.id },
          data: { driverPhone: phone }
        });
      }
    }

    // Clean up old auto if assignment changed
    if (driver.vehicleNumber && driver.vehicleNumber !== vehicleNumber) {
      const oldAuto = await prisma.auto.findUnique({ where: { plateNumber: driver.vehicleNumber } });
      if (oldAuto && oldAuto.driverPhone === driver.phone) {
        await prisma.auto.update({
          where: { id: oldAuto.id },
          data: { driverPhone: null }
        });
      }
    }

    // Update driver
    await prisma.user.update({
      where: { id },
      data: {
        name,
        phone,
        salary,
        vehicleNumber
      }
    });

    return {
      success: true,
      action: "update_driver",
      transferredFrom: transferredFromName,
      newDriverName: name,
      vehicleNumber
    };
  }



  if (actionType === "create_pending_payment") {
    const title = formData.get("title")?.toString()?.trim() || "Pending Payment";
    const clientName = formData.get("clientName")?.toString()?.trim() || title;
    const totalAmount = parseFloat(formData.get("amount")?.toString() || formData.get("totalAmount")?.toString() || "0") || 0;
    const notes = formData.get("notes")?.toString()?.trim() || "";

    if (totalAmount <= 0) {
      return { error: "Pending amount must be greater than 0." };
    }

    const payment = await (prisma as any).pendingPayment.create({
      data: {
        title,
        clientName,
        totalAmount,
        receivedAmount: 0,
        status: "PENDING",
        notes,
      }
    });

    return { success: true, action: "create_pending_payment", payment };
  }

  if (actionType === "mark_pending_received") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    if (id <= 0) {
      return { error: "Invalid pending payment ID." };
    }

    const current = await (prisma as any).pendingPayment.findUnique({ where: { id } });
    if (!current) {
      return { error: "Pending payment record not found." };
    }

    const remainingToCollect = Math.max(0, current.totalAmount - current.receivedAmount);

    const updated = await (prisma as any).pendingPayment.update({
      where: { id },
      data: {
        receivedAmount: current.totalAmount,
        status: "PAID",
      }
    });

    if (remainingToCollect > 0) {
      await prisma.expense.create({
        data: {
          amount: remainingToCollect,
          category: "other_income",
          notes: `Received pending payment: ${current.title}${current.notes ? ` (${current.notes})` : ''}`,
          senderName: current.clientName || current.title,
          type: "INCOME",
          approved: true,
        }
      });
    }

    return { success: true, action: "mark_pending_received", payment: updated };
  }

  if (actionType === "collect_pending_payment") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const amountToCollect = parseFloat(formData.get("amountToCollect")?.toString() || "0") || 0;
    const notes = formData.get("notes")?.toString()?.trim() || "";

    if (id <= 0 || amountToCollect <= 0) {
      return { error: "Invalid payment collection amount." };
    }

    const current = await (prisma as any).pendingPayment.findUnique({ where: { id } });
    if (!current) {
      return { error: "Pending payment entry not found." };
    }

    const newReceived = current.receivedAmount + amountToCollect;
    const newStatus = newReceived >= current.totalAmount ? "PAID" : "PARTIAL";

    const updated = await (prisma as any).pendingPayment.update({
      where: { id },
      data: {
        receivedAmount: newReceived,
        status: newStatus,
        notes: notes ? (current.notes ? `${current.notes}\n${notes}` : notes) : current.notes,
      }
    });

    await prisma.expense.create({
      data: {
        amount: amountToCollect,
        category: "other_income",
        notes: `Collected payment for ${current.title} (${current.clientName})${notes ? ` - ${notes}` : ''}`,
        senderName: current.clientName,
        type: "INCOME",
        approved: true,
      }
    });

    return { success: true, action: "collect_pending_payment", payment: updated };
  }

  if (actionType === "delete_pending_payment") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    await (prisma as any).pendingPayment.delete({ where: { id } });
    return { success: true, action: "delete_pending_payment" };
  }

  if (actionType === "create_borrowed_due") {
    const lenderName = formData.get("lenderName")?.toString()?.trim() || "Friend / Family";
    const reason = formData.get("reason")?.toString()?.trim() || "Borrowed cash for cashflow";
    const amount = parseFloat(formData.get("amount")?.toString() || "0") || 0;
    const returnDateStr = formData.get("returnDate")?.toString()?.trim();
    const logCashflow = formData.get("logCashflow") === "on" || formData.get("logCashflow") === "true";
    const notes = formData.get("notes")?.toString()?.trim() || "";

    if (amount <= 0) {
      return { error: "Borrowed amount must be greater than 0." };
    }

    const returnDate = returnDateStr ? new Date(returnDateStr) : null;

    const payment = await (prisma as any).pendingPayment.create({
      data: {
        title: reason,
        clientName: lenderName,
        totalAmount: amount,
        receivedAmount: 0,
        dueDate: returnDate,
        status: "BORROWED",
        notes: notes,
      }
    });

    if (logCashflow) {
      await prisma.expense.create({
        data: {
          amount: amount,
          category: "other_income",
          notes: `Borrowed from ${lenderName}: ${reason}${notes ? ` (${notes})` : ''}`,
          senderName: lenderName,
          type: "INCOME",
          approved: true,
        }
      });
    }

    const waText = [
      `*BORROWED CASH RECORDED*`,
      `• Lender / Friend: ${lenderName}`,
      `• Borrowed: ₹${amount.toLocaleString("en-IN")}`,
      `• Reason: ${reason}`,
      returnDateStr ? `• Return By: ${returnDateStr}` : null,
      logCashflow ? `• Cashflow: Logged to Money IN` : null,
      `🤝 STATUS: OWED / TO PAY BACK`
    ].filter(Boolean).join("\n");

    return {
      success: true,
      action: "create_borrowed_due",
      payment,
      whatsappTitle: "Borrowed Cash Entry",
      whatsappText: waText,
    };
  }

  if (actionType === "repay_borrowed_payment") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    const amountToRepay = parseFloat(formData.get("amountToRepay")?.toString() || "0") || 0;
    const repaymentNote = formData.get("note")?.toString()?.trim() || "";

    if (id <= 0 || amountToRepay <= 0) {
      return { error: "Please enter a valid repayment amount." };
    }

    const current = await (prisma as any).pendingPayment.findUnique({ where: { id } });
    if (!current) {
      return { error: "Borrowed debt record not found." };
    }

    const prevRepaid = current.receivedAmount || 0;
    const newRepaid = Math.min(current.totalAmount, prevRepaid + amountToRepay);
    const isFullyPaid = newRepaid >= current.totalAmount;
    const newStatus = isFullyPaid ? "BORROWED_PAID" : "BORROWED_PARTIAL";
    const remainingDue = Math.max(0, current.totalAmount - newRepaid);

    const updated = await (prisma as any).pendingPayment.update({
      where: { id },
      data: {
        receivedAmount: newRepaid,
        status: newStatus,
        notes: repaymentNote
          ? (current.notes ? `${current.notes}\nRepaid ₹${amountToRepay} (${repaymentNote})` : `Repaid ₹${amountToRepay} (${repaymentNote})`)
          : current.notes,
      }
    });

    // Automatically log this repayment as an EXPENSE in Cashflow Ledger!
    await prisma.expense.create({
      data: {
        amount: amountToRepay,
        category: "other",
        notes: `Loan / Friend Repayment to ${current.clientName} (${current.title})${repaymentNote ? ` - ${repaymentNote}` : ''}`,
        senderName: session.get("userName") || "Founder",
        type: "EXPENSE",
        approved: true,
      }
    });

    const waText = [
      `*LOAN / FRIEND REPAYMENT*`,
      `• Paid To: ${current.clientName}`,
      `• Repaid Amount: ₹${amountToRepay.toLocaleString("en-IN")}`,
      `• Remaining Owed: ₹${remainingDue.toLocaleString("en-IN")}`,
      current.title ? `• Note: ${current.title}` : null,
      `💸 STATUS: ${isFullyPaid ? "FULLY PAID & CLEARED ✅" : "PARTIALLY REPAID 🟡"}`
    ].filter(Boolean).join("\n");

    return {
      success: true,
      action: "repay_borrowed_payment",
      payment: updated,
      whatsappTitle: "Repayment Receipt Ready",
      whatsappText: waText,
    };
  }

  if (actionType === "settle_driver_salary") {
    const driverName = formData.get("driverName")?.toString()?.trim() || "";
    const driverPhone = formData.get("driverPhone")?.toString()?.trim() || "";
    const monthYear = formData.get("monthYear")?.toString()?.trim() || new Date().toISOString().substring(0, 7);
    const baseSalary = parseFloat(formData.get("baseSalary")?.toString() || "0") || 0;
    const daysWorked = parseInt(formData.get("daysWorked")?.toString() || "30") || 30;
    const earnedSalary = parseFloat(formData.get("earnedSalary")?.toString() || "0") || 0;
    const advancesDeducted = parseFloat(formData.get("advancesDeducted")?.toString() || "0") || 0;
    const bonusAmount = parseFloat(formData.get("bonusAmount")?.toString() || "0") || 0;
    const otherDeductions = parseFloat(formData.get("otherDeductions")?.toString() || "0") || 0;
    const netPaidAmount = parseFloat(formData.get("netPaidAmount")?.toString() || "0") || 0;
    const paymentMode = formData.get("paymentMode")?.toString() || "CASH";
    const notes = formData.get("notes")?.toString()?.trim() || "";

    if (!driverName || netPaidAmount < 0) {
      return { error: "Invalid salary calculation or driver name." };
    }

    const settlement = await (prisma as any).driverSalarySettlement.create({
      data: {
        driverName,
        driverPhone,
        monthYear,
        baseSalary,
        daysWorked,
        earnedSalary,
        advancesDeducted,
        bonusAmount,
        otherDeductions,
        netPaidAmount,
        paymentMode,
        notes,
      }
    });

    // Mark matching advances as settled by explicit IDs or driver name
    const advanceIdsRaw = formData.get("advanceIds")?.toString() || "";
    let advanceIds: number[] = [];
    try {
      if (advanceIdsRaw.startsWith("[")) {
        advanceIds = JSON.parse(advanceIdsRaw);
      } else if (advanceIdsRaw) {
        advanceIds = advanceIdsRaw.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      }
    } catch (e) {
      console.warn("Failed to parse advanceIds:", e);
    }

    if (advanceIds.length > 0) {
      await (prisma as any).expense.updateMany({
        where: { id: { in: advanceIds } },
        data: {
          settled: true,
          settledAt: new Date(),
        }
      });
    } else {
      const firstName = driverName.split(/\s+/)[0];
      await (prisma as any).expense.updateMany({
        where: {
          settled: false,
          OR: [
            { category: "bittu" },
            { notes: { contains: "advance", mode: "insensitive" } },
            { notes: { contains: "salary", mode: "insensitive" } },
          ],
          AND: [
            {
              OR: [
                { senderName: { contains: driverName, mode: "insensitive" } },
                { notes: { contains: driverName, mode: "insensitive" } },
                { senderName: { contains: firstName, mode: "insensitive" } },
                { notes: { contains: firstName, mode: "insensitive" } },
              ]
            }
          ]
        },
        data: {
          settled: true,
          settledAt: new Date(),
        }
      });
    }

    // Log the salary payment into Expense ledger
    await (prisma as any).expense.create({
      data: {
        amount: netPaidAmount,
        category: "bittu",
        notes: `Salary for ${monthYear} (${daysWorked} days) to ${driverName}. Base: ₹${baseSalary}, Advances Deducted: ₹${advancesDeducted}${bonusAmount > 0 ? `, Bonus: ₹${bonusAmount}` : ''}${notes ? ` (${notes})` : ''}`,
        senderName: driverName,
        type: "EXPENSE",
        approved: true,
        settled: true,
        settledAt: new Date(),
      }
    });

    const waSalarySlip = [
      "SALARY SETTLEMENT",
      `• Driver: ${driverName}`,
      `• Days Worked: ${daysWorked} days`,
      `• Earned Salary: ₹${earnedSalary.toLocaleString("en-IN")}`,
      (advancesDeducted > 0 ? `• Advances Deducted: -₹${advancesDeducted.toLocaleString("en-IN")}` : null),
      (otherDeductions > 0 ? `• Other Deductions: -₹${otherDeductions.toLocaleString("en-IN")}` : null),
      (bonusAmount > 0 ? `• Bonus: +₹${bonusAmount.toLocaleString("en-IN")}` : null),
      `💸 NET PAID: ₹${netPaidAmount.toLocaleString("en-IN")}`,
    ].filter(Boolean).join("\n");

    return {
      success: true,
      action: "settle_driver_salary",
      settlement,
      whatsappText: waSalarySlip,
      whatsappTitle: `Salary Slip: ${driverName}`,
    };
  }

  // ─── CNG Card Actions ─────────────────────────────────────────────────── //

  if (actionType === "create_cng_swipe") {
    const senderName = formData.get("senderName")?.toString()?.trim() || "Bittu";
    const amountsStr = formData.get("amounts")?.toString()?.trim() || "";
    const dateStr = formData.get("date")?.toString() || null;
    const entryDate = dateStr ? new Date(dateStr) : new Date();

    const amounts = amountsStr
      .split(/[\s,]+/)
      .map((s) => parseKAmount(s.trim()))
      .filter((n) => n > 0);

    if (amounts.length === 0) {
      return { error: "Please enter at least one valid amount." };
    }

    for (const amt of amounts) {
      await prisma.expense.create({
        data: {
          amount: amt,
          category: "cng_card",
          notes: `CNG Card Swipe – ${senderName}`,
          senderName,
          type: "CNG_CARD_SWIPE",
          approved: true,
          settled: false,
          timestamp: entryDate,
        },
      });
    }

    const total = amounts.reduce((a, b) => a + b, 0);
    return {
      success: true,
      action: "create_cng_swipe",
      count: amounts.length,
      total,
    };
  }

  if (actionType === "delete_cng_swipe") {
    const id = parseInt(formData.get("id")?.toString() || "0") || 0;
    if (id > 0) {
      await prisma.expense.delete({ where: { id, type: "CNG_CARD_SWIPE" } });
    }
    return { success: true, action: "delete_cng_swipe" };
  }

  if (actionType === "pay_cc_bill") {
    const cycleStart = new Date(formData.get("cycleStart")?.toString() || "");
    const cycleEnd = new Date(formData.get("cycleEnd")?.toString() || "");
    const cycleLabel = formData.get("cycleLabel")?.toString() || "CNG Cycle";
    const totalAmount = parseKAmount(formData.get("totalAmount")?.toString() || "0");

    if (totalAmount <= 0) {
      return { error: "No CNG swipes to settle for this cycle." };
    }

    // Create one lump-sum Expense entry in Cashflow
    await prisma.expense.create({
      data: {
        amount: totalAmount,
        category: "credit_card_cng",
        notes: `Credit Card CNG Bill (${cycleLabel})`,
        senderName: "Founder",
        type: "EXPENSE",
        approved: true,
        settled: true,
        timestamp: new Date(),
      },
    });

    // Mark all CNG swipes in this cycle as settled
    await prisma.expense.updateMany({
      where: {
        type: "CNG_CARD_SWIPE",
        settled: false,
        timestamp: { gte: cycleStart, lte: cycleEnd },
      },
      data: {
        settled: true,
        settledAt: new Date(),
      },
    });

    const waText = [
      `⛽ CNG CARD BILL PAID`,
      `Cycle: ${cycleLabel}`,
      `Total: ₹${totalAmount.toLocaleString("en-IN")}`,
      `✅ Logged to Cashflow as Credit Card CNG expense`,
    ].join("\n");

    return {
      success: true,
      action: "pay_cc_bill",
      totalAmount,
      whatsappText: waText,
      whatsappTitle: "CNG Bill Settled",
    };
  }

  return null;
}

export default function Home() {
  const { users, expenses, loggedInUser, autos, pendingPayments = [], salarySettlements = [], cngSwipes = [] } = useLoaderData() as any;
  const dbDrivers = (users || []).filter((u: any) => u.role === "DRIVER");
  const fallbackDrivers = [
    { id: 9991, name: "Bittu", phone: "", vehicleNumber: "", salary: 18000, role: "DRIVER" },
    { id: 9992, name: "Gaurav", phone: "", vehicleNumber: "", salary: 18000, role: "DRIVER" }
  ];
  const drivers = [...dbDrivers];
  fallbackDrivers.forEach(fb => {
    if (!drivers.some(d => (d.name || "").toLowerCase().includes(fb.name.toLowerCase()))) {
      drivers.push(fb);
    }
  });

  // ─── Entry Console Modes & States ─── //
  const [consoleTab, setConsoleTab] = useState<"expense" | "earning">("expense");
  const [earningSubTab, setEarningSubTab] = useState<"weekly" | "bill45" | "other">("weekly");

  // Mode A: Expense Entry
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState<string>("fuel");
  const [activeFastPill, setActiveFastPill] = useState<string>("Cash CNG");
  const [fastAmountInput, setFastAmountInput] = useState<string>("");
  const [manualNotes, setManualNotes] = useState<string>("Cash CNG fuel refill");
  const [expenseDate, setExpenseDate] = useState<string>(() => new Date().toISOString().split("T")[0]);

  // Mode B1: Fast Weekly Earning (3 IDs) State
  const [weeklyV1, setWeeklyV1] = useState<string>("");
  const [weeklyV2, setWeeklyV2] = useState<string>("");
  const [weeklyPerOrder, setWeeklyPerOrder] = useState<string>("");
  const [weeklyExtra, setWeeklyExtra] = useState<string>("");
  const [weeklyPayoutDate, setWeeklyPayoutDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [weeklyNotes, setWeeklyNotes] = useState<string>("Wednesday Payout");

  // Mode B2: 45-Day Bill Payment State
  const [billAmount, setBillAmount] = useState<string>("");
  const [billClient, setBillClient] = useState<string>("");
  const [billNote, setBillNote] = useState<string>("");
  const [billDate, setBillDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [linkedPendingId, setLinkedPendingId] = useState<string>("");

  // Mode B3: Other Income State
  const [otherIncomeAmount, setOtherIncomeAmount] = useState<string>("");
  const [otherIncomeNote, setOtherIncomeNote] = useState<string>("");
  const [otherIncomeDate, setOtherIncomeDate] = useState<string>(() => new Date().toISOString().split("T")[0]);

  // WhatsApp Chat Importer State
  const [showWhatsAppImporter, setShowWhatsAppImporter] = useState<boolean>(false);
  const [rawWhatsAppChat, setRawWhatsAppChat] = useState<string>("");
  const [detectedWhatsAppTxs, setDetectedWhatsAppTxs] = useState<DetectedTransaction[]>([]);

  // 2-Button WhatsApp Share Modal State
  const [whatsappShareModal, setWhatsappShareModal] = useState<{
    isOpen: boolean;
    title: string;
    text: string;
  }>({
    isOpen: false,
    title: "",
    text: "",
  });
  const [copiedShareText, setCopiedShareText] = useState<boolean>(false);



  const handleCopyShareText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedShareText(true);
      setTimeout(() => setCopiedShareText(false), 2500);
    } catch (err) {
      triggerAlert("Clipboard Error", "Please manually select and copy the text.");
    }
  };

  const handleOpenWhatsApp = (text: string) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const actionData = useActionData<typeof action>() as any;
  const navigation = useNavigation();
  const submit = useSubmit();
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
  const [activeTab, setActiveTab] = useState<"expenses" | "cng_card" | "pending_dues" | "driver_salaries">("expenses");
  const [expensesSubTab, setExpensesSubTab] = useState<"entry" | "ledger">("entry");
  const [showExpenseDashboard, setShowExpenseDashboard] = useState(false);

  // CNG Card Tab State
  const [cngCycleOffset, setCngCycleOffset] = useState(0);
  const [cngSelectedBoy, setCngSelectedBoy] = useState<"Bittu" | "Gaurav">("Bittu");
  const [cngAmountInput, setCngAmountInput] = useState("");
  const [cngDateMode, setCngDateMode] = useState<"today" | "yesterday" | "custom">("today");
  const [cngCustomDate, setCngCustomDate] = useState("");

  // Pending Payments & Borrowed Liabilities State
  const [showAddPendingModal, setShowAddPendingModal] = useState(false);
  const [showAddBorrowedModal, setShowAddBorrowedModal] = useState(false);
  const [repayingBorrowedItem, setRepayingBorrowedItem] = useState<any | null>(null);
  const [pendingDueDirection, setPendingDueDirection] = useState<"RECEIVE" | "BORROWED">("RECEIVE");
  const [pendingFilterStatus, setPendingFilterStatus] = useState<"ALL" | "PENDING" | "PAID">("ALL");

  // Fast inputs with 'k' / '+000' shorthand support
  const [pendingAmountInput, setPendingAmountInput] = useState("");
  const [borrowedAmountInput, setBorrowedAmountInput] = useState("");
  const [repayAmountInput, setRepayAmountInput] = useState("");
  const [borrowedLender, setBorrowedLender] = useState("");
  const [borrowedReason, setBorrowedReason] = useState("");
  const [borrowedReturnDate, setBorrowedReturnDate] = useState("");
  const [borrowedNotes, setBorrowedNotes] = useState("");
  const [borrowedLogCashflow, setBorrowedLogCashflow] = useState(true);
  const [repayNoteInput, setRepayNoteInput] = useState("");
  const [collectingPayment, setCollectingPayment] = useState<any | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectNotes, setCollectNotes] = useState("");

  // Driver Salaries & Advance Settlement State
  const [salaryMonthYear, setSalaryMonthYear] = useState<string>(new Date().toISOString().substring(0, 7));
  const [driverDaysWorkedMap, setDriverDaysWorkedMap] = useState<Record<string, number>>({});
  const [driverBonusMap, setDriverBonusMap] = useState<Record<string, number>>({});
  const [driverDeductionMap, setDriverDeductionMap] = useState<Record<string, number>>({});
  const [settlingDriver, setSettlingDriver] = useState<any | null>(null);
  const [selectedSlipData, setSelectedSlipData] = useState<any | null>(null);
  const [viewingDriverAdvances, setViewingDriverAdvances] = useState<any | null>(null);
  const [copiedSlipText, setCopiedSlipText] = useState(false);



  const [expenseFilter, setExpenseFilter] = useState<"ALL" | "YEAR" | "MONTH" | "TODAY" | "CUSTOM">("ALL");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<"ALL" | "EXPENSE" | "INCOME">("ALL");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");

  // Auto-hiding notification and driver profile states
  const [expenseSuccessVisible, setExpenseSuccessVisible] = useState(false);
  const [actionErrorVisible, setActionErrorVisible] = useState(false);
  const [passTimeRemaining, setPassTimeRemaining] = useState<string>("");

  // Live countdown timer for Temporary Access Pass holders
  useEffect(() => {
    if (!loggedInUser?.isTempPass || !loggedInUser?.expiresAt) return;

    const updateTimer = () => {
      const diff = new Date(loggedInUser.expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setPassTimeRemaining("Expired");
        window.location.href = "/login?expired=true";
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setPassTimeRemaining(`${hours}h ${mins}m ${secs}s`);
      } else {
        setPassTimeRemaining(`${mins}m ${secs}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [loggedInUser?.expiresAt, loggedInUser?.isTempPass]);
  const [selectedDriverProfile, setSelectedDriverProfile] = useState<any | null>(null);
  const [isEditingDriver, setIsEditingDriver] = useState(false);
  const [editDriverName, setEditDriverName] = useState("");
  const [editDriverPhone, setEditDriverPhone] = useState("");
  const [editDriverSalary, setEditDriverSalary] = useState("");
  const [editDriverVehicle, setEditDriverVehicle] = useState("");

  const handleOpenDriverProfile = (driver: any) => {
    setSelectedDriverProfile(driver);
    setIsEditingDriver(false);
    if (driver) {
      setEditDriverName(driver.name || "");
      setEditDriverPhone(driver.phone || "");
      setEditDriverSalary(driver.salary ? driver.salary.toString() : "");
      setEditDriverVehicle(driver.vehicleNumber || "");
    }
  };
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

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
  // [expenseFormMode removed, replaced by consoleTab]

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

  // Pagination page states and constants
  const EXPENSE_PAGE_SIZE = 10;
  const [expensePage, setExpensePage] = useState(1);

  // [manualType and selectedCategory replaced by consoleTab and selectedExpenseCategory]

  // Local edit states
  const [editingExpense, setEditingExpense] = useState<any | null>(null);

  // Form references for automated clearing on success
  const manualExpenseFormRef = useRef<HTMLFormElement>(null);

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

  // Read search parameters on mount to support PWA shortcuts & Web Share Target success/error toasts
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      const showAddParam = params.get("showAdd");
      const shareSuccessParam = params.get("shareSuccess");
      const shareErrorParam = params.get("shareError");
      const sharedFromSW = params.get("sharedFromSW");

      if (tabParam === "expenses") {
        setActiveTab("expenses");
        if (showAddParam === "true") {
          setShowExpenseDashboard(false); // Show Entry Form
        } else {
          setShowExpenseDashboard(true);  // Show Ledger
        }
      } else if (tabParam === "cng_card") {
        setActiveTab("cng_card");
      } else if (tabParam === "pending_dues") {
        setActiveTab("pending_dues");
      } else if (tabParam === "driver_salaries") {
        setActiveTab("driver_salaries");
      }

      if (shareSuccessParam === "true" || shareErrorParam) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }


    }
  }, []);





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
  const switchTab = (tab: "expenses" | "cng_card" | "pending_dues" | "driver_salaries") => {
    setActiveTab(tab);
    setShowExpenseDashboard(false);
    setSidebarOpen(false);
    setConsoleTab("expense");
    setSelectedExpenseCategory("fuel");
    setActiveFastPill("Cash CNG");
    setExpenseCategoryFilter("ALL");
    setEntityFilter("ALL");
  };

  const isBorrowedItem = (p: any) => p.status?.startsWith("BORROWED") || (p.title || "").includes("[BORROWED]");

  // ─── CNG Card Cycle Helper ─────────────────────────────────────────────── //
  const getCngCycle = (offset: number): { start: Date; end: Date; label: string } => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();

    // Current cycle base: if today >= 4th, cycle started this month's 4th
    let cycleStartMonth = day >= 4 ? month : month - 1;
    let cycleStartYear = year;
    if (cycleStartMonth < 0) { cycleStartMonth = 11; cycleStartYear--; }

    // Apply offset
    cycleStartMonth += offset;
    while (cycleStartMonth > 11) { cycleStartMonth -= 12; cycleStartYear++; }
    while (cycleStartMonth < 0) { cycleStartMonth += 12; cycleStartYear--; }

    const cycleEndMonth = cycleStartMonth + 1 > 11 ? 0 : cycleStartMonth + 1;
    const cycleEndYear = cycleStartMonth + 1 > 11 ? cycleStartYear + 1 : cycleStartYear;

    const start = new Date(cycleStartYear, cycleStartMonth, 4, 0, 0, 0);
    const end = new Date(cycleEndYear, cycleEndMonth, 4, 23, 59, 59);

    const ms = MONTH_NAMES[cycleStartMonth].substring(0, 3);
    const me = MONTH_NAMES[cycleEndMonth].substring(0, 3);
    const label = `04 ${ms} – 04 ${me} ${cycleEndYear}`;
    return { start, end, label };
  };

  const cngCycle = getCngCycle(cngCycleOffset);
  const cngSwipesInCycle = (cngSwipes as any[]).filter((s: any) => {
    const t = new Date(s.timestamp);
    return t >= cngCycle.start && t <= cngCycle.end;
  });
  const cngUnpaidInCycle = cngSwipesInCycle.filter((s: any) => !s.settled);
  const cngBittuTotal = cngSwipesInCycle.filter((s: any) => s.senderName === "Bittu").reduce((a: number, s: any) => a + (s.amount || 0), 0);
  const cngGauravTotal = cngSwipesInCycle.filter((s: any) => s.senderName === "Gaurav").reduce((a: number, s: any) => a + (s.amount || 0), 0);
  const cngCycleTotal = cngBittuTotal + cngGauravTotal;
  const cngUnpaidTotal = cngUnpaidInCycle.reduce((a: number, s: any) => a + (s.amount || 0), 0);

  // Pending Dues & Borrowed Liabilities Aggregates
  const duesSummary = useMemo(() => {
    let totalToReceive = 0;
    let totalReceived = 0;
    let countToReceive = 0;

    let totalBorrowedOwed = 0;
    let totalBorrowedRepaid = 0;
    let countBorrowed = 0;

    pendingPayments.forEach((p: any) => {
      const isBorrowed = isBorrowedItem(p);
      const total = p.totalAmount || 0;
      const receivedOrRepaid = p.receivedAmount || 0;
      const remaining = Math.max(0, total - receivedOrRepaid);

      if (isBorrowed) {
        totalBorrowedOwed += remaining;
        totalBorrowedRepaid += receivedOrRepaid;
        if (remaining > 0) countBorrowed++;
      } else {
        totalToReceive += remaining;
        totalReceived += receivedOrRepaid;
        if (remaining > 0) countToReceive++;
      }
    });

    return {
      totalToReceive,
      totalReceived,
      countToReceive,
      totalBorrowedOwed,
      totalBorrowedRepaid,
      countBorrowed,
      totalPending: totalToReceive + totalBorrowedOwed,
      totalCollected: totalReceived,
    };
  }, [pendingPayments]);

  const pendingDuesSummary = duesSummary;

  const filteredPendingPayments = useMemo(() => {
    return pendingPayments.filter((p: any) => {
      const isBorrowed = isBorrowedItem(p);
      if (pendingDueDirection === "RECEIVE") {
        if (isBorrowed) return false;
        if (pendingFilterStatus === "PENDING") return p.status !== "PAID";
        if (pendingFilterStatus === "PAID") return p.status === "PAID";
        return true;
      } else {
        // BORROWED
        if (!isBorrowed) return false;
        if (pendingFilterStatus === "PENDING") return p.status !== "BORROWED_PAID";
        if (pendingFilterStatus === "PAID") return p.status === "BORROWED_PAID";
        return true;
      }
    });
  }, [pendingPayments, pendingDueDirection, pendingFilterStatus]);

  // Driver Salary Hub Live Reconciliation
  const driverSalaryReconciliation = useMemo(() => {
    return drivers.map((d: any) => {
      const baseSalary = d.salary || 16500;
      const daysWorked = driverDaysWorkedMap[d.id] !== undefined ? driverDaysWorkedMap[d.id] : 30;
      const bonus = driverBonusMap[d.id] || 0;
      const customDeductions = driverDeductionMap[d.id] || 0;
      const dailyRate = Math.round(baseSalary / 30);
      const earnedSalary = Math.round((baseSalary / 30) * daysWorked);

      // Find all un-settled advances for this driver with smart fuzzy & first-name matching
      const unSettledAdvances = expenses.filter((e: any) => {
        if (e.settled) return false;

        const isAdvanceCategory =
          e.category === "bittu" ||
          e.category === "bittu_advance" ||
          e.category === "gaurav_advance" ||
          /advance|salary|kharcha|loan|uthav/i.test(e.notes || "") ||
          /advance|salary/i.test(e.category || "");

        if (!isAdvanceCategory) return false;

        const driverFullName = (d.name || "").toLowerCase().trim();
        const driverFirstName = driverFullName.split(/\s+/)[0]; // e.g. "bittu", "gaurav", "rahul"
        const notesLower = (e.notes || "").toLowerCase();
        const senderLower = (e.senderName || "").toLowerCase();
        const vehiclePlate = (d.vehicleNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const expVehicle = (e.vehicle || "").toLowerCase().replace(/[^a-z0-9]/g, "");

        const isBittuDriver = driverFullName.includes("bittu") || driverFullName.includes("betu");
        const isGauravDriver = driverFullName.includes("gaurav");

        const categoryMatch =
          (isBittuDriver && (e.category === "bittu" || e.category === "bittu_advance")) ||
          (isGauravDriver && (e.category === "gaurav_advance" || notesLower.includes("gaurav")));

        const nameMatch =
          (driverFullName && (notesLower.includes(driverFullName) || senderLower.includes(driverFullName))) ||
          (driverFirstName && driverFirstName.length >= 3 && (notesLower.includes(driverFirstName) || senderLower.includes(driverFirstName)));
        const vehicleMatch = Boolean(vehiclePlate && expVehicle && (vehiclePlate.includes(expVehicle) || expVehicle.includes(vehiclePlate)));

        return categoryMatch || nameMatch || vehicleMatch;
      });

      const totalAdvances = unSettledAdvances.reduce((sum: number, a: any) => sum + (a.amount || 0), 0);
      const netPayable = Math.max(0, earnedSalary + bonus - totalAdvances - customDeductions);

      return {
        driver: d,
        baseSalary,
        daysWorked,
        dailyRate,
        earnedSalary,
        unSettledAdvances,
        totalAdvances,
        bonus,
        customDeductions,
        netPayable,
      };
    });
  }, [drivers, expenses, driverDaysWorkedMap, driverBonusMap, driverDeductionMap]);

  const generateWhatsAppSlipText = (item: any) => {
    return [
      "SALARY SETTLEMENT",
      `• Driver: ${item.driver.name}`,
      `• Days Worked: ${item.daysWorked} days (₹${item.dailyRate}/day)`,
      `• Earned Salary: ₹${item.earnedSalary.toLocaleString('en-IN')}`,
      (item.totalAdvances > 0 ? `• Advances Deducted: -₹${item.totalAdvances.toLocaleString('en-IN')} (${item.unSettledAdvances.length} slips)` : null),
      (item.customDeductions > 0 ? `• Other Deductions: -₹${item.customDeductions.toLocaleString('en-IN')}` : null),
      (item.bonus > 0 ? `• Bonus: +₹${item.bonus.toLocaleString('en-IN')}` : null),
      `💸 NET PAID: ₹${item.netPayable.toLocaleString('en-IN')}`,
    ].filter(Boolean).join("\n");
  };

  // AI Spotlight Multi-Turn Chat State

  // Dynamically extract all available years from expenses to populate the year filter dropdown
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    expenses.forEach((e: any) => {
      const yr = new Date(e.timestamp).getFullYear();
      if (!isNaN(yr)) years.add(yr.toString());
    });
    // Ensure the current year is in the list
    years.add(new Date().getFullYear().toString());
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [expenses]);



  // Filtered Expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp: any) => {
      // Exclude special ledger types (e.g. CNG_CARD_SWIPE) from main Cashflow ledger
      if (exp.type !== "INCOME" && exp.type !== "EXPENSE") {
        return false;
      }

      // 1. First apply Category filter (Expense vs Income)
      if (expenseCategoryFilter === "EXPENSE" && exp.type !== "EXPENSE") {
        return false;
      }
      if (expenseCategoryFilter === "INCOME" && exp.type !== "INCOME") {
        return false;
      }

      // 1b. Apply Auto/Driver/Category Entity filter
      if (entityFilter !== "ALL") {
        if (entityFilter === "ANY_AUTO") {
          if (!exp.vehicle) return false;
        } else if (entityFilter === "ANY_DRIVER") {
          const isDriver = drivers.some((d: any) => d.name === exp.senderName);
          if (!isDriver) return false;
        } else if (entityFilter.startsWith("AUTO:")) {
          const plate = entityFilter.substring(5).toLowerCase();
          if (!exp.vehicle?.toLowerCase().includes(plate)) return false;
        } else if (entityFilter.startsWith("DRIVER:")) {
          const name = entityFilter.substring(7).toLowerCase();
          const matchesSender = exp.senderName?.toLowerCase().includes(name);
          const matchesNotes = exp.notes?.toLowerCase().includes(name);
          if (!matchesSender && !matchesNotes) return false;
        } else if (entityFilter.startsWith("CATEGORY:")) {
          const cat = entityFilter.substring(9).toLowerCase();
          if (exp.category?.toLowerCase() !== cat) return false;
        }
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
  }, [expenses, expenseFilter, expenseCategoryFilter, selectedYear, selectedMonth, customStartDate, customEndDate, entityFilter, drivers]);

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

  // Paginated sublists
  const totalExpensePages = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSE_PAGE_SIZE));
  const activeExpensePage = Math.min(expensePage, totalExpensePages);

  const paginatedExpenses = useMemo(() => {
    const startIndex = (activeExpensePage - 1) * EXPENSE_PAGE_SIZE;
    return filteredExpenses.slice(startIndex, startIndex + EXPENSE_PAGE_SIZE);
  }, [filteredExpenses, activeExpensePage]);

  // Financial calculations based on filtered ledger
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let pendingExpense = 0;
    let fuel = 0;

    filteredExpenses.forEach((exp: any) => {
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



  // Reset raw inputs on action success and set fading success messages
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      // Clear edit states on successful update
      setEditingExpense(null);

      // If a fuel slip is still pending, do NOT show the success toast yet —
      // the popup modal will handle the remaining workflow.

      // Always clear the text inputs and primary fuel slip (non-pending)
      setFastAmountInput("");
      setManualNotes("Cash CNG fuel refill");
      setActiveFastPill("Cash CNG");
      setSelectedExpenseCategory("fuel");

      // Native browser form reset for all input text fields
      manualExpenseFormRef.current?.reset();

      // Trigger 2-button WhatsApp Sync Modal if formatted text is present
      if (actionData.whatsappText) {
        setWhatsappShareModal({
          isOpen: true,
          title: actionData.whatsappTitle || "WhatsApp Sync",
          text: actionData.whatsappText,
        });
      }

      if (actionData.action === "create_expense") {
        setFastAmountInput("");
        setOtherIncomeAmount("");
        setOtherIncomeNote("");
      }

      if (actionData.action === "create_cng_swipe") {
        setCngAmountInput("");
      }

      if (actionData.action === "create_weekly_earning") {
        setWeeklyV1("");
        setWeeklyV2("");
        setWeeklyPerOrder("");
        setWeeklyExtra("");
      }

      if (actionData.action === "create_bill_payment") {
        setBillAmount("");
        setBillClient("");
        setBillNote("");
        setLinkedPendingId("");
      }

      if (actionData.action === "import_whatsapp_transactions") {
        setShowWhatsAppImporter(false);
        setRawWhatsAppChat("");
        setDetectedWhatsAppTxs([]);
      }

      // Only clear pending slip and show success if there is NO pending fuel entry
      {

        if (actionData.action === "create_expense" || actionData.action === "create_weekly_earning" || actionData.action === "import_whatsapp_transactions") {
          setExpenseSuccessVisible(true);
          const timer = setTimeout(() => setExpenseSuccessVisible(false), 6000);
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
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white p-1 shadow-sm border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
              <img src="/logo.png" alt="Logo" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-slate-100 block">
                Dreamline Logistics
              </span>
              <span className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase block">
                Daily Hisaab & Cashflow
              </span>
            </div>
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
            className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center gap-2.5 px-3.5 py-2.5 mx-2 rounded-md transition-all ${activeTab === "expenses"
                ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
              }`}
          >
            <svg className={`w-4 h-4 transition-colors ${activeTab === 'expenses' ? 'text-[#5D87FF]' : 'text-emerald-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Expenses Tracking</span>
          </button>


          {/* CNG Card Tab */}
          {loggedInUser?.role !== "DRIVER" && (
            <button
              onClick={() => switchTab("cng_card")}
              className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center justify-between px-3.5 py-2.5 mx-2 rounded-md transition-all ${activeTab === "cng_card"
                  ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                  : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
                }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-sm">⛽</span>
                <span>CNG Card</span>
              </div>
              {cngUnpaidTotal > 0 && (
                <span className="text-[10px] font-mono font-bold bg-orange-500/20 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded">
                  ₹{Math.round(cngUnpaidTotal / 1000)}k
                </span>
              )}
            </button>
          )}

          {/* Pending Dues & Receivables Tab */}
          {loggedInUser?.role !== "DRIVER" && (
            <button
              onClick={() => switchTab("pending_dues")}
              className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center justify-between px-3.5 py-2.5 mx-2 rounded-md transition-all ${activeTab === "pending_dues"
                  ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                  : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
                }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-sm">🟡</span>
                <span>Pending Dues</span>
              </div>
              {pendingDuesSummary.totalPending > 0 && (
                <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                  ₹{Math.round(pendingDuesSummary.totalPending / 1000)}k
                </span>
              )}
            </button>
          )}

          {/* Driver Salaries & Advances Hub Tab */}
          {loggedInUser?.role !== "DRIVER" && (
            <button
              onClick={() => switchTab("driver_salaries")}
              className={`sidebar-link w-[calc(100%-16px)] text-left flex items-center gap-2.5 px-3.5 py-2.5 mx-2 rounded-md transition-all ${activeTab === "driver_salaries"
                  ? "bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold shadow-sm"
                  : "hover:bg-neutral-100 dark:hover:bg-[#1E293B]/60 text-[#5A6A85] dark:text-[#7C8BA1] font-medium"
                }`}
            >
              <span className="text-sm">💵</span>
              <span>Driver Salaries Hub</span>
            </button>
          )}


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
            Dreamline Logistics
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
                Dreamline Logistics
              </span>
            </div>
          </div>

          {/* Header Action Items (Theme Toggle & Share Pass) */}
          <div className="flex items-center gap-3.5">
            {/* 💬 Instant WhatsApp Bulk Importer Button */}
            {loggedInUser?.permission !== "VIEW_ONLY" && (
              <button
                type="button"
                onClick={() => setShowWhatsAppImporter(true)}
                className="px-3 py-1.5 bg-[#13DEB9]/15 hover:bg-[#13DEB9]/25 text-[#13DEB9] border border-[#13DEB9]/30 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                title="Instant WhatsApp Bulk Importer (0ms Regex)"
              >
                <span>💬</span>
                <span className="hidden sm:inline">WA Import</span>
              </button>
            )}



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

          {/* Guest Access Live Countdown Banner */}
          {loggedInUser?.isTempPass && (
            <div className="bg-amber-500/10 border border-amber-500/30 dark:bg-amber-500/15 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm animate-fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-200">
                <span className="text-sm">👁️</span>
                <span>
                  Guest Access Pass ({loggedInUser?.permission === "VIEW_ONLY" ? "View Only Mode" : "Full Access Mode"})
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono font-extrabold text-amber-900 dark:text-amber-100 bg-amber-500/20 px-3 py-1 rounded-md w-fit">
                <span>⌛ Expires in:</span>
                <span>{passTimeRemaining || "Calculating..."}</span>
              </div>
            </div>
          )}

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
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/30 rounded-lg text-xs font-semibold animate-fade-in flex items-center justify-between">
                  <span>{actionData.error}</span>
                  <button onClick={() => setActionErrorVisible(false)} className="text-rose-500 hover:text-rose-700 font-bold ml-2">×</button>
                </div>
              )}
              {expenseSuccessVisible && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30 rounded-lg text-xs font-semibold animate-fade-in flex items-center justify-between">
                  <span>Entry saved successfully.</span>
                  <button onClick={() => setExpenseSuccessVisible(false)} className="text-emerald-600 hover:text-emerald-800 font-bold ml-2">×</button>
                </div>
              )}

              {/* FORM MODE (DEFAULT) */}
              {!showExpenseDashboard ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Unified Entry Console */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="notion-card border border-[#edece9] dark:border-[#2f2f2f] rounded-lg p-6 bg-white dark:bg-[#1e1e1e] shadow-sm space-y-6">

                      {/* Interactive Tonal Segmented Pill Control: Mode A (Add Expense) vs Mode B (Add Earning) */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tracking-tight text-neutral-800 dark:text-neutral-200">
                            Quick Entry
                          </span>
                        </div>
                        <div className="inline-flex p-0.5 bg-[#f5f5f4] dark:bg-[#2c2c2c] rounded-lg gap-0.5 select-none self-start sm:self-auto border border-neutral-200/50 dark:border-neutral-800/30">
                          <button
                            type="button"
                            onClick={() => setConsoleTab("expense")}
                            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${consoleTab === "expense"
                                ? "bg-[#5D87FF] text-white shadow-sm"
                                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                              }`}
                          >
                            <span>💸</span>
                            <span>Add Expense</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConsoleTab("earning")}
                            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${consoleTab === "earning"
                                ? "bg-[#13DEB9] text-white shadow-sm"
                                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                              }`}
                          >
                            <span>💰</span>
                            <span>Add Earning</span>
                          </button>
                        </div>
                      </div>

                      {/* MODE A: 💸 ADD EXPENSE (DEFAULT) */}
                      {consoleTab === "expense" && (
                        <div className="space-y-4 animate-fade-in">
                          {/* 1-Tap Category Pills */}
                          <div className="space-y-2.5 p-3.5 bg-neutral-50 dark:bg-neutral-900/40 rounded-xl border border-neutral-200/60 dark:border-neutral-800/60">
                            <div className="flex justify-between items-center">
                              <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                                <span>⚡ 1-Tap Category Pills</span>
                              </label>
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#5D87FF]/10 text-[#5D87FF] dark:text-[#7ba1ff] border border-[#5D87FF]/20">
                                Selected: {activeFastPill}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {FAST_EXPENSE_PILLS.map((pill) => {
                                const isSelected = activeFastPill === pill.label;
                                return (
                                  <button
                                    key={pill.label}
                                    type="button"
                                    onClick={() => {
                                      setActiveFastPill(pill.label);
                                      setSelectedExpenseCategory(pill.value);
                                      if (pill.defaultNotes) setManualNotes(pill.defaultNotes);
                                    }}
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${isSelected
                                        ? "bg-[#5D87FF] text-white border-[#5D87FF] shadow-sm scale-105"
                                        : "bg-white hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border-neutral-200/80 dark:border-neutral-700/80"
                                      }`}
                                  >
                                    <span>{pill.icon}</span>
                                    <span>{pill.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Mode A Form: NO redundant category dropdown */}
                          <Form ref={manualExpenseFormRef} method="post" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <input type="hidden" name="_action" value="create_expense" />
                            <input type="hidden" name="type" value="EXPENSE" />
                            <input type="hidden" name="category" value={selectedExpenseCategory} />
                            <input
                              type="hidden"
                              name="senderName"
                              value={
                                activeFastPill.includes("Bittu")
                                  ? "Bittu"
                                  : activeFastPill.includes("Gaurav")
                                    ? "Gaurav"
                                    : (loggedInUser?.name || "Founder")
                              }
                            />
                            <input type="hidden" name="vehicle" value="" />

                            {/* Smart Amount Input with 'k' Shorthand and +000 button */}
                            <div className="space-y-1">
                              <div className="flex justify-between items-center">
                                <label className="text-xs font-semibold text-neutral-500">Amount (₹ INR)</label>
                                <span className="text-[10px] text-neutral-400 font-medium">Type "2k" or "+000"</span>
                              </div>
                              <div className="relative flex items-center">
                                <span className="absolute left-3 text-neutral-400 font-bold text-sm pointer-events-none select-none">₹</span>
                                <input
                                  type="text"
                                  name="amount"
                                  required
                                  placeholder="e.g. 2,000 or 2k"
                                  value={fastAmountInput}
                                  onChange={(e) => setFastAmountInput(e.target.value)}
                                  onBlur={() => {
                                    const parsed = parseKAmount(fastAmountInput);
                                    if (parsed > 0) setFastAmountInput(parsed.toString());
                                  }}
                                  style={{ paddingLeft: "34px", paddingRight: "64px" }}
                                  className="notion-input w-full pl-8 pr-16 text-sm font-bold border border-neutral-200 dark:border-neutral-800 rounded-md py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const curr = parseKAmount(fastAmountInput);
                                    if (curr > 0) {
                                      setFastAmountInput((curr * 1000).toString());
                                    } else if (fastAmountInput && !isNaN(Number(fastAmountInput))) {
                                      setFastAmountInput(fastAmountInput + "000");
                                    }
                                  }}
                                  className="absolute right-1.5 px-2 py-1 text-[10px] font-extrabold rounded bg-[#5D87FF]/15 hover:bg-[#5D87FF]/25 text-[#5D87FF] dark:text-[#7ba1ff] border border-[#5D87FF]/30 transition-all cursor-pointer"
                                  title="Multiply by 1,000"
                                >
                                  +000
                                </button>
                              </div>
                            </div>

                            {/* Expense Date */}
                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Expense Date</label>
                              <input
                                type="date"
                                name="date"
                                value={expenseDate}
                                onChange={(e) => setExpenseDate(e.target.value)}
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none font-semibold cursor-pointer"
                              />
                            </div>

                            {/* Optional Note (prefilled with pill default, editable) */}
                            <div className="sm:col-span-2 space-y-1">
                              <label className="text-xs font-semibold text-neutral-500">Notes / Remarks</label>
                              <input
                                type="text"
                                name="notes"
                                value={manualNotes}
                                onChange={(e) => setManualNotes(e.target.value)}
                                placeholder="What was this expense for?"
                                className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                              />
                            </div>

                            {/* Save Expense Button */}
                            <div className="sm:col-span-2 pt-2">
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 dark:bg-[#5D87FF] dark:hover:bg-[#4d75e6] text-white font-bold rounded-lg cursor-pointer transition-all shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                              >
                                <span>💾</span>
                                <span>{isSubmitting ? "Saving Expense..." : `Save Expense (${activeFastPill})`}</span>
                              </button>
                            </div>
                          </Form>
                        </div>
                      )}

                      {/* MODE B: 💰 ADD EARNING (INCOME) */}
                      {consoleTab === "earning" && (
                        <div className="space-y-4 animate-fade-in">
                          {/* 3 Sub-Toggles */}
                          <div className="inline-flex p-1 bg-neutral-100 dark:bg-[#252525] rounded-xl gap-1 w-full border border-neutral-200/60 dark:border-neutral-800/60">
                            <button
                              type="button"
                              onClick={() => setEarningSubTab("weekly")}
                              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer text-center ${earningSubTab === "weekly"
                                  ? "bg-[#13DEB9] text-white shadow-sm"
                                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                }`}
                            >
                              💰 Weekly Payout (3 IDs)
                            </button>
                            <button
                              type="button"
                              onClick={() => setEarningSubTab("bill45")}
                              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer text-center ${earningSubTab === "bill45"
                                  ? "bg-[#13DEB9] text-white shadow-sm"
                                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                }`}
                            >
                              📑 45-Day Bill Payment
                            </button>
                            <button
                              type="button"
                              onClick={() => setEarningSubTab("other")}
                              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer text-center ${earningSubTab === "other"
                                  ? "bg-[#13DEB9] text-white shadow-sm"
                                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                }`}
                            >
                              💵 Other Income
                            </button>
                          </div>

                          {/* SUB-TAB 1: WEEKLY PAYOUT (3 IDs) - NO TDS */}
                          {earningSubTab === "weekly" && (
                            <div className="space-y-4">
                              <div className="p-3 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between">
                                <div>
                                  <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                                    <span>💰 Weekly Payout (3 IDs)</span>
                                  </h3>
                                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                                    Log Vendor 1, Vendor 2, and Per Order in one go.
                                  </p>
                                </div>
                                <div className="text-right">
                                  <div className="text-[10px] uppercase font-bold text-neutral-400">Total Earned</div>
                                  <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                                    ₹{(
                                      (parseKAmount(weeklyV1) || 0) +
                                      (parseKAmount(weeklyV2) || 0) +
                                      (parseKAmount(weeklyPerOrder) || 0) +
                                      (parseKAmount(weeklyExtra) || 0)
                                    ).toLocaleString("en-IN")}
                                  </div>
                                </div>
                              </div>

                              <Form method="post" className="space-y-4">
                                <input type="hidden" name="_action" value="create_weekly_earning" />
                                <input type="hidden" name="senderName" value={loggedInUser?.name || "Sumit Morya"} />

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div className="space-y-1">
                                    <label className="text-xs font-semibold text-neutral-500">Payout Date</label>
                                    <input
                                      type="date"
                                      name="date"
                                      value={weeklyPayoutDate}
                                      onChange={(e) => setWeeklyPayoutDate(e.target.value)}
                                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none font-semibold cursor-pointer"
                                    />
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-xs font-semibold text-neutral-500">Notes / Cycle</label>
                                    <input
                                      type="text"
                                      name="notes"
                                      value={weeklyNotes}
                                      onChange={(e) => setWeeklyNotes(e.target.value)}
                                      placeholder="Wednesday Payout / Cycle"
                                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                    />
                                  </div>
                                </div>

                                {/* 3 Amount Inputs: Vendor 1, Vendor 2, Per Order */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div className="space-y-1 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                                    <label className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block mb-1">
                                      🚚 Vendor 1
                                    </label>
                                    <input
                                      type="text"
                                      name="vendor1"
                                      placeholder="e.g. 1401 or 1.4k"
                                      value={weeklyV1}
                                      onChange={(e) => setWeeklyV1(e.target.value)}
                                      onBlur={() => {
                                        const parsed = parseKAmount(weeklyV1);
                                        if (parsed > 0) setWeeklyV1(parsed.toString());
                                      }}
                                      className="notion-input w-full text-sm font-bold border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-1.5 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                    />
                                  </div>

                                  <div className="space-y-1 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                                    <label className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block mb-1">
                                      🚚 Vendor 2
                                    </label>
                                    <input
                                      type="text"
                                      name="vendor2"
                                      placeholder="e.g. 15 or 1500"
                                      value={weeklyV2}
                                      onChange={(e) => setWeeklyV2(e.target.value)}
                                      onBlur={() => {
                                        const parsed = parseKAmount(weeklyV2);
                                        if (parsed > 0) setWeeklyV2(parsed.toString());
                                      }}
                                      className="notion-input w-full text-sm font-bold border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-1.5 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                    />
                                  </div>

                                  <div className="space-y-1 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
                                    <label className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block mb-1">
                                      📦 Per Order
                                    </label>
                                    <input
                                      type="text"
                                      name="perOrder"
                                      placeholder="e.g. 1564644"
                                      value={weeklyPerOrder}
                                      onChange={(e) => setWeeklyPerOrder(e.target.value)}
                                      onBlur={() => {
                                        const parsed = parseKAmount(weeklyPerOrder);
                                        if (parsed > 0) setWeeklyPerOrder(parsed.toString());
                                      }}
                                      className="notion-input w-full text-sm font-bold border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-1.5 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                    />
                                  </div>
                                </div>

                                {/* Extra / Bonus (Optional) */}
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500">Extra / Incentive / Bonus (Optional)</label>
                                  <input
                                    type="text"
                                    name="extra"
                                    placeholder="0"
                                    value={weeklyExtra}
                                    onChange={(e) => setWeeklyExtra(e.target.value)}
                                    onBlur={() => {
                                      const parsed = parseKAmount(weeklyExtra);
                                      if (parsed > 0) setWeeklyExtra(parsed.toString());
                                    }}
                                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                  />
                                </div>

                                <button
                                  type="submit"
                                  disabled={isSubmitting}
                                  className="w-full py-3 bg-[#13DEB9] hover:bg-[#0fbfa0] text-white font-bold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                  <span>💾</span>
                                  <span>Log Weekly Payout & Share to WhatsApp</span>
                                </button>
                              </Form>
                            </div>
                          )}

                          {/* SUB-TAB 2: 45-DAY BILL PAYMENT */}
                          {earningSubTab === "bill45" && (
                            <Form method="post" className="space-y-4">
                              <input type="hidden" name="_action" value="create_bill_payment" />
                              <input type="hidden" name="senderName" value={loggedInUser?.name || "Client"} />

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Amount Input */}
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center">
                                    <label className="text-xs font-semibold text-neutral-500">Bill Amount (₹ INR)</label>
                                    <span className="text-[10px] text-neutral-400 font-medium">Type "45k" or "+000"</span>
                                  </div>
                                  <div className="relative flex items-center">
                                    <span className="absolute left-3 text-neutral-400 font-bold text-sm pointer-events-none select-none">₹</span>
                                    <input
                                      type="text"
                                      name="amount"
                                      required
                                      placeholder="e.g. 45,000 or 45k"
                                      value={billAmount}
                                      onChange={(e) => setBillAmount(e.target.value)}
                                      onBlur={() => {
                                        const parsed = parseKAmount(billAmount);
                                        if (parsed > 0) setBillAmount(parsed.toString());
                                      }}
                                      style={{ paddingLeft: "34px", paddingRight: "64px" }}
                                      className="notion-input w-full pl-8 pr-16 text-sm font-bold border border-neutral-200 dark:border-neutral-800 rounded-md py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const curr = parseKAmount(billAmount);
                                        if (curr > 0) {
                                          setBillAmount((curr * 1000).toString());
                                        } else if (billAmount && !isNaN(Number(billAmount))) {
                                          setBillAmount(billAmount + "000");
                                        }
                                      }}
                                      className="absolute right-1.5 px-2 py-1 text-[10px] font-extrabold rounded bg-[#13DEB9]/15 hover:bg-[#13DEB9]/25 text-[#13DEB9] border border-[#13DEB9]/30 transition-all cursor-pointer"
                                      title="Multiply by 1,000"
                                    >
                                      +000
                                    </button>
                                  </div>
                                </div>

                                {/* Bill Date */}
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500">Payment Date</label>
                                  <input
                                    type="date"
                                    name="date"
                                    value={billDate}
                                    onChange={(e) => setBillDate(e.target.value)}
                                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none font-semibold cursor-pointer"
                                  />
                                </div>

                                {/* Client Name */}
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500">Client / Company Name</label>
                                  <input
                                    type="text"
                                    name="clientName"
                                    required
                                    placeholder="e.g. Shadowfax, Flipkart, Ecom Express"
                                    value={billClient}
                                    onChange={(e) => setBillClient(e.target.value)}
                                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none font-semibold"
                                  />
                                </div>

                                {/* Bill Month / Note */}
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500">Bill Month / Note</label>
                                  <input
                                    type="text"
                                    name="billNote"
                                    placeholder="e.g. September Bill Payment / Invoice #102"
                                    value={billNote}
                                    onChange={(e) => setBillNote(e.target.value)}
                                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                  />
                                </div>

                                {/* Link to Pending Due */}
                                <div className="sm:col-span-2 space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500 flex items-center justify-between">
                                    <span>Link to Pending Due (Optional)</span>
                                    <span className="text-[10px] text-neutral-400">Auto-marks pending bill as collected</span>
                                  </label>
                                  <select
                                    name="pendingPaymentId"
                                    value={linkedPendingId}
                                    onChange={(e) => {
                                      setLinkedPendingId(e.target.value);
                                      const pId = parseInt(e.target.value);
                                      const sel = pendingPayments.find((p: any) => p.id === pId);
                                      if (sel) {
                                        if (!billClient) setBillClient(sel.clientName || "");
                                        if (!billAmount) setBillAmount((sel.totalAmount - sel.receivedAmount).toString());
                                        if (!billNote) setBillNote(sel.title || "");
                                      }
                                    }}
                                    className="notion-select w-full text-xs border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 dark:bg-[#1e1e1e] focus:ring-1 focus:ring-[#13DEB9] outline-none cursor-pointer"
                                  >
                                    <option value="">None (Standalone Bill Payment)</option>
                                    {pendingPayments
                                      .filter((p: any) => p.status !== "PAID")
                                      .map((p: any) => (
                                        <option key={p.id} value={p.id}>
                                          {p.clientName} - {p.title} (₹{(p.totalAmount - p.receivedAmount).toLocaleString("en-IN")} pending)
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              </div>

                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-3 bg-[#13DEB9] hover:bg-[#0fbfa0] text-white font-bold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                <span>💾</span>
                                <span>Save 45-Day Bill Payment & Share to WhatsApp</span>
                              </button>
                            </Form>
                          )}

                          {/* SUB-TAB 3: OTHER INCOME */}
                          {earningSubTab === "other" && (
                            <Form method="post" className="space-y-4">
                              <input type="hidden" name="_action" value="create_expense" />
                              <input type="hidden" name="type" value="INCOME" />
                              <input type="hidden" name="category" value="other_income" />
                              <input type="hidden" name="senderName" value={loggedInUser?.name || "Founder"} />
                              <input type="hidden" name="vehicle" value="" />

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Amount Input */}
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center">
                                    <label className="text-xs font-semibold text-neutral-500">Amount (₹ INR)</label>
                                    <span className="text-[10px] text-neutral-400 font-medium">Type "5k" or "+000"</span>
                                  </div>
                                  <div className="relative flex items-center">
                                    <span className="absolute left-3 text-neutral-400 font-bold text-sm pointer-events-none select-none">₹</span>
                                    <input
                                      type="text"
                                      name="amount"
                                      required
                                      placeholder="e.g. 5,000 or 5k"
                                      value={otherIncomeAmount}
                                      onChange={(e) => setOtherIncomeAmount(e.target.value)}
                                      onBlur={() => {
                                        const parsed = parseKAmount(otherIncomeAmount);
                                        if (parsed > 0) setOtherIncomeAmount(parsed.toString());
                                      }}
                                      style={{ paddingLeft: "34px", paddingRight: "64px" }}
                                      className="notion-input w-full pl-8 pr-16 text-sm font-bold border border-neutral-200 dark:border-neutral-800 rounded-md py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const curr = parseKAmount(otherIncomeAmount);
                                        if (curr > 0) {
                                          setOtherIncomeAmount((curr * 1000).toString());
                                        } else if (otherIncomeAmount && !isNaN(Number(otherIncomeAmount))) {
                                          setOtherIncomeAmount(otherIncomeAmount + "000");
                                        }
                                      }}
                                      className="absolute right-1.5 px-2 py-1 text-[10px] font-extrabold rounded bg-[#13DEB9]/15 hover:bg-[#13DEB9]/25 text-[#13DEB9] border border-[#13DEB9]/30 transition-all cursor-pointer"
                                      title="Multiply by 1,000"
                                    >
                                      +000
                                    </button>
                                  </div>
                                </div>

                                {/* Date Input */}
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500">Income Date</label>
                                  <input
                                    type="date"
                                    name="date"
                                    value={otherIncomeDate}
                                    onChange={(e) => setOtherIncomeDate(e.target.value)}
                                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none font-semibold cursor-pointer"
                                  />
                                </div>

                                {/* Description / Notes */}
                                <div className="sm:col-span-2 space-y-1">
                                  <label className="text-xs font-semibold text-neutral-500">Description / Notes</label>
                                  <input
                                    type="text"
                                    name="notes"
                                    required
                                    placeholder="e.g. Extra delivery payout, scrap sale, incentive"
                                    value={otherIncomeNote}
                                    onChange={(e) => setOtherIncomeNote(e.target.value)}
                                    className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#13DEB9] outline-none"
                                  />
                                </div>
                              </div>

                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-3 bg-[#13DEB9] hover:bg-[#0fbfa0] text-white font-bold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                <span>💾</span>
                                <span>Save Other Income & Share to WhatsApp</span>
                              </button>
                            </Form>
                          )}
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
                      {expenses.slice(0, 5).map((exp: any) => (
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
                                className={`text-[10px] sm:text-xs px-2.5 py-1 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${expenseFilter === filter
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
                  </div>

                  {/* Category & Entity Selector Row */}
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4 w-full border-t border-[#edece9]/50 dark:border-[#2f2f2f]/30 pt-3">
                    <div className="flex flex-col md:flex-row md:items-center gap-3 flex-shrink-0">
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
                            className={`text-[10px] sm:text-xs px-2.5 py-1 rounded-md font-semibold border transition-all cursor-pointer whitespace-nowrap ${expenseCategoryFilter === cat.value
                                ? "bg-[#5D87FF] border-[#5D87FF] text-white"
                                : "bg-transparent border-[#edece9] dark:border-[#2f2f2f] hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-450"
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
                            paginatedExpenses.map((exp: any) => (
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
                        paginatedExpenses.map((exp: any) => (
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
                                    className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-md transition-all active:scale-95 cursor-pointer ${p === activeExpensePage
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

          {/* ========================================================================= */}
          {/* ⛽ CNG CREDIT CARD TAB VIEW */}
          {/* ========================================================================= */}
          {activeTab === "cng_card" && (
            <div className="animate-fade-in space-y-6">
              {/* Header & 4th-to-4th Cycle Selector */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
                    <span>⛽</span>
                    <span>CNG Credit Card Tracker</span>
                  </h1>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    Track daily credit card CNG swipes for Bittu &amp; Gaurav on a 4th-to-4th billing cycle, audit statement, and settle lump-sum CC bill into Cashflow.
                  </p>
                </div>

                {/* 4th-to-4th Cycle Navigation */}
                <div className="flex items-center gap-2 bg-white dark:bg-[#18181c] p-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setCngCycleOffset((c) => c - 1)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition-all cursor-pointer"
                    title="Previous billing cycle"
                  >
                    ◀ Prev Cycle
                  </button>

                  <div className="px-3 py-1 bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-bold text-xs rounded-lg flex items-center gap-1.5">
                    <span>📅</span>
                    <span>{cngCycle.label}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCngCycleOffset((c) => c + 1)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition-all cursor-pointer"
                    title="Next billing cycle"
                  >
                    Next Cycle ▶
                  </button>

                  {cngCycleOffset !== 0 && (
                    <button
                      type="button"
                      onClick={() => setCngCycleOffset(0)}
                      className="ml-1 px-2 py-1 text-[11px] font-bold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 rounded-md transition-all cursor-pointer"
                    >
                      Active Cycle
                    </button>
                  )}
                </div>
              </div>

              {/* Top Summary Cards: Total CC Bill, Bittu, Gaurav */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Total CC Bill */}
                <div className="bg-white dark:bg-[#18181c] p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 shadow-sm relative overflow-hidden">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-neutral-400">
                    💳 Total CC Bill for Cycle
                  </div>
                  <div className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-50 mt-1">
                    ₹{cngCycleTotal.toLocaleString("en-IN")}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-neutral-500 dark:text-neutral-400">
                      {cngSwipesInCycle.length} swipes ({cngUnpaidInCycle.length} unpaid)
                    </span>
                    {cngCycleTotal === 0 ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                        No Swipes
                      </span>
                    ) : cngUnpaidTotal === 0 ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        ✅ Settled into Cashflow
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        🟡 Settle 21st–24th (₹{cngUnpaidTotal.toLocaleString("en-IN")})
                      </span>
                    )}
                  </div>
                </div>

                {/* Bittu Total */}
                <div className="bg-white dark:bg-[#18181c] p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 shadow-sm">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <span>👤</span>
                    <span>Bittu Total</span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-50 mt-1">
                    ₹{cngBittuTotal.toLocaleString("en-IN")}
                  </div>
                  <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {cngSwipesInCycle.filter((s: any) => s.senderName === "Bittu").length} swipes in cycle
                  </div>
                </div>

                {/* Gaurav Total */}
                <div className="bg-white dark:bg-[#18181c] p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 shadow-sm">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                    <span>👤</span>
                    <span>Gaurav Total</span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-50 mt-1">
                    ₹{cngGauravTotal.toLocaleString("en-IN")}
                  </div>
                  <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {cngSwipesInCycle.filter((s: any) => s.senderName === "Gaurav").length} swipes in cycle
                  </div>
                </div>
              </div>

              {/* Action Buttons: WhatsApp Share & Pay CC Bill */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-50 dark:bg-neutral-900/40 p-3 rounded-xl border border-neutral-200/60 dark:border-neutral-800/60">
                <div className="text-xs text-neutral-600 dark:text-neutral-400">
                  <span className="font-semibold text-neutral-800 dark:text-neutral-200">Cycle Status: </span>
                  {cngUnpaidTotal > 0 ? (
                    <span>₹{cngUnpaidTotal.toLocaleString("en-IN")} ready to settle to Cashflow on bill arrival (21st–24th)</span>
                  ) : cngCycleTotal > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">All swipes settled for this cycle!</span>
                  ) : (
                    <span>No swipes recorded for this cycle yet.</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const lines = [
                        `⛽ CNG CREDIT CARD BILL (${cngCycle.label})`,
                        `• Bittu: ₹${cngBittuTotal.toLocaleString("en-IN")}`,
                        `• Gaurav: ₹${cngGauravTotal.toLocaleString("en-IN")}`,
                        `💳 TOTAL CC BILL: ₹${cngCycleTotal.toLocaleString("en-IN")}`,
                        cngUnpaidTotal === 0 && cngCycleTotal > 0
                          ? `✅ Status: Settled into Cashflow`
                          : `🟡 Status: Pending settlement (Pay by 24th ${MONTH_NAMES[cngCycle.end.getMonth()]?.substring(0, 3)})`,
                      ];
                      setWhatsappShareModal({
                        isOpen: true,
                        title: `CNG Cycle: ${cngCycle.label}`,
                        text: lines.join("\n"),
                      });
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#18181c] hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>💬</span>
                    <span>Share Cycle Summary</span>
                  </button>

                  <button
                    type="button"
                    disabled={cngUnpaidTotal <= 0}
                    onClick={() => {
                      triggerConfirm(
                        "Pay Credit Card Bill & Settle?",
                        `This will create ONE lump-sum expense of ₹${cngUnpaidTotal.toLocaleString("en-IN")} in Cashflow under 'Credit Card CNG' and mark all ${cngUnpaidInCycle.length} swipes in this cycle (${cngCycle.label}) as settled. Proceed?`,
                        () => {
                          const fd = new FormData();
                          fd.append("_action", "pay_cc_bill");
                          fd.append("cycleStart", cngCycle.start.toISOString());
                          fd.append("cycleEnd", cngCycle.end.toISOString());
                          fd.append("cycleLabel", cngCycle.label);
                          fd.append("totalAmount", cngUnpaidTotal.toString());
                          submit(fd, { method: "post" });
                        }
                      );
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>💳</span>
                    <span>Pay CC Bill &amp; Log to Cashflow</span>
                  </button>
                </div>
              </div>

              {/* 3-Second Fast Entry: Daily CNG Swipes */}
              <div className="bg-white dark:bg-[#18181c] p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
                  <div className="flex items-center gap-2">
                    <span className="text-base">⚡</span>
                    <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                      3-Second Fast Entry: Daily CNG Swipe
                    </h2>
                  </div>
                  <span className="text-[11px] text-neutral-400 font-mono">
                    Active Cycle: {cngCycle.label}
                  </span>
                </div>

                <Form method="post" className="space-y-4">
                  <input type="hidden" name="_action" value="create_cng_swipe" />
                  <input type="hidden" name="senderName" value={cngSelectedBoy} />
                  <input
                    type="hidden"
                    name="date"
                    value={
                      cngDateMode === "yesterday"
                        ? new Date(Date.now() - 86400000).toISOString()
                        : cngDateMode === "custom" && cngCustomDate
                        ? new Date(cngCustomDate).toISOString()
                        : new Date().toISOString()
                    }
                  />

                  {/* Row 1: Boy Selector & Date Selector */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Driver / Boy Selector */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1.5">
                        Driver / Boy
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setCngSelectedBoy("Bittu")}
                          className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            cngSelectedBoy === "Bittu"
                              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                              : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          }`}
                        >
                          <span>👤</span>
                          <span>Bittu</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCngSelectedBoy("Gaurav")}
                          className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            cngSelectedBoy === "Gaurav"
                              ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                              : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          }`}
                        >
                          <span>👤</span>
                          <span>Gaurav</span>
                        </button>
                      </div>
                    </div>

                    {/* Date Selector */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1.5">
                        Swipe Date
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setCngDateMode("today")}
                          className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                            cngDateMode === "today"
                              ? "bg-[#5D87FF] text-white border-[#5D87FF] shadow-sm"
                              : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          }`}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          onClick={() => setCngDateMode("yesterday")}
                          className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                            cngDateMode === "yesterday"
                              ? "bg-[#5D87FF] text-white border-[#5D87FF] shadow-sm"
                              : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          }`}
                        >
                          Yesterday
                        </button>
                        <button
                          type="button"
                          onClick={() => setCngDateMode("custom")}
                          className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                            cngDateMode === "custom"
                              ? "bg-[#5D87FF] text-white border-[#5D87FF] shadow-sm"
                              : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          }`}
                        >
                          📅 Custom
                        </button>
                      </div>
                      {cngDateMode === "custom" && (
                        <input
                          type="date"
                          value={cngCustomDate}
                          onChange={(e) => setCngCustomDate(e.target.value)}
                          className="mt-2 w-full px-3 py-1.5 text-xs rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#18181c] text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#5D87FF]"
                        />
                      )}
                    </div>
                  </div>

                  {/* Row 2: Amount Input & Quick Shorthands */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                        Swipe Amount (₹)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCngAmountInput((prev) => (prev ? prev + "000" : "1000"))}
                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                        >
                          +000
                        </button>
                        <button
                          type="button"
                          onClick={() => setCngAmountInput("1000")}
                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                        >
                          1k
                        </button>
                        <button
                          type="button"
                          onClick={() => setCngAmountInput("1200")}
                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                        >
                          1.2k
                        </button>
                        <button
                          type="button"
                          onClick={() => setCngAmountInput("1500")}
                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                        >
                          1.5k
                        </button>
                        {cngAmountInput && (
                          <button
                            type="button"
                            onClick={() => setCngAmountInput("")}
                            className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-200 transition-all cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <input
                      type="text"
                      name="amounts"
                      value={cngAmountInput}
                      onChange={(e) => setCngAmountInput(e.target.value)}
                      placeholder="e.g. 1200 or 1200, 1150 (space/comma for batch entry)"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-[#121824] text-neutral-900 dark:text-neutral-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#5D87FF]"
                      required
                    />
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
                      💡 Enter single amount or batch separate with space/comma (e.g. <span className="font-mono text-neutral-600 dark:text-neutral-300">1200, 1150</span>) to log multiple fills at once.
                    </p>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 bg-[#5D87FF] hover:bg-[#4570EA] text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 text-xs"
                  >
                    <span>⛽</span>
                    <span>Log CNG Swipe for {cngSelectedBoy}</span>
                  </button>
                </Form>
              </div>

              {/* Cycle Log List */}
              <div className="bg-white dark:bg-[#18181c] rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📋</span>
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                      Cycle Swipes Log ({cngSwipesInCycle.length})
                    </h3>
                  </div>
                  <div className="text-xs font-mono font-semibold text-neutral-500 dark:text-neutral-400">
                    Cycle Total: ₹{cngCycleTotal.toLocaleString("en-IN")}
                  </div>
                </div>

                {cngSwipesInCycle.length === 0 ? (
                  <div className="p-8 text-center text-neutral-400 dark:text-neutral-500 text-xs">
                    No CNG card swipes logged in this cycle ({cngCycle.label}).
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {cngSwipesInCycle.map((s: any) => {
                      const swipeDate = new Date(s.timestamp);
                      const isBittu = s.senderName === "Bittu";
                      return (
                        <div
                          key={s.id}
                          className="p-3.5 flex items-center justify-between hover:bg-neutral-50/60 dark:hover:bg-neutral-850/40 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                                isBittu
                                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                                  : "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              }`}
                            >
                              {isBittu ? "B" : "G"}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                                  {s.senderName}
                                </span>
                                {s.settled ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                    ✅ Settled
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                    🟡 Unsettled (Card Bill)
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                                {swipeDate.toLocaleDateString("en-IN", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-sm font-bold font-mono text-neutral-900 dark:text-neutral-100">
                                ₹{(s.amount || 0).toLocaleString("en-IN")}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                triggerConfirm(
                                  "Delete CNG Swipe?",
                                  `Delete this ₹${(s.amount || 0).toLocaleString("en-IN")} CNG swipe for ${s.senderName}?`,
                                  () => {
                                    const fd = new FormData();
                                    fd.append("_action", "delete_cng_swipe");
                                    fd.append("id", s.id.toString());
                                    submit(fd, { method: "post" });
                                  }
                                );
                              }}
                              className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-all cursor-pointer"
                              title="Delete swipe"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {activeTab === "pending_dues" && (
            <div className="animate-fade-in space-y-6">
              {/* Header & Add Buttons */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
                    <span>🟡</span>
                    <span>Pending Dues & Liabilities Tracker</span>
                  </h1>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    Track money clients owe you (Receivables) and cash borrowed from friends/family (To Pay Back).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddPendingModal(true)}
                    className="notion-btn text-xs px-3.5 py-2.5 font-bold flex items-center gap-1.5 bg-[#13DEB9] hover:bg-[#0fbfa0] text-white rounded-xl shadow-sm transition-all cursor-pointer"
                  >
                    <span>🟢</span>
                    <span>+ Add Client Due</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddBorrowedModal(true)}
                    className="notion-btn text-xs px-3.5 py-2.5 font-bold flex items-center gap-1.5 bg-[#FA896B] hover:bg-[#e07153] text-white rounded-xl shadow-sm transition-all cursor-pointer"
                  >
                    <span>🤝</span>
                    <span>+ Add Borrowed Money</span>
                  </button>
                </div>
              </div>

              {/* Summary Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Card 1: To Receive (Receivables) */}
                <div
                  onClick={() => setPendingDueDirection("RECEIVE")}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-sm space-y-1.5 ${pendingDueDirection === "RECEIVE"
                      ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-500/40 ring-1 ring-emerald-500/30"
                      : "bg-white dark:bg-[#1e293b] border-neutral-200/80 dark:border-slate-800 hover:border-emerald-500/30"
                    }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                      🟢 Total To Receive (Bills & Dues)
                    </span>
                    {pendingDueDirection === "RECEIVE" && (
                      <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        Active Tab
                      </span>
                    )}
                  </div>
                  <span className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 block">
                    ₹{duesSummary.totalToReceive.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    {duesSummary.countToReceive} pending invoices (clients & vendors)
                  </span>
                </div>

                {/* Card 2: Borrowed / To Pay Back */}
                <div
                  onClick={() => setPendingDueDirection("BORROWED")}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-sm space-y-1.5 ${pendingDueDirection === "BORROWED"
                      ? "bg-rose-50/40 dark:bg-rose-950/20 border-rose-500/40 ring-1 ring-rose-500/30"
                      : "bg-white dark:bg-[#1e293b] border-neutral-200/80 dark:border-slate-800 hover:border-rose-500/30"
                    }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">
                      🔴 Borrowed / To Pay Back
                    </span>
                    {pendingDueDirection === "BORROWED" && (
                      <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-600 dark:text-rose-400">
                        Active Tab
                      </span>
                    )}
                  </div>
                  <span className="text-2xl font-extrabold font-mono text-rose-600 dark:text-rose-400 block">
                    ₹{duesSummary.totalBorrowedOwed.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                    {duesSummary.countBorrowed} active debts (friends, family & financiers)
                  </span>
                </div>

                {/* Card 3: Cleared & Settled */}
                <div className="p-4 rounded-2xl bg-white dark:bg-[#1e293b] border border-neutral-200/80 dark:border-slate-800 shadow-sm space-y-1.5">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                    ⚖️ Settled & Cleared Ledgers
                  </span>
                  <div className="flex items-center gap-3 font-mono font-bold text-sm">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +₹{duesSummary.totalReceived.toLocaleString("en-IN")} <span className="text-[10px] text-neutral-400 font-sans font-normal">received</span>
                    </span>
                    <span className="text-neutral-300 dark:text-slate-700">|</span>
                    <span className="text-rose-500">
                      -₹{duesSummary.totalBorrowedRepaid.toLocaleString("en-IN")} <span className="text-[10px] text-neutral-400 font-sans font-normal">repaid</span>
                    </span>
                  </div>
                  <span className="text-[11px] text-neutral-400 block">
                    Net pending: ₹{(duesSummary.totalToReceive - duesSummary.totalBorrowedOwed).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              {/* Direction Tabs & Status Filter */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                {/* Two Clear Sub-Modes / Filter Tabs */}
                <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-slate-800/60 rounded-xl border border-neutral-200/60 dark:border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDueDirection("RECEIVE");
                      setPendingFilterStatus("ALL");
                    }}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${pendingDueDirection === "RECEIVE"
                        ? "bg-white dark:bg-[#1e293b] text-emerald-600 dark:text-emerald-400 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
                      }`}
                  >
                    <span>🟢 To Receive (Bills & Dues)</span>
                    {duesSummary.countToReceive > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono">
                        {duesSummary.countToReceive}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPendingDueDirection("BORROWED");
                      setPendingFilterStatus("ALL");
                    }}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${pendingDueDirection === "BORROWED"
                        ? "bg-white dark:bg-[#1e293b] text-rose-600 dark:text-rose-400 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
                      }`}
                  >
                    <span>🔴 Borrowed / To Pay Back</span>
                    {duesSummary.countBorrowed > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/15 text-rose-600 dark:text-rose-400 font-mono">
                        {duesSummary.countBorrowed}
                      </span>
                    )}
                  </button>
                </div>

                {/* Secondary Status Filter Pills */}
                <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-slate-800/60 rounded-xl border border-neutral-200/60 dark:border-slate-700/50">
                  {(["ALL", "PENDING", "PAID"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setPendingFilterStatus(st)}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${pendingFilterStatus === st
                          ? "bg-white dark:bg-[#1e293b] text-neutral-900 dark:text-white shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
                        }`}
                    >
                      {st === "ALL" ? "All" : st === "PENDING" ? (pendingDueDirection === "RECEIVE" ? "Pending Only" : "Unpaid Only") : "Cleared / Done"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Invoices & Borrowed List */}
              {filteredPendingPayments.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-neutral-200 dark:border-slate-800 rounded-2xl bg-white/40 dark:bg-slate-900/20 space-y-3">
                  <span className="text-3xl block">{pendingDueDirection === "RECEIVE" ? "🟢" : "🤝"}</span>
                  <p className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                    {pendingDueDirection === "RECEIVE"
                      ? "No client receivable dues found in this view!"
                      : "No borrowed / friend debt records found in this view!"}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {pendingDueDirection === "RECEIVE"
                      ? "Click '+ Add Client Due' above to track pending client payments."
                      : "Click '+ Add Borrowed Money' to track cash borrowed from friends or family."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredPendingPayments.map((p: any) => {
                    const isBorrowed = isBorrowedItem(p);
                    const isFullyPaid = isBorrowed ? p.status === "BORROWED_PAID" : p.status === "PAID";
                    const isPartial = isBorrowed ? p.status === "BORROWED_PARTIAL" : p.status === "PARTIAL";
                    const remainingDue = Math.max(0, (p.totalAmount || 0) - (p.receivedAmount || 0));

                    return (
                      <div
                        key={p.id}
                        className={`p-5 rounded-2xl bg-white dark:bg-[#1e293b] border shadow-sm space-y-4 hover:shadow-md transition-all flex flex-col justify-between ${isFullyPaid
                            ? "border-emerald-500/30 bg-emerald-50/5 dark:bg-emerald-950/10"
                            : isBorrowed
                              ? "border-rose-500/30 hover:border-rose-500/60 bg-rose-50/5 dark:bg-rose-950/5"
                              : "border-amber-500/30 hover:border-amber-500/60"
                          }`}
                      >
                        <div className="space-y-3">
                          {/* Header info */}
                          <div className="flex justify-between items-start gap-2">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-slate-800 text-neutral-700 dark:text-neutral-300">
                                  {isBorrowed ? `👤 ${p.clientName || 'Friend/Family'}` : `🏢 ${p.clientName || 'Client'}`}
                                </span>
                                {isBorrowed && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400">
                                    Borrowed
                                  </span>
                                )}
                              </div>
                              <h3 className="text-base font-bold text-neutral-900 dark:text-white pt-1">
                                {p.title}
                              </h3>
                              {p.notes && p.notes !== p.title && (
                                <p className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-pre-line">
                                  {p.notes}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-neutral-400 pt-0.5">
                                <span>📅 Added: {new Date(p.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}</span>
                                {p.dueDate && (
                                  <span className={new Date(p.dueDate) < new Date() && !isFullyPaid ? "text-rose-500 font-bold" : ""}>
                                    🎯 Return by: {new Date(p.dueDate).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>

                            <span
                              className={`text-[10px] font-extrabold uppercase font-mono px-2.5 py-1 rounded-full border shrink-0 ${isFullyPaid
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : isPartial
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                    : isBorrowed
                                      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                }`}
                            >
                              {isFullyPaid
                                ? (isBorrowed ? "✅ Fully Repaid" : "✅ Cleared / Done")
                                : isPartial
                                  ? `🟡 Partial (₹${remainingDue.toLocaleString("en-IN")} left)`
                                  : (isBorrowed ? "🔴 To Pay Back" : "🟡 Pending")}
                            </span>
                          </div>

                          {/* Amount Breakdown Card */}
                          <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-slate-900/60 border border-neutral-100 dark:border-slate-800 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-semibold text-neutral-500">
                                {isBorrowed ? "Total Borrowed" : "Total Billed / Due"}
                              </span>
                              <span className="text-sm font-bold font-mono text-neutral-700 dark:text-neutral-300">
                                ₹{p.totalAmount.toLocaleString("en-IN")}
                              </span>
                            </div>

                            {(p.receivedAmount || 0) > 0 && (
                              <div className="flex justify-between items-center text-xs">
                                <span className="text-neutral-500">
                                  {isBorrowed ? "Repaid So Far" : "Collected So Far"}
                                </span>
                                <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">
                                  ₹{(p.receivedAmount || 0).toLocaleString("en-IN")}
                                </span>
                              </div>
                            )}

                            <div className="pt-1.5 border-t border-neutral-200/60 dark:border-slate-800 flex justify-between items-center">
                              <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                                {isFullyPaid
                                  ? "Final Status"
                                  : isBorrowed
                                    ? "Remaining Owed to Friend"
                                    : "Remaining to Collect"}
                              </span>
                              <span className={`text-lg font-extrabold font-mono ${isFullyPaid
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : isBorrowed
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-amber-600 dark:text-amber-400"
                                }`}>
                                {isFullyPaid ? "CLEARED" : `₹${remainingDue.toLocaleString("en-IN")}`}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="pt-3 border-t border-neutral-100 dark:border-slate-800/80 flex justify-between items-center text-xs">
                          <div>
                            {isFullyPaid ? (
                              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                <span>✨</span>
                                <span>{isBorrowed ? "Repayment Logged to Expenses" : "Recorded in Income Ledger"}</span>
                              </span>
                            ) : isBorrowed ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRepayingBorrowedItem(p);
                                  setRepayAmountInput(remainingDue.toString());
                                  setRepayNoteInput("");
                                }}
                                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                              >
                                <span>💸</span>
                                <span>Pay Back (₹{remainingDue.toLocaleString("en-IN")})</span>
                              </button>
                            ) : (
                              <Form method="post">
                                <input type="hidden" name="_action" value="mark_pending_received" />
                                <input type="hidden" name="id" value={p.id} />
                                <button
                                  type="submit"
                                  disabled={isSubmitting}
                                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  <span>✅</span>
                                  <span>Mark as Received & Add to Income</span>
                                </button>
                              </Form>
                            )}
                          </div>

                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (!confirm(`Are you sure you want to delete "${p.title}"?`)) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="_action" value="delete_pending_payment" />
                            <input type="hidden" name="id" value={p.id} />
                            <button
                              type="submit"
                              className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-all cursor-pointer"
                              title="Delete record"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </Form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* DRIVER SALARIES & ADVANCES HUB TAB VIEW */}
          {/* ========================================================================= */}
          {activeTab === "driver_salaries" && (
            <div className="animate-fade-in space-y-6">
              {/* Header & Month Selector */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[#edece9] dark:border-[#2f2f2f]">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
                    <span>💵</span>
                    <span>Driver Salaries & Advance Settlement Hub</span>
                  </h1>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    Calculate exact working day salary, auto-deduct cash advances taken during the month, settle with 1-click, and send WhatsApp slips!
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-neutral-500">Settlement Month:</span>
                  <input
                    type="month"
                    value={salaryMonthYear}
                    onChange={(e) => setSalaryMonthYear(e.target.value)}
                    className="notion-input px-3 py-1.5 text-xs font-bold rounded-lg border border-neutral-200 dark:border-slate-800 bg-white dark:bg-[#1e293b] text-neutral-800 dark:text-white outline-none cursor-pointer font-mono"
                  />
                </div>
              </div>

              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-neutral-200/70 dark:border-slate-800 shadow-sm space-y-1">
                  <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">Active Drivers</span>
                  <span className="text-xl font-extrabold font-mono text-neutral-900 dark:text-white">
                    {drivers.length}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-neutral-200/70 dark:border-slate-800 shadow-sm space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Base Salary Commitment</span>
                  <span className="text-xl font-extrabold font-mono text-neutral-900 dark:text-white">
                    ₹{drivers.reduce((s: number, d: any) => s + (d.salary || 16500), 0).toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-rose-200/80 dark:border-rose-500/20 bg-rose-50/20 dark:bg-rose-500/5 shadow-sm space-y-1">
                  <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wider block">Unsettled Advances</span>
                  <span className="text-xl font-extrabold font-mono text-rose-500">
                    ₹{driverSalaryReconciliation.reduce((s: number, r: any) => s + r.totalAdvances, 0).toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-[#1e293b] border border-emerald-200/80 dark:border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-500/5 shadow-sm space-y-1">
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">Est. Net Payable</span>
                  <span className="text-xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
                    ₹{driverSalaryReconciliation.reduce((s: number, r: any) => s + r.netPayable, 0).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              {/* Driver Reconciliation Interactive Grid */}
              <div className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                  Live Month-End Driver Payout Breakdown
                </h2>

                <div className="space-y-3">
                  {driverSalaryReconciliation.map((item: any) => (
                    <div
                      key={item.driver.id}
                      className="p-5 rounded-2xl bg-white dark:bg-[#1e293b] border border-neutral-200/80 dark:border-slate-800 shadow-sm space-y-4 transition-all hover:border-[#5D87FF]/40"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Driver Info */}
                        <div className="flex items-center gap-3.5">
                          <div className="w-11 h-11 rounded-full bg-[#ECF2FF] dark:bg-[#5D87FF]/15 text-[#5D87FF] font-extrabold text-base flex items-center justify-center border border-[#5D87FF]/20">
                            {item.driver.name.charAt(0)}
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                              <span>{item.driver.name}</span>
                              {item.driver.vehicleNumber && (
                                <span className="text-[10px] font-mono bg-neutral-100 dark:bg-slate-800 text-neutral-600 dark:text-slate-300 px-2 py-0.5 rounded font-bold">
                                  🛺 {item.driver.vehicleNumber}
                                </span>
                              )}
                            </h3>
                            <span className="text-xs text-neutral-400 font-mono">
                              📞 {item.driver.phone} • Base: ₹{item.baseSalary.toLocaleString("en-IN")}/mo (₹{item.dailyRate}/day)
                            </span>
                          </div>
                        </div>

                        {/* Working Days & Bonus Adjusters */}
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          {/* Days Worked */}
                          <div className="flex items-center gap-1.5 bg-neutral-50 dark:bg-slate-900/60 p-1.5 rounded-xl border border-neutral-200/70 dark:border-slate-800">
                            <span className="text-neutral-500 font-medium pl-1">Days:</span>
                            <input
                              type="number"
                              min="1"
                              max="31"
                              value={item.daysWorked}
                              onChange={(e) => {
                                const val = Math.min(31, Math.max(0, parseInt(e.target.value) || 0));
                                setDriverDaysWorkedMap((prev) => ({ ...prev, [item.driver.id]: val }));
                              }}
                              className="w-12 text-center font-bold font-mono bg-white dark:bg-slate-800 border border-neutral-200 dark:border-slate-700 rounded-md py-0.5 outline-none"
                            />
                            <span className="text-[10px] text-slate-400 pr-1">(= ₹{item.earnedSalary.toLocaleString("en-IN")})</span>
                          </div>

                          {/* Bonus */}
                          <div className="flex items-center gap-1 bg-emerald-500/5 p-1.5 rounded-xl border border-emerald-500/20">
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold pl-1">+Bonus:</span>
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={item.bonus || ""}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                setDriverBonusMap((prev) => ({ ...prev, [item.driver.id]: val }));
                              }}
                              className="w-16 text-center font-bold font-mono bg-white dark:bg-slate-800 border border-emerald-500/30 rounded-md py-0.5 outline-none text-emerald-600 dark:text-emerald-400"
                            />
                          </div>

                          {/* Un-deducted Advances */}
                          <div className="flex items-center gap-1.5 bg-rose-500/5 p-1.5 rounded-xl border border-rose-500/20">
                            <span className="text-rose-500 font-semibold pl-1">Advances:</span>
                            <button
                              type="button"
                              onClick={() => setViewingDriverAdvances(item)}
                              className="font-bold font-mono text-rose-500 hover:underline cursor-pointer flex items-center gap-1"
                              title="Click to view all advances"
                            >
                              <span>-₹{item.totalAdvances.toLocaleString("en-IN")}</span>
                              <span className="text-[9px] bg-rose-500/20 px-1 py-0.2 rounded font-mono">
                                {item.unSettledAdvances.length} slips 👁️
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Payout Calculation Bar & Actions */}
                      <div className="pt-3 border-t border-neutral-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">
                            Net Payable Payout:
                          </span>
                          <span className="text-xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
                            ₹{item.netPayable.toLocaleString("en-IN")}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* WhatsApp Slip Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSlipData(item);
                              setCopiedSlipText(false);
                            }}
                            className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                          >
                            <span>📱</span>
                            <span>WhatsApp Slip</span>
                          </button>

                          {/* Settle & Pay Button */}
                          <button
                            type="button"
                            onClick={() => setSettlingDriver(item)}
                            className="px-3.5 py-1.5 bg-[#5D87FF] hover:bg-[#4570EA] text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                          >
                            <span>💸</span>
                            <span>Settle & Pay Salary</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Past Settlements History */}
              {salarySettlements.length > 0 && (
                <div className="space-y-3 pt-6 border-t border-neutral-200 dark:border-slate-800">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
                    <span>📜</span>
                    <span>Recent Salary Settlement Vouchers ({salarySettlements.length})</span>
                  </h3>

                  <div className="rounded-2xl border border-neutral-200/80 dark:border-slate-800 bg-white dark:bg-[#1e293b] overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-neutral-50 dark:bg-slate-800/80 text-neutral-500 uppercase tracking-wider border-b border-neutral-200/80 dark:border-slate-800 font-mono">
                          <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Month</th>
                            <th className="p-3">Driver Name</th>
                            <th className="p-3">Days Worked</th>
                            <th className="p-3">Advances Deducted</th>
                            <th className="p-3">Net Paid</th>
                            <th className="p-3">Mode</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100 dark:divide-slate-800/60 font-medium text-neutral-700 dark:text-neutral-300">
                          {salarySettlements.map((s: any) => (
                            <tr key={s.id} className="hover:bg-neutral-50/50 dark:hover:bg-slate-800/40">
                              <td className="p-3 font-mono text-neutral-400">
                                {new Date(s.paymentDate).toLocaleDateString()}
                              </td>
                              <td className="p-3 font-mono font-bold text-[#5D87FF]">{s.monthYear}</td>
                              <td className="p-3 font-bold text-neutral-900 dark:text-white">{s.driverName}</td>
                              <td className="p-3 font-mono">{s.daysWorked} days</td>
                              <td className="p-3 font-mono text-rose-500">-₹{s.advancesDeducted.toLocaleString("en-IN")}</td>
                              <td className="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                ₹{s.netPaidAmount.toLocaleString("en-IN")}
                              </td>
                              <td className="p-3 font-mono text-[10px] uppercase font-bold text-slate-400">{s.paymentMode}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* MODAL 1: ADD PENDING CLIENT DUE (RECEIVABLE) */}
        {/* ========================================================================= */}
        {showAddPendingModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => setShowAddPendingModal(false)} />
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scale-up text-neutral-800 dark:text-neutral-200">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-100 dark:border-neutral-800">
                <h3 className="text-base font-bold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <span>🟢</span>
                  <span>Add Client Pending Due</span>
                </h3>
                <button type="button" onClick={() => setShowAddPendingModal(false)} className="text-neutral-400 hover:text-neutral-600 cursor-pointer">✕</button>
              </div>

              <Form method="post" onSubmit={() => setShowAddPendingModal(false)} className="space-y-4 text-xs">
                <input type="hidden" name="_action" value="create_pending_payment" />

                <div className="space-y-1.5">
                  <label className="font-bold text-neutral-700 dark:text-neutral-300">
                    Client / Company Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="clientName"
                    required
                    autoFocus
                    placeholder="e.g. Shadowfax, Flipkart, Factory A"
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-semibold text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="font-bold text-neutral-700 dark:text-neutral-300">
                      Pending Due Amount (₹ INR) <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-neutral-400">Type "15k" or "+000"</span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-neutral-400 font-bold text-sm pointer-events-none select-none">₹</span>
                    <input
                      type="text"
                      name="amount"
                      required
                      placeholder="e.g. 15,000 or 15k"
                      value={pendingAmountInput}
                      onChange={(e) => setPendingAmountInput(e.target.value)}
                      onBlur={() => {
                        const parsed = parseKAmount(pendingAmountInput);
                        if (parsed > 0) setPendingAmountInput(parsed.toString());
                      }}
                      style={{ paddingLeft: "34px", paddingRight: "64px" }}
                      className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-bold text-lg text-emerald-600 dark:text-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const curr = parseKAmount(pendingAmountInput);
                        if (curr > 0) setPendingAmountInput((curr * 1000).toString());
                        else if (pendingAmountInput && !isNaN(Number(pendingAmountInput))) setPendingAmountInput(pendingAmountInput + "000");
                      }}
                      className="absolute right-1.5 px-2 py-1 text-[10px] font-extrabold rounded bg-[#13DEB9]/15 hover:bg-[#13DEB9]/25 text-[#13DEB9] border border-[#13DEB9]/30 transition-all cursor-pointer"
                    >
                      +000
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-neutral-700 dark:text-neutral-300">
                    Invoice / Bill Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="title"
                    required
                    placeholder="e.g. October 45-Day Deliveries Settlement"
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-medium text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-400">
                    Additional Details / Notes (Optional)
                  </label>
                  <textarea
                    name="notes"
                    rows={2}
                    placeholder="Any extra details, invoice number, or reminder dates..."
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none text-xs"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddPendingModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-neutral-100 dark:bg-slate-800 font-bold hover:bg-neutral-200 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#13DEB9] hover:bg-[#0fbfa0] text-white font-bold shadow-sm transition-all cursor-pointer"
                  >
                    🟢 Save Client Due
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL 2: ADD BORROWED MONEY FROM FRIEND / FAMILY / BYAAJ */}
        {/* ========================================================================= */}
        {showAddBorrowedModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => setShowAddBorrowedModal(false)} />
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scale-up text-neutral-800 dark:text-neutral-200">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-100 dark:border-neutral-800">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2 text-rose-600 dark:text-rose-400">
                    <span>🤝</span>
                    <span>Add Borrowed Money (Friend / Family)</span>
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                    Track money borrowed for cashflow. You can pay back in full or partial anytime.
                  </p>
                </div>
                <button type="button" onClick={() => setShowAddBorrowedModal(false)} className="text-neutral-400 hover:text-neutral-600 cursor-pointer">✕</button>
              </div>

              <Form method="post" onSubmit={() => setShowAddBorrowedModal(false)} className="space-y-3.5 text-xs">
                <input type="hidden" name="_action" value="create_borrowed_due" />

                <div className="space-y-1.5">
                  <label className="font-bold text-neutral-700 dark:text-neutral-300">
                    Lender / Friend Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="lenderName"
                    required
                    autoFocus
                    value={borrowedLender}
                    onChange={(e) => setBorrowedLender(e.target.value)}
                    placeholder="e.g. Rahul (Friend), Papa, Sharma Ji (Byaaj)"
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-semibold text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="font-bold text-neutral-700 dark:text-neutral-300">
                      Amount Borrowed (₹ INR) <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-neutral-400">Type "20k" or "+000"</span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-neutral-400 font-bold text-sm pointer-events-none select-none">₹</span>
                    <input
                      type="text"
                      name="amount"
                      required
                      placeholder="e.g. 20,000 or 20k"
                      value={borrowedAmountInput}
                      onChange={(e) => setBorrowedAmountInput(e.target.value)}
                      onBlur={() => {
                        const parsed = parseKAmount(borrowedAmountInput);
                        if (parsed > 0) setBorrowedAmountInput(parsed.toString());
                      }}
                      style={{ paddingLeft: "34px", paddingRight: "64px" }}
                      className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-bold text-lg text-rose-600 dark:text-rose-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const curr = parseKAmount(borrowedAmountInput);
                        if (curr > 0) setBorrowedAmountInput((curr * 1000).toString());
                        else if (borrowedAmountInput && !isNaN(Number(borrowedAmountInput))) setBorrowedAmountInput(borrowedAmountInput + "000");
                      }}
                      className="absolute right-1.5 px-2 py-1 text-[10px] font-extrabold rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/30 transition-all cursor-pointer"
                    >
                      +000
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-neutral-700 dark:text-neutral-300">
                    Reason / Purpose <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="reason"
                    required
                    value={borrowedReason}
                    onChange={(e) => setBorrowedReason(e.target.value)}
                    placeholder="e.g. CNG cashflow & emergency auto tyre replacement"
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-medium text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-600 dark:text-neutral-400">
                    Expected Return Date (Optional)
                  </label>
                  <input
                    type="date"
                    name="returnDate"
                    value={borrowedReturnDate}
                    onChange={(e) => setBorrowedReturnDate(e.target.value)}
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-semibold text-xs cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-medium text-neutral-400">
                    Notes / Remarks (Optional)
                  </label>
                  <input
                    type="text"
                    name="notes"
                    value={borrowedNotes}
                    onChange={(e) => setBorrowedNotes(e.target.value)}
                    placeholder="e.g. Promised to return after Shadowfax payout"
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none text-xs"
                  />
                </div>

                {/* Log to Cashflow Income Checkbox */}
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-50 dark:bg-slate-900/80 border border-neutral-200/80 dark:border-slate-800 cursor-pointer hover:bg-neutral-100/60 transition-colors">
                  <input
                    type="checkbox"
                    name="logCashflow"
                    checked={borrowedLogCashflow}
                    onChange={(e) => setBorrowedLogCashflow(e.target.checked)}
                    className="mt-0.5 rounded text-[#5D87FF] focus:ring-0 cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block">
                      Log this borrowed cash as Money IN on Cashflow Ledger today
                    </span>
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block leading-tight">
                      Records an INCOME entry so your cash-in-hand matches your wallet.
                    </span>
                  </div>
                </label>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddBorrowedModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-neutral-100 dark:bg-slate-800 font-bold hover:bg-neutral-200 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#FA896B] hover:bg-[#e07153] text-white font-bold shadow-sm transition-all cursor-pointer"
                  >
                    🤝 Save Borrowed Debt
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL 3: REPAY BORROWED MONEY (PARTIAL OR FULL) */}
        {/* ========================================================================= */}
        {repayingBorrowedItem && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => setRepayingBorrowedItem(null)} />
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scale-up text-neutral-800 dark:text-neutral-200">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-100 dark:border-neutral-800">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2 text-rose-600 dark:text-rose-400">
                    <span>💸</span>
                    <span>Pay Back Friend / Family</span>
                  </h3>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                    Lender: <strong>{repayingBorrowedItem.clientName}</strong> ({repayingBorrowedItem.title})
                  </p>
                </div>
                <button type="button" onClick={() => setRepayingBorrowedItem(null)} className="text-neutral-400 hover:text-neutral-600 cursor-pointer">✕</button>
              </div>

              {/* Debt Snapshot */}
              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-slate-900/60 border border-neutral-100 dark:border-slate-800 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Total Borrowed:</span>
                  <span className="font-mono font-bold">₹{repayingBorrowedItem.totalAmount.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Already Repaid:</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ₹{(repayingBorrowedItem.receivedAmount || 0).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-neutral-200/60 dark:border-slate-800 flex justify-between items-center">
                  <span className="font-bold text-neutral-800 dark:text-neutral-200">Current Balance Owed:</span>
                  <span className="font-mono font-extrabold text-base text-rose-600 dark:text-rose-400">
                    ₹{Math.max(0, repayingBorrowedItem.totalAmount - (repayingBorrowedItem.receivedAmount || 0)).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              <Form method="post" onSubmit={() => setRepayingBorrowedItem(null)} className="space-y-4 text-xs">
                <input type="hidden" name="_action" value="repay_borrowed_payment" />
                <input type="hidden" name="id" value={repayingBorrowedItem.id} />

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="font-bold text-neutral-700 dark:text-neutral-300">
                      Amount to Pay Back (₹ INR) <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-neutral-400">Full or Partial</span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-neutral-400 font-bold text-sm pointer-events-none select-none">₹</span>
                    <input
                      type="text"
                      name="amountToRepay"
                      required
                      autoFocus
                      value={repayAmountInput}
                      onChange={(e) => setRepayAmountInput(e.target.value)}
                      onBlur={() => {
                        const parsed = parseKAmount(repayAmountInput);
                        if (parsed > 0) setRepayAmountInput(parsed.toString());
                      }}
                      style={{ paddingLeft: "34px", paddingRight: "64px" }}
                      className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-bold text-lg text-emerald-600 dark:text-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const curr = parseKAmount(repayAmountInput);
                        if (curr > 0) setRepayAmountInput((curr * 1000).toString());
                        else if (repayAmountInput && !isNaN(Number(repayAmountInput))) setRepayAmountInput(repayAmountInput + "000");
                      }}
                      className="absolute right-1.5 px-2 py-1 text-[10px] font-extrabold rounded bg-[#13DEB9]/15 hover:bg-[#13DEB9]/25 text-[#13DEB9] border border-[#13DEB9]/30 transition-all cursor-pointer"
                    >
                      +000
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    Remaining balance: ₹{Math.max(0, repayingBorrowedItem.totalAmount - (repayingBorrowedItem.receivedAmount || 0)).toLocaleString("en-IN")}. You can repay in full or make a partial payment.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-neutral-700 dark:text-neutral-300">
                    Payment Method / Note (Optional)
                  </label>
                  <input
                    type="text"
                    name="note"
                    value={repayNoteInput}
                    onChange={(e) => setRepayNoteInput(e.target.value)}
                    placeholder="e.g. Paid via PhonePe UPI / Cash"
                    className="notion-input w-full p-2.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-medium text-xs"
                  />
                </div>

                <div className="p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <span>⚡</span>
                  <span>This payment will automatically log an <strong>Expense</strong> in your Cashflow Ledger and generate a short WhatsApp receipt.</span>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRepayingBorrowedItem(null)}
                    className="flex-1 py-2.5 rounded-xl bg-neutral-100 dark:bg-slate-800 font-bold hover:bg-neutral-200 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>💸</span>
                    <span>Confirm Pay Back</span>
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}



        {/* ========================================================================= */}
        {/* MODAL: VIEW DRIVER ADVANCE SLIPS */}
        {/* ========================================================================= */}
        {viewingDriverAdvances && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => setViewingDriverAdvances(null)} />
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scale-up text-neutral-800 dark:text-neutral-200">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-100 dark:border-neutral-800">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2 text-rose-500">
                    <span>⚠️</span>
                    <span>Advance Slips: {viewingDriverAdvances.driver.name}</span>
                  </h3>
                  <span className="text-xs text-neutral-400 font-mono">
                    Total: ₹{viewingDriverAdvances.totalAdvances.toLocaleString("en-IN")} ({viewingDriverAdvances.unSettledAdvances.length} entries)
                  </span>
                </div>
                <button type="button" onClick={() => setViewingDriverAdvances(null)} className="text-neutral-400 hover:text-neutral-600">✕</button>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {viewingDriverAdvances.unSettledAdvances.map((adv: any) => (
                  <div key={adv.id} className="p-3 rounded-xl bg-neutral-50 dark:bg-slate-900/60 border border-neutral-100 dark:border-slate-800 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-neutral-900 dark:text-white">
                        ₹{adv.amount.toLocaleString("en-IN")}
                      </div>
                      <div className="text-neutral-400 text-[11px] font-sans">
                        {adv.notes || "Advance payment"}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      {new Date(adv.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setViewingDriverAdvances(null)}
                  className="w-full py-2 bg-neutral-100 dark:bg-slate-800 font-bold rounded-xl text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL: CONFIRM SALARY SETTLEMENT */}
        {/* ========================================================================= */}
        {settlingDriver && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => setSettlingDriver(null)} />
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scale-up text-neutral-800 dark:text-neutral-200">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-100 dark:border-neutral-800">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <span>💸</span>
                    <span>Confirm Salary Payout</span>
                  </h3>
                  <span className="text-xs text-neutral-400">
                    {settlingDriver.driver.name} • {salaryMonthYear}
                  </span>
                </div>
                <button type="button" onClick={() => setSettlingDriver(null)} className="text-neutral-400 hover:text-neutral-600">✕</button>
              </div>

              {/* Breakdown */}
              <div className="p-4 rounded-xl bg-neutral-50 dark:bg-slate-900/60 border border-neutral-100 dark:border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Days Worked:</span>
                  <span className="font-mono font-bold">{settlingDriver.daysWorked} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Earned Base Pay:</span>
                  <span className="font-mono font-bold">₹{settlingDriver.earnedSalary.toLocaleString("en-IN")}</span>
                </div>
                {settlingDriver.bonus > 0 && (
                  <div className="flex justify-between text-emerald-500 font-bold">
                    <span>Bonus:</span>
                    <span className="font-mono">+₹{settlingDriver.bonus.toLocaleString("en-IN")}</span>
                  </div>
                )}
                {settlingDriver.totalAdvances > 0 && (
                  <div className="flex justify-between text-rose-500 font-bold">
                    <span>Less Advances ({settlingDriver.unSettledAdvances.length} slips):</span>
                    <span className="font-mono">-₹{settlingDriver.totalAdvances.toLocaleString("en-IN")}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-neutral-200 dark:border-slate-700 flex justify-between text-sm font-extrabold">
                  <span>Net Payable:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">₹{settlingDriver.netPayable.toLocaleString("en-IN")}</span>
                </div>
              </div>

              <Form method="post" onSubmit={() => setSettlingDriver(null)} className="space-y-3 text-xs">
                <input type="hidden" name="_action" value="settle_driver_salary" />
                <input type="hidden" name="driverName" value={settlingDriver.driver.name} />
                <input type="hidden" name="driverPhone" value={settlingDriver.driver.phone || ""} />
                <input type="hidden" name="monthYear" value={salaryMonthYear} />
                <input type="hidden" name="baseSalary" value={settlingDriver.baseSalary} />
                <input type="hidden" name="daysWorked" value={settlingDriver.daysWorked} />
                <input type="hidden" name="earnedSalary" value={settlingDriver.earnedSalary} />
                <input type="hidden" name="advancesDeducted" value={settlingDriver.totalAdvances} />
                <input type="hidden" name="bonusAmount" value={settlingDriver.bonus} />
                <input type="hidden" name="otherDeductions" value={settlingDriver.customDeductions} />
                <input type="hidden" name="netPaidAmount" value={settlingDriver.netPayable} />
                <input type="hidden" name="advanceIds" value={JSON.stringify(settlingDriver.unSettledAdvances.map((a: any) => a.id))} />

                <div className="space-y-1">
                  <label className="font-semibold text-neutral-500">Payment Mode</label>
                  <select name="paymentMode" className="notion-input w-full p-2 rounded-lg border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none font-bold">
                    <option value="CASH">💵 Cash</option>
                    <option value="UPI">📱 UPI / PhonePe / GPay</option>
                    <option value="BANK_TRANSFER">🏦 Bank Transfer</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-neutral-500">Notes (Optional)</label>
                  <input type="text" name="notes" placeholder="e.g. Cleared full month salary" className="notion-input w-full p-2 rounded-lg border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 outline-none" />
                </div>

                <div className="pt-2 flex gap-2">
                  <button type="button" onClick={() => setSettlingDriver(null)} className="flex-1 py-2 rounded-xl bg-neutral-100 dark:bg-slate-800 font-bold">Cancel</button>
                  <button type="submit" className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm">Confirm & Settle</button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL: WHATSAPP SALARY SLIP SHARE */}
        {/* ========================================================================= */}
        {selectedSlipData && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => setSelectedSlipData(null)} />
            <div className="relative bg-white dark:bg-[#18181c] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-scale-up text-neutral-800 dark:text-neutral-200">
              <div className="flex justify-between items-center pb-3 border-b border-neutral-100 dark:border-neutral-800">
                <h3 className="text-base font-bold flex items-center gap-2 text-emerald-600">
                  <span>📱</span>
                  <span>WhatsApp Salary Slip</span>
                </h3>
                <button type="button" onClick={() => setSelectedSlipData(null)} className="text-neutral-400 hover:text-neutral-600">✕</button>
              </div>

              <div className="p-4 rounded-xl bg-neutral-900 text-emerald-400 font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-inner max-h-72 overflow-y-auto">
                {generateWhatsAppSlipText(selectedSlipData)}
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generateWhatsAppSlipText(selectedSlipData));
                    setCopiedSlipText(true);
                    setTimeout(() => setCopiedSlipText(false), 3000);
                  }}
                  className="flex-1 py-2.5 bg-neutral-100 dark:bg-slate-800 font-bold rounded-xl text-xs hover:bg-neutral-200 transition-all cursor-pointer"
                >
                  {copiedSlipText ? "✅ Copied to Clipboard!" : "📋 Copy Slip Text"}
                </button>

                <a
                  href={`https://wa.me/?text=${encodeURIComponent(generateWhatsAppSlipText(selectedSlipData))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all text-center flex items-center justify-center gap-1 shadow-sm"
                >
                  <span>💬</span>
                  <span>Send on WhatsApp</span>
                </a>
              </div>
            </div>
          </div>
        )}


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

              {isEditingDriver ? (
                <Form method="post" className="p-5 space-y-4">
                  <input type="hidden" name="_action" value="update_driver" />
                  <input type="hidden" name="id" value={selectedDriverProfile.id} />

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Delivery Boy Name</label>
                    <input
                      type="text"
                      name="name"
                      required
                      value={editDriverName}
                      onChange={(e) => setEditDriverName(e.target.value)}
                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Phone Number</label>
                    <input
                      type="tel"
                      name="phone"
                      required
                      value={editDriverPhone}
                      onChange={(e) => setEditDriverPhone(e.target.value)}
                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Monthly Salary (₹)</label>
                    <input
                      type="number"
                      name="salary"
                      value={editDriverSalary}
                      onChange={(e) => setEditDriverSalary(e.target.value)}
                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-800 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-neutral-500">Auto Assignment</label>
                    <select
                      name="vehicleNumber"
                      value={editDriverVehicle}
                      onChange={(e) => setEditDriverVehicle(e.target.value)}
                      className="notion-input w-full text-sm border border-neutral-200 dark:border-neutral-800 rounded-md px-3 py-2 bg-transparent text-neutral-850 dark:text-neutral-100 focus:ring-1 focus:ring-[#5D87FF] outline-none text-neutral-850 dark:text-neutral-100"
                    >
                      <option value="" className="text-neutral-800 dark:text-neutral-900">None</option>
                      {autos?.map((a: any) => (
                        <option key={a.id} value={a.plateNumber} className="text-neutral-800 dark:text-neutral-900">
                          {a.plateNumber} ({a.modelName || "N/A"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-4 flex gap-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {isSubmitting ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingDriver(false)}
                      className="flex-1 py-2 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-md text-xs font-bold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </Form>
              ) : (
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#ECF2FF] dark:bg-[#5D87FF]/10 flex items-center justify-center text-lg font-bold text-[#5D87FF] border border-[#5D87FF]/20 flex-shrink-0">
                      {selectedDriverProfile.name?.charAt(0) || "J"}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-neutral-855 dark:text-neutral-100">
                        {selectedDriverProfile.name || "John Driver"}
                      </h4>
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-450 flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                        Active & On Duty
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs space-y-2.5 text-neutral-500 dark:text-neutral-400">
                    <div className="flex justify-between">
                      <span>Contact Phone:</span>
                      <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                        {selectedDriverProfile.phone || "+91 88888 88888"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Vehicle Number:</span>
                      <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                        {selectedDriverProfile.vehicleNumber || (
                          <span className="text-amber-500 font-semibold italic">Not Set</span>
                        )}
                      </span>
                    </div>
                    {selectedDriverProfile.salary && (
                      <div className="flex justify-between">
                        <span>Monthly Salary:</span>
                        <span className="font-bold text-neutral-750 dark:text-neutral-300">
                          ₹{selectedDriverProfile.salary.toLocaleString()}/mo
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Driver Expense History */}
                  {(() => {
                    const driverExpenses = expenses.filter((exp: any) => exp.senderName === selectedDriverProfile.name);
                    return (
                      <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
                        <h5 className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest text-left">
                          Recent Transaction History (Max 3)
                        </h5>
                        {driverExpenses.length === 0 ? (
                          <div className="text-center py-4 text-[11px] text-neutral-400 italic">
                            No transactions logged for this driver.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 scrollbar-none">
                              {driverExpenses.slice(0, 3).map((exp: any) => (
                                <div key={exp.id} className="flex justify-between items-center text-[11px] p-2 bg-neutral-50 dark:bg-neutral-900/60 rounded border border-neutral-100 dark:border-neutral-800">
                                  <div className="space-y-0.5 text-left">
                                    <div className="font-semibold text-neutral-700 dark:text-neutral-200">
                                      {exp.category === "fuel" && "⛽ "}
                                      {exp.category === "bittu" && "👤 "}
                                      {exp.category === "service" && "🔧 "}
                                      {exp.category === "other" && "📦 "}
                                      <span className="capitalize">{exp.category}</span>
                                    </div>
                                    <div className="text-neutral-450 dark:text-neutral-400 font-sans text-[10px] truncate max-w-[200px]" title={exp.notes}>
                                      {exp.notes}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-bold text-neutral-800 dark:text-neutral-100">
                                      ₹{exp.amount.toLocaleString()}
                                    </div>
                                    <div className="text-[9px] text-neutral-400">
                                      {new Date(exp.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {driverExpenses.length > 0 && (
                              <div className="pt-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedDriverProfile(null);
                                    setActiveTab("expenses");
                                    setShowExpenseDashboard(true);
                                    setEntityFilter(`DRIVER:${selectedDriverProfile.name}`);
                                  }}
                                  className="text-xs font-bold text-[#5D87FF] hover:underline flex items-center justify-center gap-1 mx-auto"
                                >
                                  🔍 View All in Ledger ({driverExpenses.length})
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="pt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingDriver(true)}
                      className="w-full py-2 bg-[#5D87FF] hover:bg-[#4570EA] text-white rounded-md text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      ✏️ Edit Profile & Auto
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected Auto Profile Modal Overlay */}


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
                      Install Dreamline App
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
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${editingExpense.type === "EXPENSE"
                          ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-950 dark:text-white"
                          : "text-neutral-500 hover:text-neutral-700"
                        }`}
                    >
                      Expense
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingExpense({ ...editingExpense, type: "INCOME", category: "shadowfax" })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${editingExpense.type === "INCOME"
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

        {/* WhatsApp Bulk Chat Importer Modal */}
        {showWhatsAppImporter && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto animate-scale-up">
              {/* Header */}
              <div className="flex justify-between items-center border-b border-neutral-100 dark:border-neutral-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">💬</span>
                  <div>
                    <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                      WhatsApp Group Chat Importer
                    </h3>
                    <p className="text-[11px] text-neutral-450 dark:text-neutral-400">
                      Instant 0ms local regex parser for weekly payouts, voice expense logs & driver advances
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWhatsAppImporter(false)}
                  className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 font-bold text-lg cursor-pointer"
                >
                  ×
                </button>
              </div>

              {/* Chat Text Input Area */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
                    Paste WhatsApp Messages or Chat Export (.txt)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRawWhatsAppChat(SAMPLE_WHATSAPP_CHAT);
                        const msgs = parseWhatsAppChat(SAMPLE_WHATSAPP_CHAT);
                        const txs = detectTransactions(msgs);
                        setDetectedWhatsAppTxs(txs);
                      }}
                      className="px-2.5 py-1 text-[11px] font-bold rounded bg-[#13DEB9]/15 hover:bg-[#13DEB9]/25 text-[#13DEB9] border border-[#13DEB9]/30 transition-all cursor-pointer"
                    >
                      ✨ Try Sample Chat
                    </button>
                    <label className="px-2.5 py-1 text-[11px] font-bold rounded bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 border border-neutral-200/80 dark:border-neutral-700 cursor-pointer">
                      📁 Upload .txt
                      <input
                        type="file"
                        accept=".txt"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                              const text = (evt.target?.result as string) || "";
                              setRawWhatsAppChat(text);
                              const msgs = parseWhatsAppChat(text);
                              const txs = detectTransactions(msgs);
                              setDetectedWhatsAppTxs(txs);
                            };
                            reader.readAsText(file);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={rawWhatsAppChat}
                  onChange={(e) => {
                    const text = e.target.value;
                    setRawWhatsAppChat(text);
                    if (text.trim()) {
                      const msgs = parseWhatsAppChat(text);
                      const txs = detectTransactions(msgs);
                      setDetectedWhatsAppTxs(txs);
                    } else {
                      setDetectedWhatsAppTxs([]);
                    }
                  }}
                  placeholder="Paste WhatsApp messages here, e.g.:
[01/10, 12:37 pm] Sumit Morya: Earning 
Vandor 1 :- 3031 
Vandor 2 :- 2903
Per order :- 5955
[01/10, 12:44 pm] Sumit: Expenses 
- 20k bill payments 
- 12k commission to manager"
                  className="notion-textarea w-full text-xs font-mono border border-neutral-200 dark:border-neutral-800 rounded-xl p-3 bg-neutral-50/50 dark:bg-neutral-900/50 text-neutral-800 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-[#13DEB9]"
                />
              </div>

              {/* Detected Transactions Checklist */}
              {detectedWhatsAppTxs.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                        Detected Entries ({detectedWhatsAppTxs.filter(t => t.selected).length}/{detectedWhatsAppTxs.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = detectedWhatsAppTxs.every(t => t.selected);
                          setDetectedWhatsAppTxs(prev => prev.map(t => ({ ...t, selected: !allSelected })));
                        }}
                        className="text-[10px] font-bold text-[#5D87FF] hover:underline cursor-pointer"
                      >
                        {detectedWhatsAppTxs.every(t => t.selected) ? "Deselect All" : "Select All"}
                      </button>
                    </div>
                    <span className="text-xs font-extrabold text-[#13DEB9]">
                      Total: ₹{detectedWhatsAppTxs.filter(t => t.selected).reduce((sum, t) => sum + (t.totalAmount || 0), 0).toLocaleString("en-IN")}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {detectedWhatsAppTxs.map((tx) => (
                      <div
                        key={tx.id}
                        onClick={() => {
                          setDetectedWhatsAppTxs(prev =>
                            prev.map(t => (t.id === tx.id ? { ...t, selected: !t.selected } : t))
                          );
                        }}
                        className={`p-3 rounded-xl border text-xs transition-all cursor-pointer flex items-start gap-3 select-none ${tx.selected
                            ? "bg-[#13DEB9]/10 border-[#13DEB9]/40 text-neutral-850 dark:text-neutral-100"
                            : "bg-neutral-50/50 dark:bg-neutral-900/30 border-neutral-200/60 dark:border-neutral-800/60 opacity-60"
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={tx.selected}
                          onChange={() => { }} // Handled by container onClick
                          className="mt-0.5 rounded text-[#13DEB9] focus:ring-[#13DEB9] cursor-pointer"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-bold flex items-center gap-1.5">
                              {tx.type === "earning" && "💰"}
                              {tx.type === "expense" && "💸"}
                              {tx.type === "staff_advance" && "👤"}
                              <span>{tx.summary}</span>
                            </span>
                            <span className="font-extrabold text-sm">
                              {tx.type === "earning" ? "+" : "-"} ₹{tx.totalAmount.toLocaleString("en-IN")}
                            </span>
                          </div>
                          <div className="text-[10px] text-neutral-450 dark:text-neutral-400 flex items-center gap-2">
                            <span>📅 {tx.date}</span>
                            <span>•</span>
                            <span>👤 {tx.sender}</span>
                          </div>

                          {/* Breakdown preview */}
                          {tx.type === "earning" && tx.earningDetails && (
                            <div className="text-[10px] bg-white/60 dark:bg-black/30 rounded p-1.5 font-mono space-y-0.5 text-neutral-600 dark:text-neutral-300">
                              <div>Vendor 1: ₹{tx.earningDetails.vendor1Net} {tx.earningDetails.vendor1TDS > 0 ? `(Gross: ${tx.earningDetails.vendor1Gross} - TDS: ${tx.earningDetails.vendor1TDS})` : ""}</div>
                              <div>Vendor 2: ₹{tx.earningDetails.vendor2}</div>
                              <div>Per Order: ₹{tx.earningDetails.perOrder}</div>
                              {tx.earningDetails.extra > 0 && <div>Extra: ₹{tx.earningDetails.extra}</div>}
                            </div>
                          )}

                          {tx.type === "expense" && tx.expenseDetails && (
                            <div className="text-[10px] bg-white/60 dark:bg-black/30 rounded p-1.5 font-mono space-y-0.5 text-neutral-600 dark:text-neutral-300">
                              {tx.expenseDetails.rows.map((row, rIdx) => (
                                <div key={rIdx} className="flex justify-between">
                                  <span>• {row.note || row.category}</span>
                                  <span className="font-bold">₹{row.amount}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Submit to Prisma */}
                  <Form method="post" className="pt-2">
                    <input type="hidden" name="_action" value="import_whatsapp_transactions" />
                    <input
                      type="hidden"
                      name="transactions"
                      value={JSON.stringify(detectedWhatsAppTxs.filter(t => t.selected))}
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting || detectedWhatsAppTxs.filter(t => t.selected).length === 0}
                      className="w-full py-3 bg-[#13DEB9] hover:bg-[#0fbfa0] text-white font-bold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <span>💾</span>
                      <span>
                        Save {detectedWhatsAppTxs.filter(t => t.selected).length} Selected to Cloud Ledger
                      </span>
                    </button>
                  </Form>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2-Button WhatsApp Share Modal */}
        {whatsappShareModal.isOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-scale-up">
              {/* Header */}
              <div className="flex justify-between items-center border-b border-neutral-100 dark:border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">✅</span>
                  <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                    {whatsappShareModal.title || "WhatsApp Sync Note"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setWhatsappShareModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 font-bold text-lg cursor-pointer"
                >
                  ×
                </button>
              </div>

              {/* Formatted Text Preview */}
              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/70 border border-neutral-200/80 dark:border-neutral-800 max-h-56 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap text-neutral-800 dark:text-neutral-200 leading-relaxed">
                  {whatsappShareModal.text}
                </pre>
              </div>

              {/* 2 Big Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleCopyShareText(whatsappShareModal.text)}
                  className="py-2.5 px-3 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 font-bold rounded-xl border border-neutral-200/80 dark:border-neutral-700 transition-all cursor-pointer flex items-center justify-center gap-1.5 text-xs shadow-sm"
                >
                  <span>{copiedShareText ? "✅" : "📋"}</span>
                  <span>{copiedShareText ? "Copied!" : "Copy Text"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenWhatsApp(whatsappShareModal.text)}
                  className="py-2.5 px-3 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 text-xs shadow-md"
                >
                  <span>💬</span>
                  <span>Send to WhatsApp</span>
                </button>
              </div>
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
                <div className={`p-2.5 rounded-xl ${customDialog.type === "confirm"
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
        {/* Mobile Bottom Navigation Bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#18181c]/95 backdrop-blur-md border-t border-neutral-200 dark:border-neutral-800 px-2 py-1.5 flex items-center justify-around pb-safe shadow-lg">
          <button
            type="button"
            onClick={() => switchTab("expenses")}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-all cursor-pointer ${
              activeTab === "expenses"
                ? "text-[#5D87FF] font-bold"
                : "text-neutral-500 dark:text-neutral-400 font-medium hover:text-neutral-700 dark:hover:text-neutral-200"
            }`}
          >
            <span className="text-base">💸</span>
            <span className="text-[10px]">Cashflow</span>
          </button>

          <button
            type="button"
            onClick={() => switchTab("cng_card")}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-all cursor-pointer relative ${
              activeTab === "cng_card"
                ? "text-[#5D87FF] font-bold"
                : "text-neutral-500 dark:text-neutral-400 font-medium hover:text-neutral-700 dark:hover:text-neutral-200"
            }`}
          >
            <div className="relative">
              <span className="text-base">⛽</span>
              {cngUnpaidTotal > 0 && (
                <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-orange-500" />
              )}
            </div>
            <span className="text-[10px]">CNG Card</span>
          </button>

          {loggedInUser?.role !== "DRIVER" && (
            <button
              type="button"
              onClick={() => switchTab("pending_dues")}
              className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-all cursor-pointer relative ${
                activeTab === "pending_dues"
                  ? "text-[#5D87FF] font-bold"
                  : "text-neutral-500 dark:text-neutral-400 font-medium hover:text-neutral-700 dark:hover:text-neutral-200"
              }`}
            >
              <div className="relative">
                <span className="text-base">🟡</span>
                {pendingDuesSummary.totalPending > 0 && (
                  <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-amber-500" />
                )}
              </div>
              <span className="text-[10px]">Pending</span>
            </button>
          )}

          {loggedInUser?.role !== "DRIVER" && (
            <button
              type="button"
              onClick={() => switchTab("driver_salaries")}
              className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-all cursor-pointer ${
                activeTab === "driver_salaries"
                  ? "text-[#5D87FF] font-bold"
                  : "text-neutral-500 dark:text-neutral-400 font-medium hover:text-neutral-700 dark:hover:text-neutral-200"
              }`}
            >
              <span className="text-base">💵</span>
              <span className="text-[10px]">Salaries</span>
            </button>
          )}
        </nav>
      </main>
    </div>
  );
}
