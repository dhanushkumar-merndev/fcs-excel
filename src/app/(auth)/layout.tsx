import { BrandMark } from "@/components/shell/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-11" />
        </div>
        {children}
      </div>
      <p className="mt-10 text-center text-xs text-fg-subtle">Invite-only workspace · Times shown in IST</p>
    </div>
  );
}
