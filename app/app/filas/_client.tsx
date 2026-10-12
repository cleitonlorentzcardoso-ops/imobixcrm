"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UsersThree } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { toast } from "sonner";

type Queue = { id: string; name: string; description: string | null; is_default: boolean; service_queue_members: Array<{ user_id: string }> };

export function FilasClient() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const queues = useQuery({ queryKey: ["service-queues"], queryFn: () => apiClient.get<{ data: Queue[] }>("/api/v1/service-queues").then((r) => r.data) });
  const members = useQuery({ queryKey: ["assignable-members"], enabled: open, queryFn: () => apiClient.get<{ data: Array<{ user_id: string; full_name: string | null; role: string }> }>("/api/v1/team/assignable").then((r) => r.data) });
  const create = useMutation({
    mutationFn: () => apiClient.post("/api/v1/service-queues", { name, description: description || undefined, member_ids: memberIds, is_default: isDefault }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["service-queues"] }); setOpen(false); setName(""); setDescription(""); setMemberIds([]); setIsDefault(false); toast.success("Fila criada."); },
    onError: showApiError,
  });
  const data = queues.data ?? [];
  return <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Filas</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Antes de um corretor assumir, o lead entra aqui. Ao assumir, ele passa para <strong>Minhas</strong>; se necessário, a conversa pode voltar para outra fila.</p></div>
      <Button onClick={() => setOpen(true)}><Plus className="mr-2" size={16} />Criar fila</Button>
    </header>
    <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><strong>Como começar:</strong> crie “Locação” e “Vendas”. Marque uma delas como fila de entrada quando quiser que todo novo lead chegue nela automaticamente. Sem fila padrão, o comportamento atual do CRM continua: a conversa fica na fila geral, sem responsável.</section>
    {queues.isLoading ? <p className="text-sm text-muted-foreground">Carregando filas…</p> : data.length === 0 ? <Card className="border-dashed"><CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><UsersThree size={32} className="text-muted-foreground"/><div><p className="font-medium">Nenhuma fila criada ainda</p><p className="mt-1 text-sm text-muted-foreground">Crie as filas de Locação e Vendas para separar os novos atendimentos.</p></div><Button variant="outline" onClick={() => setOpen(true)}>Criar a primeira fila</Button></CardContent></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.map((queue) => <Card key={queue.id}><CardHeader><CardTitle className="flex items-center justify-between gap-3 text-base">{queue.name}{queue.is_default && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Entrada padrão</span>}</CardTitle><CardDescription>{queue.description || "Sem descrição"}</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">{queue.service_queue_members.length} {queue.service_queue_members.length === 1 ? "atendente vinculado" : "atendentes vinculados"}</CardContent></Card>)}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Criar fila</DialogTitle><DialogDescription>Defina para onde os leads chegam antes de alguém assumir o atendimento.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="queue-name">Nome da fila</Label><Input id="queue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Locação" maxLength={80}/></div><div className="space-y-2"><Label htmlFor="queue-description">Descrição</Label><Textarea id="queue-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: leads interessados em alugar imóveis" maxLength={240}/></div><div className="space-y-2"><Label>Quem pode atender</Label><div className="max-h-32 space-y-2 overflow-y-auto rounded-md border p-3">{members.isLoading ? <p className="text-sm text-muted-foreground">Carregando atendentes…</p> : (members.data ?? []).map((member) => <label key={member.user_id} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={memberIds.includes(member.user_id)} onChange={(e) => setMemberIds((current) => e.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))}/>{member.full_name ?? `Atendente ${member.user_id.slice(0, 8)}`}</label>)}</div></div><div className="flex items-center justify-between gap-4 rounded-md border p-3"><div><Label htmlFor="queue-default">Fila de entrada padrão</Label><p className="mt-1 text-xs text-muted-foreground">Novos leads entram nela até uma regra específica ser configurada.</p></div><Switch id="queue-default" checked={isDefault} onCheckedChange={setIsDefault}/></div></div><DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Criando…" : "Criar fila"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
