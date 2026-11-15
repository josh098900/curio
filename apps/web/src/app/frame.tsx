import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { currentUser } from "@/server/session";
import { AppShell } from "@/shared/shell/AppShell";
import styles from "./frame.module.css";

/** A page without the shell: the main landmark, padded. */
export function PlainPage({ children }: { children: ReactNode }) {
  return (
    <main id="main" className={styles.main}>
      {children}
    </main>
  );
}

/**
 * The shell for someone signed in, a plain page for anyone else. The (app) group's layout uses it,
 * and so does the 404, which Next renders outside every group. If Auth can't answer, the page
 * still renders without the shell, and a page that needs the user shows S54 itself.
 */
export async function ShellIfSignedIn({ children }: { children: ReactNode }) {
  const user = await currentUser().catch((error) => {
    unstable_rethrow(error);
    return null;
  });
  return user ? (
    <AppShell>{children}</AppShell>
  ) : (
    <PlainPage>{children}</PlainPage>
  );
}
