import { z } from "zod";

export const QueryInputSchema = z.object({
  question: z
    .string({ required_error: "question is required" })
    .trim()
    .min(1, "question must not be empty")
    .max(1000, "question must be at most 1000 characters"),
});

export type QueryInput = z.infer<typeof QueryInputSchema>;

export const SourceDocumentSchema = z.object({
  title: z.string(),
  chunk_id: z.string(),
});

export const QueryOutputSchema = z.object({
  answer: z.string().nullable(),
  // Fonte única citada e confiança, provenientes do structured output validado.
  source_document: z.string().optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  // Chunks recuperados pelo retrieval, para rastreabilidade.
  source_documents: z.array(SourceDocumentSchema),
});

export type QueryOutput = z.infer<typeof QueryOutputSchema>;
