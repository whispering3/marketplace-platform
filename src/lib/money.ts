import { Prisma } from "@prisma/client";

Prisma.Decimal.set({ precision: 40 });
const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_DOWN });
export type MoneyInput = Prisma.Decimal | string | number;

/** XMR has 12 decimal places. Round calculated fractions down to whole atomic units. */
export function money(value: MoneyInput): Prisma.Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("InvalidMoneyAmount");
  return result.toDecimalPlaces(12, Decimal.ROUND_DOWN);
}

/** Validate user input without silently rounding it or accepting exponent notation. */
export function parseMoney(value: string): Prisma.Decimal {
  if (!/^-?\d{1,18}(\.\d{1,12})?$/.test(value)) throw new Error("InvalidMoneyAmount");
  return money(value);
}

export function toPiconero(value: MoneyInput): bigint {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.decimalPlaces() > 12) throw new Error("InvalidMoneyAmount");
  return BigInt(decimal.mul("1000000000000").toFixed(0));
}

export function fromPiconero(value: bigint): Prisma.Decimal {
  return new Decimal(value.toString()).div("1000000000000");
}

export function atomicUnitsToXmr(value: string | number): Prisma.Decimal {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("UnsafeAtomicAmount");
  if (!/^\d+$/.test(String(value))) throw new Error("InvalidAtomicAmount");
  return fromPiconero(BigInt(value));
}
