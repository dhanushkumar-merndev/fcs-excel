/**
 * Invite-only auth: disables public sign-ups, sets the site URL and redirect allow-list, and gives
 * invite/reset links 24 hours. Usage: pnpm auth:config --target staging|live --site-url https://crm.example.com
 */
import { api, parseTarget, projectRef } from "./mgmt";

const target = parseTarget(process.argv);
const siteIndex = process.argv.indexOf("--site-url");
const siteUrl = (siteIndex >= 0 ? process.argv[siteIndex + 1] : "http://localhost:3000").replace(/\/$/, "");
const ref = projectRef(target);

const allow = [...new Set([`${siteUrl}/**`, "http://localhost:3000/**"])];
await api(`/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  body: JSON.stringify({
    disable_signup: true,
    site_url: siteUrl,
    uri_allow_list: allow.join(","),
    mailer_otp_exp: 86400,
    external_email_enabled: true,
    security_update_password_require_reauthentication: false,
  }),
});
const config = await api<Record<string, unknown>>(`/v1/projects/${ref}/config/auth`);
console.log(`Auth config for ${target} (${ref}):`, {
  disable_signup: config.disable_signup,
  site_url: config.site_url,
  uri_allow_list: config.uri_allow_list,
  mailer_otp_exp: config.mailer_otp_exp,
});
