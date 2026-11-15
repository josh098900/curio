// Stands in for the server-only package in Vitest. The real one throws when it's imported
// outside React Server Components, which is what keeps src/server off the client (T03), and
// Vitest isn't one.
export {};
