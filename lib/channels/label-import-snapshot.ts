/** Acervo portátil, somente de leitura, para etiquetas que o canal ativo não sincronizou. */
import { z } from "zod";

import { normalizarContatosEtiquetados } from "@/lib/channels/label-contacts";

export const labelImportSnapshotSchema = z
  .object({
    version: z.literal(1),
    account_id: z.string().min(1).max(100),
    labels: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            name: z.string().min(1).max(200),
            colorHex: z
              .string()
              .regex(/^#[0-9a-f]{6}$/i)
              .nullable(),
            chats: z
              .array(
                z
                  .object({
                    chatId: z.string().min(1).max(100),
                    name: z.string().max(300).nullable(),
                  })
                  .strict(),
              )
              .max(20_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (new Set(snapshot.labels.map((label) => label.id)).size !== snapshot.labels.length) {
      ctx.addIssue({ code: "custom", message: "etiqueta duplicada" });
    }
    if (snapshot.labels.reduce((sum, label) => sum + label.chats.length, 0) > 40_000) {
      ctx.addIssue({ code: "custom", message: "acervo grande demais" });
    }
  });

export type LabelImportSnapshot = z.infer<typeof labelImportSnapshotSchema>;

export const snapshotContacts = normalizarContatosEtiquetados;
