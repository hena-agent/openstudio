import { falSearchSchema, searchFalModels } from "../fal";
import { route } from "../http";

export const GET = route(async (request) => {
  const query = new URL(request.url).searchParams;
  const input = falSearchSchema.parse({ query: query.get("q") || "", category: query.get("category") || "text-to-image", cursor: query.get("cursor") || undefined });
  return searchFalModels(input);
}, false, false);
