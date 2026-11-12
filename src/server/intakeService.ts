/**
 * 하자 접수 링크 (D-74) — 로그인하지 않은 사람이 쓰는 서버 경로.
 *
 * - 접수 주소(/r/…): 그 현장에 하자 접수 한 건을 만들 수 있을 뿐, 아무것도 읽지 못한다 (회사·건물 이름·회사 전화번호만 보인다).
 * - 진행 확인 주소(/r/s/…): 그 접수 한 건의 진행·회신·보수 사진만. 주소는 해시로 찾는다.
 * - 접수·확인·다시 접수는 명령과 같은 길로 저장한다: 회사 잠금 → 최신 데이터 → 순수 함수 → 차이 저장 → 본사 알림.
 *   (로그인한 사용자가 없으므로 실행자는 "system")
 * - 틀린 입력은 회사 데이터를 읽기 전에 거절한다 (checkIntakeInput).
 */
import type { DefectIntake, DemoDB, PartnerRequest, Site, WorkOrder } from "@/lib/domain/types";
import { INTAKE_DAILY_LIMIT, INTAKE_STATUS_RE, INTAKE_TOKEN_RE, intakeState, intakeStatusView, tokenHash, type IntakeFormView, type IntakeStatusView } from "@/lib/domain/intake";
import { INTAKE_FULL_MESSAGE, confirmIntake, noteIntakeFull, reopenIntake, submitIntake, type SubmitIntakeInput } from "@/lib/data/intakeCommands";
import { CommandError } from "@/lib/data/commands";
import { noticesFor } from "@/lib/domain/notify";
import { getDb, type Tx } from "./sql";
import { loadState, persistState } from "./state";
import { deliver } from "./push";

type Json<T> = T | string;
const parse = <T>(v: Json<T>): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const kstToday = (now = new Date()) => new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

async function findIntake(tx: Tx, token: unknown): Promise<{ companyId: string; intake: DefectIntake } | null> {
  if (typeof token !== "string" || !INTAKE_TOKEN_RE.test(token)) return null;
  const rows = await tx.query<{ company_id: string; data: Json<DefectIntake> }>(`select company_id, data from records where collection = 'intakes' and id = $1 limit 1`, [tokenHash(token)]);
  if (!rows.length) return null;
  const intake = parse(rows[0].data);
  // 해시가 맞아도 저장된 주소와 한 번 더 맞춰 본다
  return intake.token === token ? { companyId: rows[0].company_id, intake } : null;
}

async function findRequest(tx: Tx, key: unknown): Promise<{ companyId: string; req: PartnerRequest; hash: string } | null> {
  if (typeof key !== "string" || !INTAKE_STATUS_RE.test(key)) return null;
  const hash = tokenHash(key);
  const rows = await tx.query<{ company_id: string; data: Json<PartnerRequest> }>(`select company_id, data from records where collection = 'partnerRequests' and data->>'statusKey' = $1 limit 1`, [hash]);
  if (!rows.length) return null;
  const req = parse(rows[0].data);
  return req.intake ? { companyId: rows[0].company_id, req, hash } : null;
}

async function requestById(tx: Tx, companyId: string, id: string): Promise<PartnerRequest | undefined> {
  const [row] = await tx.query<{ data: Json<PartnerRequest> }>(`select data from records where company_id = $1 and collection = 'partnerRequests' and id = $2`, [companyId, id]);
  return row ? parse(row.data) : undefined;
}

async function companyInfo(tx: Tx, companyId: string, siteId: string): Promise<{ company: string; phone?: string; sample: boolean; site: Site | undefined }> {
  const [[c], [st], [s]] = await Promise.all([
    tx.query<{ name: string }>(`select name from companies where id = $1`, [companyId]),
    tx.query<{ settings: Json<DemoDB["settings"]> | null }>(`select settings from company_state where company_id = $1`, [companyId]),
    tx.query<{ data: Json<Site> }>(`select data from records where company_id = $1 and collection = 'sites' and id = $2`, [companyId, siteId]),
  ]);
  const settings = st?.settings ? parse(st.settings) : undefined;
  return { company: c?.name ?? "", ...(settings?.publicPhone ? { phone: settings.publicPhone } : {}), sample: !!settings?.sampleData, site: s ? parse(s.data) : undefined };
}

