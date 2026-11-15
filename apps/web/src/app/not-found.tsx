import { IconCompass, IconSearch } from "@tabler/icons-react";
import { ERROR_MESSAGES } from "@curio/contracts";
import type { Metadata } from "next";
import { SystemPage } from "@/shared/shell/SystemPage";
import { ButtonLink } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/StateMessage";
import { ShellIfSignedIn } from "./frame";

export const metadata: Metadata = { title: "Not found" };

/**
 * S53 Not found: the contract's NOT_FOUND message, with the frame's words under it. The shell is
 * there when someone is signed in.
 */
export default function NotFound() {
  return (
    <ShellIfSignedIn>
      <SystemPage>
        <EmptyState
          icon={<IconSearch aria-hidden="true" />}
          title={ERROR_MESSAGES.NOT_FOUND}
          action={
            <ButtonLink href="/" icon={<IconCompass aria-hidden="true" />}>
              Back to Discover
            </ButtonLink>
          }
        >
          The link might be wrong, or what it pointed to has been removed.
        </EmptyState>
      </SystemPage>
    </ShellIfSignedIn>
  );
}
