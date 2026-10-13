import { startQueue } from "@job/backend";

// Connection to the job queues (pg-boss), opened on first use. The API only sends jobs;
// the job collector's worker processes them.
let queue: ReturnType<typeof startQueue> | null = null;

export function getQueue() {
  queue ??= startQueue(undefined, { sendOnly: true }).catch((error) => {
    queue = null;
    throw error;
  });
  return queue;
}

export async function stopQueue(): Promise<void> {
  if (!queue) return;
  const current = queue;
  queue = null;
  await (await current).stop({ graceful: false });
}
