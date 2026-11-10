import { afterEach } from "vitest";
import { closeDatabases } from "@openstudio/database";
afterEach(() => closeDatabases());
