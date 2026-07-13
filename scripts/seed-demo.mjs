import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

async function main() {
  console.log("🌱 Seeding demo data...");

  // 1. Create Admins
  const adminCount = await prisma.adminCredential.count();
  if (adminCount === 0) {
    await prisma.adminCredential.create({
      data: {
        username: "sumit@6969",
        passwordHash: hashPassword("sumitdream6969"),
      },
    });
    console.log("  - Created Default Admin: sumit@6969");
  }

  // 2. Clear existing demo users/autos
  await prisma.user.deleteMany({ where: { role: "DRIVER" } });
  await prisma.auto.deleteMany({});
  console.log("  - Cleared existing delivery boys and autos");

  // 3. Create Delivery Boys
  const driver1 = await prisma.user.create({
    data: {
      name: "Amit Sharma",
      phone: "+919876543210",
      role: "DRIVER",
      passwordHash: hashPassword("pass123"),
      passwordText: "pass123",
      vehicleNumber: "MH-12-PQ-4567",
      salary: 15000,
      loginEnabled: true,
    },
  });

  const driver2 = await prisma.user.create({
    data: {
      name: "Rahul Verma",
      phone: "+919876543211",
      role: "DRIVER",
      passwordHash: hashPassword("pass456"),
      passwordText: "pass456",
      vehicleNumber: "MH-12-RS-8901",
      salary: 16000,
      loginEnabled: true,
    },
  });

  const driver3 = await prisma.user.create({
    data: {
      name: "Vijay Kumar",
      phone: "+919876543212",
      role: "DRIVER",
      passwordHash: hashPassword("pass789"),
      passwordText: "pass789",
      vehicleNumber: null,
      salary: 14500,
      loginEnabled: false,
    },
  });

  console.log("  - Created 3 Delivery Boys");

  // 4. Create Autos
  await prisma.auto.create({
    data: {
      plateNumber: "MH-12-PQ-4567",
      modelName: "Piaggio Ape",
      ownerName: "Self",
      driverPhone: driver1.phone,
    },
  });

  await prisma.auto.create({
    data: {
      plateNumber: "MH-12-RS-8901",
      modelName: "Bajaj RE",
      ownerName: "Rented",
      driverPhone: driver2.phone,
    },
  });

  await prisma.auto.create({
    data: {
      plateNumber: "MH-12-XY-1234",
      modelName: "Mahindra Treo",
      ownerName: "Vendor",
      driverPhone: null,
    },
  });

  console.log("  - Created 3 Autos");
  console.log("✅ Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
