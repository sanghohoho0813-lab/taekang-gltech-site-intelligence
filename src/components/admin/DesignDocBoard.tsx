"use client";

/**
 * AX 상세설계서 (계약 1단계 산출물 · D-59) — 업무 흐름·화면·역할별 권한·데이터 구조·보안 설계를 한 문서로.
 * 내용은 src/lib/design/spec.ts (실제 시스템과 같은지 시험으로 확인) + 메뉴 정의에서 만든다. 인쇄·PDF용, 금액 없음.
 */
import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { GROUPS, NAV } from "@/lib/nav";
import { fmtDate, todayIso } from "@/lib/domain/format";
import type { RoleId } from "@/lib/domain/types";
import { ACCOUNT_SPEC, CMD_GROUP_LABEL, COLLECTION_SPEC, COMMAND_SPEC, DATA_NONE, FIELD_SCREENS, FLOWS, MODULES, ROLE_DESC, ROLE_NAME, ROLE_ORDER, SECURITY, SERVER_TABLES, type Allow, type CmdGroup } from "@/lib/design/spec";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, DemoBadge, PageSkeleton, cx } from "@/components/ui/primitives";

const VENDOR = "미래AI랩";
const th = "border border-line-strong bg-surface-2 px-2.5 py-1.5 text-left text-[0.8rem] font-bold text-ink-2 print:bg-transparent";
const td = "border border-line-strong px-2.5 py-1.5 align-top text-[0.84rem]";
const MARK: Record<Allow, { t: string; sr: string }> = { all: { t: "●", sr: "전부" }, own: { t: "본인만", sr: "담당 현장·본인 것만" }, no: { t: "–", sr: "안 됨" } };
const SCREENS = NAV.filter((n) => n.only !== "demo");
/** 현장 직원 화면은 현장 직원이 보는 이름으로 */
const screenName = (href: string) => FIELD_SCREENS.find((s) => s.href === href)?.label ?? SCREENS.find((n) => n.href === href)?.label ?? href;
const whoCan = (roles: RoleId[], also: RoleId[] = []) => ROLE_ORDER.filter((r) => roles.includes(r) || also.includes(r)).map((r) => ROLE_NAME[r]).join(" · ");

