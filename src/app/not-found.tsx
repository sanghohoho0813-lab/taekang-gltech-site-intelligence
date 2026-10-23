import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-5 py-20 text-center">
      <p className="text-[0.85rem] font-bold text-ink-3">404</p>
      <h1 className="mt-2 text-[1.4rem] font-extrabold">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 text-[0.9rem] text-ink-3">주소가 바뀌었거나 없는 화면입니다.</p>
      <Link href="/dashboard" className="mt-6 inline-flex h-11 items-center rounded-xl bg-cta px-5 font-bold text-cta-text">
        대시보드로 이동
      </Link>
    </div>
  );
}
