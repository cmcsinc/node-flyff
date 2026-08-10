'use client';

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface Section {
  key: string;
  label: string;
  badge?: string | number;
  content: React.ReactNode;
}

interface ResponsiveSectionsProps {
  sections: Section[];
}

/**
 * Responsive layout for character sub-sections:
 *
 * - **Desktop (≥xl):** 3 equal columns side-by-side.
 * - **Tablet (md–lg):** 2 columns — first section full-width on top, remaining
 *   sections side-by-side below.
 * - **Mobile (<md):** tabbed interface.
 */
export function ResponsiveSections({ sections }: ResponsiveSectionsProps): React.JSX.Element {
  const [mode, setMode] = React.useState<'mobile' | 'tablet' | 'desktop'>('mobile');

  React.useEffect(() => {
    const mobile = window.matchMedia('(max-width: 767px)');
    const desktop = window.matchMedia('(min-width: 1280px)');

    function sync(): void {
      setMode(desktop.matches ? 'desktop' : mobile.matches ? 'mobile' : 'tablet');
    }
    sync();

    mobile.addEventListener('change', sync);
    desktop.addEventListener('change', sync);
    return (): void => {
      mobile.removeEventListener('change', sync);
      desktop.removeEventListener('change', sync);
    };
  }, []);

  if (mode === 'mobile') {
    return (
      <Tabs defaultValue={sections[0]?.key}>
        <TabsList className="w-full">
          {sections.map((s) => (
            <TabsTrigger key={s.key} value={s.key} className="flex-1">
              {s.label}
              {s.badge !== undefined && (
                <span className="ml-1.5 rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {s.badge}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map((s) => (
          <TabsContent key={s.key} value={s.key}>
            {s.content}
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  if (mode === 'desktop') {
    return (
      <div className="grid grid-cols-3 gap-4">
        {sections.map((s) => (
          <div key={s.key} className="min-w-0">
            {s.content}
          </div>
        ))}
      </div>
    );
  }

  // Tablet: first section full-width, remaining two side-by-side.
  const [first, ...rest] = sections;
  return (
    <div className="space-y-4">
      <div>{first.content}</div>
      {rest.length > 0 && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${String(rest.length)}, minmax(0, 1fr))` }}
        >
          {rest.map((s) => (
            <div key={s.key} className="min-w-0">
              {s.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
