import { IconAlertCircle } from "@tabler/icons-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import styles from "./fields.module.css";

type Described = {
  label: string;
  /** A hint under the field, such as "1–40 characters". */
  hint?: string;
  /** The message next to the field, from packages/contracts' field-rule messages. */
  error?: string;
};

/**
 * The ids that tie a field to its hint and error: a screen reader reads both with the field, and
 * aria-invalid marks it wrong (WEB-UI-09). A form also shows "Check the highlighted fields" in an
 * error Banner, which is announced as it appears.
 */
function useDescribed({ hint, error }: Omit<Described, "label">) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return {
    id,
    control: {
      id,
      "aria-invalid": error ? true : undefined,
      "aria-describedby":
        [hintId, errorId].filter(Boolean).join(" ") || undefined,
    },
    messages: (
      <>
        {hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className={styles.error}>
            <IconAlertCircle aria-hidden="true" />
            {error}
          </p>
        )}
      </>
    ),
  };
}

function Field({
  id,
  label,
  children,
  messages,
}: {
  id: string;
  label: string;
  children: ReactNode;
  messages: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {messages}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  ...input
}: Described & ComponentProps<"input">) {
  const { id, control, messages } = useDescribed({ hint, error });
  return (
    <Field id={id} label={label} messages={messages}>
      <input dir="auto" {...input} {...control} className={styles.control} />
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  ...textarea
}: Described & ComponentProps<"textarea">) {
  const { id, control, messages } = useDescribed({ hint, error });
  return (
    <Field id={id} label={label} messages={messages}>
      <textarea
        dir="auto"
        {...textarea}
        {...control}
        className={`${styles.control} ${styles.long}`}
      />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  children,
  ...select
}: Described & ComponentProps<"select">) {
  const { id, control, messages } = useDescribed({ hint, error });
  return (
    <Field id={id} label={label} messages={messages}>
      <select {...select} {...control} className={styles.control}>
        {children}
      </select>
    </Field>
  );
}

export function Checkbox({
  label,
  hint,
  error,
  ...input
}: Described & Omit<ComponentProps<"input">, "type">) {
  const { id, control, messages } = useDescribed({ hint, error });
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.check}>
        <input {...input} {...control} type="checkbox" />
        {label}
      </label>
      {messages}
    </div>
  );
}
