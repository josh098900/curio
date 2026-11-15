// A feature's actions file, for the test that finds server actions on its own
// (src/server/every-action.test.ts): one export made by action(), one not.
import { action, noInput } from "@/server/action";

export const wrapped = action({
  input: noInput,
  run: ({ backend }) => backend.rpc("health", {}),
});

export async function unwrapped() {
  return { ok: true };
}
