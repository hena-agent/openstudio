import type { Asset } from "@openstudio/shared/types";

export function AssetPreview({ asset }: { asset: Asset }) {
  const source = `/api/assets?id=${asset.id}`;
  if (asset.kind === "image") return <img className="max-h-80 max-w-full rounded-md object-contain" alt={asset.name} src={source} />;
  if (asset.kind === "video") return <video aria-label={asset.name} className="max-h-80 w-full" controls preload="metadata" src={source} />;
  return <audio aria-label={asset.name} className="w-full" controls preload="metadata" src={source} />;
}
