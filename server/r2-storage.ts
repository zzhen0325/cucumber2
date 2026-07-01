import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const DEFAULT_R2_ASSETS_BUCKET = "agent-assets";
export const DEFAULT_R2_SKILL_PACKAGES_BUCKET = "agent-skill-packages";
export const DEFAULT_R2_SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;
export const DEFAULT_R2_SIGNED_READ_TTL_SECONDS = 10 * 60;
const MAX_R2_PRESIGNED_TTL_SECONDS = 7 * 24 * 60 * 60;

type PutObjectInput = {
  bucket: string;
  cacheControl?: string;
  contentType: string;
  path: string;
  bytes: Uint8Array;
};

type SignedUploadInput = {
  bucket: string;
  contentType: string;
  expiresIn?: number;
  path: string;
};

type SignedReadInput = {
  bucket: string;
  expiresIn?: number;
  path: string;
};

let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

export function getR2AssetsBucket() {
  return readOptionalEnv("R2_ASSETS_BUCKET") || DEFAULT_R2_ASSETS_BUCKET;
}

export function getR2SkillPackagesBucket() {
  return readOptionalEnv("R2_SKILL_PACKAGES_BUCKET") || DEFAULT_R2_SKILL_PACKAGES_BUCKET;
}

export function getR2SignedUploadTtlSeconds() {
  return readTtlSeconds(
    "R2_SIGNED_UPLOAD_TTL_SECONDS",
    DEFAULT_R2_SIGNED_UPLOAD_TTL_SECONDS
  );
}

export function getR2SignedReadTtlSeconds() {
  return readTtlSeconds(
    "R2_SIGNED_READ_TTL_SECONDS",
    DEFAULT_R2_SIGNED_READ_TTL_SECONDS
  );
}

export function isR2Configured() {
  return Boolean(
    readOptionalEnv("R2_ACCOUNT_ID") &&
      readOptionalEnv("R2_ACCESS_KEY_ID") &&
      readOptionalEnv("R2_SECRET_ACCESS_KEY")
  );
}

export async function putObject({
  bucket,
  bytes,
  cacheControl,
  contentType,
  path,
}: PutObjectInput) {
  await getR2Client().send(
    new PutObjectCommand({
      Body: bytes,
      Bucket: bucket,
      CacheControl: cacheControl,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
      Key: path,
    })
  );
}

export async function getObject(bucket: string, path: string) {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    })
  );
  const bytes = await readResponseBody(response.Body);

  return {
    bytes,
    etag: response.ETag,
    mimeType: response.ContentType,
    sizeBytes: response.ContentLength ?? bytes.byteLength,
  };
}

export async function headObject(bucket: string, path: string) {
  const response = await getR2Client().send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: path,
    })
  );

  return {
    etag: response.ETag,
    mimeType: response.ContentType,
    sizeBytes: response.ContentLength ?? null,
  };
}

export async function deleteObject(bucket: string, path: string) {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: path,
    })
  );
}

export async function createPresignedUploadUrl({
  bucket,
  contentType,
  expiresIn = getR2SignedUploadTtlSeconds(),
  path,
}: SignedUploadInput) {
  const signedUrl = await getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: bucket,
      ContentType: contentType,
      Key: path,
    }),
    { expiresIn }
  );

  return {
    expiresIn,
    headers: {
      "Content-Type": contentType,
    },
    method: "PUT" as const,
    signedUrl,
  };
}

export async function createPresignedReadUrl({
  bucket,
  expiresIn = getR2SignedReadTtlSeconds(),
  path,
}: SignedReadInput) {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    }),
    { expiresIn }
  );
}

function getR2Client() {
  const config = readR2Config();
  const clientKey = JSON.stringify(config);
  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
  });
  cachedClientKey = clientKey;
  return cachedClient;
}

function readR2Config() {
  const accountId = readOptionalEnv("R2_ACCOUNT_ID");
  const accessKeyId = readOptionalEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = readOptionalEnv("R2_SECRET_ACCESS_KEY");

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
    );
  }

  return {
    accessKeyId,
    accountId,
    secretAccessKey,
  };
}

function readOptionalEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function readTtlSeconds(name: string, fallback: number) {
  const raw = readOptionalEnv(name);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_R2_PRESIGNED_TTL_SECONDS
  ) {
    throw new Error(
      `${name} must be an integer between 1 and ${MAX_R2_PRESIGNED_TTL_SECONDS}.`
    );
  }
  return value;
}

async function readResponseBody(body: GetObjectCommandOutput["Body"]) {
  if (!body) {
    throw new Error("R2 did not return object bytes.");
  }

  const transformable = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof transformable.transformToByteArray === "function") {
    return transformable.transformToByteArray();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Uint8Array(Buffer.concat(chunks));
}
