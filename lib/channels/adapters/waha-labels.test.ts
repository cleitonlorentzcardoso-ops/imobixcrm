import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => ({
    listarChatsDaEtiqueta: async () => [
      { chatId: "5511999999999@c.us", name: "Cliente" },
      { chatId: "123456789@lid", name: null },
      { chatId: "120363000000000000@g.us", name: "Grupo" },
      { chatId: "qualquer-coisa@c.us", name: "Inválido" },
    ],
  }),
}));

import { wahaAdapter } from "./waha";

describe("contatos com etiqueta", () => {
  it("importa somente chats individuais válidos, nunca grupo ou JID desconhecido", async () => {
    const contacts = await wahaAdapter.listLabeledContacts!({ sessionRef: "numero", labelId: "1" });
    expect(contacts).toHaveLength(2);
    expect(contacts[0]?.identity).toEqual({ kind: "phone", phone: "+5511999999999", lid: null });
    expect(contacts[1]?.identity).toEqual({ kind: "lid", phone: null, lid: "123456789" });
  });
});
