import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Every link in the app, made with Next's Link and never prefetching (decided on 15 November).
 * Every page is dynamic and none has a loading.tsx, so a prefetch can fetch nothing ahead of the
 * tap. Yet each visible link to a real page cost two server renders through the proxy, and one to
 * a page that doesn't exist yet got a 404 whose body Next never reads, leaving the request open
 * for good, which stalled Lighthouse and the preview's checks. Lint refuses next/link anywhere
 * else. Revisit this when a route adds a loading.tsx: prefetching is what would let its skeleton
 * show the moment someone taps.
 */
export function Link(props: Omit<ComponentProps<typeof NextLink>, "prefetch">) {
  return <NextLink {...props} prefetch={false} />;
}
