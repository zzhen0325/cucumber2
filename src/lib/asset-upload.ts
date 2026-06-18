import { getResponseError } from "@/lib/api-client";
import type { UploadedFileForStorage } from "@/lib/file-upload";
import type { ArtifactRef } from "@/types/canvas";

type SignedUploadResponse = {
  upload: {
    bucket: string;
    contentRef: string;
    expiresIn: number;
    headers: Record<string, string>;
    method: "PUT";
    path: string;
    signedUrl: string;
    uploadId: string;
  };
};

type CompleteUploadResponse = {
  artifact: ArtifactRef;
};

export async function uploadProjectFileAsset(
  projectId: string,
  upload: UploadedFileForStorage
) {
  const totalStartedAt = nowMs();
  let uploadId: string | undefined;
  let signMs: number | undefined;
  let storageUploadMs: number | undefined;
  let completeMs: number | undefined;

  try {
    const signStartedAt = nowMs();
    const signed = await signProjectUpload(projectId, upload);
    signMs = elapsedMs(signStartedAt);
    uploadId = signed.uploadId;

    const storageUploadStartedAt = nowMs();
    const storageResponse = await fetch(signed.signedUrl, {
      body: upload.file,
      headers: signed.headers,
      method: signed.method,
    });
    storageUploadMs = elapsedMs(storageUploadStartedAt);

    if (!storageResponse.ok) {
      throw new Error(
        `R2 upload failed (${storageResponse.status} ${storageResponse.statusText}).`
      );
    }

    const completeStartedAt = nowMs();
    const artifact = await completeProjectUpload(projectId, upload, signed);
    completeMs = elapsedMs(completeStartedAt);

    logUploadTiming("completed", {
      artifactId: artifact.id,
      completeMs,
      fileName: upload.title,
      kind: upload.kind,
      signMs,
      sizeBytes: upload.file.size,
      storageUploadMs,
      totalMs: elapsedMs(totalStartedAt),
      uploadId,
    });

    return artifact;
  } catch (error) {
    logUploadTiming("failed", {
      completeMs,
      error: getLogError(error),
      fileName: upload.title,
      kind: upload.kind,
      signMs,
      sizeBytes: upload.file.size,
      storageUploadMs,
      totalMs: elapsedMs(totalStartedAt),
      uploadId,
    });
    throw error;
  }
}

async function signProjectUpload(
  projectId: string,
  upload: UploadedFileForStorage
) {
  const response = await fetch(`/api/projects/${projectId}/uploads/sign`, {
    body: JSON.stringify({
      fileName: upload.title,
      mimeType: getFileMimeType(upload.file),
      sizeBytes: upload.file.size,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return ((await response.json()) as SignedUploadResponse).upload;
}

async function completeProjectUpload(
  projectId: string,
  upload: UploadedFileForStorage,
  signed: SignedUploadResponse["upload"]
) {
  const response = await fetch(
    `/api/projects/${projectId}/uploads/${signed.uploadId}/complete`,
    {
      body: JSON.stringify({
        bucket: signed.bucket,
        fileName: upload.title,
        height: upload.dimensions?.height,
        kind: upload.kind,
        mimeType: getFileMimeType(upload.file),
        path: signed.path,
        preview: upload.preview,
        sizeBytes: upload.file.size,
        summary: upload.summary,
        title: upload.title,
        width: upload.dimensions?.width,
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return ((await response.json()) as CompleteUploadResponse).artifact;
}

function getFileMimeType(file: File) {
  return file.type || "application/octet-stream";
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsedMs(startedAt: number) {
  return Math.round(nowMs() - startedAt);
}

function logUploadTiming(
  status: "completed" | "failed",
  details: Record<string, unknown>
) {
  console.info("[upload:asset]", {
    status,
    ...details,
  });
}

function getLogError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
