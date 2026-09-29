import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BANK_NAME, GTBankMark } from "@/components/brand";
import { FactoredLogo } from "@/components/FactoredLogo";
import { SignInForm } from "@/components/SignInForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export default async function SignInPage() {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  if (session) redirect("/app");

  return (
    <main className="signin">
      <div className="signin-top">
        <ThemeToggle />
      </div>
      <section className="card signin-card" aria-labelledby="signin-title">
        <div className="signin-brand">
          <GTBankMark size={44} />
          <div>
            <h1 id="signin-title">{BANK_NAME}</h1>
            <p className="sub">Dispute assistant · fictional bank, synthetic data</p>
          </div>
        </div>
        <p className="signin-lede">Sign in with the demo credentials to try the assistant in Spanish or Portuguese.</p>
        <Suspense>
          <SignInForm />
        </Suspense>
      </section>
      <a className="signin-credit" href="https://www.factored.ai" target="_blank" rel="noreferrer">
        Built for the AI &amp; Data Hackathon 2026 by <FactoredLogo height={16} />
      </a>
    </main>
  );
}
