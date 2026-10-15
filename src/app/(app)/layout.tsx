import { Suspense } from "react";
import {
  BottomNavSlot,
  SidebarFallback,
  SidebarSlot,
  TopbarFallback,
  TopbarSlot,
} from "@/components/shell/app-chrome";
import { ConnectionWatch } from "@/components/shell/connection-watch";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <Suspense fallback={<SidebarFallback />}>
        <SidebarSlot />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<TopbarFallback />}>
          <TopbarSlot />
        </Suspense>
        <main id="main" className="flex-1 pb-28 md:pb-12">
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <BottomNavSlot />
      </Suspense>
      <ConnectionWatch />
    </div>
  );
}
