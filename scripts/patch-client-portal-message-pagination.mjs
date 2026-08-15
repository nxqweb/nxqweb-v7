import fs from "node:fs";

const path = "src/pages/ClientPortal.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source shape not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source shape matched more than once`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  '  const [messages, setMessages] = useState<ClientMessageRow[]>([]);',
  '  const [messages, setMessages] = useState<ClientMessageRow[]>([]);\n  const [messageHasMore, setMessageHasMore] = useState(false);\n  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);',
  "message pagination state",
);

replaceOnce(
`      const messageResult = await supabase
        .from("client_messages")
        .select(
          "id, client_id, sender_type, message, needs_owner_review, ai_handled, created_at"
        )
        .eq("client_id", loadedClient.id)
        .order("created_at", { ascending: false });`,
`      const messageResult = await supabase.rpc("current_client_message_page", {
        target_limit: 50,
        target_cursor_created_at: null,
        target_cursor_id: null,
      });`,
  "initial client message query",
);

replaceOnce(
`      } else {
        setMessages((messageResult.data || []) as ClientMessageRow[]);
      }

      const fileListResult`,
`      } else {
        const messagePage = (messageResult.data || []) as ClientMessageRow[];
        setMessages(messagePage);
        setMessageHasMore(messagePage.length === 50);
      }

      const fileListResult`,
  "initial client message result",
);

const sendAnchor = '  async function sendClientMessage() {';
const sendIndex = source.indexOf(sendAnchor);
if (sendIndex < 0) throw new Error("sendClientMessage anchor not found");
source = source.slice(0, sendIndex) + `  async function loadOlderMessages() {
    if (!supabase || messages.length === 0 || isLoadingOlderMessages) return;

    const cursor = messages[messages.length - 1];
    setIsLoadingOlderMessages(true);
    setErrorMessage("");

    try {
      const result = await supabase.rpc("current_client_message_page", {
        target_limit: 50,
        target_cursor_created_at: cursor.created_at,
        target_cursor_id: cursor.id,
      });

      if (result.error) throw result.error;

      const page = (result.data || []) as ClientMessageRow[];
      setMessages((current) => [...current, ...page]);
      setMessageHasMore(page.length === 50);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown message history error";
      setErrorMessage(\`Older messages failed to load: \${message}\`);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }

` + source.slice(sendIndex);

replaceOnce(
`              {messages.map((message) => {`,
`              {messageHasMore && messages.length > 0 ? (
                <button
                  className="wide-btn"
                  type="button"
                  onClick={() => void loadOlderMessages()}
                  disabled={isLoadingOlderMessages}
                >
                  {isLoadingOlderMessages ? "Loading…" : "Load older messages"}
                </button>
              ) : null}

              {messages.map((message) => {`,
  "load older messages button",
);

if (source.includes('.from("client_messages")')) {
  throw new Error("Client Portal still contains a direct client_messages read");
}
if (!source.includes('current_client_message_page')) throw new Error("Tenant-derived message page RPC missing");
if (!source.includes('Load older messages')) throw new Error("Load older messages UI missing");

fs.writeFileSync(path, source);
console.log("Client Portal message history now uses tenant-derived cursor pagination with no total-history ceiling.");
