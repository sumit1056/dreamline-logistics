import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [expenses, autos, users, admins] = await Promise.all([
    prisma.expense.deleteMany({}),
    prisma.auto.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.adminCredential.deleteMany({}),
  ]);

  console.log(`✅ Wiped:`);
  console.log(`   Expenses:    ${expenses.count}`);
  console.log(`   Autos:       ${autos.count}`);
  console.log(`   Users:       ${users.count}`);
  console.log(`   Admin Creds: ${admins.count}`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
