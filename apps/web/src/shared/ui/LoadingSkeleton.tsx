import styles from "./LoadingSkeleton.module.css";

/**
 * Placeholder rows while something loads. Screen readers hear "Loading…" once, not the rows.
 */
export function LoadingSkeleton() {
  return (
    <div role="status" className={styles.skeleton}>
      <span className="visually-hidden">Loading…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className={styles.row}>
          <span className={styles.line} />
          <span className={`${styles.line} ${styles.short}`} />
        </div>
      ))}
    </div>
  );
}
