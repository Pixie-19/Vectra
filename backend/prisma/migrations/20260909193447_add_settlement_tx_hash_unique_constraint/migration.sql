/*
  Warnings:

  - A unique constraint covering the columns `[transactionHash]` on the table `Settlement` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Settlement_transactionHash_key" ON "Settlement"("transactionHash");
