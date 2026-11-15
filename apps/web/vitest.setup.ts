import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts after each test only when Vitest runs with globals, which it doesn't.
afterEach(cleanup);
