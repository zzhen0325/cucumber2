import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getResponseError } from "@/lib/api-client";
import type { UploadedFileForStorage } from "@/lib/file-upload";
import type { ArtifactRef } from "@/types/canvas";

type SignedUploadResponse = {
  upload: {
    bucket: string;
    contentRef: string;
    expiresIn: number;
    path: string;
    signedUrl: string;
    token: string;
    uploadId: string;
  };
};

type CompleteUploadResponse = {
  artifact: ArtifactRef;
};

let cachedStorageClient: SupabaseClient | null = null;

export async function uploadProjectFileAsset(
  projectId: string,
  upload: UploadedFileForStorage
) {
  const signed = await signProjectUpload(projectId, upload);
  const { error } = await getBrowserStorageClient()
    .storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, upload.file, {
      contentType: getFileMimeType(upload.file),
    });

  if (error) {
    throw error;
  }

  return completeProjectUpload(projectId, upload, signed);
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

function getBrowserStorageClient() {
  if (cachedStorageClient) {
    return cachedStorageClient;
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY
  )?.trim();

  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      "Supabase browser upload is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  cachedStorageClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedStorageClient;
}

function getFileMimeType(file: File) {
  return file.type || "application/octet-stream";
}
