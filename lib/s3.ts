import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getStorageConfig, isStorageReady } from "./storage-settings";

export { isStorageReady } from "./storage-settings";

async function makeS3Client() {
  const config = await getStorageConfig();
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
  return { client, config };
}

export async function isS3Configured(): Promise<boolean> {
  const config = await getStorageConfig();
  return isStorageReady(config);
}

export async function getPublicUrl(key: string): Promise<string> {
  const config = await getStorageConfig();
  if (config.publicUrlBase) return `${config.publicUrlBase}/${key}`;
  if (config.endpoint) return `${config.endpoint}/${config.bucket}/${key}`;
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}

export async function createPresignedUploadUrl({
  purpose,
  mimeType,
  extension,
}: {
  purpose: string;
  mimeType: string;
  extension: string;
}) {
  const { client, config } = await makeS3Client();
  const key = `${purpose}/${randomUUID()}.${extension}`;
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: mimeType,
  });
  const url = await getSignedUrl(client, command, { expiresIn: 600 });
  return { url, key, fileUrl: await getPublicUrl(key) };
}

export async function deleteObject(key: string): Promise<void> {
  const { client, config } = await makeS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
