import "server-only";

import { createMessage, encrypt, readKey } from "openpgp";

export async function validatePgpEncryptionPublicKey(armoredKey: string) {
  if (!armoredKey || armoredKey.length > 32768) return false;
  try {
    const publicKey = await readKey({ armoredKey });
    if (publicKey.isPrivate()) return false;
    await encrypt({
      message: await createMessage({ text: "PGP encryption capability check" }),
      encryptionKeys: publicKey,
    });
    return true;
  } catch {
    return false;
  }
}
