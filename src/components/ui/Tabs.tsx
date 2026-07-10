"use client";

import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  /** Gold active pill (admin); default is accent green. */
  variant?: "accent" | "gold";
}

export function Tabs({ tabs, activeId, onChange, ariaLabel, variant = "accent" }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = useCallback((index: number) => {
    const i = ((index % tabs.length) + tabs.length) % tabs.length;
    tabRefs.current[i]?.focus();
    onChange(tabs[i].id);
  }, [onChange, tabs]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = document.documentElement.dir === "rtl";
    let delta = 0;
    if (e.key === "Home") return focusTab(0);
    if (e.key === "End") return focusTab(tabs.length - 1);
    if (rtl) {
      if (e.key === "ArrowLeft") delta = 1;
      else if (e.key === "ArrowRight") delta = -1;
    } else {
      if (e.key === "ArrowRight") delta = 1;
      else if (e.key === "ArrowLeft") delta = -1;
    }
    if (delta) {
      e.preventDefault();
      focusTab(index + delta);
    }
  }, [focusTab, tabs.length]);

  const listClass = variant === "gold" ? "ui-tabs ui-tabs--gold" : "ui-tabs";

  return (
    <>
      <div className={listClass} role="tablist" aria-label={ariaLabel}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={activeId === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={activeId === t.id ? 0 : -1}
            className={`ui-tab${activeId === t.id ? " ui-tab--active" : ""}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            ref={(el) => { tabRefs.current[i] = el; }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${baseId}-panel-${t.id}`}
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={activeId !== t.id}
          className="ui-tabpanel"
          tabIndex={0}
        >
          {activeId === t.id ? t.panel : null}
        </div>
      ))}
    </>
  );
}
