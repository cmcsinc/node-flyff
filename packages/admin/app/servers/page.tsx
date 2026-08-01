import { PageHeader } from "@/components/page-header";
import { getStatuses } from "@/lib/server-manager";
import { ServerManager } from "./server-manager-client";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const instances = await getStatuses();
  return (
    // Fixed viewport-height column so the log console owns the leftover space
    // instead of being a short scrolling card at the bottom of a long page.
    // 3.5rem header + 2rem page padding + ~1.5rem breathing room.
    <div className="flex min-h-[calc(100vh-9rem)] flex-col gap-4">
      <PageHeader
        title="Servers"
        description="Spawn, configure, and monitor login / cluster / world server processes"
      />
      <ServerManager initial={instances} />
    </div>
  );
}
