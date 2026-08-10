'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { GoalHover } from './goal-hover';
import type { QuestSlotItem, QuestRequirement } from './types';
import { QUEST_STATE_LABELS, QUEST_STATE_VARIANT } from './types';

interface QuestCardProps {
  item: QuestSlotItem;
  isExpanded: boolean;
  onToggle: () => void;
}

/** Kill-requirement progress: current counter vs the required count. */
function killProgress(item: QuestSlotItem, req: QuestRequirement): number {
  if (req.killIndex === 0) return item.killNpcNum0;
  if (req.killIndex === 1) return item.killNpcNum1;
  return 0;
}

/** One requirement row — hover shows the icon and map goal. */
function RequirementRow({
  req,
  item,
}: {
  req: QuestRequirement;
  item: QuestSlotItem;
}): React.JSX.Element {
  const done =
    req.kind === 'kill' && req.count !== undefined ? killProgress(item, req) >= req.count : false;

  return (
    <li className="flex items-start gap-1.5">
      <span className="text-muted-foreground">•</span>
      <GoalHover iconUrl={req.iconUrl} label={req.label} goal={req.goal}>
        <span className={cn(done && 'text-success line-through')}>{req.label}</span>
      </GoalHover>
      {req.count !== undefined && (
        <span className="text-muted-foreground">
          {req.kind === 'kill'
            ? `${String(String(killProgress)(item, req))} / ${String(req.count)}`
            : `×${String(req.count)}`}
        </span>
      )}
    </li>
  );
}

/** Collapsible detail body. */
function QuestDetail({ item }: { item: QuestSlotItem }): React.JSX.Element {
  const hasNpcs = item.beginNpc != null || item.endNpc != null;

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3 text-xs">
      {item.description && (
        <p className="text-[11px] leading-relaxed text-muted-foreground italic">
          {item.description}
        </p>
      )}

      {item.conditionText && (
        <div>
          <span className="text-muted-foreground">Objective</span>
          <p className="mt-0.5 text-[11px] leading-relaxed text-foreground">{item.conditionText}</p>
        </div>
      )}

      {hasNpcs && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {item.beginNpc && (
            <span>
              <span className="text-muted-foreground">From: </span>
              <GoalHover label={item.beginNpc.name} goal={item.beginNpc.goal}>
                {item.beginNpc.name}
              </GoalHover>
            </span>
          )}
          {item.endNpc && (
            <span>
              <span className="text-muted-foreground">Turn in: </span>
              <GoalHover label={item.endNpc.name} goal={item.endNpc.goal}>
                {item.endNpc.name}
              </GoalHover>
            </span>
          )}
        </div>
      )}

      {item.requirements.length > 0 && (
        <div>
          <span className="text-muted-foreground">Requirements</span>
          <ul className="mt-1 space-y-0.5">
            {item.requirements.map((req, i) => (
              <RequirementRow key={i} req={req} item={item} />
            ))}
          </ul>
        </div>
      )}

      {item.rewards.length > 0 && (
        <div>
          <span className="text-muted-foreground">Rewards</span>
          <ul className="mt-1 space-y-0.5">
            {item.rewards.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-success">
                <span>•</span>
                <GoalHover iconUrl={r.iconUrl} label={r.label}>
                  <span>{r.label}</span>
                </GoalHover>
                {r.count !== undefined && <span className="text-muted-foreground">×{r.count}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.questItems.length > 0 && (
        <div>
          <span className="text-muted-foreground">Drops from</span>
          <ul className="mt-1 space-y-0.5">
            {item.questItems.map((qi, i) => (
              <li key={i} className="flex flex-wrap items-start gap-1.5">
                <span className="text-muted-foreground">•</span>
                <GoalHover iconUrl={qi.itemIconUrl} label={qi.itemName} goal={qi.goal}>
                  <span>{qi.itemName}</span>
                </GoalHover>
                <span className="text-muted-foreground">
                  from {qi.moverName} · {qi.chance.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {item.levelReq && (
          <span>
            Level {item.levelReq[0]}–{item.levelReq[1]}
          </span>
        )}
        {item.categoryLabel && <span>{item.categoryLabel}</span>}
        {item.repeatable && <span>Repeatable</span>}
        {!item.removable && <span>Cannot cancel</span>}
        <span className="font-mono">{item.symbol}</span>
      </div>
    </div>
  );
}

/**
 * One quest row. Collapsed: name, id, state, kill progress, time. Expanded:
 * objective text, begin/turn-in NPCs, requirements, rewards, and drop sources —
 * each with a hover card showing the icon and map coordinates.
 */
export function QuestCard({ item, isExpanded, onToggle }: QuestCardProps): React.JSX.Element {
  const hasKills = item.killNpcNum0 > 0 || item.killNpcNum1 > 0;
  const label = QUEST_STATE_LABELS[item.state] ?? `State ${String(item.state)}`;
  const variant = QUEST_STATE_VARIANT[item.state] ?? 'secondary';

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card/80 transition-colors',
        isExpanded ? 'border-primary/40 bg-card' : 'hover:border-primary/60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">#{item.questId}</span>
              <h4 className="truncate text-sm font-semibold text-foreground">{item.name}</h4>
            </div>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              {item.beginNpc && <span>from {item.beginNpc.name}</span>}
              {item.levelReq && (
                <span>
                  Lv. {item.levelReq[0]}–{item.levelReq[1]}
                </span>
              )}
              {hasKills && (
                <span>
                  kills {item.killNpcNum0}/{item.killNpcNum1}
                </span>
              )}
              {item.time > 0 && (
                <span>
                  {item.time > 60
                    ? `${String(Math.floor(item.time / 60))}m ${String(item.time % 60)}s left`
                    : `${String(item.time)}s left`}
                </span>
              )}
            </p>
          </div>
          <Badge variant={variant}>{label}</Badge>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          <QuestDetail item={item} />
        </div>
      )}
    </div>
  );
}
