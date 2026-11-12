/**
 * 하자 접수 링크 (D-74) — 로그인하지 않은 사람이 쓰는 서버 경로.
 *
 * - 접수 주소(/r/…): 그 현장에 하자 접수 한 건을 만들 수 있을 뿐, 아무것도 읽지 못한다 (회사·현장 이름만 보인다).
 * - 진행 확인 주소(/r/s/…): 그 접수 한 건의 진행·회신·사진만. 주소의 비밀값은 저장하지 않고 해시로 찾는다.
 * - 접수·확인은 명령과 같은 길로 저장한다: 회사 잠금 → 최신 데이터 → 순수 함수 → 차이 저장 → 본사 알림.
 *   (로그인한 사용자가 없으므로 실행자는 "system")
 */
import type { DefectIntake, DemoDB, PartnerRequest, Site, WorkOrder } from "@/lib/domain/types";
import { INTAKE_STATUS_RE, INTAKE_TOKEN_RE, intakeState, intakeStatusView, tokenHash, type IntakeFormView, type IntakeStatusView } from "@/lib/domain/intake";
import { confirmIntake, submitIntake, type SubmitIntakeInput } from "@/lib/data/intakeCommands";
import { noticesFor } from "@/lib/domain/notify";
import { getDb, type Tx } from "./sql";
import { loadState, persistState } from "./state";
import { deliver } from "./push";

type Json<T> = T | string;
const parse = <T>(v: Json<T>): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

async function findIntake(tx: Tx, token: unknown): Promise<{ companyId: string; intake: DefectIntake } | null> {
  if (typeof token !== "string" || !INTAKE_TOKEN_RE.test(token)) return null;
  const rows = await tx.query<{ company_id: string; data: Json<DefectIntake> }>(`select company_id, data from records where collection = 'intakes' and id = $1 limit 1`, [tokenHash(token)]);
  if (!rows.length) return null;
  const intake = parse(rows[0].data);
  // 해시가 맞아도 저장된 주소와 한 번 더 맞춰 본다
  return intake.token === token ? { companyId: rows[0].company_id, intake } : null;
}

async function findRequest(tx: Tx, key: unknown): Promise<{ companyId: string; req: PartnerRequest } | null> {
  if (typeof key !== "string" || !INTAKE_STATUS_RE.test(key)) return null;
  const rows = await tx.query<{ company_id: string; data: Json<PartnerRequest> }>(`select company_id, data from records where collection = 'partnerRequests' and data->>'statusKey' = $1 limit 1`, [tokenHash(key)]);
  if (!rows.length) return null;
  const req = parse(rows[0].data);
  return req.intake ? { companyId: rows[0].company_id, req } : null;
}

async function companyInfo(tx: Tx, companyId: string, siteId: string): Promise<{ company: string; sample: boolean; site: Site | undefined }> {
  const [[c], [st], [s]] = await Promise.all([
    tx.query<{ name: string }>(`select name from companies where id = $1`, [companyId]),
    tx.query<{ settings: Json<DemoDB["settings"]> | null }>(`select settings from company_state where company_id = $1`, [companyId]),
    tx.query<{ data: Json<Site> }>(`select data from records where company_id = $1 and collection = 'sites' and id = $2`, [companyId, siteId]),
  ]);
  const settings = st?.settings ? parse(st.settings) : undefined;
  return { company: c?.name ?? "", sample: !!settings?.sampleData, site: s ? parse(s.data) : undefined };
}

export type IntakeOpen = { ok: true; view: IntakeFormView } | { ok: false; reason: "notfound" | "closed" };

/** 접수 화면 — 열려 있는 링크면 회사·현장 이름만 */
export async function openIntake(token: unknown): Promise<IntakeOpen> {
  const db = await getDb();
  const f = await findIntake(db, token);
  if (!f) return { ok: false, reason: "notfound" };
  if (intakeState(f.intake) !== "open") return { ok: false, reason: "closed" };
  const info = await companyInfo(db, f.companyId, f.intake.siteId);
  if (!info.site) return { ok: false, reason: "notfound" };
  return { ok: true, view: { company: info.company, siteName: info.site.name, ...(info.sample ? { sample: true as const } : {}) } };
}

/** 회사 잠금 안에서 순수 함수를 실행하고 저장 — 로그인 없는 경로용 (알림은 저장 뒤에) */
async function runAsSystem<R>(companyId: string, fn: (state: DemoDB, ctx: { userId: string; now: Date }) => { db: DemoDB; result: R }): Promise<R> {
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    await tx.query(`select rev from companies where id = $1 for update`, [companyId]);
    const state = await loadState(tx, companyId);
    const out = fn(state, { userId: "system", now: new Date() });
    const notices = noticesFor(state, out.db, "system");
    await persistState(tx, companyId, state, out.db);
    return { result: out.result, notices };
  });
  if (done.notices.length) await deliver(companyId, done.notices).catch((e) => console.error("[push]", e));
  return done.result;
}

/** 하자 접수 — 접수 번호와 진행 확인 주소(비밀값)를 한 번 돌려준다 */
export async function submitIntakeByToken(token: unknown, input: Omit<SubmitIntakeInput, "intakeId">): Promise<{ no: string; statusToken: string } | null> {
  const db = await getDb();
  const f = await findIntake(db, token);
  if (!f) return null;
  const r = await runAsSystem(f.companyId, (state, ctx) => submitIntake(state, { ...input, intakeId: f.intake.id }, ctx));
  return { no: r.no, statusToken: r.statusToken };
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
  return intakeStatusView({ company: info.company, sample: info.sample, site: info.site, req: f.req, workOrder: wo[0] ? parse(wo[0].data) : undefined });
}

/** 진행 확인 주소로 볼 수 있는 사진인지 — 본인이 보낸 사진·본사가 회신에 붙인 보수 사진만. 원본은 읽지 않는다 */
export async function intakePhotoAccess(key: unknown, photoId: unknown): Promise<{ companyId: string } | null> {
  if (typeof photoId !== "string" || !/^[\w-]{1,80}$/.test(photoId)) return null;
  const db = await getDb();
  const f = await findRequest(db, key);
  if (!f) return null;
  const ok = (f.req.photoIds ?? []).includes(photoId) || (f.req.replyPhotoIds ?? []).includes(photoId);
  return ok ? { companyId: f.companyId } : null;
}

export async function intakePhotoBlob(companyId: string, photoId: string): Promise<{ mime: string; data: Uint8Array } | null> {
  const db = await getDb();
  const [row] = await db.query<{ mime: string; data: Uint8Array }>(`select mime, data from photo_blobs where id = $1 and company_id = $2`, [photoId, companyId]);
  return row ? { mime: row.mime, data: row.data } : null;
}

/** ‘확인했습니다’ — 진행 확인 주소를 가진 사람만 */
export async function confirmIntakeByKey(key: unknown, note: unknown): Promise<{ confirmedAt: string } | null> {
  const db = await getDb();
  const f = await findRequest(db, key);
  if (!f) return null;
  return runAsSystem(f.companyId, (state, ctx) => confirmIntake(state, { requestId: f.req.id, note: typeof note === "string" ? note : undefined }, ctx));
}
