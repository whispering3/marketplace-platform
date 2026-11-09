import { requiredProductionEnv } from "@/lib/env";
import { redirect } from "next/navigation";

export default function LegacyAdminTicketsRedirect() {
  redirect(`/${requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev")}?tab=support`);
}
