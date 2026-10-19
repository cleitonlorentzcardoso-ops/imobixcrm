/** Normalização única dos contatos individuais retornados por uma etiqueta. */
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import type { ChannelLabeledContact } from "@/lib/channels/types";

export function normalizarContatosEtiquetados(
  chats: Array<{ chatId: string; name: string | null }>,
): ChannelLabeledContact[] {
  return chats.flatMap<ChannelLabeledContact>(({ chatId, name }) => {
    const phone = /^(\d{8,15})@(?:c\.us|s\.whatsapp\.net)$/.exec(chatId);
    if (phone)
      return [
        {
          chatId,
          name,
          identity: { kind: "phone" as const, phone: canonicalPhoneBR(`+${phone[1]}`), lid: null },
        },
      ];
    const lid = /^(\d{1,30})@lid$/.exec(chatId);
    if (lid)
      return [
        {
          chatId,
          name,
          identity: { kind: "lid" as const, phone: null, lid: lid[1]! },
        },
      ];
    return [];
  });
}
