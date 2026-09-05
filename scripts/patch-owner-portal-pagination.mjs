import fs from "node:fs";

const path = "src/pages/OwnerPortal.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOne(pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected 1 match, found ${matches.length}`);
  source = source.replace(pattern, replacement);
}

replaceOne(
  /type ClientRow = \{[\s\S]*?\n\};/,
  `type ClientRow = {\n  id: string;\n  business_name: string;\n  contact_name: string | null;\n  contact_email: string | null;\n  business_type: string | null;\n  status: string;\n  monthly_price: number;\n  billing_status: string;\n  billing_provider: string | null;\n  billing_overdue_since: string | null;\n  billing_frozen_at: string | null;\n  notes: string | null;\n  qa_only: boolean;\n  created_at: string;\n  project_id: string | null;\n  website_status: string | null;\n  build_plan: Record<string, unknown> | null;\n  unread_message_count: number;\n};`,
  "ClientRow",
);

replaceOne(
  /type ClientMessageRow = \{[\s\S]*?\n\};/,
  `type ClientMessageRow = {\n  id: string;\n  client_id: string | null;\n  business_name?: string;\n  sender_type: "owner" | "client" | "ai" | "system";\n  message: string;\n  needs_owner_review: boolean;\n  ai_handled: boolean;\n  owner_seen_at: string | null;\n  created_at: string;\n};`,
  "ClientMessageRow",
);

replaceOne(
  /type ProjectRow = \{[\s\S]*?\n\};\n/,
  `type ProjectRow = {\n  id: string;\n  client_id: string | null;\n  website_status: string;\n  build_plan: Record<string, unknown> | null;\n};\n\ntype OwnerPortalSummary = {\n  total_clients: number;\n  active_clients: number;\n  active_monthly_revenue: number;\n  pipeline_clients: number;\n  pipeline_monthly_value: number;\n  unread_client_messages: number;\n  pending_approvals: number;\n};\n\nconst OWNER_PAGE_SIZE = 50;\nconst OWNER_UNREAD_PAGE_SIZE = 25;\n`,
  "summary types",
);

replaceOne(
  /  const \[projects, setProjects\] = useState<ProjectRow\[]>\(\[\]\);\n  const \[clientMessages, setClientMessages\] = useState<ClientMessageRow\[]>\(\[\]\);/,
  `  const [clientMessages, setClientMessages] = useState<ClientMessageRow[]>([]);\n  const [ownerUnreadMessages, setOwnerUnreadMessages] = useState<ClientMessageRow[]>([]);\n  const [ownerSummary, setOwnerSummary] = useState<OwnerPortalSummary>({\n    total_clients: 0,\n    active_clients: 0,\n    active_monthly_revenue: 0,\n    pipeline_clients: 0,\n    pipeline_monthly_value: 0,\n    unread_client_messages: 0,\n    pending_approvals: 0,\n  });\n  const [clientSearch, setClientSearch] = useState("");\n  const [clientHasMore, setClientHasMore] = useState(false);\n  const [messageHasMore, setMessageHasMore] = useState(false);\n  const [isLoadingMore, setIsLoadingMore] = useState(false);`,
  "owner pagination state",
);

replaceOne(
  /  const activeMonthlyIncome = useMemo\(\(\) => \{[\s\S]*?  \}, \[clients\]\);\n\n  const pipelineMonthlyValue = useMemo\(\(\) => \{[\s\S]*?  \}, \[clients\]\);/,
  `  const activeMonthlyIncome = Number(ownerSummary.active_monthly_revenue || 0);\n  const pipelineMonthlyValue = Number(ownerSummary.pipeline_monthly_value || 0);\n  const unreadClientMessageCount = Number(ownerSummary.unread_client_messages || 0);`,
  "global metrics",
);

replaceOne(
  /  const filteredClientMessages = useMemo\(\(\) => \{[\s\S]*?  \}, \[clientMessages, selectedMessageClientId\]\);\n\n  const ownerReviewMessages = useMemo\(\(\) => \{[\s\S]*?  \}, \[clientMessages\]\);\n\n  const unreadMessageCountByClient = useMemo\(\(\) => \{[\s\S]*?  \}, \[ownerReviewMessages\]\);/,
  `  const filteredClientMessages = clientMessages;\n  const ownerReviewMessages = ownerUnreadMessages;\n\n  const unreadMessageCountByClient = useMemo(() => {\n    const counts: Record<string, number> = {};\n    for (const client of clients) counts[client.id] = Number(client.unread_message_count || 0);\n    return counts;\n  }, [clients]);`,
  "message derived state",
);

