import type { AiJsonRequest, AiProvider } from "./provider";

// Test double: answers come from handlers set by the test, per task name. No network.
export type FakeHandler = (request: AiJsonRequest) => unknown;

export class FakeProvider implements AiProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  handlers: Record<string, FakeHandler> = {};
  requests: AiJsonRequest[] = [];

  // Sets one task's handler for the duration of `run`, then restores the previous one.
  async with<T>(task: string, handler: FakeHandler, run: () => Promise<T>): Promise<T> {
    const previous = this.handlers[task];
    this.handlers[task] = handler;
    try {
      return await run();
    } finally {
      this.handlers[task] = previous;
    }
  }

  async generateJson(request: AiJsonRequest): Promise<string> {
    this.requests.push(request);
    const handler = this.handlers[request.task];
    if (!handler) throw new Error(`FakeProvider: no handler for task "${request.task}"`);
    const answer = await handler(request);
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }
}
