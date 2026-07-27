import { loadSkills } from "@/lib/resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const data = loadSkills();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Skills</h1>
        <p className="text-muted-foreground">{data.length} skill definition files</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.map((file, i) => {
          const entries = typeof file === "object" && file !== null ? Object.keys(file).length : 0;
          const firstName = typeof file === "object" && file !== null ? Object.keys(file)[0] : "unknown";
          return (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{firstName}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="secondary">{entries} entries</Badge>
              </CardContent>
            </Card>
          );
        })}
        {data.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No skill data</CardContent></Card>
        )}
      </div>
    </div>
  );
}
