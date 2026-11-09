import { digestAuthorization } from "./http-digest";
import { toPiconero, atomicUnitsToXmr, type MoneyInput } from "./money";
export { toPiconero, fromPiconero, atomicUnitsToXmr } from "./money";
/**
 * OLYMPUS MARKET - MONERO RPC INTEGRATION
 * This module connects to the local monero-wallet-rpc daemon.
 * For production, this daemon must be running strictly on 127.0.0.1
 * and firewalled from the outside world.
 */

const RPC_URL = process.env.XMR_RPC_URL || "http://127.0.0.1:18082/json_rpc";
const RPC_USER = process.env.XMR_RPC_USER || "";
const RPC_PASS = process.env.XMR_RPC_PASS || "";
const RPC_TIMEOUT_MS = Number(process.env.XMR_RPC_TIMEOUT_MS || "10000");

export type MoneroSubaddress = {
  address: string;
  addressIndex: number;
};

export type MoneroIncomingTransfer = {
  txid?: string;
  tx_hash?: string;
  amount: number | string;
  confirmations?: number;
  unlocked?: boolean;
  address?: string;
  subaddr_index?: {
    major?: number;
    minor?: number;
  };
};

export async function callRpc(method: string, params?: any) {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const body = JSON.stringify({ jsonrpc: "2.0", id: "olympus", method, params });
  const signal = AbortSignal.timeout(Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 10000);
  const send = () => fetch(RPC_URL, { method: "POST", headers, signal, body, redirect: "error", cache: "no-store" });
  let response = await send();
  // Retry only an explicit authentication rejection, never a timeout or a daemon error.
  if (response.status === 401 && RPC_USER && RPC_PASS) {
    const challenge = response.headers.get("www-authenticate") || "";
    await response.body?.cancel();
    const url = new URL(RPC_URL);
    headers["Authorization"] = digestAuthorization(challenge, {
      username: RPC_USER, password: RPC_PASS, method: "POST", uri: url.pathname + url.search,
    });
    response = await send();
  }

  if (!response.ok) {
    throw new Error(`Monero RPC Error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Monero RPC Daemon Error: ${data.error.message}`);
  }

  return data.result;
}

/**
 * XMR ATOMIC UNIT CONVERSION (Piconero)
 * 1 XMR = 1e12 Piconero
 * We use BigInt to avoid floating point precision issues in calculations.
 */
export const PICONERO_RATIO = BigInt(1e12);

function toAtomicNumber(amount: MoneyInput): number {
  const atomicAmount = toPiconero(amount);
  const asNumber = Number(atomicAmount);

  if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
    throw new Error("Invalid or unsafe Monero amount");
  }

  return asNumber;
}

/**
 * Creates a unique subaddress for a user to deposit XMR.
 */
export async function createSubaddress(label: string): Promise<MoneroSubaddress> {
  // account_index 0 is the primary account. We generate endless subaddresses under it.
  const result = await callRpc("create_address", {
    account_index: 0,
    label,
  });
  const addressIndex = Number(result.address_index);

  if (!result.address || !Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new Error("Monero RPC returned an invalid subaddress payload");
  }

  return {
    address: result.address,
    addressIndex,
  };
}

/**
 * Checks balance and incoming transfers for a specific subaddress indexing.
 * Warning: Typically requires iterating `get_transfers` to find incoming to specific subaddress indices.
 */
export async function getTransfersForAddress(addressIndex: number) {
  const result = await callRpc("get_transfers", {
    in: true,
    account_index: 0,
    subaddr_indices: [addressIndex],
  });
  return result.in || [];
}

export async function getIncomingTransfersForSubaddresses(addressIndexes: number[]): Promise<MoneroIncomingTransfer[]> {
  if (addressIndexes.length === 0) return [];

  const result = await callRpc("get_transfers", {
    in: true,
    pool: true,
    account_index: 0,
    subaddr_indices: addressIndexes,
  });

  return [...(result.in || []), ...(result.pool || [])];
}

export async function validateMoneroAddress(address: string): Promise<boolean> {
  const result = await callRpc("validate_address", {
    address,
    any_net_type: false,
    allow_openalias: false,
  });

  return Boolean(result.valid);
}

/**
 * Executes a transfer from the primary account (0) to an external address.
 */
export async function transferWithReceipt(address: string, amount: MoneyInput) {
  const result = await callRpc("transfer", {
    destinations: [{ address, amount: toAtomicNumber(amount) }],
    account_index: 0,
    priority: 1,
  });

  if (typeof result?.tx_hash !== "string" || !/^[a-f0-9]{64}$/i.test(result.tx_hash)) throw new Error("InvalidTransferResponse");
  const networkFeeXMR = atomicUnitsToXmr(result.fee);
  if (networkFeeXMR.lt(0)) throw new Error("InvalidNetworkFee");
  return { txHash: result.tx_hash as string, networkFeeXMR };
}

export async function transferToExternal(address: string, amount: MoneyInput): Promise<string> {
  return (await transferWithReceipt(address, amount)).txHash;
}

export async function verifyOutgoingTransfer(hash: string, address: string, amount: MoneyInput) {
  const result = await callRpc("get_transfer_by_txid", { txid: hash, account_index: 0 });
  const transfer = result?.transfer;
  if (!transfer || transfer.txid !== hash || transfer.type !== "out" || !Number.isSafeInteger(transfer.confirmations) || transfer.confirmations < 1) return false;
  if (!Array.isArray(transfer.destinations) || transfer.destinations.length !== 1) return false;
  const destination = transfer.destinations[0];
  if (destination.address !== address || !Number.isSafeInteger(destination.amount) || BigInt(destination.amount) !== toPiconero(amount)) return false;
  const networkFeeXMR = atomicUnitsToXmr(transfer.fee);
  return networkFeeXMR.gte(0) ? { networkFeeXMR } : false;
}

/**
 * AUTO-SWEEP LOGIC: Consolidates funds to the main account index 0 address 0.
 * In a real scenario, we use sweep_all with subaddr_indices.
 */
export async function sweepAllFromSubaddress(subaddrIndex: number): Promise<string[]> {
  // 1. Get the master address for account 0
  const addrResult = await callRpc("get_address", { account_index: 0, address_index: 0 });
  const masterAddress = addrResult.address;

  // 2. Sweep all from the specific subaddress index
  // Note: monero-wallet-rpc sweep_all sweeps funds from the entire account if not restricted.
  // We use the destinations and subaddr_indices for precision.
  const result = await callRpc("sweep_all", {
    address: masterAddress,
    account_index: 0,
    subaddr_indices: [subaddrIndex],
    priority: 1,
  });

  return result.tx_hash_list || [];
}
