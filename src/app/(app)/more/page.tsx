import { Bell, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NAV } from "@/components/shell/nav-items";
import { PageContainer } from "@/components/shell/page";
import { MoreAccount } from "@/components/shell/more-account";
import { Skeleton } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/auth/dal";
import { navFor } from "@/lib/domain/permissions";

export const metadata: Metadata = { title: "More" };

export default function MorePage() {
  return (
    <PageContainer className="max-w-lg">
      <h1 className="mb-4 text-[22px] font-semibold tracking-tight">More</h1>
      <Suspense fallback={<Skeleton className="h-80 w-full rounded-2xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const staff = await getCurrentStaff();
  const items = navFor(staff.role).filter((k) => !["dashboard", "leads", "follow-ups"].includes(k));
  const links = [
    ...items.map((k) => ({ href: NAV[k].href, label: NAV[k].label, Icon: NAV[k].icon })),
    { href: "/notifications", label: "Notifications", Icon: Bell },
  ];
  return (
    <div className="flex flex-col gap-4">
      <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
        {links.map(({ href, label, Icon }) => (
          <li key={href} className="border-b border-line last:border-0">
            <Link href={href} className="flex h-14 items-center gap-3 px-4 hover:bg-hover">
              <Icon className="size-[18px] text-fg-muted" />
              <span className="flex-1 text-[15px]">{label}</span>
              <ChevronRight className="size-4 text-fg-subtle" />
            </Link>
          </li>
        ))}
      </ul>
      <MoreAccount user={{ fullName: staff.fullName, username: staff.username, role: staff.role }} />
    </div>
  );
}
