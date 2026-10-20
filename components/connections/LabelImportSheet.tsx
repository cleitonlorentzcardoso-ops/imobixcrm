"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  labelImportSnapshotSchema,
  type LabelImportSnapshot,
} from "@/lib/channels/label-import-snapshot";
import { useT } from "@/hooks/i18n/useT";

type Label = { id: string; name: string; colorHex: string | null };
type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string; is_won: boolean; is_lost: boolean };
type Mapping = { label_id: string; pipeline_id: string; stage_id: string };
type Preview = {
  contacts: number;
  conflicts: number;
  per_label: Array<{ label_id: string; contacts: number }>;
};
type Batch = {
  created: number;
  moved: number;
  tagged: number;
  unchanged: number;
  skipped: number;
  failed: number;
  next: string | null;
};

const zero = (): Omit<Batch, "next"> => ({
  created: 0,
  moved: 0,
  tagged: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
});

export function LabelImportSheet({
  channelId,
  onClose,
}: {
  channelId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [labels, setLabels] = useState<Label[]>([]);
  const [snapshot, setSnapshot] = useState<LabelImportSnapshot | null>(null);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const snapshotFile = useRef<HTMLInputElement>(null);
  const [funis, setFunis] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Record<string, Stage[]>>({});
  const [choices, setChoices] = useState<Record<string, { pipeline_id: string; stage_id: string }>>(
    {},
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [totals, setTotals] = useState<Omit<Batch, "next"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [automationsReviewed, setAutomationsReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const url = `/api/v1/channel-sessions/${channelId}/labels/import`;

  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiClient
        .get<{ data: Label[] }>(url)
        .then((response) => ({ ...response, unavailable: false }))
        .catch(() => ({ data: [] as Label[], unavailable: true })),
      apiClient.get<{ data: Pipeline[] }>("/api/v1/pipelines"),
    ])
      .then(([labelResponse, pipelineResponse]) => {
        if (!mounted) return;
        setLabels(labelResponse.data);
        setSourceUnavailable(labelResponse.unavailable);
        setFunis(pipelineResponse.data);
      })
      .catch(() => {
        if (mounted) setError(t("Não consegui ler as etiquetas ou os funis deste número."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [url, t]);

  async function loadSnapshot(file: File) {
    setError(null);
    if (file.size > 3_500_000) {
      setError(t("O arquivo de etiquetas é grande demais para esta importação."));
      return;
    }
    try {
      const parsed = labelImportSnapshotSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("invalid_snapshot");
      setSnapshot(parsed.data);
      setLabels(parsed.data.labels.map(({ id, name, colorHex }) => ({ id, name, colorHex })));
      setChoices({});
      setPreview(null);
      setTotals(null);
    } catch {
      setError(
        t("Não consegui ler esse arquivo de etiquetas. Gere um novo arquivo e tente novamente."),
      );
    } finally {
      if (snapshotFile.current) snapshotFile.current.value = "";
    }
  }

  const loadStages = useCallback(
    async (pipelineId: string) => {
      if (!pipelineId || stages[pipelineId]) return;
      try {
        const response = await apiClient.get<{ data: Stage[] }>(
          `/api/v1/pipelines/${pipelineId}/stages`,
        );
        setStages((old) => ({
          ...old,
          [pipelineId]: response.data.filter((stage) => !stage.is_won && !stage.is_lost),
        }));
      } catch {
        setError(t("Não consegui ler as colunas deste funil."));
      }
    },
    [stages, t],
  );

  function choosePipeline(labelId: string, pipelineId: string) {
    setChoices((old) => ({ ...old, [labelId]: { pipeline_id: pipelineId, stage_id: "" } }));
    setPreview(null);
    if (pipelineId) void loadStages(pipelineId);
  }

  function chooseStage(labelId: string, stageId: string) {
    setChoices((old) => ({
      ...old,
      [labelId]: { pipeline_id: old[labelId]?.pipeline_id ?? "", stage_id: stageId },
    }));
    setPreview(null);
  }

  function mappings(): Mapping[] {
    return labels.flatMap((label) => {
      const choice = choices[label.id];
      return choice?.pipeline_id && choice.stage_id
        ? [{ label_id: label.id, pipeline_id: choice.pipeline_id, stage_id: choice.stage_id }]
        : [];
    });
  }

  async function inspect() {
    setBusy(true);
    setError(null);
    setTotals(null);
    try {
      const response = await apiClient.post<{ data: Preview }>(
        url,
        { mode: "preview", mappings: mappings(), ...(snapshot ? { snapshot } : {}) },
        { timeoutMs: 120_000 },
      );
      setPreview(response.data);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : t("A prévia falhou. Confira a conexão e tente novamente."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    let cursor: string | null = null;
    const summary = zero();
    try {
      do {
        const response: { data: Batch } = await apiClient.post<{ data: Batch }>(
          url,
          {
            mode: "apply",
            mappings: mappings(),
            after: cursor,
            automations_reviewed: automationsReviewed,
            ...(snapshot ? { snapshot } : {}),
          },
          { timeoutMs: 120_000 },
        );
        for (const key of [
          "created",
          "moved",
          "tagged",
          "unchanged",
          "skipped",
          "failed",
        ] as const) {
          summary[key] += response.data[key];
        }
        setTotals({ ...summary });
        cursor = response.data.next;
      } while (cursor);
      setPreview(null);
    } catch (cause) {
      const detail = cause instanceof ApiError ? ` ${cause.message}` : "";
      setError(
        `${t("A importação parou. Os lotes concluídos foram mantidos; revise o resultado antes de repetir.")}${detail}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("Etiquetas do WhatsApp Business")}</SheetTitle>
          <SheetDescription>
            {t(
              "Escolha uma coluna para cada etiqueta. Primeiro confira a prévia; nada muda no WhatsApp.",
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
          <div className="rounded-md border p-3 text-sm">
            <p>
              {t(
                "Se as etiquetas deste número não aparecerem, use um arquivo exportado do mesmo WhatsApp.",
              )}
            </p>
            <input
              ref={snapshotFile}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label={t("Arquivo de etiquetas")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadSnapshot(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={busy}
              onClick={() => snapshotFile.current?.click()}
            >
              {t("Escolher arquivo de etiquetas")}
            </Button>
            {snapshot && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("Arquivo carregado:")} {snapshot.labels.length} {t("etiquetas")}.{" "}
                {t("Confira os destinos antes de importar.")}
              </p>
            )}
          </div>
          {loading && <p className="text-sm text-muted-foreground">{t("Carregando etiquetas…")}</p>}
          {!loading && sourceUnavailable && !snapshot && (
            <p className="text-sm text-muted-foreground">
              {t(
                "A conexão não entregou as etiquetas. Você pode usar um arquivo exportado deste número.",
              )}
            </p>
          )}
          {!loading && labels.length === 0 && !error && !sourceUnavailable && (
            <p className="text-sm">{t("Nenhuma etiqueta encontrada neste número.")}</p>
          )}
          {labels.map((label) => (
            <div key={label.id} className="rounded-md border p-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                {label.colorHex && (
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: label.colorHex }}
                    aria-hidden
                  />
                )}
                {label.name}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label={`${label.name}: ${t("Funil")}`}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  disabled={busy}
                  value={choices[label.id]?.pipeline_id ?? ""}
                  onChange={(event) => choosePipeline(label.id, event.target.value)}
                >
                  <option value="">{t("Não importar")}</option>
                  {funis.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${label.name}: ${t("Coluna")}`}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  disabled={busy || !choices[label.id]?.pipeline_id}
                  value={choices[label.id]?.stage_id ?? ""}
                  onChange={(event) => chooseStage(label.id, event.target.value)}
                >
                  <option value="">{t("Escolha a coluna")}</option>
                  {(stages[choices[label.id]?.pipeline_id ?? ""] ?? []).map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </div>
              {preview && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {preview.per_label.find((item) => item.label_id === label.id)?.contacts ?? 0}{" "}
                  {t("contatos na prévia")}
                </p>
              )}
            </div>
          ))}
          {preview && (
            <div className="rounded-md border p-3 text-sm" role="status">
              {preview.contacts} {t("conversas etiquetadas para analisar")}.
              {preview.conflicts > 0 && (
                <p>
                  {preview.conflicts}{" "}
                  {t(
                    "contatos com mais de uma etiqueta escolhida serão ignorados para evitar destino ambíguo.",
                  )}
                </p>
              )}
            </div>
          )}
          {totals && (
            <div className="rounded-md border p-3 text-sm" role="status">
              {totals.created} {t("criados")}, {totals.moved} {t("movidos")}, {totals.tagged}{" "}
              {t("etiquetados")}, {totals.unchanged} {t("já corretos")}, {totals.skipped}{" "}
              {t("preservados por conflito com outro funil")}, {totals.failed} {t("não concluídos")}
              .
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Negócios abertos em outro funil não serão movidos. Mensagens antigas não são importadas. Automações do CRM podem reagir à criação ou mudança de negócios.",
          )}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={automationsReviewed}
            disabled={busy}
            onChange={(event) => setAutomationsReviewed(event.target.checked)}
          />
          {t(
            "Revisei minhas automações e estou ciente de que elas podem enviar mensagens aos clientes.",
          )}
        </label>
        <div className="flex gap-2 pt-3">
          <Button
            variant="outline"
            onClick={() => void inspect()}
            disabled={busy || mappings().length === 0}
          >
            {t("Conferir prévia")}
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={busy || !preview || preview.contacts === 0 || !automationsReviewed}
          >
            {busy ? t("Processando…") : t("Importar para o CRM")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
