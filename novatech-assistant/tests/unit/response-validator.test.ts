import { describe, it, expect } from 'vitest';
import { validateResponse } from '../../src/services/response-validator.js';

const validResponse = {
  answer: 'O prazo de devolução é de 7 dias úteis conforme POL-001.',
  source_document: 'POL-001',
  confidence_score: 0.9,
};

describe('validateResponse — schema (structured output)', () => {
  it('aceita uma resposta válida e a devolve intacta', () => {
    expect(validateResponse(validResponse)).toEqual(validResponse);
  });

  it('rejeita quando falta source_document (Guardrail 1)', () => {
    const result = validateResponse({ answer: 'sem fonte', confidence_score: 0.8 });
    expect(result.source_document).toBe('N/A');
    expect(result.confidence_score).toBe(0);
  });

  it('rejeita source_document vazio ou só com espaços', () => {
    const result = validateResponse({ ...validResponse, source_document: '   ' });
    expect(result.source_document).toBe('N/A');
  });

  it('rejeita campos extras (.strict)', () => {
    const result = validateResponse({ ...validResponse, injected: 'x' });
    expect(result.source_document).toBe('N/A');
  });

  it('rejeita confidence_score fora de [0,1]', () => {
    expect(validateResponse({ ...validResponse, confidence_score: 1.5 }).source_document).toBe('N/A');
  });

  it('rejeita entrada não-objeto (ex.: texto cru do modelo)', () => {
    expect(validateResponse('não é json').source_document).toBe('N/A');
  });
});

describe('validateResponse — Guardrail 2 (carga perigosa + devolução)', () => {
  it('bloqueia afirmação de devolução no plural/conjugação (fail-open corrigido)', () => {
    const result = validateResponse({
      ...validResponse,
      answer: 'Sim, cargas perigosas podem ser devolvidas normalmente.',
    });
    expect(result.confidence_score).toBe(0);
  });

  it('bloqueia mesmo com variação "produto perigoso" + "retorno"', () => {
    const result = validateResponse({
      ...validResponse,
      answer: 'O retorno de produtos perigosos é liberado sem restrição.',
    });
    expect(result.confidence_score).toBe(0);
  });

  it('NÃO bloqueia quando há a negativa explícita (ordem inversa da POL-001)', () => {
    const answer =
      'Cargas perigosas classes 1 a 6 não são elegíveis para devolução pelo processo padrão.';
    const result = validateResponse({ ...validResponse, answer });
    expect(result.answer).toBe(answer);
    expect(result.confidence_score).toBe(0.9);
  });

  it('não interfere em respostas sem o tema de carga perigosa', () => {
    const answer = 'O prazo de devolução geral é de 7 dias úteis.';
    const result = validateResponse({ ...validResponse, answer });
    expect(result.answer).toBe(answer);
  });
});
