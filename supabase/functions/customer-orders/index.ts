import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://king-egy-9i1.pages.dev"]);
function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://king-egy-9i1.pages.dev",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
}
function digits(value: unknown) {
  return String(value ?? "").replace(/[^0-9]/g, "");
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  if (origin && !allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers });

  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    const orderNumber = String(body.order_number ?? "").trim().toUpperCase();
    const phone = digits(body.phone);
    if (!/^KE-[A-F0-9]{10}$/.test(orderNumber) || phone.length < 8 || phone.length > 15) {
      return new Response(JSON.stringify({ error: "Invalid order details" }), { status: 400, headers });
    }
    if (!["track", "cancel"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Server configuration missing");
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: order, error: orderError } = await db.from("orders")
      .select("id,order_number,phone,status,created_at,updated_at,total_egp")
      .eq("order_number", orderNumber).maybeSingle();
    if (orderError) throw orderError;
    if (!order || digits(order.phone) !== phone) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers });
    }
    if (action === "cancel") {
      if (order.status !== "preparing") {
        return new Response(JSON.stringify({ ok: false, reason: "not_cancellable", status: order.status }), { headers });
      }
      const { data: changed, error: updateError } = await db.from("orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", order.id).eq("status", "preparing")
        .select("status").maybeSingle();
      if (updateError) throw updateError;
      if (!changed) return new Response(JSON.stringify({ ok: false, reason: "not_cancellable" }), { headers });
      return new Response(JSON.stringify({ ok: true, status: changed.status }), { headers });
    }
    const [itemsResult, historyResult] = await Promise.all([
      db.from("order_items").select("product_name_ar,product_name_en,color,size,quantity,line_total_egp").eq("order_id", order.id),
      db.from("order_status_history").select("status,changed_at").eq("order_id", order.id).order("changed_at", { ascending: true })
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (historyResult.error) throw historyResult.error;
    return new Response(JSON.stringify({
      order_number: order.order_number, status: order.status, created_at: order.created_at,
      updated_at: order.updated_at, total_egp: order.total_egp,
      items: (itemsResult.data ?? []).map((i) => ({
        name_ar: i.product_name_ar, name_en: i.product_name_en, color: i.color,
        size: i.size, quantity: i.quantity, line_total_egp: i.line_total_egp
      })),
      history: historyResult.data ?? []
    }), { headers });
  } catch (error) {
    console.error("customer-orders error", error);
    return new Response(JSON.stringify({ error: "Unable to process request" }), { status: 500, headers });
  }
});