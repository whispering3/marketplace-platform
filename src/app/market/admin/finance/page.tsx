import { requiredProductionEnv } from "@/lib/env";
import { redirect } from "next/navigation";

export default function LegacyAdminFinanceRedirect() {
  redirect(`/${requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev")}?tab=wallets`);
}
