import { describe, expect, it } from "vitest";

import { planLabelImport } from "./label-import";
import { labelImportSnapshotSchema, snapshotContacts } from "./label-import-snapshot";

describe("acervo portátil de etiquetas", () => {
  it("aceita contatos individuais e ignora grupos sem criar identidades ambíguas", () => {
    const contacts = snapshotContacts([
      { chatId: "5511999999999@c.us", name: "Cliente" },
      { chatId: "123456789@lid", name: null },
      { chatId: "12036300@g.us", name: "Grupo" },
      { chatId: "desconhecido", name: null },
    ]);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]?.identity).toEqual({ kind: "phone", phone: "+5511999999999", lid: null });
    expect(contacts[1]?.identity).toEqual({ kind: "lid", phone: null, lid: "123456789" });
  });

  it("recusa IDs de etiqueta repetidos e campos inesperados", () => {
    const label = { id: "7", name: "TORRESANI", colorHex: null, chats: [] };
    expect(
      labelImportSnapshotSchema.safeParse({
        version: 1,
        account_id: "5511999999999@c.us",
        labels: [label, label],
      }).success,
    ).toBe(false);
    expect(
      labelImportSnapshotSchema.safeParse({
        version: 1,
        account_id: "5511999999999@c.us",
        labels: [label],
        api_key: "não deve entrar",
      }).success,
    ).toBe(false);
  });

  it("recusa arquivo de outro número antes de planejar qualquer contato", async () => {
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      maybeSingle: async () => ({
        data: {
          id: "sessao",
          provider: "waha",
          waha_session_name: "principal",
          phone_number: "+5511999999999",
        },
        error: null,
      }),
    };
    const admin = { from: () => query };
    await expect(
      planLabelImport(admin as never, "org", "sessao", [], {
        version: 1,
        account_id: "5521888888888@c.us",
        labels: [{ id: "7", name: "TORRESANI", colorHex: null, chats: [] }],
      }),
    ).rejects.toMatchObject({ code: "account_mismatch" });
  });
});
