import { getSetting } from "./settings";

export interface StorageConfig {
  bucket: string;
  endpoint?: string;
  accessKey: string;
  secretKey: string;
  region: string;
  publicUrlBase?: string;
}

export async function getStorageConfig(): Promise<StorageConfig> {
  const [bucket, endpoint, accessKey, secretKey, publicUrlBase] = await Promise.all([
    getSetting("storage_bucket"),
    getSetting("storage_endpoint"),
    getSetting("storage_access_key"),
    getSetting("storage_secret_key"),
    getSetting("storage_public_url"),
  ]);

  return {
    bucket: bucket ?? process.env.STORAGE_BUCKET ?? "",
    endpoint: endpoint ?? process.env.STORAGE_ENDPOINT ?? undefined,
    accessKey: accessKey ?? process.env.STORAGE_ACCESS_KEY ?? "",
    secretKey: secretKey ?? process.env.STORAGE_SECRET_KEY ?? "",
    region: process.env.STORAGE_REGION ?? "us-east-1",
    publicUrlBase: publicUrlBase ?? undefined,
  };
}

export function isStorageReady(config: StorageConfig): boolean {
  return Boolean(config.bucket && config.accessKey && config.secretKey);
}
