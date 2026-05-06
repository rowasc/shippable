export type ResolvedImageSource =
  | { kind: "local"; src: string; resolvedPath: string }
  | { kind: "blocked"; src: string }
  | { kind: "unavailable"; src: string; resolvedPath: string };

export function resolveImageSrc(
  src: string | undefined,
  baseDir: string,
  imageAssets: Record<string, string> | undefined,
): ResolvedImageSource | undefined {
  if (!src) return undefined;
  if (isBlockedImageSrc(src)) return { kind: "blocked", src };
  const resolved = resolvePath(baseDir, src);
  if (!imageAssets) return { kind: "unavailable", src, resolvedPath: resolved };
  const assetSrc = imageAssets[resolved];
  if (assetSrc) return { kind: "local", src: assetSrc, resolvedPath: resolved };
  return { kind: "unavailable", src, resolvedPath: resolved };
}

export function resolvePath(baseDir: string, rel: string): string {
  const stripped = rel.startsWith("./") ? rel.slice(2) : rel;
  if (stripped.startsWith("/")) return stripped.slice(1);

  const baseParts = baseDir ? baseDir.split("/").filter(Boolean) : [];
  const relParts = stripped.split("/");
  for (const part of relParts) {
    if (part === "..") baseParts.pop();
    else if (part !== "." && part !== "") baseParts.push(part);
  }
  return baseParts.join("/");
}

export function isBlockedImageSrc(src: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src);
}
