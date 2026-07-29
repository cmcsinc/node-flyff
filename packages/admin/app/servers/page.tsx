import { PageHeader } from "@/components/page-header";
import { getStatuses } from "@/lib/server-manager";
import { ServerManager } from "./server-manager-client";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const instances = await getStatuses();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Servers"
        description="Spawn, configure, and monitor login / cluster / world server processes"
      />
      <ServerManager initial={instances} />
    </div>
  );
}
