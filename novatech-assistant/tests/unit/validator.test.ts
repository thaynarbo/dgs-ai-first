import { describe, it, expect } from "vitest";
import { QueryInputSchema, QueryOutputSchema } from "../../src/functions/query/validator";

describe("QueryInputSchema", () => {
  it("rejects body without question field", () => {
    const result = QueryInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = QueryInputSchema.safeParse({ question: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    const result = QueryInputSchema.safeParse({ question: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts a valid question", () => {
    const result = QueryInputSchema.safeParse({ question: "Qual é a política de devolução?" });
    expect(result.success).toBe(true);
  });

  it("accepts a question with exactly 1000 characters", () => {
    const result = QueryInputSchema.safeParse({ question: "a".repeat(1000) });
    expect(result.success).toBe(true);
  });

  it("rejects a question with more than 1000 characters", () => {
    const result = QueryInputSchema.safeParse({ question: "a".repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe("QueryOutputSchema", () => {
  it("accepts answer as string with source_documents array", () => {
    const result = QueryOutputSchema.safeParse({
      answer: "Sim, a política é de 30 dias.",
      source_documents: [{ title: "POL-001", chunk_id: "pol-001-1" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts answer as null with empty source_documents", () => {
    const result = QueryOutputSchema.safeParse({
      answer: null,
      source_documents: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing answer field", () => {
    const result = QueryOutputSchema.safeParse({ source_documents: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing source_documents field", () => {
    const result = QueryOutputSchema.safeParse({ answer: "ok" });
    expect(result.success).toBe(false);
  });

  it("rejects source_documents entry without title", () => {
    const result = QueryOutputSchema.safeParse({
      answer: "ok",
      source_documents: [{ chunk_id: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects source_documents entry without chunk_id", () => {
    const result = QueryOutputSchema.safeParse({
      answer: "ok",
      source_documents: [{ title: "DOC" }],
    });
    expect(result.success).toBe(false);
  });
});
