import {
  LayoutDashboard,
  Building2,
  ClipboardPen,
  ListChecks,
  Wallet,
  FileBarChart,
  Handshake,
  ShieldAlert,
  BadgeCheck,
  Lightbulb,
  Settings,
  Presentation,
  Home,
  UserRound,
  MapPinCheck,
  CalendarClock,
  ClipboardCheck,
  HardHat,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Building2,
  ClipboardPen,
  ListChecks,
  Wallet,
  FileBarChart,
  Handshake,
  ShieldAlert,
  BadgeCheck,
  Lightbulb,
  Settings,
  Presentation,
  Home,
  UserRound,
  MapPinCheck,
  CalendarClock,
  ClipboardCheck,
  HardHat,
};

export function NavIcon({ name, className, size = 20 }: { name: string; className?: string; size?: number }) {
  const I = MAP[name] ?? LayoutDashboard;
  return <I className={className} size={size} aria-hidden strokeWidth={2} />;
}
