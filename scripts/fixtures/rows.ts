/** Deterministic, clearly fake Meta-style lead rows (shared by fixtures and the demo seed). */
export const HEADERS = [
  "id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "form_name",
  "is_organic", "platform", "what's_the_occasion_for_your_event?", "no_of_guests_", "which_menu_needed?", "event_date",
  "event_address", "full_name", "phone", "lead_status", "CRM UPDATE",
];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const FIRST = ["Aarav", "Diya", "Ishaan", "Kavya", "Rohan", "Ananya", "Vikram", "Meera", "Arjun", "Sneha", "Karthik", "Priya", "Rahul", "Lakshmi", "Nikhil", "Pooja"];
const LAST = ["Sharma", "Iyer", "Reddy", "Nair", "Gupta", "Menon", "Rao", "Patel", "Kumar", "Pillai", "Das", "Joshi"];
const OCCASIONS = ["birthday", "house_party", "anniversary", "corporate_event", "puja", "kitty_party", "wedding"];
const GUESTS = ["1_-_10", "11_-_20", "21_-_30", "more_than_30"];
const MENUS = ["veg_menu", "non_veg_menu", "veg_and_non_veg"];
const AREAS = ["Koramangala, Bengaluru", "Indiranagar, Bengaluru", "HSR Layout, Bengaluru", "Whitefield, Bengaluru", "Adyar, Chennai", "Banjara Hills, Hyderabad", "Bandra West, Mumbai"];
const CAMPAIGNS = [
  { id: "c:120211000000000101", name: "Diwali Parties 2026" },
  { id: "c:120211000000000102", name: "Weekend Chef at Home" },
  { id: "c:120211000000000103", name: "Corporate Lunches" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isoIST(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 19) + "+05:30";
}

export function row(i: number, opts: { idBase?: bigint } = {}) {
  const campaign = pick(CAMPAIGNS);
  const created = new Date(Date.UTC(2026, 8, 1) + Math.floor(rand() * 44 * 86_400_000));
  const event = new Date(created.getTime() + (7 + Math.floor(rand() * 80)) * 86_400_000);
  const style = rand();
  const eventText =
    style < 0.6
      ? event.toISOString().slice(0, 10)
      : style < 0.8
        ? `${String(event.getUTCDate()).padStart(2, "0")}/${String(event.getUTCMonth() + 1).padStart(2, "0")}/${event.getUTCFullYear()}`
        : `${event.getUTCDate()} ${MONTHS[event.getUTCMonth()]}`;
  const phone = `p:+919${String(100000000 + i).padStart(9, "0")}`;
  const id = (opts.idBase ?? 1202110000000000n) + BigInt(i);
  return [
    `l:${id}`,
    isoIST(created),
    `ag:1202110000${String(500000 + (i % 7)).padStart(8, "0")}`,
    `Ad ${(i % 7) + 1} - ${campaign.name}`,
    `as:1202110000${String(400000 + (i % 3)).padStart(8, "0")}`,
    `${campaign.name} - Audience ${(i % 3) + 1}`,
    campaign.id,
    campaign.name,
    `f:${String(900000000000000 + (i % 2))}`,
    i % 2 ? "Chef booking form" : "Catering enquiry form",
    rand() < 0.15 ? "true" : "false",
    rand() < 0.65 ? "ig" : "fb",
    pick(OCCASIONS),
    pick(GUESTS),
    pick(MENUS),
    eventText,
    pick(AREAS),
    `${pick(FIRST)} ${pick(LAST)}`,
    phone,
    "CREATED",
    rand() < 0.2 ? "YES" : "",
  ];
}

