"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, UsersThree } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

const SUGGESTED_QUEUES = ["Campanha Torresani", "Campanha Altos Sta Helena"] as const;

type Queue = {
  id: string;
  name: string;
  description: string | null;
  service_queue_members: Array<{ user_id: string }>;
  service_queue_campaign_rules: Array<{ campaign_id: string }>;
};
type Member = { user_id: string; full_name: string | null; role: string };
type WaitingConversation = {
  id: string;
  awaiting_since: string | null;
  last_message_preview: string | null;
  contacts: { display_name: string | null; name: string | null; phone_number: string | null } | null;
};
type WaitingPage = { conversations: WaitingConversation[]; count: number; page: number };

function campaignIds(text: string): string[] {
  return [...new Set(text.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean))];
}

export function FilasClient({ canManage }: { canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState("");

  const queues = useQuery({
    queryKey: ["service-queues"],
    queryFn: () => apiClient.get<{ data: Queue[] }>("/api/v1/service-queues").then((r) => r.data),
  });
  const members = useQuery({
    queryKey: ["assignable-members"], enabled: formOpen,
    queryFn: () => apiClient.get<{ data: Member[] }>("/api/v1/team/assignable").then((r) => r.data),
  });
  const waiting = useQuery({
    queryKey: ["service-queue-conversations", selectedQueueId, page], enabled: selectedQueueId !== null,
    refetchInterval: selectedQueueId ? 15_000 : false,
    queryFn: () => apiClient.get<{ data: WaitingPage }>(`/api/v1/service-queues/${selectedQueueId}/conversations?page=${page}`).then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, member_ids: memberIds, campaign_ids: campaignIds(campaigns) };
      return editingId ? apiClient.patch(`/api/v1/service-queues/${editingId}`, body)
        : apiClient.post("/api/v1/service-queues", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-queues"] });
      setFormOpen(false);
      toast.success(editingId ? t("Fila atualizada.") : t("Fila criada."));
    },
    onError: showApiError,
  });
  const claim = useMutation({
    mutationFn: (conversationId: string) => apiClient.post(`/api/v1/conversations/${conversationId}/claim`, { expected_assignee: null }),
    onSuccess: (_result, conversationId) => {
      queryClient.invalidateQueries({ queryKey: ["service-queue-conversations", selectedQueueId] });
      router.push(`/app/inbox?id=${conversationId}`);
    },
    onError: showApiError,
  });

  const data = queues.data ?? [];
  const selectedQueue = data.find((queue) => queue.id === selectedQueueId);
  const missingSuggestedQueues = SUGGESTED_QUEUES
    .filter((suggestedName) => !data.some((queue) => queue.name === suggestedName));

  function openCreate(suggestedName = "") {
    setEditingId(null);
    setName(suggestedName);
    setDescription("");
    setMemberIds([]);
    setCampaigns("");
    setFormOpen(true);
  }
  function openEdit(queue: Queue) {
    setEditingId(queue.id);
    setName(queue.name);
    setDescription(queue.description ?? "");
    setMemberIds(queue.service_queue_members.map((member) => member.user_id));
    setCampaigns(queue.service_queue_campaign_rules.map((rule) => rule.campaign_id).join("\n"));
    setFormOpen(true);
  }
  function openQueue(id: string) {
    setSelectedQueueId(id);
    setPage(0);
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Filas")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("Os leads das campanhas aparecem na fila correspondente. Assuma uma conversa para levá-la a Minhas.")}
          </p>
        </div>
        {canManage && <Button onClick={() => openCreate()}><Plus className="mr-2" size={16} />{t("Criar fila")}</Button>}
      </header>

      <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        {t("Sem ID de campanha configurado, o lead continua na Fila geral. A conexão com a Meta será feita depois.")}
      </section>

      {canManage && missingSuggestedQueues.length > 0 && !queues.isLoading && (
        <div className="flex flex-wrap gap-2">
          {missingSuggestedQueues.includes(SUGGESTED_QUEUES[0]) &&
            <Button variant="outline" onClick={() => openCreate(SUGGESTED_QUEUES[0])}>{t("Criar Campanha Torresani")}</Button>}
          {missingSuggestedQueues.includes(SUGGESTED_QUEUES[1]) &&
            <Button variant="outline" onClick={() => openCreate(SUGGESTED_QUEUES[1])}>{t("Criar Campanha Altos Sta Helena")}</Button>}
        </div>
      )}

      {queues.isLoading ? <p className="text-sm text-muted-foreground">{t("Carregando filas…")}</p>
        : data.length === 0 ? (
          <Card className="border-dashed"><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <UsersThree size={32} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("Nenhuma fila cadastrada nesta empresa.")}</p>
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.map((queue) => (
              <Card key={queue.id} className={selectedQueueId === queue.id ? "border-primary" : undefined}>
                <CardHeader>
                  <CardTitle className="text-base">{queue.name}</CardTitle>
                  <CardDescription>{queue.description || t("Sem descrição")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{queue.service_queue_members.length} {t("atendentes vinculados")}</p>
                  <p>{queue.service_queue_campaign_rules.length} {t("IDs de campanha")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm"
                      disabled={!canManage && !queue.service_queue_members.some((member) => member.user_id === user.id)}
                      onClick={() => openQueue(queue.id)}>{t("Abrir fila")}</Button>
                    {canManage && <Button variant="ghost" size="sm" onClick={() => openEdit(queue)}>{t("Editar")}</Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      {selectedQueue && (
        <section className="space-y-3" aria-label={t("Conversas da fila")}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{selectedQueue.name} · {waiting.data?.count ?? 0} {t("aguardando")}</h2>
            <Button variant="ghost" onClick={() => setSelectedQueueId(null)}>{t("Fechar fila")}</Button>
          </div>
          {waiting.isLoading ? <p className="text-sm text-muted-foreground">{t("Carregando conversas…")}</p>
            : waiting.isError ? <p className="text-sm text-destructive">{t("Não foi possível carregar as conversas.")}</p>
              : waiting.data?.conversations.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nenhuma conversa aguardando nesta fila.")}</p>
                : <div className="space-y-2">{waiting.data?.conversations.map((conversation) => (
                  <Card key={conversation.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="font-medium">{rotuloDoContato(conversation.contacts, t)}</p>
                      <p className="truncate text-sm text-muted-foreground">{conversation.last_message_preview || t("Sem prévia")}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" asChild><Link href={`/app/inbox?id=${conversation.id}`}>{t("Ver conversa")}</Link></Button>
                      <Button size="sm" disabled={claim.isPending || (!canManage && !selectedQueue.service_queue_members.some((member) => member.user_id === user.id))}
                        onClick={() => claim.mutate(conversation.id)}>{t("Atender")}</Button>
                    </div>
                  </CardContent></Card>
                ))}</div>}
          {(waiting.data?.count ?? 0) > 50 && <div className="flex items-center justify-center gap-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>{t("Anterior")}</Button>
            <span className="text-sm text-muted-foreground">{page + 1}</span>
            <Button variant="outline" disabled={(page + 1) * 50 >= (waiting.data?.count ?? 0)} onClick={() => setPage((current) => current + 1)}>{t("Próxima")}</Button>
          </div>}
        </section>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("Editar fila") : t("Criar fila")}</DialogTitle>
            <DialogDescription>{t("Vincule atendentes e IDs de campanha da Meta a esta fila.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="queue-name">{t("Nome da fila")}</Label>
              <Input id="queue-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Ex.: Campanha Torresani")} maxLength={80} /></div>
            <div className="space-y-2"><Label htmlFor="queue-description">{t("Descrição")}</Label>
              <Textarea id="queue-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} /></div>
            <div className="space-y-2"><Label>{t("Quem pode atender")}</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                {members.isLoading ? <p>{t("Carregando atendentes…")}</p> : (members.data ?? []).map((member) => (
                  <label key={member.user_id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={memberIds.includes(member.user_id)} onChange={(event) =>
                      setMemberIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />
                    {member.full_name ?? `${t("Atendente")} ${member.user_id.slice(0, 8)}`}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2"><Label htmlFor="queue-campaigns">{t("IDs de campanha da Meta")}</Label>
              <Textarea id="queue-campaigns" value={campaigns} onChange={(event) => setCampaigns(event.target.value)}
                placeholder={t("Um ID de campanha por linha")} rows={3} />
              <p className="text-xs text-muted-foreground">{t("Deixe vazio por enquanto. Ao conectar a Meta, associe cada ID à fila desejada.")}</p>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setFormOpen(false)}>{t("Cancelar")}</Button>
            <Button disabled={name.trim().length < 2 || save.isPending || campaignIds(campaigns).some((id) => id.length > 100)}
              onClick={() => save.mutate()}>{save.isPending ? t("Salvando…") : t("Salvar fila")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
