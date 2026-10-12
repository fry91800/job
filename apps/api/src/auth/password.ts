import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// Argon2id with the OWASP minimum parameters (19 MiB, 2 passes, 1 lane), stored as a
// standard PHC string so other tools can read it and parameters can change later:
// $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>   (base64 without padding)
const params = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

function argon2id(password: string, salt: Buffer, options: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, ...options }, (error, hash) => (error ? reject(error) : resolve(hash)));
  });
}

const b64 = (buffer: Buffer) => buffer.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2id(password, salt, params);
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!match) return false;
  const [, memory, passes, parallelism, salt, hash] = match;
  const expected = Buffer.from(hash, "base64");
  const actual = await argon2id(password, Buffer.from(salt, "base64"), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

// Spends the same time as a real check, so a login with an unknown email cannot be told
// apart from a wrong password by its response time.
const dummyHash = hashPassword("dummy-password-for-timing");
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(await dummyHash, password);
}
