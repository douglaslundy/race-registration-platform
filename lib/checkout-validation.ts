import { z } from "zod";

export function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

export function opaqueIdField() {
  return z.preprocess(emptyStringToUndefined, z.string().trim().min(1, "ID inválido"));
}

export function optionalOpaqueIdField() {
  return z.preprocess(emptyStringToUndefined, z.string().trim().min(1, "ID inválido").optional());
}

export function optionalEnumField<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(emptyStringToUndefined, z.enum(values).optional());
}

export function extractApiErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return null;

  const payload = error as {
    error?: unknown;
    message?: unknown;
    formErrors?: unknown;
    fieldErrors?: unknown;
  };

  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.message === "string") return payload.message;
  if (Array.isArray(payload.formErrors) && payload.formErrors[0] && typeof payload.formErrors[0] === "string") {
    return payload.formErrors[0];
  }

  const fieldErrors = payload.fieldErrors;
  if (fieldErrors && typeof fieldErrors === "object") {
    for (const value of Object.values(fieldErrors as Record<string, unknown>)) {
      if (Array.isArray(value) && value[0] && typeof value[0] === "string") {
        return value[0];
      }
    }
  }

  return null;
}