export function DesignDocBoard() {
  const { db } = useMe();
  if (!db) return <PageSkeleton />;
  const groups = Object.keys(CMD_GROUP_LABEL) as CmdGroup[];
  return (
    <PageBody>
      <PageHeader
        className="no-print"
        eyebrow={<DemoBadge compact />}
        title="상세설계서"
        desc="계약 1단계 산출물입니다. 업무 흐름·화면·역할별 권한·데이터 구조·보안 설계를 실제 시스템 기준으로 정리했습니다. 권한표와 데이터 표는 서버 규칙과 같은지 자동 시험으로 확인합니다. 금액은 넣지 않습니다."
        right={
          <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="design-print">
            인쇄·PDF
          </Button>
        }
      />
      <article className="mx-auto w-full min-w-0 max-w-[56rem] rounded-2xl border border-line bg-surface px-5 py-6 text-ink @min-[760px]:px-9 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0" data-testid="design-doc">
        <h2 className="text-center text-[1.55rem] font-extrabold tracking-[0.25em]">AX 상세설계서</h2>
        <p className="mt-1 text-center text-[0.9rem] font-semibold text-ink-2">TAEKANG SITE INTELLIGENCE · 현장 운영 AX 1차</p>
        <table className="mt-4 w-full border-collapse">
          <tbody>
            <tr>
              <th className={cx(th, "w-24")}>사업명</th>
              <td className={td} colSpan={3}>
                현장 운영 AX 시스템 구축 — 계약 1단계 (업무분석·AX 상세설계, 현장·사용자 구조, 권한·DB 구조)
              </td>
            </tr>
            <tr>
              <th className={th}>발주자</th>
              <td className={td} data-testid="design-client">
                {db.company.name}
              </td>
              <th className={cx(th, "w-24")}>수행사</th>
              <td className={td}>{VENDOR}</td>
            </tr>
            <tr>
              <th className={th}>작성일</th>
              <td className={cx(td, "num")}>{fmtDate(todayIso())}</td>
              <th className={th}>기준</th>
              <td className={td}>현재 시스템의 화면·권한 규칙에서 자동 작성</td>
            </tr>
          </tbody>
        </table>

        <Sec no="1" title="개요" testId="design-overview">
          <p className="text-[0.9rem] leading-relaxed">
            현장에서 생기는 출퇴근·작업·사진·추가 비용·작업 인원 기록을 휴대폰으로 바로 받고, 본사가 지시·확인한 뒤, 그 기록이 원가·손익·기성으로 이어지게 하는 시스템입니다. 현장 직원은 누르기만 하는 쉬운 화면을 쓰고, 금액 판단은 본사에서만 합니다.
          </p>
          <Tbl label="사용자 역할">
            <thead>
              <tr>
                <th className={cx(th, "w-28")}>역할</th>
                <th className={th}>할 수 있는 범위</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_ORDER.map((r) => (
                <tr key={r} data-testid="design-role">
                  <td className={cx(td, "font-bold")}>{ROLE_NAME[r]}</td>
                  <td className={td}>{ROLE_DESC[r]}</td>
                </tr>
              ))}
            </tbody>
          </Tbl>
        </Sec>

        <Sec no="2" title="업무 흐름" testId="design-flows">
          <div className="grid gap-3 @min-[760px]:grid-cols-2 print:grid-cols-2">
            {FLOWS.map((f) => (
              <div key={f.key} className="break-inside-avoid rounded-lg border border-line-strong p-3" data-testid="design-flow">
                <p className="text-[0.92rem] font-extrabold">{f.title}</p>
                <ol className="mt-1.5 space-y-1">
                  {f.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[0.84rem] leading-snug">
                      <span className="num w-4 shrink-0 font-bold text-ink-3">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="mr-1 rounded bg-surface-2 px-1 text-[0.74rem] font-bold text-ink-2 print:border print:border-line-strong print:bg-transparent">{ROLE_NAME[s.who]}</span>
                        {s.text}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Sec>

        <Sec no="3" title="화면 구성" testId="design-screens">
          <Tbl label="본사·발주처 화면">
            <thead>
              <tr>
                <th className={cx(th, "w-20")}>묶음</th>
                <th className={cx(th, "w-28")}>화면</th>
                <th className={th}>하는 일</th>
                <th className={cx(th, "w-36")}>볼 수 있는 역할</th>
              </tr>
            </thead>
            <tbody>
              {SCREENS.map((n) => (
                <tr key={n.href} data-testid="design-screen">
                  <td className={cx(td, "text-ink-3")}>{GROUPS.find((g) => g.id === n.group)?.label}</td>
                  <td className={cx(td, "font-bold")}>{n.label}</td>
                  <td className={td}>{n.desc}</td>
                  <td className={cx(td, "text-[0.78rem]")}>{whoCan(n.roles, n.alsoAccess)}</td>
                </tr>
              ))}
            </tbody>
          </Tbl>
          <p className="mt-3 text-[0.86rem] font-bold">현장 직원 휴대폰 화면 (큰 글씨·누르기만)</p>
          <Tbl label="현장 직원 화면">
            <tbody>
              {FIELD_SCREENS.map((s) => (
                <tr key={s.href}>
                  <td className={cx(td, "w-32 font-bold")}>{s.label}</td>
                  <td className={td}>{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </Tbl>
        </Sec>

        <Sec no="4" title="역할별 권한" testId="design-permissions">
          <p className="text-[0.84rem] text-ink-2">
            ● 전부 · <b>본인만</b> 담당 현장·본인 것만 · – 안 됨. 화면이 아니라 <b>서버가</b> 모든 요청마다 확인합니다. 이 표는 서버 규칙과 같은지 자동 시험으로 확인합니다.
          </p>
          <Tbl label="역할별 권한표">
            <thead>
              <tr>
                <th className={th}>할 수 있는 일</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} className={cx(th, "w-16 text-center")}>
                    {ROLE_NAME[r]}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr>
                  <td className={cx(td, "bg-surface-2 font-extrabold print:bg-transparent")} colSpan={5}>
                    {CMD_GROUP_LABEL[g]}
                  </td>
                </tr>
                {Object.entries(COMMAND_SPEC)
                  .filter(([, c]) => c.group === g)
                  .map(([k, c]) => (
                    <PermRow key={k} label={c.label} allow={c.allow} />
                  ))}
              </tbody>
            ))}
            <tbody>
              <tr>
                <td className={cx(td, "bg-surface-2 font-extrabold print:bg-transparent")} colSpan={5}>
                  계정·백업
                </td>
              </tr>
              {ACCOUNT_SPEC.map((a) => (
                <PermRow key={a.label} label={a.label} allow={a.allow} />
              ))}
            </tbody>
          </Tbl>
        </Sec>

        <Sec no="5" title="데이터 구조" testId="design-data">
          <p className="text-[0.84rem] text-ink-2">
            대표·본사 관리자는 회사 데이터를 모두 받습니다 (대표가 ‘좌표는 대표만’으로 정하면 관리자에게는 위치 좌표를 빼고 보냅니다). 현장 직원·발주처에게는 아래 범위만 보냅니다. ‘{DATA_NONE}’는 아예 보내지 않음입니다.
          </p>
          <Tbl label="데이터 구조표">
            <thead>
              <tr>
                <th className={cx(th, "w-24")}>데이터</th>
                <th className={th}>담는 내용</th>
                <th className={cx(th, "w-32")}>현장 직원에게</th>
                <th className={cx(th, "w-24")}>발주처에게</th>
                <th className={cx(th, "w-32")}>보관</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(COLLECTION_SPEC).map(([k, c]) => (
                <tr key={k} data-testid="design-collection">
                  <td className={cx(td, "font-bold")}>{c.label}</td>
                  <td className={td}>{c.holds}</td>
                  <td className={cx(td, "text-[0.8rem]", c.field === DATA_NONE && "text-center text-ink-3")}>{c.field}</td>
                  <td className={cx(td, "text-[0.8rem]", c.partner === DATA_NONE && "text-center text-ink-3")}>{c.partner}</td>
                  <td className={cx(td, "text-[0.78rem] text-ink-2")}>{c.keep}</td>
                </tr>
              ))}
            </tbody>
          </Tbl>
          <p className="mt-3 text-[0.86rem] font-bold">그 밖의 서버 표</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[0.84rem]">
            {SERVER_TABLES.map((t) => (
              <li key={t.name}>
                <b>{t.name}</b> — {t.holds}
              </li>
            ))}
          </ul>
        </Sec>

        <Sec no="6" title="계약 핵심 모듈 대응" testId="design-modules">
          <Tbl label="모듈 대응표">
            <thead>
              <tr>
                <th className={cx(th, "w-10")}>No.</th>
                <th className={cx(th, "w-36")}>모듈</th>
                <th className={cx(th, "w-40")}>화면</th>
                <th className={th}>구현 내용</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.no} data-testid="design-module">
                  <td className={cx(td, "num")}>{m.no}</td>
                  <td className={cx(td, "font-bold")}>{m.name}</td>
                  <td className={cx(td, "text-[0.8rem]")}>{m.routes.map(screenName).join(" · ")}</td>
                  <td className={td}>{m.note}</td>
                </tr>
              ))}
            </tbody>
          </Tbl>
        </Sec>

        <Sec no="7" title="보안·개인정보 설계" testId="design-security">
          <ul className="space-y-1.5 text-[0.86rem]">
            {SECURITY.map((s) => (
              <li key={s.title} className="break-inside-avoid">
                <b>{s.title}</b> — {s.text}
              </li>
            ))}
          </ul>
        </Sec>

        <Sec no="8" title="운영 환경" testId="design-infra">
          <ul className="list-disc space-y-0.5 pl-5 text-[0.86rem]">
            <li>웹 앱 — 설치 없이 휴대폰·PC 브라우저로 사용, 휴대폰 홈 화면에 아이콘 추가 가능</li>
            <li>서버 Vercel(서울) · DB Supabase Postgres(서울) — 회사 명의 계정으로 운영, 회사가 소스·DB·배포 계정을 소유</li>
            <li>백업 — DB 자동 백업(요금제에 따라) + 대표의 전체 자료 내려받기 + 분기별 DB 백업</li>
            <li>배포 전·후 자동 점검 — 운영 모드·DB 연결·보안 헤더·로그인 없는 접근 차단·서버 지역</li>
          </ul>
        </Sec>

        <section className="mt-5 grid break-inside-avoid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 print:grid-cols-2" data-testid="design-sign">
          <SignBox party="발주자" org={db.company.name} who="설계 확인" />
          <SignBox party="수행사" org={VENDOR} who="대표" />
        </section>
        <p className="mt-4 border-t border-line pt-2 text-[0.74rem] text-ink-3" data-testid="design-foot">
          {IS_LIVE ? "" : "DEMO · 가상 시연 데이터 — 회사명은 시연값입니다. "}
          TAEKANG SITE INTELLIGENCE 자동 작성 — 권한표·데이터 표·화면 목록은 현재 시스템 규칙에서 만들었습니다. 금액·계약 조건은 넣지 않습니다.
        </p>
      </article>
    </PageBody>
  );
}

