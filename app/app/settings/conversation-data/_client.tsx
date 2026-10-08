"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface Canal {
  id: string;
  nome: string;
  status: string;
  historico_ligado: boolean;
  pronto: boolean;
}

interface Lote {
  lidas: number;
  importadas: number;
  repetidas: number;
  ignoradas: number;
  proximo_offset: number;
  concluido: boolean;
  desde: string;
}

interface Totais {
  lidas: number;
  importadas: number;
  repetidas: number;
  ignoradas: number;
}

const ZERADO: Totais = { lidas: 0, importadas: 0, repetidas: 0, ignoradas: 0 };

export function ConversationDataClient() {
  const t = useT();
  const canais = useQuery({
    queryKey: ["conversation-data-channels"],
    queryFn: () => apiClient.get<{ data: Canal[] }>("/api/v1/settings/conversation-data"),
    refetchOnWindowFocus: false,
  });
  const [canalId, setCanalId] = useState("");
  const [dias, setDias] = useState(30);
  const [importando, setImportando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [totais, setTotais] = useState<Totais>(ZERADO);
  const canal = canais.data?.data.find((item) => item.id === canalId) ?? null;

  async function importar() {
    if (!canalId || dias < 1 || dias > 3650) return;
    setImportando(true);
    setConcluido(false);
    setTotais(ZERADO);
    let offset = 0;
    let desde: string | undefined;
    const acumulado = { ...ZERADO };
    try {
      for (;;) {
        const resposta = await apiClient.post<{ data: Lote }>(
          "/api/v1/settings/conversation-data",
          { channel_session_id: canalId, dias, offset, desde },
          { timeoutMs: 60_000 },
        );
        const lote = resposta.data;
        acumulado.lidas += lote.lidas;
        acumulado.importadas += lote.importadas;
        acumulado.repetidas += lote.repetidas;
        acumulado.ignoradas += lote.ignoradas;
        setTotais({ ...acumulado });
        offset = lote.proximo_offset;
        desde = lote.desde;
        if (lote.concluido) break;
      }
      setConcluido(true);
      toast.success(t("Importação concluída."));
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : t("A importação foi interrompida."));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Dados de conversas")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("Traga para o Inbox as conversas que o canal guardou antes de ser conectado ao CRM.")}
        </p>
      </header>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("Importar conversas antigas")}</CardTitle>
          <CardDescription>
            {t("As mensagens entram como histórico. Elas não disparam IA, automações, avisos nem distribuição de atendimento.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {canais.isError ? (
            <p role="alert" className="text-sm text-destructive">{t("Não foi possível listar as conexões.")}</p>
          ) : null}

          <div className="space-y-2">
            <Label>{t("Conexão do WhatsApp")}</Label>
            <Select value={canalId} onValueChange={setCanalId} disabled={importando || canais.isLoading}>
              <SelectTrigger>
                <SelectValue placeholder={t("Escolha uma conexão")} />
              </SelectTrigger>
              <SelectContent>
                {(canais.data?.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dias-historico">{t("Quantos dias deseja importar?")}</Label>
            <Input
              id="dias-historico"
              type="number"
              min={1}
              max={3650}
              value={dias}
              disabled={importando}
              onChange={(event) => setDias(Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">{t("Você pode repetir a importação depois. Mensagens já existentes não são duplicadas.")}</p>
          </div>

          {canal && !canal.historico_ligado ? (
            <div className="rounded-md border border-warning-border bg-warning-bg p-4 text-sm text-warning-fg">
              <p>{t("O armazenamento de histórico está desligado nesta conexão.")}</p>
              <Button asChild variant="link" className="mt-2">
                <Link href="/app/connections">{t("Abrir Conexões para ativar")}</Link>
              </Button>
            </div>
          ) : null}

          {canal && (canal.status !== "WORKING" || !canal.pronto) ? (
            <p role="alert" className="text-sm text-warning-fg">{t("A conexão precisa estar online para importar.")}</p>
          ) : null}

          {importando ? (
            <div className="space-y-2" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
              </div>
              <p className="text-sm text-muted-foreground">{t("Importando em lotes seguros…")}</p>
            </div>
          ) : null}

          {(totais.lidas > 0 || concluido) ? (
            <div className="grid grid-cols-2 gap-3 rounded-md border p-4 text-sm sm:grid-cols-4" aria-live="polite">
              <div><strong className="block text-lg">{totais.importadas}</strong>{t("Importadas")}</div>
              <div><strong className="block text-lg">{totais.repetidas}</strong>{t("Já existiam")}</div>
              <div><strong className="block text-lg">{totais.ignoradas}</strong>{t("Ignoradas")}</div>
              <div><strong className="block text-lg">{totais.lidas}</strong>{t("Analisadas")}</div>
            </div>
          ) : null}

          <Button
            type="button"
            disabled={
              importando ||
              !canal ||
              !canal.historico_ligado ||
              canal.status !== "WORKING" ||
              !canal.pronto ||
              dias < 1 ||
              dias > 3650
            }
            onClick={() => void importar()}
          >
            {importando ? t("Importando…") : t("Importar dados antigos")}
          </Button>

          <p className="text-xs text-muted-foreground">
            {t("Se o número foi conectado antes de o histórico ser ativado, pode ser necessário vinculá-lo novamente para o canal baixar as conversas antigas.")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
