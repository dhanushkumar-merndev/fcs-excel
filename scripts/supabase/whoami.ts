/** Diagnoses what the management token can access. */
import { api } from "./mgmt";

for (const path of ["/v1/organizations", "/v1/organizations/xqzqdauqvyzoloyokqut", "/v1/organizations/xqzqdauqvyzoloyokqut/members"]) {
  try {
    console.log(path, JSON.stringify(await api(path)).slice(0, 400));
  } catch (error) {
    console.log(path, String(error).slice(0, 300));
  }
}