replaceOne(
  /    const seenAt = new Date\(\)\.toISOString\(\);[\s\S]*?    await loadOwnerData\(\);/,
  `    await loadClientMessagePage(clientId, false);\n    await loadOwnerData();`,
  "open thread refresh",
);

replaceOne(
  /  function getProjectForClient\(clientId: string\) \{[\s\S]*?  \}\n  function getClientForMessage\(message: ClientMessageRow\) \{[\s\S]*?\n\}/,
  `  function getProjectForClient(clientId: string) {\n    const client = clients.find((item) => item.id === clientId);\n    if (!client?.project_id) return null;\n    return {\n      id: client.project_id,\n      client_id: client.id,\n      website_status: client.website_status || "planning",\n      build_plan: client.build_plan,\n    } satisfies ProjectRow;\n  }\n  function getClientForMessage(message: ClientMessageRow) {\n    return clients.find((client) => client.id === message.client_id) || null;\n  }`,
  "project/message lookup",
);

replaceOne(
  /  async function loadOwnerData\(\) \{[\s\S]*?\n  \}\n\n  async function updateApprovalStatus/,
  `  async function loadClientMessagePage(clientId: string, append: boolean) {\n    if (!supabase) return;\n    const existing = append ? clientMessages : [];\n    const cursor = append && existing.length > 0 ? existing[existing.length - 1] : null;\n    const result = await supabase.rpc("owner_client_message_page", {\n      target_client_id: clientId,\n      target_limit: OWNER_PAGE_SIZE,\n      target_cursor_created_at: cursor?.created_at || null,\n      target_cursor_id: cursor?.id || null,\n    });\n    if (result.error) throw result.error;\n    const page = (result.data || []) as ClientMessageRow[];\n    setClientMessages(append ? [...existing, ...page] : page);\n    setMessageHasMore(page.length === OWNER_PAGE_SIZE);\n  }\n\n  async function loadMoreClients() {\n    if (!supabase || clients.length === 0 || isLoadingMore) return;\n    const cursor = clients[clients.length - 1];\n    setIsLoadingMore(true);\n    try {\n      const result = await supabase.rpc("owner_client_directory_page", {\n        target_limit: OWNER_PAGE_SIZE,\n        target_cursor_created_at: cursor.created_at,\n        target_cursor_id: cursor.id,\n        target_search: clientSearch.trim() || null,\n        target_status: null,\n      });\n      if (result.error) throw result.error;\n      const page = (result.data || []) as ClientRow[];\n      setClients((current) => [...current, ...page]);\n      setClientHasMore(page.length === OWNER_PAGE_SIZE);\n    } catch (error) {\n      setErrorMessage(\`Client page load failed: \${error instanceof Error ? error.message : "Unknown error"}\`);\n    } finally {\n      setIsLoadingMore(false);\n    }\n  }\n\n  async function reloadClientSearch() {\n    if (!supabase) return;\n    setIsLoadingMore(true);\n    try {\n      const result = await supabase.rpc("owner_client_directory_page", {\n        target_limit: OWNER_PAGE_SIZE,\n        target_cursor_created_at: null,\n        target_cursor_id: null,\n        target_search: clientSearch.trim() || null,\n        target_status: null,\n      });\n      if (result.error) throw result.error;\n      const page = (result.data || []) as ClientRow[];\n      setClients(page);\n      setClientHasMore(page.length === OWNER_PAGE_SIZE);\n    } catch (error) {\n      setErrorMessage(\`Client search failed: \${error instanceof Error ? error.message : "Unknown error"}\`);\n    } finally {\n      setIsLoadingMore(false);\n    }\n  }\n\n  async function loadOlderMessages() {\n    if (!selectedMessageClientId || isLoadingMore) return;\n    setIsLoadingMore(true);\n    try {\n      await loadClientMessagePage(selectedMessageClientId, true);\n    } catch (error) {\n      setErrorMessage(\`Message page load failed: \${error instanceof Error ? error.message : "Unknown error"}\`);\n    } finally {\n      setIsLoadingMore(false);\n    }\n  }\n\n  async function loadOwnerData() {\n    setIsLoading(true);\n    setErrorMessage("");\n    setActionMessage("");\n\n    if (!isSupabaseConfigured || !supabase) {\n      setIsLoading(false);\n      setErrorMessage("Supabase is not configured yet. Check .env.local.");\n      return;\n    }\n\n    try {\n      const [summaryResult, clientResult, approvalResult, unreadResult] = await Promise.all([\n        supabase.rpc("owner_portal_summary"),\n        supabase.rpc("owner_client_directory_page", {\n          target_limit: OWNER_PAGE_SIZE,\n          target_cursor_created_at: null,\n          target_cursor_id: null,\n          target_search: clientSearch.trim() || null,\n          target_status: null,\n        }),\n        supabase.rpc("owner_approval_page", {\n          target_limit: OWNER_PAGE_SIZE,\n          target_cursor_created_at: null,\n          target_cursor_id: null,\n          target_status: null,\n        }),\n        supabase.rpc("owner_unread_message_page", {\n          target_limit: OWNER_UNREAD_PAGE_SIZE,\n          target_cursor_created_at: null,\n          target_cursor_id: null,\n        }),\n      ]);\n\n      if (summaryResult.error) throw summaryResult.error;\n      if (clientResult.error) throw clientResult.error;\n      if (approvalResult.error) throw approvalResult.error;\n      if (unreadResult.error) throw unreadResult.error;\n\n      const summary = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;\n      if (summary) setOwnerSummary(summary as OwnerPortalSummary);\n\n      const clientPage = (clientResult.data || []) as ClientRow[];\n      setClients(clientPage);\n      setClientHasMore(clientPage.length === OWNER_PAGE_SIZE);\n      setApprovals((approvalResult.data || []) as ApprovalRow[]);\n      setOwnerUnreadMessages((unreadResult.data || []) as ClientMessageRow[]);\n    } catch (error) {\n      const message = error instanceof Error ? error.message : "Unknown load error";\n      setErrorMessage(\`Owner portal load failed: \${message}\`);\n    } finally {\n      setIsLoading(false);\n    }\n  }\n\n  async function updateApprovalStatus`,
  "scalable loader",
);

