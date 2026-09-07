// drizzle-kit is a standalone CLI, not part of the Next.js runtime, so nothing else has populated
// process.env by the time this is read.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
