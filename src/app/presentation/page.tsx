"use client";

import { PlayCircle, GraduationCap, RotateCcw, Monitor, Columns2 } from "lucide-react";
import { useState } from "react";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, Notice } from "@/components/ui/primitives";
import { TOURS, useTour } from "@/components/tour/Tour";
import { resetDemo } from "@/lib/data/store";
import { ResetDialog } from "@/components/device/DemoBar";
import { useToast } from "@/components/ui/Toast";

export default function PresentationPage() {
  const tour = useTour();
  const toast = useToast();
  const [reset, setReset] = useState(false);
  const steps = TOURS.presentation.steps;
  return (
    <PageBody className="max-w-[1100px]">
      <PageHeader
        eyebrow={<DemoBadge />}
        title="대표자 시연 모드 (3~4분)"
        desc="별도 슬라이드가 아니라 실제 화면을 순서대로 이동하며 안내합니다. 안내 패널은 화면을 가리지 않으므로 PC와 모바일을 그대로 조작할 수 있습니다."
        right={
          <>
            <Button icon={<RotateCcw size={17} />} onClick={() => setReset(true)}>
              데모 초기화
            </Button>
            <Button variant="cta" size="lg" icon={<PlayCircle size={19} />} onClick={() => tour.start("presentation")} data-testid="start-presentation">
              시연 시작
            </Button>
          </>
        }
      />
      <Notice tone="info" title="미팅 직전 체크">
        ① 상단 ‘데모 초기화’ ② 브라우저 폭 1280px 이상(PC+Mobile 단계) ③ 역할 = 대표자 ④ 인터넷 연결 없이도 동작 (데이터는 이 브라우저에 저장)
      </Notice>
      <Card>
        <CardHeader title="시연 순서" sub="각 단계에서 실제 Route로 자동 이동하고 대상 영역을 강조합니다" />
        <ol className="space-y-2.5 px-5 pb-5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
              <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-solid text-[0.85rem] font-bold text-white">{i + 1}</span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {s.title.replace(/^[①-⑥]\s*/, "")}
                  <Badge>{s.route}</Badge>
                  {s.device === "dual" ? (
                    <Badge tone="info" icon={<Columns2 size={12} />}>PC+Mobile</Badge>
                  ) : (
                    <Badge tone="neutral" icon={<Monitor size={12} />}>PC</Badge>
                  )}
                </p>
                <p className="mt-0.5 text-[0.85rem] text-ink-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <CardHeader title="처음 사용 안내 (튜토리얼 4단계)" right={<Button icon={<GraduationCap size={17} />} onClick={() => tour.start("tutorial")}>튜토리얼 시작</Button>} />
        <p className="px-5 pb-5 text-[0.85rem] text-ink-3">메뉴 그룹 → KPI 클릭 → 화면 보기 모드 → 설정 순으로 안내합니다. 설정에서 언제든 다시 볼 수 있습니다.</p>
      </Card>
      <ResetDialog
        open={reset}
        onClose={() => setReset(false)}
        onConfirm={() => {
          resetDemo();
          setReset(false);
          toast.push({ tone: "ok", title: "데모를 초기 상태로 되돌렸습니다" });
        }}
      />
    </PageBody>
  );
}
