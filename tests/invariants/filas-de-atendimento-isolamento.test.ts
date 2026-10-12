/** Filas por organização: leitura, escrita, roteamento e quem pode assumir. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ORG, GOV_SESSION,
  countAs, seedGov, sql, writeCountAs } from "./gov-helpers";

const QUEUE_A = randomUUID();
const QUEUE_B = randomUUID();
const ORG_B = randomUUID();
const CONTACT_ROUTED = randomUUID();
const CONTACT_GENERAL = randomUUID();
const CONV_ROUTED = randomUUID();
const CONV_GENERAL = randomUUID();

function asAgent(userId: string, statement: string): string {
  return sql(`set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${statement}`);
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'fila-b-${ORG_B}', 'Fila B', 'Fila B');
    insert into public.service_queues (id, organization_id, name) values
      ('${QUEUE_A}', '${GOV_ORG}', 'Fila teste A'),
      ('${QUEUE_B}', '${ORG_B}', 'Fila teste B');
    insert into public.service_queue_members (organization_id, queue_id, user_id)
      values ('${GOV_ORG}', '${QUEUE_A}', '${GOV_AGENT_A}');
    insert into public.service_queue_campaign_rules (organization_id, campaign_id, queue_id)
      values ('${GOV_ORG}', 'meta-campanha-001', '${QUEUE_A}');
    insert into public.contacts (id, organization_id, display_name, source_metadata) values
      ('${CONTACT_ROUTED}', '${GOV_ORG}', 'Contato da campanha', '{"ad_platform":"meta_ads","campaign_id":"meta-campanha-001"}'),
      ('${CONTACT_GENERAL}', '${GOV_ORG}', 'Contato sem campanha', '{"ad_platform":"meta_ads"}');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONV_ROUTED}', '${GOV_ORG}', '${CONTACT_ROUTED}', '${GOV_SESSION}', 'open'),
      ('${CONV_GENERAL}', '${GOV_ORG}', '${CONTACT_GENERAL}', '${GOV_SESSION}', 'open');
  `);
});

afterAll(() => {
  sql(`
    delete from public.conversations where id in ('${CONV_ROUTED}', '${CONV_GENERAL}');
    delete from public.contacts where id in ('${CONTACT_ROUTED}', '${CONTACT_GENERAL}');
    delete from public.service_queues where id = '${QUEUE_A}';
    delete from public.organizations where id = '${ORG_B}';
  `);
});

describe("filas de atendimento isoladas por empresa", () => {
  it("um agente vê a fila da própria empresa, nunca a de outra", () => {
    expect(countAs(GOV_AGENT_A, `select count(*) from public.service_queues where id = '${QUEUE_A}'`)).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.service_queues where id = '${QUEUE_B}'`)).toBe(0);
  });

  it("só gestor altera uma fila, não agente", () => {
    expect(writeCountAs(GOV_AGENT_A, `update public.service_queues set description = 'agente' where id = '${QUEUE_A}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.service_queues set description = 'gestor' where id = '${QUEUE_A}'`)).toBe(1);
  });

  it("campanha conhecida entra na fila correta; sem regra fica na Fila geral", () => {
    const routed = sql(`select service_queue_id::text from public.conversations where id = '${CONV_ROUTED}'`).trim();
    const general = sql(`select coalesce(service_queue_id::text, 'GERAL') from public.conversations where id = '${CONV_GENERAL}'`).trim();
    expect(routed).toBe(QUEUE_A);
    expect(general).toBe("GERAL");
  });

  it("agente não envia conversa para fila de outra empresa", () => {
    expect(() => asAgent(GOV_AGENT_A,
      `select public.fn_conversation_send_to_queue('${GOV_ORG}', '${CONV_GENERAL}', '${QUEUE_B}');`,
    )).toThrow(/service_queue_not_found/);
    expect(sql(`select coalesce(service_queue_id::text, 'GERAL') from public.conversations where id = '${CONV_GENERAL}'`).trim()).toBe("GERAL");
  });

  it("só membro da fila pode assumir e a conversa sai dela ao ser assumida", () => {
    expect(() => asAgent(GOV_AGENT_B,
      `select public.fn_conversation_assign('${GOV_ORG}', '${CONV_ROUTED}', '${GOV_AGENT_B}', 'claim', null, true);`,
    )).toThrow(/service_queue_member_required/);
    asAgent(GOV_AGENT_A,
      `select id from public.fn_conversation_assign('${GOV_ORG}', '${CONV_ROUTED}', '${GOV_AGENT_A}', 'claim', null, true);`);
    expect(sql(`select assigned_to_user_id::text || ':' || coalesce(service_queue_id::text, 'GERAL')
      from public.conversations where id = '${CONV_ROUTED}'`).trim()).toBe(`${GOV_AGENT_A}:GERAL`);
  });
});
