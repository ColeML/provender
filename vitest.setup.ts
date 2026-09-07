import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount between tests: a leaked tree makes the next test's getByRole ambiguous, which reads as a
// broken component rather than a dirty environment.
afterEach(cleanup);
