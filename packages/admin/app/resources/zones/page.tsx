import { loadZones } from "@/lib/resources";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ZonesPage() {
  const data = loadZones();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Zones</h1>
        <p className="text-muted-foreground">{data.length} zone definitions</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.map((zone, i) => {
          const name = typeof zone === "object" && zone !== null ? String(zone.name ?? zone.worldId ?? `Zone ${i}`) : `Zone ${i}`;
          const desc = typeof zone === "object" && zone !== null ? String(zone.description ?? "") : "";
          return (
            <Card key={i}>
              <CardHeader>
                <CardTitle>{name}</CardTitle>
                {desc && <CardDescription>{desc}</CardDescription>}
              </CardHeader>
              <CardContent>
                <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
                  {JSON.stringify(zone, null, 2).slice(0, 1000)}
                </pre>
              </CardContent>
            </Card>
          );
        })}
        {data.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No zone data</CardContent></Card>
        )}
      </div>
    </div>
  );
}
