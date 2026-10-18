import { describe, expect, it } from "vitest";
import { makeLabelAssignments } from "./label-import";

const contact = (chatId: string) => ({
  chatId,
  name: null,
  identity: { kind: "phone" as const, phone: "+5511999999999", lid: null },
});
const row = (labelId: string, stageId: string, chatIds: string[]) => ({
  label: { id: labelId, name: labelId, colorHex: null },
  mapping: { label_id: labelId, pipeline_id: "pipeline", stage_id: stageId },
  contacts: chatIds.map(contact),
});

describe("plano de etiquetas", () => {
  it("não escolhe a última coluna quando o mesmo contato tem duas etiquetas", () => {
    const plan = makeLabelAssignments([
      row("locacao", "etapa-locacao", ["1@c.us", "2@c.us"]),
      row("venda", "etapa-venda", ["2@c.us", "3@c.us"]),
    ]);
    expect(plan.conflicts).toBe(1);
    expect(plan.assignments.map((a) => a.contact.chatId)).toEqual(["1@c.us", "3@c.us"]);
  });

  it("remove repetição do mesmo contato na mesma etiqueta", () => {
    const plan = makeLabelAssignments([row("locacao", "etapa", ["1@c.us", "1@c.us"])]);
    expect(plan.conflicts).toBe(0);
    expect(plan.assignments).toHaveLength(1);
  });
});
