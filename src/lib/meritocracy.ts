export const XP_PER_01_XMR_BUYER = 50;
export const XP_PER_01_XMR_VENDOR = 100;

export function calculateLevel(xp: number): number {
  if (xp < 1000) return 1;
  if (xp < 3000) return 2;
  if (xp < 7000) return 3;
  if (xp < 15000) return 4;
  if (xp < 30000) return 5;
  if (xp < 70000) return 6;
  if (xp < 150000) return 7;
  if (xp < 300000) return 8;
  if (xp < 600000) return 9;
  return 10; // Max Legendary Level
}

export function calculateVendorLevelFromSales(completedSales: number): number {
  if (completedSales >= 1200) return 10;
  if (completedSales >= 750) return 9;
  if (completedSales >= 400) return 8;
  if (completedSales >= 200) return 7;
  if (completedSales >= 100) return 6;
  if (completedSales >= 60) return 5;
  if (completedSales >= 30) return 4;
  if (completedSales >= 15) return 3;
  if (completedSales >= 5) return 2;
  return 1;
}

export function getBadgesForUser(role: string, level: number): string[] {
  const badges: string[] = [];

  if (role === "BUYER") {
    if (level >= 2) badges.push("[SILVER BUYER]");
    if (level >= 4) badges.push("[WHALE]");
    if (level >= 6) badges.push("[SOVEREIGN COLLECTOR]");
  } else if (role === "VENDOR") {
    if (level >= 2) badges.push("[TRUSTED SOURCE]");
    if (level >= 4) badges.push("[HIGH-VOLUME DEALER]");
    if (level >= 6) badges.push("[INDUSTRY LEGEND]");
  }

  return badges;
}