/** 오늘(한국 날짜) 이 링크로 들어온 접수 수 — 접수 화면을 열 때 한도에 닿았는지 미리 알려 주려고 */
async function countToday(tx: Tx, companyId: string, intakeId: string): Promise<number> {
  const from = new Date(`${kstToday()}T00:00:00+09:00`).toISOString();
  const [row] = await tx.query<{ n: string | number }>(
    `select count(*) as n from records where company_id = $1 and collection = 'partnerRequests' and data->'intake'->>'id' = $2 and data->>'createdAt' >= $3 and data->>'reopenedFrom' is null`,
    [companyId, intakeId, from],
  );
  return Number(row?.n ?? 0);
}

export type IntakeOpen = { ok: true; view: IntakeFormView; companyId: string } | { ok: false; reason: "notfound" } | { ok: false; reason: "closed"; company: string; phone?: string };

/** 접수 화면 — 열려 있는 링크면 회사·건물 이름(과 회사 전화번호)만. 닫힌 링크도 어디에 전화할지는 알려 준다 */
export async function openIntake(token: unknown): Promise<IntakeOpen> {
  const db = await getDb();
  const f = await findIntake(db, token);
  if (!f) return { ok: false, reason: "notfound" };
  const info = await companyInfo(db, f.companyId, f.intake.siteId);
  if (intakeState(f.intake) !== "open") return { ok: false, reason: "closed", company: info.company, ...(info.phone ? { phone: info.phone } : {}) };
  if (!info.site) return { ok: false, reason: "notfound" };
  const full = (await countToday(db, f.companyId, f.intake.id)) >= INTAKE_DAILY_LIMIT;
  return {
    ok: true,
    companyId: f.companyId,
    view: { company: info.company, siteName: f.intake.place || info.site.name, ...(info.phone ? { phone: info.phone } : {}), ...(full ? { full: true as const } : {}), ...(info.sample ? { sample: true as const } : {}) },
  };
}

/** 회사 잠금 안에서 순수 함수를 실행하고 저장 — 로그인 없는 경로용 (알림은 저장 뒤에) */
async function runAsSystem<R>(companyId: string, fn: (state: DemoDB, ctx: { userId: string; now: Date }) => { db: DemoDB; result: R }): Promise<R> {
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    await tx.query(`select rev from companies where id = $1 for update`, [companyId]);
    const state = await loadState(tx, companyId);
    const out = fn(state, { userId: "system", now: new Date() });
    // 바뀐 것이 없으면(같은 접수를 다시 보낸 경우) 쓰지 않는다
    if (out.db === state) return { result: out.result, notices: [] };
    const notices = noticesFor(state, out.db, "system");
    await persistState(tx, companyId, state, out.db);
    return { result: out.result, notices };
  });
  if (done.notices.length) await deliver(companyId, done.notices).catch((e) => console.error("[push]", e));
  return done.result;
}

/** 하자 접수 — 접수 번호와 진행 확인 주소(비밀값)를 돌려준다. source: 접수한 곳 (하루 한도용 — 저장하지 않는다) */
export async function submitIntakeByToken(token: unknown, input: Omit<SubmitIntakeInput, "intakeId" | "source">, source?: string): Promise<{ no: string; statusToken: string } | null> {
  const db = await getDb();
  const f = await findIntake(db, token);
  if (!f) return null;
  try {
    const r = await runAsSystem(f.companyId, (state, ctx) => submitIntake(state, { ...input, intakeId: f.intake.id, ...(source ? { source } : {}) }, ctx));
    return { no: r.no, statusToken: r.statusToken };
  } catch (e) {
    // 하루 한도에 닿았으면 본사에 한 번 알린다 (그날 처음일 때만 기록·알림) — 접수자에게는 그대로 거절
    if (e instanceof CommandError && e.message === INTAKE_FULL_MESSAGE) await runAsSystem(f.companyId, (state, ctx) => noteIntakeFull(state, { intakeId: f.intake.id }, ctx)).catch((err) => console.error("[intake]", err));
    throw e;
  }
}