replaceOne(
  /  const latestProjectBuildPlans = projects\.filter\([\s\S]*?  \);/,
  `  const latestProjectBuildPlans = clients\n    .filter((client) => client.build_plan && Object.keys(client.build_plan).length > 0)\n    .map((client) => ({\n      id: client.project_id || client.id,\n      client_id: client.id,\n      website_status: client.website_status || "planning",\n      build_plan: client.build_plan,\n    } satisfies ProjectRow));`,
  "project plans from paged directory",
);

source = source.replaceAll(
  'Client chat {ownerReviewMessages.length > 0 ? `(${ownerReviewMessages.length})` : ""}',
  'Client chat {unreadClientMessageCount > 0 ? `(${unreadClientMessageCount})` : ""}',
);
source = source.replaceAll(
  '<span>{ownerReviewMessages.length} new</span>',
  '<span>{unreadClientMessageCount} new</span>',
);
source = source.replaceAll(
  'client?.business_name || "Unknown client"',
  'client?.business_name || message.business_name || "Unknown client"',
);

replaceOne(
  /            <div className="client-list">/,
  `            <div className="owner-client-search-row">\n              <input\n                className="message-filter-select"\n                value={clientSearch}\n                onChange={(event) => setClientSearch(event.target.value)}\n                onKeyDown={(event) => { if (event.key === "Enter") void reloadClientSearch(); }}\n                placeholder="Search clients by business, contact, or email"\n                aria-label="Search clients"\n              />\n              <button className="wide-btn" type="button" onClick={() => void reloadClientSearch()} disabled={isLoadingMore}>\n                Search\n              </button>\n              <small>{Number(ownerSummary.total_clients || 0).toLocaleString()} total clients</small>\n            </div>\n\n            <div className="client-list">`,
  "client search UI",
);

replaceOne(
  /              \{clients\.map\(\(client\) => \(/,
  `              {clientHasMore && clients.length > 0 ? (\n                <button className="wide-btn" type="button" onClick={() => void loadMoreClients()} disabled={isLoadingMore}>\n                  {isLoadingMore ? "Loading…" : "Load more clients"}\n                </button>\n              ) : null}\n\n              {clients.map((client) => (`,
  "load more client UI",
);

replaceOne(
  /    \{filteredClientMessages\.map\(\(message\) => \{/,
  `    {messageHasMore && selectedMessageClientId ? (\n      <button className="wide-btn" type="button" onClick={() => void loadOlderMessages()} disabled={isLoadingMore}>\n        {isLoadingMore ? "Loading…" : "Load older messages"}\n      </button>\n    ) : null}\n\n    {filteredClientMessages.map((message) => {`,
  "load older messages UI",
);

fs.writeFileSync(path, source);
console.log("Owner Portal now uses cursor-paginated scalable read models, server-side global metrics, and server search.");
