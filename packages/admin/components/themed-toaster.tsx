'use client';

import * as React from 'react';
import { Toaster } from 'sonner';

/**
 * Sonner's own `theme="system"` reads the OS media query, which is wrong here —
 * the theme is an explicit class on `<html>` set by [ThemeToggle]. Mirror that
 * class instead so toasts match the rest of the panel.
 */
export function ThemedToaster(): React.JSX.Element {
  const [dark, setDark] = React.useState(true);

  React.useEffect(() => {
    const el = document.documentElement;
    const sync = (): void => {
      setDark(el.classList.contains('dark'));
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return (): void => {
      obs.disconnect();
    };
  }, []);

  return <Toaster position="top-right" theme={dark ? 'dark' : 'light'} richColors closeButton />;
}