/** 진행 확인 — 그 접수 한 건 (담당자·내부 메모·작업지시 번호 없음) */
export async function intakeStatus(key: unknown): Promise<IntakeStatusView | null> {
  const db = await getDb();
  const f = await findRequest(db, key);
  if (!f) return null;
  const [info, wo] = await Promise.all([
    companyInfo(db, f.companyId, f.req.siteId),
    f.req.linkedWorkOrderId
      ? db.query<{ data: Json<WorkOrder> }>(`select data from records where company_id = $1 and collection = 'workOrders' and id = $2`, [f.companyId, f.req.linkedWorkOrderId])
      : Promise.resolve([] as { data: Json<WorkOrder> }[]),
  ]);
  // 다시 접수한 건이면 앞 접수(번호·그때 받은 답변)와 몇 번째인지
  let prev: PartnerRequest | undefined;
  let round = 0;
  for (let cur = f.req.reopenedFrom; cur && round < 10; round++) {
    const p = await requestById(db, f.companyId, cur);
    if (!p) break;
    prev ??= p;
    cur = p.reopenedFrom;
  }
  // 접수 화면에 보인 건물 이름을 그대로 쓴다 (링크에 따로 적은 이름이 있으면)
  let place: string | undefined;
  if (f.req.intake && f.req.intake.id !== "phone") {
    const [row] = await db.query<{ data: Json<DefectIntake> }>(`select data from records where company_id = $1 and collection = 'intakes' and id = $2`, [f.companyId, f.req.intake.id]);
    place = row ? parse(row.data).place : undefined;
  }
  return intakeStatusView({
    company: info.company,
    ...(info.phone ? { phone: info.phone } : {}),
    sample: info.sample,
    site: place ? { name: place } : info.site,
    req: f.req,
    workOrder: wo[0] ? parse(wo[0].data) : undefined,
    ...(prev ? { prev } : {}),
    round,
    today: kstToday(),
  });
}

/**
 * 진행 확인 주소로 볼 수 있는 사진인지 — 본사가 회신에 붙인 보수 사진만. 원본은 읽지 않는다.
 * 접수자가 올린 사진은 이 주소로 다시 내주지 않는다 (올린 파일이 회사 주소 아래 공개 주소가 되지 않게 · 점검 10차).
 */
export async function intakePhotoAccess(key: unknown, photoId: unknown): Promise<{ companyId: string } | null> {
  if (typeof photoId !== "string" || !/^[\w-]{1,80}$/.test(photoId)) return null;
  const db = await getDb();
  const f = await findRequest(db, key);
  if (!f) return null;
  return (f.req.replyPhotoIds ?? []).includes(photoId) ? { companyId: f.companyId } : null;
}

export async function intakePhotoBlob(companyId: string, photoId: string): Promise<{ mime: string; data: Uint8Array } | null> {
  const db = await getDb();
  const [row] = await db.query<{ mime: string; data: Uint8Array }>(`select mime, data from photo_blobs where id = $1 and company_id = $2`, [photoId, companyId]);
  return row ? { mime: row.mime, data: row.data } : null;
}

/** ‘잘 고쳐졌습니다’ — 진행 확인 주소를 가진 사람만. 주소(해시)는 회사 잠금 안에서 다시 맞춰 본다 */
export async function confirmIntakeByKey(key: unknown, note: unknown): Promise<{ confirmedAt: string } | null> {
  const db = await getDb();
  const f = await findRequest(db, key);
  if (!f) return null;
  return runAsSystem(f.companyId, (state, ctx) => confirmIntake(state, { requestId: f.req.id, statusKey: f.hash, note: typeof note === "string" ? note : undefined }, ctx));
}

/** ‘아직 문제가 있습니다’ — 같은 주소에서 새 접수로 이어진다 */
export async function reopenIntakeByKey(key: unknown, note: unknown): Promise<{ no: string } | null> {
  const db = await getDb();
  const f = await findRequest(db, key);
  if (!f) return null;
  const r = await runAsSystem(f.companyId, (state, ctx) => reopenIntake(state, { requestId: f.req.id, statusKey: f.hash, note: typeof note === "string" ? note : "" }, ctx));
  return { no: r.no };
}
