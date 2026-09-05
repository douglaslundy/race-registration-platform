import { describe, expect, it } from "vitest";
import {
  filterKitDeliveryItems,
  kitDeliveryAssistantNames,
  parseKitDeliveryListParams,
  sortKitDeliveryItems,
  summarizeKitDeliveryFilters,
} from "@/lib/kit-delivery/list-view";

interface Row {
  participantName: string;
  participantCpf: string | null;
  delivered: boolean;
  deliveredByName: string | null;
}

function row(overrides: Partial<Row>): Row {
  return {
    participantName: "Fulano",
    participantCpf: null,
    delivered: false,
    deliveredByName: null,
    ...overrides,
  };
}

const ana = row({ participantName: "Ana", participantCpf: "11144477735", delivered: true, deliveredByName: "Carlos" });
const bruno = row({ participantName: "Bruno", participantCpf: "22255588846", delivered: true, deliveredByName: "Duda" });
const caio = row({ participantName: "Caio", participantCpf: "33366699957", delivered: false });
const dora = row({ participantName: "Dora", participantCpf: null, delivered: false });

describe("filterKitDeliveryItems", () => {
  const items = [ana, bruno, caio, dora];

  it("status 'delivered' mantém só os entregues", () => {
    expect(filterKitDeliveryItems(items, { status: "delivered", assistant: null, q: "" })).toEqual([ana, bruno]);
  });

  it("status 'pending' mantém só os pendentes", () => {
    expect(filterKitDeliveryItems(items, { status: "pending", assistant: null, q: "" })).toEqual([caio, dora]);
  });

  it("filtra por assistente que entregou", () => {
    expect(filterKitDeliveryItems(items, { status: "all", assistant: "Carlos", q: "" })).toEqual([ana]);
  });

  it("busca por nome (case-insensitive)", () => {
    expect(filterKitDeliveryItems(items, { status: "all", assistant: null, q: "bru" })).toEqual([bruno]);
  });

  it("busca por CPF ignorando pontuação", () => {
    expect(filterKitDeliveryItems(items, { status: "all", assistant: null, q: "111.444.777-35" })).toEqual([ana]);
  });

  it("combina status + assistente + busca", () => {
    expect(
      filterKitDeliveryItems(items, { status: "delivered", assistant: "Duda", q: "bruno" }),
    ).toEqual([bruno]);
  });
});

describe("sortKitDeliveryItems", () => {
  const items = [caio, ana, dora, bruno];

  it("'delivered-first' põe entregues em cima, cada grupo por nome", () => {
    expect(sortKitDeliveryItems(items, "delivered-first")).toEqual([ana, bruno, caio, dora]);
  });

  it("'pending-first' põe pendentes em cima, cada grupo por nome", () => {
    expect(sortKitDeliveryItems(items, "pending-first")).toEqual([caio, dora, ana, bruno]);
  });

  it("não muta o array recebido", () => {
    const input = [caio, ana];
    sortKitDeliveryItems(input, "delivered-first");
    expect(input).toEqual([caio, ana]);
  });
});

describe("kitDeliveryAssistantNames", () => {
  it("lista nomes distintos de quem entregou, em ordem alfabética", () => {
    const dup = row({ participantName: "Eva", delivered: true, deliveredByName: "Carlos" });
    expect(kitDeliveryAssistantNames([bruno, ana, dup, caio])).toEqual(["Carlos", "Duda"]);
  });

  it("ignora entregas sem nome de assistente", () => {
    const semNome = row({ participantName: "Eva", delivered: true, deliveredByName: null });
    expect(kitDeliveryAssistantNames([semNome, ana])).toEqual(["Carlos"]);
  });
});

describe("parseKitDeliveryListParams", () => {
  it("usa padrões quando a query está vazia", () => {
    expect(parseKitDeliveryListParams(new URLSearchParams())).toEqual({
      status: "all",
      assistant: null,
      q: "",
      sort: "delivered-first",
    });
  });

  it("lê status, assistant, q e sort da query", () => {
    const sp = new URLSearchParams("status=pending&assistant=Carlos&q=ana&sort=pending-first");
    expect(parseKitDeliveryListParams(sp)).toEqual({
      status: "pending",
      assistant: "Carlos",
      q: "ana",
      sort: "pending-first",
    });
  });

  it("cai no padrão em valores inválidos", () => {
    const sp = new URLSearchParams("status=xpto&sort=random");
    expect(parseKitDeliveryListParams(sp)).toMatchObject({ status: "all", sort: "delivered-first" });
  });
});

describe("summarizeKitDeliveryFilters", () => {
  it("descreve 'sem filtros' quando tudo é padrão", () => {
    expect(summarizeKitDeliveryFilters({ status: "all", assistant: null, q: "", sort: "delivered-first" })).toBe(
      "Todos os inscritos · entregues primeiro",
    );
  });

  it("descreve status, assistente e busca aplicados", () => {
    expect(
      summarizeKitDeliveryFilters({ status: "delivered", assistant: "Carlos", q: "ana", sort: "pending-first" }),
    ).toBe('Entregues · assistente: Carlos · busca: "ana" · pendentes primeiro');
  });
});
