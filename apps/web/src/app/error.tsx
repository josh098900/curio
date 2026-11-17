"use client";

import type { ComponentProps } from "react";
import SomethingWentWrong from "./(app)/error";
import styles from "./frame.module.css";

/**
 * S54 for a page outside the (app) group, which has no layout of its own to give it a main
 * landmark; global-error.tsx uses it too.
 */
export default function RootError(
  props: ComponentProps<typeof SomethingWentWrong>,
) {
  return (
    <main id="main" className={styles.main}>
      <SomethingWentWrong {...props} />
    </main>
  );
}
