import { readFileSync } from "node:fs";
import path from "node:path";
import { pinHint, verifyPin } from "../lib/auth";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

async function main() {
  const previous = process.env.DOLLA_PIN;
  delete process.env.DOLLA_PIN;

  try {
    const hint = pinHint();
    expectEq("default keypad length", hint?.length, 4);
    expectEq("default keypad is numeric", hint?.numeric, true);

    expect("3369 unlocks", await verifyPin("3369"));
    expect("4826 is rejected", !(await verifyPin("4826")));
    expect("empty pin is rejected", !(await verifyPin("")));
    expect("short pin is rejected", !(await verifyPin("336")));
    expect("long pin is rejected", !(await verifyPin("33690")));

    const root = process.cwd();
    const auth = readFileSync(path.join(root, "lib/auth.ts"), "utf8");
    const route = readFileSync(path.join(root, "app/api/auth/login/route.ts"), "utf8");
    const login = readFileSync(path.join(root, "components/login-screen.tsx"), "utf8");

    expect("built-in pin is not plain text", !auth.includes("3369") && !auth.includes('"4826"'));
    expect("login route still checks the pin", route.includes("await verifyPin(candidate)"));
    expect("login keypad still unlocks", login.includes("void unlock(next)"));
    expect("login still requests the greeting", login.includes("requestGreetingAfterUnlock()"));
  } finally {
    if (previous === undefined) delete process.env.DOLLA_PIN;
    else process.env.DOLLA_PIN = previous;
  }

  console.log("pin ok");
}

main();
