import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { createMessage, decrypt, readMessage, readPrivateKey, sign } from "openpgp";

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Local PGP helper is disabled in production.");
  const operation = process.argv[2];
  const account = process.argv[3];
  const decryptAccounts = ["buyer", "vendor", "admin", "moderator"];
  if (!["decrypt", "sign"].includes(operation) || !decryptAccounts.includes(account) || (operation === "sign" && !["admin", "moderator"].includes(account))) {
    throw new Error("Usage: npm run local:test:pgp -- decrypt <buyer|vendor|admin|moderator> OR sign <admin|moderator>");
  }
  const armoredInput = await readStdin();
  if (!armoredInput) throw new Error("Pipe the armored PGP message or staff challenge through stdin.");
  const privateKey = await readPrivateKey({ armoredKey: await readFile(`.local-test/${account}-private-key.asc`, "utf8") });

  if (operation === "decrypt") {
    const message = await readMessage({ armoredMessage: armoredInput });
    const result = await decrypt({ message, decryptionKeys: privateKey });
    process.stdout.write(String(result.data).trim() + "\n");
    return;
  }

  const signature = await sign({ message: await createMessage({ text: armoredInput }), signingKeys: privateKey, detached: true });
  process.stdout.write(signature);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
