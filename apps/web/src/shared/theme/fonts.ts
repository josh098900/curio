import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";

// IBM Plex Sans for the interface and Plex Sans Condensed for times, counts and section headers
// (brief §3). next/font serves every script Google has for each family from Curio itself (Latin,
// Cyrillic, Greek, Vietnamese…), each file loaded by unicode-range only when a page needs it, so
// names from everywhere render, the browser never asks Google, and the CSP's font-src 'self'
// holds. Nothing is preloaded, so no subsets are named.
export const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  preload: false,
});

export const plexSansCondensed = IBM_Plex_Sans_Condensed({
  weight: ["500", "600"],
  variable: "--font-plex-cond",
  preload: false,
});
