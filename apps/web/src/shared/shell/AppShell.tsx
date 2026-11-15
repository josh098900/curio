import type { ReactNode } from "react";
import styles from "./AppShell.module.css";
import { BottomNav, TopNav } from "./Nav";
import { OfflineNotice } from "./online";

/**
 * The frame around every page someone signed in sees: the top bar on desktop, the tab bar on
 * phones, and the offline notice (spec §11, shared foundation).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div data-shell>
      <TopNav />
      <OfflineNotice className={styles.notice} />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
