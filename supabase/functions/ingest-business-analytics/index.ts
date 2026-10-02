import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Event = {event_type?: string;page_path?: string;anonymous_session_key?: string;normalized_x?: number;normalized_y?: number;scroll_depth?: number;consent_version?: string;occurred_at?: string;metadata?: Record<string, unknown>;};
type Payload = {schema_version?: string;ingest_key?: string;events?: Event[];};
type AnalyticsProfile = {id: string;client_id: string;project_id: string;status: string;consent_mode: string;consent_version: string;page_view_enabled: boolean;click_enabled: boolean;scroll_depth_enabled: boolean;mouse_tracking_enabled: boolean;allowed_origins: string[] | null;hourly_event_limit: number | null;};
type QuotaReservation = {allowed?: boolean;retry_after_seconds?: number;};
const MAX_REQUEST_BYTES = 65536;
function requestOrigin(req:Request){const origin=(req.headers.get("origin")||"").trim();return /^https:\/\/[^\s/$.?#].*$/i.test(origin)?origin:"";}
function cors(origin:string){return {"Content-Type":"application/json","Access-Control-Allow-Origin":origin||"https://invalid.nxq.local","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};}
function secret(name: string) {const value = Deno.env.get(name)?.trim();if (!value) throw new Error(`Missing protected secret: ${name}`);return value;}
function response(body: unknown, status = 200,origin="") {return new Response(JSON.stringify(body), { status, headers: cors(origin) });}
function boundedText(value: unknown, max: number) {return typeof value === "string" ? value.slice(0, max) : "";}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");}
async function reserveAnalyticsQuota(admin:SupabaseClient,profile:AnalyticsProfile,ingestKey:string,units:number){const identityHash=await sha256(`analytics-profile:${profile.id}:${ingestKey}`);const reservation=await admin.rpc("nxq_reserve_ingress_capacity",{target_scope_key:`analytics-profile:${profile.id}`,target_operation_key:"analytics_events_hourly",target_identity_hash:identityHash,target_units:units,target_limit_units:Number(profile.hourly_event_limit||5000),target_window_seconds:3600});if(reservation.error)throw new Error(`Analytics quota reservation failed: ${reservation.error.message}`);return reservation.data as QuotaReservation;}
function allowedMetadata(value: unknown) {if (!value || typeof value !== "object" || Array.isArray(value)) return {};const input = value as Record<string, unknown>;const out: Record<string, unknown> = {};for (const key of ["element", "destination_kind", "viewport_class", "device_class", "referrer_kind", "utm_source", "utm_medium", "utm_campaign"]) {const metadataValue = input[key];if (typeof metadataValue === "string") out[key] = metadataValue.slice(0, 100);}return out;}
function normalizeEvent(event: Event, profile: AnalyticsProfile) {const type = String(event.event_type || "");if (!["page_view", "click", "scroll_depth", "mouse_heatpoint"].includes(type)) throw new Error("Unsupported analytics event type.");if (type === "mouse_heatpoint" && !profile.mouse_tracking_enabled) throw new Error("Mouse heatpoints are not enabled for this project.");if (type === "click" && !profile.click_enabled) throw new Error("Click analytics are disabled.");if (type === "scroll_depth" && !profile.scroll_depth_enabled) throw new Error("Scroll analytics are disabled.");if (type === "page_view" && !profile.page_view_enabled) throw new Error("Page-view analytics are disabled.");const x = typeof event.normalized_x === "number" ? event.normalized_x : null;const y = typeof event.normalized_y === "number" ? event.normalized_y : null;const depth = typeof event.scroll_depth === "number" ? Math.round(event.scroll_depth) : null;if ((x !== null && (x < 0 || x > 1)) || (y !== null && (y < 0 || y > 1)) || (depth !== null && (depth < 0 || depth > 100))) throw new Error("Analytics coordinates/depth are invalid.");const consent = boundedText(event.consent_version, 30);if (profile.consent_mode === "required" && consent !== profile.consent_version) throw new Error("Analytics consent version is missing or stale.");const occurred = event.occurred_at ? new Date(event.occurred_at) : new Date();if (Number.isNaN(occurred.getTime()) || Math.abs(Date.now() - occurred.getTime()) > 86400000) throw new Error("Analytics timestamp is invalid.");return {analytics_profile_id: profile.id,client_id: profile.client_id,project_id: profile.project_id,event_type: type,page_path: boundedText(event.page_path || "/", 500) || "/",anonymous_session_key: boundedText(event.anonymous_session_key, 100) || null,normalized_x: x,normalized_y: y,scroll_depth: depth,consent_version: consent || null,metadata: allowedMetadata(event.metadata),occurred_at: occurred.toISOString(),};}

Deno.serve(async (req) => {
  const origin=requestOrigin(req);
  if (req.method === "OPTIONS") return new Response(null, { status: origin?204:403, headers: cors(origin) });
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405,origin);
  if(!origin)return response({ok:false,error:"A valid HTTPS origin is required."},403,origin);
  const declaredSize=Number(req.headers.get("content-length")||"0");
  if(Number.isFinite(declaredSize)&&declaredSize>MAX_REQUEST_BYTES)return response({ok:false,error:"Request body is too large."},413,origin);
  const rawBody=await req.text();const payloadSize=new TextEncoder().encode(rawBody).byteLength;
  if(payloadSize>MAX_REQUEST_BYTES)return response({ok:false,error:"Request body is too large."},413,origin);
  let payload:Payload;
  try{payload=JSON.parse(rawBody) as Payload;}catch{return response({ok:false,error:"Request body must be valid JSON."},400,origin);}
  const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  try {
    if (payload.schema_version !== "nxq-analytics-v1") return response({ ok: false, error: "Unsupported analytics schema." }, 400,origin);
    const key = boundedText(payload.ingest_key, 100);if (!key) return response({ ok: false, error: "Analytics key is required." }, 400,origin);
    if (!Array.isArray(payload.events) || payload.events.length === 0 || payload.events.length > 20) return response({ ok: false, error: "Analytics batch size is invalid." }, 400,origin);
    const profileResult = await admin.from("website_analytics_profiles").select("id,client_id,project_id,status,consent_mode,consent_version,page_view_enabled,click_enabled,scroll_depth_enabled,mouse_tracking_enabled,allowed_origins,hourly_event_limit").eq("public_ingest_key", key).single();
    if (profileResult.error || !profileResult.data) return response({ ok: false, error: "Analytics profile is unavailable." }, 404,origin);const profile = profileResult.data as AnalyticsProfile;
    if (profile.status !== "enabled") return response({ ok: true, accepted: 0, disabled: true },200,origin);
    const origins = Array.isArray(profile.allowed_origins) ? profile.allowed_origins : [];if (!origins.includes(origin)) return response({ ok: false, error: "Origin is not allowed." }, 403,origin);
    const rows = payload.events.map((event) => normalizeEvent(event, profile));
    const quota=await reserveAnalyticsQuota(admin,profile,key,rows.length);if(!quota?.allowed)return response({ok:false,error:"Analytics rate limit reached.",retry_after_seconds:quota?.retry_after_seconds||3600},429,origin);
    const reservationKey=`analytics-ingest:${profile.id}:${crypto.randomUUID()}`;
    const authorization=await admin.rpc("nxq_authorize_paid_capability",{target_client_id:profile.client_id,target_feature_key:"basic_analytics",target_resources:{api_requests:1,bandwidth_bytes:payloadSize},target_estimated_provider_cost_cents:0,target_idempotency_key:reservationKey,target_metadata:{analytics_profile_id:profile.id,event_count:rows.length}});
    if(authorization.error||authorization.data?.allowed!==true)return response({ok:false,error:"Analytics is unavailable under the current subscription, billing state, or resource limits."},409,origin);
    const insert = await admin.from("website_analytics_events").insert(rows);
    if (insert.error) {
      await admin.rpc("nxq_finalize_economic_usage",{target_client_id:profile.client_id,target_idempotency_key:reservationKey,target_release:true});
      throw new Error(`Analytics insert failed: ${insert.error.message}`);
    }
    const finalized=await admin.rpc("nxq_finalize_economic_usage",{target_client_id:profile.client_id,target_idempotency_key:reservationKey,target_actual_provider_cost_cents:0});
    if(finalized.error)throw new Error("Analytics usage reservation could not be reconciled.");
    await admin.rpc("increment_client_usage", {target_client_id: profile.client_id,target_usage_key: "analytics_events",target_quantity: payload.events.length,target_unit: "event",target_product_family_slug: "business",});
    return response({ ok: true, accepted: rows.length },200,origin);
  } catch (error) {return response({ ok: false, error: error instanceof Error ? error.message : "Analytics ingest failed." }, 400,origin);}
});
