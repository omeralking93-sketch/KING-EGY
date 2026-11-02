import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://king-egy-9i1.pages.dev"]);
function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://king-egy-9i1.pages.dev",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin", "Content-Type": "application/json"
  };
}
function digits(value: unknown) { return String(value ?? "").replace(/[^0-9]/g, ""); }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  if (origin && !allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers });

  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    const token = String(body.device_token ?? "");
    if (!uuidPattern.test(token)) return new Response(JSON.stringify({ error: "Invalid device" }), { status: 400, headers });
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Server configuration missing");
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === "feedback_list") {
      const { data, error } = await db.from("customer_feedback").select("id,feedback_type,customer_name,message,status,admin_reply,created_at,updated_at").eq("device_token", token).order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ feedback: data ?? [] }), { headers });
    }

    if (action === "list") {
      const { data: links, error: linkError } = await db.from("device_order_access").select("order_id").eq("device_token", token);
      if (linkError) throw linkError;
      const ids = (links ?? []).map((x) => x.order_id);
      if (!ids.length) return new Response(JSON.stringify({ orders: [] }), { headers });
      const [ordersResult, itemsResult, historyResult] = await Promise.all([
        db.from("orders").select("id,order_number,status,created_at,updated_at,total_egp").in("id", ids).order("created_at", { ascending: false }),
        db.from("order_items").select("order_id,product_name_ar,product_name_en,color,size,quantity,line_total_egp").in("order_id", ids),
        db.from("order_status_history").select("order_id,status,changed_at").in("order_id", ids).order("changed_at", { ascending: true })
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (itemsResult.error) throw itemsResult.error;
      if (historyResult.error) throw historyResult.error;
      const orders = (ordersResult.data ?? []).map((o) => ({
        order_number: o.order_number, status: o.status, created_at: o.created_at,
        updated_at: o.updated_at, total_egp: o.total_egp,
        items: (itemsResult.data ?? []).filter((i) => i.order_id === o.id).map((i) => ({
          name_ar: i.product_name_ar, name_en: i.product_name_en, color: i.color,
          size: i.size, quantity: i.quantity, line_total_egp: i.line_total_egp
        })),
        history: (historyResult.data ?? []).filter((h) => h.order_id === o.id).map((h) => ({ status: h.status, changed_at: h.changed_at }))
      }));
      return new Response(JSON.stringify({ orders }), { headers });
    }

    if (action === "cancel") {
      const orderNumber = String(body.order_number ?? "").trim().toUpperCase();
      if (!/^KE-[A-F0-9]{10}$/.test(orderNumber)) return new Response(JSON.stringify({ error: "Invalid order" }), { status: 400, headers });
      // A device can own multiple orders; resolve the requested order by matching its number.
      const { data: order, error: orderError } = await db.from("orders").select("id,status").eq("order_number", orderNumber).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers });
      const { data: owned, error: ownedError } = await db.from("device_order_access").select("order_id").eq("device_token", token).eq("order_id", order.id).maybeSingle();
      if (ownedError) throw ownedError;
      if (!owned) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers });
      if (!["new", "confirmed", "preparing"].includes(order.status)) return new Response(JSON.stringify({ ok: false, reason: "not_cancellable", status: order.status }), { headers });
      const { data: changed, error: updateError } = await db.from("orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", order.id).in("status", ["new", "confirmed", "preparing"]).select("status").maybeSingle();
      if (updateError) throw updateError;
      if (!changed) return new Response(JSON.stringify({ ok: false, reason: "not_cancellable" }), { headers });
      return new Response(JSON.stringify({ ok: true, status: changed.status }), { headers });
    }

    // Backward-compatible lookup for old direct order links.
    if (action === "track") {
      const orderNumber = String(body.order_number ?? "").trim().toUpperCase();
      const phone = digits(body.phone);
      if (!/^KE-[A-F0-9]{10}$/.test(orderNumber) || phone.length < 8 || phone.length > 15)
        return new Response(JSON.stringify({ error: "Invalid order details" }), { status: 400, headers });
      const { data: order, error: orderError } = await db.from("orders").select("id,order_number,phone,status,created_at,updated_at,total_egp").eq("order_number", orderNumber).maybeSingle();
      if (orderError) throw orderError;
      if (!order || digits(order.phone) !== phone) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers });
      const [itemsResult, historyResult] = await Promise.all([
        db.from("order_items").select("product_name_ar,product_name_en,color,size,quantity,line_total_egp").eq("order_id", order.id),
        db.from("order_status_history").select("status,changed_at").eq("order_id", order.id).order("changed_at", { ascending: true })
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (historyResult.error) throw historyResult.error;
      return new Response(JSON.stringify({ order_number: order.order_number, status: order.status, created_at: order.created_at, updated_at: order.updated_at, total_egp: order.total_egp,
        items: (itemsResult.data ?? []).map((i) => ({ name_ar: i.product_name_ar, name_en: i.product_name_en, color: i.color, size: i.size, quantity: i.quantity, line_total_egp: i.line_total_egp })),
        history: historyResult.data ?? [] }), { headers });
    }
    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
  } catch (error) {
    console.error("customer-orders error", error);
    return new Response(JSON.stringify({ error: "Unable to process request" }), { status: 500, headers });
  }
});