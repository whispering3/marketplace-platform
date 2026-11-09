export function assertDemoSeedAllowed(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === "production" || env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Demo seed requires a disposable local database and ALLOW_DEMO_SEED=true outside production.");
  }
  const url = new URL(env.DATABASE_URL || "");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^(market|olympus)_(demo|test)(_[a-z0-9_]+)?$/.test(database)
    || env.DEMO_DATABASE_NAME !== database) {
    throw new Error("Demo seed requires a local market_demo/market_test database and matching DEMO_DATABASE_NAME.");
  }
}
