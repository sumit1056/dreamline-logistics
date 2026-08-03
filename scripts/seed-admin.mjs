import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  const hash = crypto.createHash("sha256").update("sumitdream6969").digest("hex");
  await prisma.adminCredential.upsert({
    where: { username: "sumit@6969" },
    update: {},
    create: {
      username: "sumit@6969",
      passwordHash: hash,
    },
  });
  console.log("✅ Admin credential verified/created: sumit@6969");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
