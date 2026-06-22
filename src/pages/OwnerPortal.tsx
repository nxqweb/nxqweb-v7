import { Bot, CheckCircle2, Clock, MessageSquareText, Users } from "lucide-react";

const mockApprovals = [
  {
    title: "New client request",
    client: "Smith Tree Service",
    summary: "Needs a 5-page service website. Recommended package: Growth. Missing logo/photos.",
    risk: "Low",
  },
  {
    title: "Client message escalation",
    client: "Bamford Forestry",
    summary: "Client asked about adding a land-clearing gallery and Google reviews block.",
    risk: "Medium",
  },
];

const mockClients = [
  { name: "Smith Tree Service", package: "Growth", status: "Needs approval", mrr: "$100/mo" },
  { name: "Bamford Forestry", package: "Premium", status: "Planning", mrr: "$150/mo" },
];

export function OwnerPortal() {
  const totalMrr = "$250/mo";

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner APS</p>
            <h1>NXQ command chat</h1>
            <p className="subtle">
              This is the simple owner portal: AI approvals, client messages, and client overview.
            </p>
          </div>

          <div className="stat-card">
            <span>Monthly income</span>
            <strong>{totalMrr}</strong>
          </div>
        </div>

        <div className="owner-grid">
          <section className="panel panel-large">
            <div className="panel-title">
              <Bot size={20} />
              <h2>AI approval chat</h2>
            </div>

            <div className="chat-feed">
              <div className="ai-bubble">
                <strong>NXQ AI</strong>
                <p>
                  New approval queue ready. I found 2 items that need owner review.
                </p>
              </div>

              {mockApprovals.map((item) => (
                <div className="approval-card" key={item.client}>
                  <div className="approval-top">
                    <span>{item.title}</span>
                    <small>Risk: {item.risk}</small>
                  </div>

                  <h3>{item.client}</h3>
                  <p>{item.summary}</p>

                  <div className="approval-actions">
                    <button>Accept</button>
                    <button>Deny</button>
                    <button>Edit</button>
                    <button>Ask More</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="panel">
            <div className="panel-title">
              <Users size={20} />
              <h2>Clients</h2>
            </div>

            <div className="client-list">
              {mockClients.map((client) => (
                <article className="mini-client-card" key={client.name}>
                  <strong>{client.name}</strong>
                  <span>{client.package}</span>
                  <small>{client.status}</small>
                  <b>{client.mrr}</b>
                </article>
              ))}
            </div>
          </aside>

          <aside className="panel">
            <div className="panel-title">
              <MessageSquareText size={20} />
              <h2>Client messages</h2>
            </div>

            <div className="history-item">
              <Clock size={16} />
              <p>Smith Tree Service asked where to upload photos.</p>
            </div>

            <div className="history-item">
              <CheckCircle2 size={16} />
              <p>AI answered basic onboarding question safely.</p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
