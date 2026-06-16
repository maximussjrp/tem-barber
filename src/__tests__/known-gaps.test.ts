import { describe, it } from "vitest";

describe("lacunas conhecidas da Fase 0", () => {
  it.todo("impede reservas concorrentes para intervalos sobrepostos");
  it.todo("requisicao repetida com a mesma intencao nao cria duplicidade");
  it.todo("endpoint administrativo impede sobreposicao de horarios");
  it.todo("toda alteracao de status gera historico");
  it.todo("rotas publicas aplicam rate limit");
});
