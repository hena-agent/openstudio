import { catalog } from "../catalog";
import { route } from "../http";

export const GET = route(async () => catalog(), false, false);
export const POST = route(async () => catalog(true), true, false);
