import { ImagePlus, MessageCircle, UploadCloud } from "lucide-react";

export function ClientPortal() {
  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Client Portal</p>
            <h1>Your website project hub</h1>
            <p className="subtle">
              Clients will use this portal to fill intake, message NXQ, upload photos,
              request changes, and track their website stage.
            </p>
          </div>

          <div className="stat-card">
            <span>Project stage</span>
            <strong>Intake</strong>
          </div>
        </div>

        <div className="client-grid">
          <section className="panel">
            <div className="panel-title">
              <MessageCircle size={20} />
              <h2>Message NXQ</h2>
            </div>
            <p className="subtle">
              Ask questions, send updates, or request changes. AI answers simple things
              and escalates important questions to the owner.
            </p>
            <textarea placeholder="Type your message here..." />
            <button className="wide-btn">Send message</button>
          </section>

          <section className="panel">
            <div className="panel-title">
              <UploadCloud size={20} />
              <h2>Upload files</h2>
            </div>
            <p className="subtle">
              Upload logos, business photos, reviews, service images, and content for your website.
            </p>
            <div className="upload-box">
              <ImagePlus size={30} />
              <span>File upload will connect to Supabase Storage soon.</span>
            </div>
          </section>

          <section className="panel panel-wide">
            <h2>Project tracker</h2>
            <div className="tracker">
              <span className="active">Intake</span>
              <span>Owner Review</span>
              <span>Planning</span>
              <span>Building</span>
              <span>Review</span>
              <span>Live</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
