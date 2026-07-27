import { loadSkills } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const data = loadSkills();

  // YAML structure: { _job, skills: [{ id, name, tier, reqLevel, maxLevel, levels: [...] }] }
  const skills: Array<{ id: number; name: string; job: string; tier: number; reqLevel: number; maxLevel: number; levels: number }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const job = String((file as Record<string, unknown>)._job ?? "unknown");
    const entries = (file as Record<string, unknown>).skills;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const lvlArr = Array.isArray(v.levels) ? v.levels : [];
      skills.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        job,
        tier: Number(v.tier ?? 0),
        reqLevel: Number(v.reqLevel ?? 0),
        maxLevel: Number(v.maxLevel ?? lvlArr.length ?? 0),
        levels: lvlArr.length,
      });
    }
  }

  skills.sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Skills</h1>
        <p className="text-muted-foreground">{skills.length} skills from {data.length} job files</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Req Lv</TableHead>
                  <TableHead>Max Lv</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.slice(0, 500).map((s, i) => (
                  <TableRow key={`${s.job}-${s.id}-${i}`}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.job}</TableCell>
                    <TableCell><Badge variant="secondary">{s.tier}</Badge></TableCell>
                    <TableCell>{s.reqLevel > 0 ? s.reqLevel : "—"}</TableCell>
                    <TableCell>{s.maxLevel > 0 ? s.maxLevel : "—"}</TableCell>
                    <TableCell><Link href={`/resources/skills/${s.id}/edit`} className="text-xs text-primary hover:underline">Edit</Link></TableCell>
                  </TableRow>
                ))}
                {skills.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No skill data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
