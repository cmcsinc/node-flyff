import type * as React from 'react';
import { loadQuests } from '@/lib/resources';
import { getResourceIndex } from '@/lib/resource-cache';
import { npcNameForKey } from '@flyff/resources';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import {
  IdCell,
  NameCell,
  SymbolCell,
  NameWithSymbol,
  NumCell,
  EditLink,
} from '@/components/resource-cells';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { ScrollText } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  npc?: string;
  minLevel?: string;
  maxLevel?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

/**
 * First argument value of the named quest command, or "" when absent.
 *
 * A quest arg is `{ value: string | number }` (a symbol like `MaFl_Rin`, or a
 * level). Anything else in that slot is malformed data, and coercing it would
 * print `[object Object]` into the table, so it degrades to "" instead.
 */
function firstArg(cmds: unknown[], name: string): string {
  const cmd = cmds.find(
    (c): c is Record<string, unknown> =>
      typeof c === 'object' && c !== null && (c as Record<string, unknown>).cmd === name,
  );
  if (!cmd || !Array.isArray(cmd.args) || cmd.args.length === 0) return '';
  const value = (cmd.args[0] as Record<string, unknown>).value;
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : '';
}

interface QuestRow {
  id: number;
  title: string;
  titleToken: string;
  symbol: string;
  level: number;
  npcKey: string;
  npcName: string;
}

const SORT_KEYS = ['id', 'title', 'symbol', 'titleToken', 'npcName', 'level'] as const;

const COLUMNS: readonly ResourceColumn<QuestRow>[] = [
  {
    key: 'id',
    header: 'ID',
    sortable: true,
    className: 'w-20',
    cell: (r) => <IdCell value={r.id} />,
  },
  { key: 'title', header: 'Title', sortable: true, cell: (r) => <NameCell value={r.title} /> },
  { key: 'symbol', header: 'Symbol', sortable: true, cell: (r) => <SymbolCell value={r.symbol} /> },
  {
    key: 'titleToken',
    header: 'Title ID',
    sortable: true,
    // Trimmed of its shared prefix; the full token is in the tooltip.
    cell: (r) => (
      <SymbolCell value={r.titleToken.replace(/^IDS_PROPQUEST_INC_/, '')} title={r.titleToken} />
    ),
  },
  {
    key: 'npcName',
    header: 'NPC',
    sortable: true,
    // Unresolved: show the key de-prefixed rather than the propMover model name,
    // which is the shared model and wrong for NPCs.
    cell: (r) => (
      <NameWithSymbol
        name={r.npcName || r.npcKey.replace(/^[A-Za-z]{2,4}_/, '')}
        symbol={r.npcKey}
      />
    ),
  },
  {
    key: 'level',
    header: 'Req Lv',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.level} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (r) => (
      <EditLink href={`/resources/quests/${String(r.id)}/edit`} label={`quest ${String(r.id)}`} />
    ),
  },
];

export default async function QuestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const npc = params.npc ?? '';
  const minLevel = params.minLevel ?? '';
  const maxLevel = params.maxLevel ?? '';
  const perPage = parsePerPage(params.perPage);
  const data = loadQuests();

  // `title` in the yml is an `IDS_PROPQUEST_INC_*` token, not text — the C++
  // resolves it through `propQuest.txt.txt` at load (`ProjectCmn.cpp:985`), and
  // so does the client. Resolve it here so the table shows what a player sees.
  // Of 474 quests: 464 resolve, 10 have a token whose table entry is an empty
  // string, so the display falls back to a dash rather than a blank cell.
  //
  // `SetCharacter` likewise stores a character.inc block key (`MaFl_Rin`), not a
  // name. `npcNameForKey` follows the C++ chain (`Project.cpp:3023` ->
  // `Mover.cpp:1011`): block -> `SetName(IDS_*)` -> `character.txt.txt`.
  const { questText, characterInc } = await getResourceIndex();

  const quests: QuestRow[] = [];
  for (const doc of data) {
    if (typeof doc !== 'object') continue;
    const cmds = Array.isArray(doc.commands) ? doc.commands : [];
    const id = Number(doc.id ?? 0);
    const titleToken = typeof doc.title === 'string' ? doc.title : '';
    const npcKey = firstArg(cmds, 'SetCharacter');
    quests.push({
      id,
      title: questText.get(titleToken) ?? '',
      titleToken,
      symbol: typeof doc.symbol === 'string' ? doc.symbol : `Quest ${String(id)}`,
      level: Number(firstArg(cmds, 'SetBeginCondLevel') || 0),
      npcKey,
      npcName: npcNameForKey(characterInc, npcKey) ?? '',
    });
  }

  quests.sort((a, b) => a.id - b.id);

  const min = Number(minLevel);
  const max = Number(maxLevel);
  const needle = search.toLowerCase();
  const npcNeedle = npc.toLowerCase();

  const filtered = quests.filter((q) => {
    if (minLevel && Number.isFinite(min) && q.level < min) return false;
    if (maxLevel && Number.isFinite(max) && q.level > max) return false;
    // The NPC filter matches the resolved name as well as the key, so typing
    // "Rin" works without knowing the `MaFl_` prefix.
    if (
      npcNeedle &&
      !q.npcKey.toLowerCase().includes(npcNeedle) &&
      !q.npcName.toLowerCase().includes(npcNeedle)
    )
      return false;
    // Search spans the resolved title, the symbol, the token, and the id — a GM
    // cross-referencing the C++ has only the symbol or token to go on.
    if (
      needle &&
      !q.title.toLowerCase().includes(needle) &&
      !q.symbol.toLowerCase().includes(needle) &&
      !q.titleToken.toLowerCase().includes(needle) &&
      !String(q.id).includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(
    sortRows(filtered, sort, { npcName: (q) => q.npcName || q.npcKey }),
    parsePage(params.page),
    perPage,
  );
  const active = Boolean(search || npc || minLevel || maxLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quests"
        description={`${filtered.length.toLocaleString()} of ${quests.length.toLocaleString()} quest definitions`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search title, symbol, token, or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Input
          name="npc"
          defaultValue={npc}
          placeholder="NPC name or key"
          aria-label="Filter by NPC name or character key"
          className="w-40"
        />
        <Input
          name="minLevel"
          type="number"
          min={0}
          defaultValue={minLevel}
          placeholder="Min Lv"
          aria-label="Minimum level"
          className="w-24"
        />
        <Input
          name="maxLevel"
          type="number"
          min={0}
          defaultValue={maxLevel}
          placeholder="Max Lv"
          aria-label="Maximum level"
          className="w-24"
        />
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.id}
        sort={sort}
        params={params}
        unit="quests"
        empty={{
          icon: ScrollText,
          message: active ? 'No quests match your filters' : 'No quest data found',
        }}
      />
    </div>
  );
}
