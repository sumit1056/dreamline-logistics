const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding realistic demo data for Dreamline Logistics...");

  // 1. Create or ensure Driver: Bittu
  let bittu = await prisma.user.findFirst({
    where: { phone: "9876543210" }
  });

  if (!bittu) {
    const passwordHash = crypto.createHash("sha256").update("bittu123").digest("hex");
    bittu = await prisma.user.create({
      data: {
        name: "Bittu",
        phone: "9876543210",
        role: "DRIVER",
        salary: 16500,
        vehicleNumber: "MH-12-DL-1056",
        passwordHash,
        passwordText: "bittu123",
        loginEnabled: true,
      }
    });
    console.log("✅ Created Driver: Bittu (₹16,500/mo)");
  } else {
    bittu = await prisma.user.update({
      where: { id: bittu.id },
      data: { salary: 16500, vehicleNumber: "MH-12-DL-1056" }
    });
    console.log("ℹ️ Updated Driver: Bittu");
  }

  // 2. Create or ensure Driver: Rahul
  let rahul = await prisma.user.findFirst({
    where: { phone: "9876500001" }
  });

  if (!rahul) {
    const passwordHash = crypto.createHash("sha256").update("rahul123").digest("hex");
    rahul = await prisma.user.create({
      data: {
        name: "Rahul Kumar",
        phone: "9876500001",
        role: "DRIVER",
        salary: 18000,
        vehicleNumber: "MH-12-AB-4567",
        passwordHash,
        passwordText: "rahul123",
        loginEnabled: true,
      }
    });
    console.log("✅ Created Driver: Rahul Kumar (₹18,000/mo)");
  }

  // 3. Ensure Autos exist
  const auto1 = await prisma.auto.findFirst({ where: { plateNumber: "MH-12-DL-1056" } });
  if (!auto1) {
    await prisma.auto.create({
      data: {
        plateNumber: "MH-12-DL-1056",
        modelName: "Piaggio Ape Auto Plus",
        ownerName: "Company Owned",
        driverPhone: "9876543210"
      }
    });
  }

  const auto2 = await prisma.auto.findFirst({ where: { plateNumber: "MH-12-AB-4567" } });
  if (!auto2) {
    await prisma.auto.create({
      data: {
        plateNumber: "MH-12-AB-4567",
        modelName: "Bajaj Maxima Z",
        ownerName: "Self Rented",
        driverPhone: "9876500001"
      }
    });
  }

  // 4. Create Unsettled Advances for Bittu & Rahul
  await prisma.expense.createMany({
    data: [
      {
        amount: 2000,
        category: "bittu",
        notes: "Bittu cash advance for personal expense",
        senderName: "Bittu",
        vehicle: "MH-12-DL-1056",
        type: "EXPENSE",
        approved: true,
        settled: false,
        timestamp: new Date("2026-08-08T10:30:00Z"),
      },
      {
        amount: 1500,
        category: "bittu",
        notes: "Bittu advance for vehicle maintenance & parts",
        senderName: "Bittu",
        vehicle: "MH-12-DL-1056",
        type: "EXPENSE",
        approved: true,
        settled: false,
        timestamp: new Date("2026-08-16T14:15:00Z"),
      },
      {
        amount: 800,
        category: "bittu",
        notes: "Bittu emergency fuel cash advance",
        senderName: "Bittu",
        vehicle: "MH-12-DL-1056",
        type: "EXPENSE",
        approved: true,
        settled: false,
        timestamp: new Date("2026-08-22T18:45:00Z"),
      },
      {
        amount: 2500,
        category: "bittu",
        notes: "Rahul Kumar cash advance for home needs",
        senderName: "Rahul Kumar",
        vehicle: "MH-12-AB-4567",
        type: "EXPENSE",
        approved: true,
        settled: false,
        timestamp: new Date("2026-08-12T11:00:00Z"),
      },
    ]
  });
  console.log("✅ Created 4 Unsettled Cash Advance Entries (Total Bittu: ₹4,300, Rahul: ₹2,500)");

  // 5. Create Sample Pending Dues
  await prisma.pendingPayment.createMany({
    data: [
      {
        title: "Factory A - August Deliveries Final Payment",
        clientName: "Factory A Logistics",
        totalAmount: 35000,
        receivedAmount: 0,
        status: "PENDING",
        notes: "August monthly dispatch balance payment pending from accounts manager.",
      },
      {
        title: "Shadowfax Vendor Weekly Batch Payout",
        clientName: "Shadowfax Partner",
        totalAmount: 18500,
        receivedAmount: 0,
        status: "PENDING",
        notes: "Week 33 invoice remittance expected by Monday.",
      }
    ]
  });
  console.log("✅ Created 2 Sample Pending Dues (₹35,000 and ₹18,500)");

  console.log("🎉 All Demo Data successfully seeded into Neon DB!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
