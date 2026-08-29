require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const recentExpenses = await prisma.expense.findMany({
    orderBy: { timestamp: "desc" },
    take: 15
  });
  console.log("Recent 15 Expenses:");
  console.log(JSON.stringify(recentExpenses.map(e => ({
    id: e.id,
    amount: e.amount,
    category: e.category,
    senderName: e.senderName,
    notes: e.notes,
    settled: e.settled,
    type: e.type,
    timestamp: e.timestamp
  })), null, 2));

  const drivers = await prisma.user.findMany({
    where: { role: "DRIVER" }
  });
  console.log("Drivers in DB:");
  console.log(JSON.stringify(drivers.map(d => ({ id: d.id, name: d.name, phone: d.phone })), null, 2));
}

main().finally(() => prisma.$disconnect());
