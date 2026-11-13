import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { QuotationSheet } from "@/components/quotation/quotation-sheet";
import "@/components/quotation/quotation.css";
import { getCurrentStaff } from "@/lib/auth/dal";
import { getLeadForQuotation } from "@/lib/leads/queries";
import { quotationDefaults } from "@/lib/quotation/build";

const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"] });

export const metadata: Metadata = { title: "Quotation" };

// Outside the (app) group on purpose: no sidebar or bottom nav, so the sheet prints clean.
export default function QuotationPage(props: PageProps<"/quotation/[id]">) {
  return (
    <div className={inter.className}>
      <Suspense fallback={<p className="p-6 text-sm text-fg-muted">Preparing quotation…</p>}>
        <QuotationContent params={props.params} />
      </Suspense>
    </div>
  );
}

async function QuotationContent({ params }: { params: PageProps<"/quotation/[id]">["params"] }) {
  const [{ id }] = await Promise.all([params, getCurrentStaff()]);
  // RLS: a salesperson only gets leads they can already see; missing and not-permitted look the same.
  const lead = await getLeadForQuotation(id);
  if (!lead) notFound();
  return <QuotationSheet leadId={lead.id} defaults={quotationDefaults(lead, new Date())} />;
}
