import {
  GeneratedInboxSchema,
  NoveltyScanResultSchema,
  ViabilityResultSchema
} from "@/lib/v2/schemas";

export function parseInboxGenerationOutput(raw: string) {
  return GeneratedInboxSchema.parse(JSON.parse(raw));
}

export function parseNoveltyScanOutput(raw: string) {
  return NoveltyScanResultSchema.parse(JSON.parse(raw));
}

export function parseViabilityOutput(raw: string) {
  return ViabilityResultSchema.parse(JSON.parse(raw));
}
