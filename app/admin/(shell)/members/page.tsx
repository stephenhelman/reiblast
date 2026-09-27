import { PageTitle } from "@/components/admin/ui";
import { requireOwnerOrRedirect } from "@/lib/admin/requireOwner";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  await requireOwnerOrRedirect();
  return (
    <div>
      <PageTitle sub="Coming in Task 6.">Members</PageTitle>
      <p className="mt-6 text-sm text-white/50">This view is not built yet.</p>
    </div>
  );
}
