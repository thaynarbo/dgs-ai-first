import { z } from "zod";
import { logger } from "../shared/logger.js";

// STRUCTURED OUTPUT — formato que a resposta do assistente DEVE seguir.
// .strict() rejeita campos extras; .trim().min(1) garante source_document não-vazio
// (Guardrail 1 coberto estruturalmente, de forma determinística, pelo schema).
export const AssistantResponseSchema = z
	.object({
		answer: z
			.string({ required_error: "answer is required" })
			.trim()
			.min(1, "answer must not be empty"),
		source_document: z
			.string({ required_error: "source_document is required" })
			.trim()
			.min(1, "source_document must not be empty"),
		confidence_score: z
			.number({ required_error: "confidence_score is required" })
			.min(0, "confidence_score must be at least 0")
			.max(1, "confidence_score must be at most 1"),
	})
	.strict();

export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;

// Resposta padrão segura devolvida sempre que a validação falha.
// Não menciona "devolução de carga perigosa" para não violar o próprio Guardrail 2.
const SAFE_REJECTION_RESPONSE: AssistantResponse = {
	answer:
		"Não foi possível validar esta resposta com segurança. Um atendente humano fará a verificação antes de prosseguir.",
	source_document: "N/A",
	confidence_score: 0,
};

// Detecção por radical — independente de ordem, cobre singular/plural e conjugações.
const DANGEROUS_CARGO = /\bcargas?\s+perigosas?\b|\bprodutos?\s+perigosos?\b/;
const RETURN_TOPIC = /\bdevol\w*\b|\bretorno\b/; // devolução, devolver, devolvidas, devolvido...
const PROHIBITION = /\b(nao|nunca|jamais|proibid\w*|vedad\w*|inelegiveis?|nao elegiveis?)\b/;

export function validateResponse(rawResponse: unknown): AssistantResponse {
	// (1) Validação de FORMATO — determinística, via schema Zod.
	//     Cobre o Guardrail 1 (source_document obrigatório e não-vazio).
	const parsed = AssistantResponseSchema.safeParse(rawResponse);

	if (!parsed.success) {
		logger.warn({
			reason: "assistant_response_schema_validation_failed",
			issues: parsed.error.issues.map((issue) => ({
				path: issue.path.join("."),
				code: issue.code,
			})),
			msg: "Assistant response rejected",
		});

		return SAFE_REJECTION_RESPONSE;
	}

	const response = parsed.data;

	// (2) Guardrail 2 — verificação de CONTEÚDO, determinística e fail-safe.
	//     Se a resposta trata de devolução de carga perigosa, DEVE conter negativa
	//     explícita; na ausência dela, bloqueia (POL-001 §3.2).
	if (
		mentionsDangerousCargoReturn(response.answer) &&
		!statesReturnIsForbidden(response.answer)
	) {
		logger.warn({
			reason: "dangerous_cargo_return_without_prohibition",
			msg: "Assistant response rejected",
		});

		return SAFE_REJECTION_RESPONSE;
	}

	return response;
}

function mentionsDangerousCargoReturn(answer: string): boolean {
	const normalized = normalizeText(answer);
	return DANGEROUS_CARGO.test(normalized) && RETURN_TOPIC.test(normalized);
}

function statesReturnIsForbidden(answer: string): boolean {
	return PROHIBITION.test(normalizeText(answer));
}

function normalizeText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}