function Sec({ no, title, children, testId }: { no: string; title: string; children: ReactNode; testId: string }) {
  return (
    <section className="mt-6 space-y-2" data-testid={testId}>
      <h3 className="break-after-avoid border-b-2 border-ink pb-1 text-[1.05rem] font-extrabold">
        <span className="num mr-1.5">{no}.</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Tbl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div tabIndex={0} role="region" aria-label={`${label} (가로 스크롤)`} className="relative overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse">{children}</table>
    </div>
  );
}

function PermRow({ label, allow }: { label: string; allow: Record<RoleId, Allow> }) {
  return (
    <tr className="break-inside-avoid" data-testid="design-perm">
      <td className={td}>{label}</td>
      {ROLE_ORDER.map((r) => (
        <td key={r} className={cx(td, "text-center", allow[r] === "own" ? "text-[0.74rem] font-bold whitespace-nowrap" : "text-[0.95rem]", allow[r] === "no" ? "text-ink-3" : "font-bold")} data-role={r} data-allow={allow[r]}>
          <span aria-hidden>{MARK[allow[r]].t}</span>
          <span className="sr-only">{MARK[allow[r]].sr}</span>
        </td>
      ))}
    </tr>
  );
}

function SignBox({ party, org, who }: { party: string; org: string; who: string }) {
  return (
    <div className="rounded-lg border border-line-strong px-4 py-3 text-[0.88rem]">
      <p className="font-extrabold">
        {party} <span className="font-semibold text-ink-2">{org}</span>
      </p>
      <p className="mt-4 flex items-end gap-2">
        <span className="shrink-0 text-ink-3">{who}</span>
        <span className="flex-1 border-b border-ink-3" />
        <span className="shrink-0 text-ink-3">(서명 또는 인)</span>
      </p>
      <p className="mt-3 flex items-end gap-2">
        <span className="shrink-0 text-ink-3">일자</span>
        <span className="flex-1 border-b border-ink-3" />
      </p>
    </div>
  );
}
