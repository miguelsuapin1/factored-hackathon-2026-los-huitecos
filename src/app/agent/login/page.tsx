import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AgentSignInForm } from "@/components/AgentSignInForm";
import { GTBankMark, GTBankWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AGENT_COOKIE, verifyAgentSession } from "@/lib/auth/session";

export default async function AgentSignInPage() {
  const agent = await verifyAgentSession((await cookies()).get(AGENT_COOKIE)?.value).catch(() => null);
  if (agent) redirect("/agent");

  return (
    <main className="signin">
      <div className="signin-top"><ThemeToggle /></div>
      <section className="card signin-card" aria-labelledby="agent-signin-title">
        <div className="signin-brand">
          <GTBankMark size={46} />
          <div>
            <h1><GTBankWordmark /></h1>
            <p className="label">Agent console</p>
          </div>
        </div>
        <h2 className="signin-title" id="agent-signin-title">
          Customers the assistant <span className="serif plume">handed to you.</span>
        </h2>
        <p className="signin-lede">
          For bank staff. Each request arrives with the case facts and a summary of the conversation; accept it to chat
          with the customer.
        </p>
        <Suspense><AgentSignInForm /></Suspense>
      </section>
      <p className="signin-foot">GT Bank is a fictional bank · synthetic data · customers sign in at <Link href="/">the assistant</Link></p>
    </main>
  );
}
