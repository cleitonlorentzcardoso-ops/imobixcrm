/**
 * Executar por stdin dentro de uma instância WAHA de leitura, sem webhook.
 * O JSON contém identificadores de contatos: salve-o apenas no computador do operador.
 * A chave da API fica no ambiente do contêiner e nunca entra na saída.
 */
const apiKey = process.env.WAHA_API_KEY;
if (!apiKey) throw new Error("Chave WAHA ausente nesta instância.");

async function get(path) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Leitura WAHA: HTTP ${response.status}`);
  return response.json();
}

function chatIdOf(row) {
  if (typeof row === "string") return row;
  if (!row || typeof row !== "object") return null;
  if (typeof row.id === "string") return row.id;
  if (typeof row.id?._serialized === "string") return row.id._serialized;
  if (typeof row.chatId === "string") return row.chatId;
  return null;
}

const sessions = await get("/api/sessions?all=true");
if (!Array.isArray(sessions) || sessions.length !== 1 || sessions[0]?.status !== "WORKING") {
  throw new Error("A exportação exige exatamente uma sessão ativa nesta instância de leitura.");
}
const session = sessions[0];
const accountId = typeof session.me?.id === "string" ? session.me.id : null;
if (!accountId) throw new Error("O número da sessão não foi confirmado pelo WAHA.");
const sessionPath = encodeURIComponent(session.name);
const sourceLabels = await get(`/api/${sessionPath}/labels`);
if (!Array.isArray(sourceLabels)) throw new Error("Resposta de etiquetas inválida.");

const labels = [];
for (const label of sourceLabels) {
  if (typeof label?.id !== "string" || typeof label?.name !== "string") {
    throw new Error("Resposta de etiqueta inválida.");
  }
  const sourceChats = await get(`/api/${sessionPath}/labels/${encodeURIComponent(label.id)}/chats`);
  if (!Array.isArray(sourceChats)) throw new Error("Resposta de conversas inválida.");
  const chats = new Map();
  for (const row of sourceChats) {
    const chatId = chatIdOf(row);
    if (!chatId) continue;
    const name =
      typeof row === "object" && row !== null
        ? typeof row.name === "string"
          ? row.name
          : typeof row.pushname === "string"
            ? row.pushname
            : typeof row.pushName === "string"
              ? row.pushName
              : null
        : null;
    chats.set(chatId, { chatId, name });
  }
  labels.push({
    id: label.id,
    name: label.name,
    colorHex:
      typeof label.colorHex === "string" && /^#[0-9a-f]{6}$/i.test(label.colorHex)
        ? label.colorHex
        : null,
    chats: [...chats.values()].sort((a, b) => a.chatId.localeCompare(b.chatId)),
  });
}

process.stdout.write(JSON.stringify({ version: 1, account_id: accountId, labels }));
