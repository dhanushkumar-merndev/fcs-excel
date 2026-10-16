/**
 * Read-only go-live status: staff accounts and auth settings.
 *   pnpm db:status --target live
 */
import { api, parseTarget, projectRef, query } from "./mgmt";

const target = parseTarget(process.argv);
const ref = projectRef(target);
const staff = await query(
  ref,
  `select p.username, p.full_name, p.role, p.is_active, u.email_confirmed_at is not null as confirmed, u.last_sign_in_at
     from public.profiles p join auth.users u on u.id = p.id order by p.created_at`,
  true,
);
const orphans = await query(ref, `select count(*)::int as n from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)`, true);
const settings = await query(ref, `select business_name from public.business_settings`, true);
const auth = await api<Record<string, unknown>>(`/v1/projects/${ref}/config/auth`);
console.log(`Status for ${target} (${ref})`);
console.table(staff);
console.log("Auth users without a staff profile:", orphans[0]?.n, "· Business settings rows:", settings.length);
console.log("Auth:", {
  disable_signup: auth.disable_signup,
  site_url: auth.site_url,
  uri_allow_list: auth.uri_allow_list,
  mailer_otp_exp: auth.mailer_otp_exp,
});
