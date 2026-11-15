import { IconLogout } from "@tabler/icons-react";
import type { Metadata } from "next";
import { Link } from "@/shared/ui/Link";
import { safeNextPath, SIGN_IN_PATH } from "@/shared/navigation";
import { SystemPage } from "@/shared/shell/SystemPage";
import { ButtonLink } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/StateMessage";

export const metadata: Metadata = { title: "Signed out" };

/**
 * S56 Signed out, where requireUser() sends someone whose session stopped working. Sign in again
 * carries `next` on, once it's checked to be a path on Curio. T17 decides what else lands here,
 * and adds the name of the page they'll go back to; T19 builds the terms and privacy pages.
 */
export default async function SignedOut({
  searchParams,
}: PageProps<"/signed-out">) {
  const next = safeNextPath((await searchParams).next);
  return (
    <SystemPage
      footer={
        <>
          <Link href="/terms">Terms of use</Link>
          <Link href="/privacy">Privacy notice</Link>
        </>
      }
    >
      <EmptyState
        icon={<IconLogout aria-hidden="true" />}
        title="You've been signed out"
        action={
          <ButtonLink
            wide
            href={
              next
                ? `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`
                : SIGN_IN_PATH
            }
          >
            Sign in again
          </ButtonLink>
        }
      >
        Sign in again to carry on where you left off.
      </EmptyState>
    </SystemPage>
  );
}
