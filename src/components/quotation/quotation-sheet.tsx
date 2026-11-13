"use client";

import {
  ArrowLeft,
  CalendarDays,
  ChefHat,
  Clock,
  CookingPot,
  Download,
  Gift,
  Globe,
  Mail,
  MapPin,
  PartyPopper,
  Phone,
  Sparkles,
  Users,
  UtensilsCrossed,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { QUOTATION_COMPANY as CO, advanceFor, formatAmount, parseAmount, quotationTotals, type QuotationDefaults } from "@/lib/quotation/build";

type Props = { leadId: string; defaults: QuotationDefaults };

export function QuotationSheet({ leadId, defaults }: Props) {
  const [f, setF] = useState({ ...defaults, time: "", dishes: "", discount: "" });
  // Final price and advance are worked out, but staff can still type over them.
  const [finalOverride, setFinalOverride] = useState<string | null>(null);
  const [advanceOverride, setAdvanceOverride] = useState<string | null>(null);

  const totals = quotationTotals(f.packagePrice, f.discount);
  const finalText = finalOverride ?? (totals.final === null ? "" : formatAmount(totals.final));
  const advanceText = advanceOverride ?? (() => {
    const adv = advanceFor(parseAmount(finalText));
    return adv === null ? "" : formatAmount(adv);
  })();

  // Phones: shrink the A4 sheet to the screen width. Print CSS resets zoom to 1.
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const fit = () => {
      const avail = window.innerWidth - 24;
      page.style.zoom = avail < page.offsetWidth ? String(avail / page.offsetWidth) : "";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const set = (key: keyof typeof f) => (value: string) => setF((s) => ({ ...s, [key]: value }));
  const tidy = (value: string) => {
    const n = parseAmount(value);
    return n === null ? value : formatAmount(n);
  };

  const download = () => {
    const previous = document.title;
    document.title = `Chefpy Quotation - ${f.customerName.trim() || "Customer"} - ${f.quoteNo}`;
    window.print();
    window.setTimeout(() => {
      document.title = previous;
    }, 500);
  };

  return (
    <div className="qt-root">
      <div className="qt-toolbar">
        <Link href={`/leads/${leadId}`} className="qt-btn qt-btn-ghost">
          <ArrowLeft /> Back to lead
        </Link>
        <span className="qt-hint">Details come from the lead. Click any field to edit before downloading.</span>
        <button type="button" className="qt-btn qt-btn-primary" onClick={download}>
          <Download /> Download PDF / Print
        </button>
      </div>

      <div className="qt-page" ref={pageRef}>
        <div className="qt-topbar" />
        <div className="qt-content">
          <header className="qt-head">
            {/* eslint-disable-next-line @next/next/no-img-element -- printed asset; next/image adds nothing here */}
            <img src="/chefpy-logo.webp" alt="Chefpy logo" className="qt-logo" />
            <div className="qt-brand">
              <h1>
                {CO.name} <em>({CO.brand})</em>
              </h1>
              <div className="qt-tag">{CO.tagline}</div>
              <div className="qt-addr">
                <div className="qt-row">
                  <MapPin />
                  <span>
                    {CO.addressLines.map((line, i) => (
                      <span key={line}>
                        {i > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="qt-row">
                  <Phone />
                  <span>{CO.phone}</span>
                </div>
                <div className="qt-row">
                  <Mail />
                  <span>{CO.email}</span>
                </div>
                <div className="qt-row">
                  <Globe />
                  <span>{CO.website}</span>
                </div>
              </div>
            </div>
            <div className="qt-qbox">
              <div className="qt-title">Quotation</div>
              <table>
                <tbody>
                  <tr>
                    <td>Quote No.</td>
                    <td>
                      <Field value={f.quoteNo} onChange={set("quoteNo")} placeholder="KB-0000" />
                    </td>
                  </tr>
                  <tr>
                    <td>Date</td>
                    <td>
                      <Field value={f.quoteDate} onChange={set("quoteDate")} placeholder="DD MMM YYYY" />
                    </td>
                  </tr>
                  <tr>
                    <td>Valid till</td>
                    <td>
                      <Field value={f.validTill} onChange={set("validTill")} placeholder="DD MMM YYYY" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </header>

          <div className="qt-rule" />

          <section className="qt-greet">
            <div className="qt-dear">
              Dear
              <Field value={f.customerName} onChange={set("customerName")} placeholder="Customer name" />,
            </div>
            <p>Thank you for sharing your event requirements. Please find your customized quotation below.</p>
          </section>

          <h2 className="qt-h2">Event Details</h2>
          <div className="qt-details">
            <Detail icon={<CalendarDays />} label="Event Date" value={f.eventDate} onChange={set("eventDate")} placeholder="DD MMM YYYY" />
            <Detail icon={<PartyPopper />} label="Occasion" value={f.occasion} onChange={set("occasion")} placeholder="Birthday, House party…" />
            <Detail icon={<Users />} label="No. of Guests" value={f.guests} onChange={set("guests")} placeholder="e.g. 40" />
            <Detail icon={<MapPin />} label="Event Location" value={f.location} onChange={set("location")} placeholder="Area, City" />
            <Detail icon={<Clock />} label="Preferred Time" value={f.time} onChange={set("time")} placeholder="e.g. 7:00 PM" />
            <Detail icon={<UtensilsCrossed />} label="No. of Dishes" value={f.dishes} onChange={set("dishes")} placeholder="e.g. 6" />
          </div>

          <h2 className="qt-h2">Price Details</h2>
          <div className="qt-pricing">
            <div className="qt-ptable">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Package Price</td>
                    <td>
                      <Money value={f.packagePrice} onChange={set("packagePrice")} onBlur={(v) => set("packagePrice")(tidy(v))} />
                    </td>
                  </tr>
                  <tr className="qt-disc">
                    <td>Special Discount</td>
                    <td>
                      <Money prefix="− ₹" value={f.discount} onChange={set("discount")} onBlur={(v) => set("discount")(tidy(v))} />
                    </td>
                  </tr>
                  <tr className="qt-final">
                    <td>Final Package Price</td>
                    <td>
                      <Money
                        value={finalText}
                        onChange={(v) => setFinalOverride(v.trim() ? v : null)}
                        onBlur={(v) => setFinalOverride(v.trim() ? tidy(v) : null)}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="qt-advance">
              <div className="qt-k">
                <Wallet /> Booking Advance <span className="qt-pct">40%</span>
              </div>
              <div className="qt-amt">
                <Money
                  value={advanceText}
                  onChange={(v) => setAdvanceOverride(v.trim() ? v : null)}
                  onBlur={(v) => setAdvanceOverride(v.trim() ? tidy(v) : null)}
                />
              </div>
              <p>40% of the final package price, payable to confirm your booking.</p>
            </div>
          </div>

          <h2 className="qt-h2">Package Includes</h2>
          <div className="qt-includes">
            <Include icon={<ChefHat />} title="Professional Chef Service" sub="Verified, experienced chef" />
            <Include icon={<CookingPot />} title="Live Cooking at Your Venue" sub="Fresh food, cooked on-site" />
            <Include icon={<Sparkles />} title="Basic Kitchen Cleaning" sub="After cooking is complete" />
          </div>

          <div className="qt-offer">
            <Gift />
            <p>
              <b>Special Offer:</b> Valid for today’s booking only.
            </p>
          </div>

          <p className="qt-confirm">
            To confirm your booking, please pay the <b>40% booking advance</b>.
          </p>

          <div className="qt-thanks">
            <div className="qt-msg">
              Thank you for choosing{" "}
              <span>
                {CO.name} ({CO.brand})
              </span>
              .
            </div>
            <div className="qt-sign">
              <div className="qt-for">
                For {CO.name} ({CO.brand})
              </div>
              <div className="qt-line" />
              Authorised Signatory
            </div>
          </div>
        </div>

        <footer className="qt-footer">
          <div>
            <b>
              <Phone /> Call Us
            </b>
            {CO.phone}
          </div>
          <div>
            <b>
              <WhatsAppIcon /> WhatsApp
            </b>
            Quick responses &amp; quotes
          </div>
          <div>
            <b>
              <Clock /> Working Hours
            </b>
            {CO.workingHours}
          </div>
          <div>
            <b>
              <Zap /> Response Time
            </b>
            {CO.responseTime}
          </div>
        </footer>
        <div className="qt-footnote">This is a computer-generated quotation.</div>
      </div>
    </div>
  );
}

function Field({ value, onChange, onBlur, ...rest }: Omit<ComponentProps<"input">, "onChange" | "onBlur" | "value"> & {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
}) {
  return (
    <input
      {...rest}
      className="qt-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
    />
  );
}

function Money({ prefix = "₹", ...props }: { prefix?: string; value: string; onChange: (v: string) => void; onBlur?: (v: string) => void }) {
  return (
    <span className="qt-money">
      {prefix}
      <Field {...props} inputMode="decimal" placeholder="0" />
    </span>
  );
}

function Detail({ icon, label, ...field }: { icon: ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="qt-detail">
      <div className="qt-ico">{icon}</div>
      <div className="qt-v">
        <div className="qt-k">{label}</div>
        <Field {...field} aria-label={label} />
      </div>
    </div>
  );
}

function Include({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="qt-inc">
      <div className="qt-ico">{icon}</div>
      <div>
        <b>{title}</b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

/** Lucide dropped brand marks, so the WhatsApp glyph is inlined (Font Awesome path, via react-icons). */
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z" />
    </svg>
  );
}
