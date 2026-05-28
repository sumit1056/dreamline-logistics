-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "category" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "vehicle" TEXT,
    "senderName" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'EXPENSE'
);
INSERT INTO "new_Expense" ("amount", "approved", "category", "currency", "id", "imageUrl", "notes", "senderName", "timestamp", "vehicle") SELECT "amount", "approved", "category", "currency", "id", "imageUrl", "notes", "senderName", "timestamp", "vehicle" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
