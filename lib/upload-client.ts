export type UploadPurpose = "banner" | "list_banner" | "regulation" | "kit_info";

type PresignResponse = {
  url: string;
  fileUrl: string;
};

function toErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
    return JSON.stringify(value);
  }
  return fallback;
}

export async function uploadFileViaPresign(file: File, purpose: UploadPurpose): Promise<string> {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      purpose,
      mimeType: file.type,
      size: file.size,
    }),
  });

  const presignData = await presignRes.json().catch(() => null);
  if (!presignRes.ok) {
    throw new Error(toErrorMessage(presignData, "Erro ao preparar upload"));
  }

  const { url, fileUrl } = presignData as PresignResponse;
  if (!url || !fileUrl) {
    throw new Error("Resposta inválida ao preparar upload");
  }

  const uploadRes = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
    },
    body: file,
  });

  if (!uploadRes.ok) {
    const uploadError = await uploadRes.text().catch(() => "");
    throw new Error(uploadError || "Falha ao enviar arquivo para o storage");
  }

  return fileUrl;
}
