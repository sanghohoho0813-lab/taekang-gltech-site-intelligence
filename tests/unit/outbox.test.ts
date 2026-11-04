import { describe, expect, it } from "vitest";
import { CommandError } from "@/lib/data/commands";
import { flushWith, type OutboxItem, type OutboxStore } from "@/lib/browser/outbox";

function memStore(items: OutboxItem[]): OutboxStore & { items: Map<string, OutboxItem> } {
  const m = new Map(items.map((i) => [i.id, i]));
  return { items: m, all: async () => [...m.values()], put: async (i) => void m.set(i.id, i), remove: async (id) => void m.delete(id) };
}
const item = (id: string, at: string, userId = "u-field"): OutboxItem => ({ id, userId, name: "submitFieldReport", args: { idempotencyKey: id }, label: id, createdAt: at, tries: 0 });

describe("보내지 못한 보고함", () => {
  it("오래된 것부터 보내고, 보내면 지운다", async () => {
    const s = memStore([item("b", "2026-11-04T02:00:00Z"), item("a", "2026-11-04T01:00:00Z")]);
    const order: string[] = [];
    const r = await flushWith(s, "u-field", async (_n, args) => void order.push(String(args.idempotencyKey)));
    expect(order).toEqual(["a", "b"]);
    expect(r).toEqual({ sent: 2, failed: 0, waiting: 0, offline: false });
    expect(s.items.size).toBe(0);
  });

  it("아직 인터넷이 안 되면 멈추고 그대로 보관 (시도 횟수만 늘림)", async () => {
    const s = memStore([item("a", "2026-11-04T01:00:00Z"), item("b", "2026-11-04T02:00:00Z")]);
    let calls = 0;
    const r = await flushWith(s, "u-field", async () => {
      calls += 1;
      throw new CommandError("서버에 연결할 수 없습니다.", "NETWORK");
    });
    expect(calls).toBe(1);
    expect(r).toMatchObject({ sent: 0, waiting: 2, offline: true });
    expect(s.items.get("a")!.tries).toBe(1);
  });

  it("끊기기 직전에 이미 저장된 보고(중복 응답)는 보낸 것으로 처리", async () => {
    const s = memStore([item("a", "2026-11-04T01:00:00Z")]);
    const r = await flushWith(s, "u-field", async () => {
      throw new CommandError("이미 저장된 요청입니다.", "DUPLICATE");
    });
    expect(r.sent).toBe(1);
    expect(s.items.size).toBe(0);
  });

  it("서버가 거부한 보고는 이유와 함께 남겨 사람이 판단 (다음 보고는 계속 보냄)", async () => {
    const s = memStore([item("a", "2026-11-04T01:00:00Z"), item("b", "2026-11-04T02:00:00Z")]);
    const r = await flushWith(s, "u-field", async (_n, args) => {
      if (args.idempotencyKey === "a") throw new CommandError("담당 현장에만 보고할 수 있습니다.", "STATE");
    });
    expect(r).toMatchObject({ sent: 1, failed: 1, waiting: 0 });
    expect(s.items.get("a")!.failed).toContain("담당 현장");
    // 실패한 것은 다시 자동으로 보내지 않는다
    let again = 0;
    await flushWith(s, "u-field", async () => void (again += 1));
    expect(again).toBe(0);
  });

  it("로그인이 풀렸으면 멈추고 보관 (다시 로그인하면 이어서)", async () => {
    const s = memStore([item("a", "2026-11-04T01:00:00Z")]);
    const r = await flushWith(s, "u-field", async () => {
      throw new CommandError("로그인이 필요합니다.", "STATE");
    });
    expect(r).toMatchObject({ offline: true, waiting: 1 });
    expect(s.items.get("a")!.failed).toBeUndefined();
  });

  it("같은 휴대폰을 쓰는 다른 사람의 보관 보고는 보내지 않는다", async () => {
    const s = memStore([item("a", "2026-11-04T01:00:00Z", "u-field2")]);
    let calls = 0;
    await flushWith(s, "u-field", async () => void (calls += 1));
    expect(calls).toBe(0);
    expect(s.items.size).toBe(1);
  });
});
