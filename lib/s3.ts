import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const REGION = process.env.STORAGE_REGION ?? "us-east-1";
const BUCKET = process.env.STORAGE_BUCKET ?? "";
const ENDPOINT = process.env.STORAGE_ENDPOINT;

export const s3 = new S3Client({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: true } : {}),
  credentials:
    process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY
      ? {
          accessKeyId: process.env.STORAGE_ACCESS_KEY,
          secretAccessKey: process.env.STORAGE_SECRET_KEY,
        }
      : undefined,
});

export function isS3Configured() {
  return Boolean(
    process.env.STORAGE_ACCESS_KEY &&
    process.env.STORAGE_SECRET_KEY &&
    process.env.STORAGE_BUCKET
  );
}

export function getPublicUrl(key: string) {
  if (ENDPOINT) return `${ENDPOINT}/${BUCKET}/${key}`;
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
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
  const key = `${purpose}/${randomUUID()}.${extension}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
  });
  const url = await getSignedUrl(s3, command, { expiresIn: 600 });
  return { url, key, fileUrl: getPublicUrl(key) };
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
