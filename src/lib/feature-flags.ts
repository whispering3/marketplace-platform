import "server-only";
import { prisma } from "./db";

const envFlag = (key: string): boolean | null => {
  const value = process.env[`FEATURE_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  if (value === undefined) return null;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export async function isFeatureEnabled(key: string, fallback = false): Promise<boolean> {
  const override = envFlag(key);
  if (override !== null) return override;

  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return flag?.enabled ?? fallback;
  } catch {
    return fallback;
  }
}

export async function requireFeature(key: string): Promise<void> {
  if (!(await isFeatureEnabled(key))) {
    throw new Error(`FeatureDisabled:${key}`);
  }
}
