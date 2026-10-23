/**
 * 업종 맞춤 SVG 일러스트 (커튼월·창호·유리 파사드).
 * 실제 현장 사진이 아니며 화면에 그 사실을 표기한다 (출처 불명 사진 사용 금지).
 */
import type { Site } from "@/lib/domain/types";

export function Facade({ kind, className = "", label = true }: { kind: Site["illustration"]; className?: string; label?: boolean }) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="커튼월 파사드 일러스트 (실제 현장 사진 아님)">
        <defs>
          <linearGradient id={`sky-${kind}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C9D8E8" />
            <stop offset="1" stopColor="#EEF2F6" />
          </linearGradient>
          <linearGradient id={`glass-${kind}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5E7F9C" />
            <stop offset="0.45" stopColor="#9FB8CC" />
            <stop offset="1" stopColor="#3F5D78" />
          </linearGradient>
          <linearGradient id={`glass2-${kind}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7E9CB6" />
            <stop offset="1" stopColor="#4A6782" />
          </linearGradient>
          <pattern id={`mullion-${kind}`} width="32" height="40" patternUnits="userSpaceOnUse">
            <rect width="32" height="40" fill="transparent" />
            <rect x="0" y="0" width="2.2" height="40" fill="#2B3440" opacity=".55" />
            <rect x="0" y="0" width="32" height="2.2" fill="#2B3440" opacity=".45" />
          </pattern>
        </defs>
        <rect width="640" height="360" fill={`url(#sky-${kind})`} />
        {kind === "logistics" && (
          <g>
            <rect x="0" y="300" width="640" height="60" fill="#B9C1C9" />
            <rect x="40" y="150" width="560" height="150" fill="#D5DBE1" />
            <rect x="60" y="120" width="300" height="180" fill={`url(#glass-${kind})`} />
            <rect x="60" y="120" width="300" height="180" fill={`url(#mullion-${kind})`} />
            <rect x="60" y="120" width="190" height="180" fill="#FFFFFF" opacity=".07" />
            {/* 설치 진행 중 구간 (프레임만) */}
            <rect x="360" y="120" width="220" height="180" fill="none" stroke="#2B3440" strokeWidth="2" opacity=".55" />
            {Array.from({ length: 7 }).map((_, i) => (
              <rect key={i} x={360 + i * 32} y="120" width="2.2" height="180" fill="#2B3440" opacity=".5" />
            ))}
            <rect x="360" y="232" width="128" height="68" fill={`url(#glass2-${kind})`} />
            {/* 크레인 */}
            <rect x="540" y="30" width="6" height="270" fill="var(--brand-mark)" />
            <rect x="420" y="30" width="200" height="6" fill="var(--brand-mark)" />
            <line x1="470" y1="36" x2="470" y2="110" stroke="#2B3440" strokeWidth="1.5" />
            <rect x="458" y="110" width="26" height="30" fill={`url(#glass2-${kind})`} stroke="#2B3440" />
          </g>
        )}
        {kind === "office" && (
          <g>
            <rect x="0" y="315" width="640" height="45" fill="#BAC2CA" />
            <rect x="160" y="30" width="320" height="285" fill={`url(#glass-${kind})`} />
            <rect x="160" y="30" width="320" height="285" fill={`url(#mullion-${kind})`} />
            <rect x="160" y="30" width="110" height="285" fill="#FFFFFF" opacity=".08" />
            {/* 교체 완료/미완료 층 구분 */}
            <rect x="160" y="190" width="320" height="125" fill="#6C7681" opacity=".5" />
            <rect x="160" y="188" width="320" height="4" fill="var(--brand-mark)" />
            <rect x="60" y="140" width="100" height="175" fill="#D3D9DF" />
            <rect x="480" y="100" width="110" height="215" fill="#CBD2D9" />
            {/* 곤돌라 */}
            <rect x="300" y="170" width="70" height="14" fill="#2B3440" />
            <line x1="305" y1="30" x2="305" y2="170" stroke="#2B3440" strokeWidth="1.2" />
            <line x1="365" y1="30" x2="365" y2="170" stroke="#2B3440" strokeWidth="1.2" />
          </g>
        )}
        {kind === "civic" && (
          <g>
            <rect x="0" y="305" width="640" height="55" fill="#B8C0C8" />
            <rect x="70" y="170" width="500" height="135" fill="#D7DCE1" />
            {/* 유리 아트리움 */}
            <path d="M200 305 L200 170 Q320 60 440 170 L440 305 Z" fill={`url(#glass-${kind})`} />
            <path d="M200 305 L200 170 Q320 60 440 170 L440 305 Z" fill={`url(#mullion-${kind})`} />
            {Array.from({ length: 6 }).map((_, i) => (
              <path key={i} d={`M${220 + i * 40} 305 L${220 + i * 40} ${150 - Math.abs(2.5 - i) * 10}`} stroke="#2B3440" strokeWidth="2" opacity=".5" />
            ))}
            <rect x="90" y="200" width="90" height="105" fill="#C6CDD4" />
            <rect x="460" y="200" width="90" height="105" fill="#C6CDD4" />
            {/* 철골 하부구조 (진행 중) */}
            <rect x="196" y="168" width="248" height="4" fill="var(--brand-mark)" opacity=".9" />
          </g>
        )}
      </svg>
      {label && <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[0.65rem] font-semibold text-white">일러스트 · 실제 현장 사진 아님</span>}
    </div>
  );
}
