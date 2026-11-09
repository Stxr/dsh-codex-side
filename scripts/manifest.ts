import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/** 构建和索引共用清单边界；版本格式同时防止输出目录发生路径穿越。 */
export const manifestSchema = z.object({
  name: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  repository: z.object({ url: z.string().min(1) }), author: z.string(), keywords: z.array(z.string()),
  engines: z.object({ dsh: z.string().min(1) }),
  dsh: z.object({ bundle: z.object({ patch: z.string().min(1) }) }),
  exports: z.record(z.string(), z.union([z.string(), z.object({ types: z.string().optional(), default: z.string() })])),
});
export type ReleaseManifest = z.infer<typeof manifestSchema>;
export async function readManifest(file: URL): Promise<ReleaseManifest> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  return manifestSchema.parse(raw);
}
export function runtimeExport(manifest: ReleaseManifest, key: string): string {
  const value = manifest.exports[key];
  if (!value) throw new Error(`Missing package export ${key}`);
  return typeof value === 'string' ? value : value.default;
}
