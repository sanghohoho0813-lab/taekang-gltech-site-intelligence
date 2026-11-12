import { describe, expect, it } from "vitest";
import { CommandError } from "@/lib/data/commands";
import { flushWith, makeFlusher, type OutboxItem, type OutboxStore } from "@/lib/browser/outbox";

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

  it("끊긴 채 시작한 보내기가 도는 중에 ‘연결됨’ 신호가 오면 끝난 뒤 바로 한 번 더 보낸다 (30초 기다리지 않음)", async () => {
    const s = memStore([item("a", "2026-11-04T01:00:00Z")]);
    let online = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    let done = 0;
    const flush = makeFlusher(s, () => (done += 1));
    let started!: () => void;
    const sending = new Promise<void>((r) => (started = r));
    const runner = async () => {
      calls += 1;
      const sentOnline = online; // 요청을 보낸 그 순간의 연결 상태
      if (calls === 1) {
        started();
        await gate; // 끊긴 상태의 첫 시도가 아직 응답을 기다리는 중
      }
      if (!sentOnline) throw new CommandError("서버에 연결할 수 없습니다.", "NETWORK");
    };
    const first = flush("u-field", runner);
    await sending;
    // 신호가 잡힘 → ‘연결됨’으로 다시 부름 (같은 시도에 합쳐짐)
    online = true;
    const second = flush("u-field", runner);
    expect(second).toBe(first);
    release();
    const r = await first;
    expect(calls).toBe(2);
    expect(r).toMatchObject({ sent: 1, waiting: 0, offline: false });
    expect(s.items.size).toBe(0);
    expect(done).toBe(1);
    // 다시 부르는 일이 없으면 한 번만 보낸다
    const s2 = memStore([item("b", "2026-11-04T01:00:00Z")]);
    let c2 = 0;
    await makeFlusher(s2)("u-field", async () => void (c2 += 1));
    expect(c2).toBe(1);
  });
});

