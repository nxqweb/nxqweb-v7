// These service-role workers intentionally span the full migration-owned
// schema. Replace this boundary with generated Supabase types immediately
// after the migrations are replayed in the connected project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DynamicDatabase = any;
