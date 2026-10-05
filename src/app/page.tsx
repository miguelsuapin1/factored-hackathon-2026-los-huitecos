import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GTBankMark, GTBankWordmark } from "@/components/brand";
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
          <GTBankMark size={46} />
          <div>
            <h1><GTBankWordmark /></h1>
            <p className="label">Dispute Desk</p>
          </div>
        </div>
        <h2 className="signin-title" id="signin-title">
          A charge you don’t recognize? <span className="serif plume">Let’s sort it out.</span>
        </h2>
        <p className="signin-lede">Sign in with a test customer login to try the assistant in Spanish or Portuguese. You only see that customer’s data.</p>
        <Suspense>
          <SignInForm />
        </Suspense>
      </section>
      <a className="signin-credit" href="https://www.factored.ai" target="_blank" rel="noreferrer">
        Built for the AI &amp; Data Hackathon 2026 by <FactoredLogo height={16} />
      </a>
      <p className="signin-foot">GT Bank is a fictional bank · synthetic data</p>
    </main>
  );
}
