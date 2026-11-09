import { catalog } from "../catalog";
import { route } from "../http";

export const GET = route(async () => catalog());
export const POST = route(async () => catalog(true), true);
