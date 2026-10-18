import { afterEach, describe, expect, it, vi } from "vitest";
import { WahaClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("etiquetas do canal", () => {
  it("lê somente as etiquetas e normaliza os chats retornados pelo servidor", async () => {
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/labels")
              ? [{ id: "1", name: "Locação", colorHex: "#123456" }]
              : [
                  { id: { _serialized: "5511999999999@c.us" }, pushName: "Cliente" },
                  "5511888888888@c.us",
                ],
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new WahaClient("http://canal", "chave");
    expect(await client.listarEtiquetas("sessão")).toEqual([
      { id: "1", name: "Locação", colorHex: "#123456" },
    ]);
    expect(await client.listarChatsDaEtiqueta("sessão", "1")).toEqual([
      { chatId: "5511999999999@c.us", name: "Cliente" },
      { chatId: "5511888888888@c.us", name: null },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(encodeURIComponent("sessão"));
  });

  it("não converte resposta malformada em lista vazia que enganaria a prévia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await expect(new WahaClient("http://canal", "chave").listarEtiquetas("s1")).rejects.toThrow(
      "waha_labels_invalid_response",
    );
  });
});
