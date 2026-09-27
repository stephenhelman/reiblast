import { GateScreen } from "@/components/admin/ui";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

/** Fallback sign-in for when the CRM (and its SMS) is unavailable: 6-digit authenticator code or a one-time backup code. */
export default function LoginPage() {
  return (
    <GateScreen title="Admin sign-in" message="Normally you enter through the link in your CRM menu. This page is for when the CRM is unavailable.">
      <div className="mt-6 text-left">
        <LoginForm />
      </div>
    </GateScreen>
  );
}
