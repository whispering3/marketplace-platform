import { prisma } from "../src/lib/db";
import "dotenv/config";
import { syncIncomingDeposits } from "../src/lib/wallet-sync";

async function main() {
  const result = await syncIncomingDeposits();
  console.log(JSON.stringify(result, null, 2));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error);
  process.exit(1);
});
