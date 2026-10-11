/**
 * A etiqueta "Grupo" na lista de conversas.
 *
 * `conversations.is_group` já chega no `SELECT_COLS` do handler (schema
 * original) — este teste prende só a LEITURA na tela: quem abre o inbox
 * precisa distinguir uma conversa de grupo de uma individual sem abrir cada
 * uma. Props mínimas copiadas de `ConversationList.tsx`, via
 * `__fixtures__/conversa.ts`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationListItem } from "./ConversationListItem";
import { conversaDeExemplo } from "./__fixtures__/conversa";

describe("ConversationListItem — etiqueta de grupo", () => {
  it("conversa de grupo tem a etiqueta Grupo", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, is_group: true }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByText("Grupo")).toBeInTheDocument();
  });

  it("conversa individual não tem", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, is_group: false }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.queryByText("Grupo")).toBeNull();
  });
});

/**
 * A bolinha no canto do avatar. A cor sai de quem está no comando, mas cor
 * sozinha não se explica — a palavra vem junto, no `title` e no nome acessível.
 */
describe("ConversationListItem — bolinha de quem atende", () => {
  it("a bolinha do avatar diz em palavras quem está no comando", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          assigned_to_user_id: "user-1",
          assigned_to_user_name: "Ana",
          assignee_kind: "user",
        }}
        {...conversaDeExemplo.props}
      />,
    );
    const bolinha = screen.getByRole("img", { name: "Em atendimento" });
    expect(bolinha).toHaveAttribute("title", "Em atendimento");
  });

  it("conversa encerrada: a bolinha diz Encerrada", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, status: "closed" }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toHaveAttribute("title", "Encerrada");
  });

  // O caminho comum da aba de fechadas: alguém assumiu e fechou. Fechar não solta
  // o dono (`fn_service_status`), e `comandoDaConversa` segue dizendo `humano` de
  // propósito — mas a PALAVRA "Em atendimento" afirmaria um atendimento que acabou.
  it("conversa encerrada COM dono: a bolinha diz Encerrada, nunca Em atendimento", () => {
    render(
      <ConversationListItem
        conversation={{
          ...conversaDeExemplo.conversation,
          status: "closed",
          assigned_to_user_id: "user-1",
          assigned_to_user_name: "Ana",
          assignee_kind: "user",
        }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toHaveAttribute("title", "Encerrada");
    expect(screen.queryByRole("img", { name: "Em atendimento" })).toBeNull();
  });
});

describe("ConversationListItem — seleção em massa", () => {
  it("troca a seleção da conversa sem abrir o atendimento", () => {
    const onSelect = vi.fn();
    const onToggleBulk = vi.fn();

    render(
      <ConversationListItem
        conversation={conversaDeExemplo.conversation}
        {...conversaDeExemplo.props}
        isSelected={false}
        onSelect={onSelect}
        bulkMode
        isBulkSelected={false}
        onToggleBulk={onToggleBulk}
      />,
    );

    const item = screen.getByRole("button", { name: /maria/i });
    expect(item).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(item);

    expect(onToggleBulk).toHaveBeenCalledWith(conversaDeExemplo.conversation.id);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
