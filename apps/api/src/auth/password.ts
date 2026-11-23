import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const HASH_BYTES = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, HASH_BYTES, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (
    algorithm !== "scrypt" ||
    !/^[\da-f]{32}$/i.test(saltHex ?? "") ||
    !/^[\da-f]{128}$/i.test(hashHex ?? "") ||
    !password
  ) return false;

  const expected = Buffer.from(hashHex!, "hex");
  const actual = await derive(password, Buffer.from(saltHex!, "hex"));
  return timingSafeEqual(expected, actual);
}
