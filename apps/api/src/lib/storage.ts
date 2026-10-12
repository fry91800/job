import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { config } from "../config";

// File storage (DATABASE.md "File storage"). Local-disk driver; an S3 driver can be added
// behind the same functions. Keys: {kind}/{userId}/{uuid}.{ext}

function pathFor(key: string): string {
  const root = resolve(config.storage.localDir);
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error(`Invalid storage key: ${key}`);
  return path;
}

export function newStorageKey(kind: string, userId: string, extension: string): string {
  return `${kind}/${userId}/${randomUUID()}.${extension}`;
}

export async function putFile(key: string, data: Buffer): Promise<void> {
  const path = pathFor(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(pathFor(key));
}

export async function deleteFile(key: string): Promise<void> {
  await rm(pathFor(key), { force: true });
}
