"use client";

import { useEffect, type ReactNode } from "react";
import { applyPrefsToDocument, usePrefs } from "@/lib/data/store";
import { ToastProvider } from "@/components/ui/Toast";
import { TourProvider } from "@/components/tour/Tour";
import { DeviceStage } from "@/components/device/DeviceStage";

function PrefsApplier() {
  const prefs = usePrefs();
  useEffect(() => applyPrefsToDocument(prefs), [prefs]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TourProvider>
        <PrefsApplier />
        <DeviceStage>{children}</DeviceStage>
      </TourProvider>
    </ToastProvider>
  );
}
