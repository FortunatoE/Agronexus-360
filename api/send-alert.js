const allowedDomain = "agroboaesperanca.com.br";

function emailList(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[;,\n]/);
  return [...new Set(items.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function validInternalAddress(address) {
  return /^[^\s@]+@agroboaesperanca\.com\.br$/i.test(address);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  })[character]);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido." });
  }

  try {
    const payload = request.body || {};
    const to = emailList(payload.to);
    const cc = emailList(payload.cc);
    const notices = Array.isArray(payload.notices) ? payload.notices.slice(0, 100) : [];
    if (!to.length || !notices.length) return response.status(400).json({ error: "Informe destinatário e ao menos um pedido elegível." });
    if (![...to, ...cc].every(validInternalAddress)) {
      return response.status(400).json({ error: `Use somente endereços internos @${allowedDomain}.` });
    }
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_EMAIL_DOMAIN) {
      return response.status(503).json({ error: "O serviço de e-mail ainda não está disponível." });
    }

    const rows = notices.map((notice) => `<tr><td>${escapeHtml(notice.reference)}</td><td>${escapeHtml(notice.material)}</td><td>${escapeHtml(notice.nucleus)}</td><td>${escapeHtml(notice.dueDate)}</td><td>${escapeHtml(notice.delay)}</td><td>${escapeHtml(notice.quantity)}</td></tr>`).join("");
    const nucleus = escapeHtml(payload.nucleus || "Todos os núcleos");
    const threshold = escapeHtml(payload.threshold || "0");
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `AgroNexus 360 <alertas@${process.env.RESEND_EMAIL_DOMAIN}>`,
        to,
        ...(cc.length ? { cc } : {}),
        subject: `AgroNexus | pedidos pendentes — ${nucleus}`,
        html: `<main style="font-family:Arial,sans-serif;color:#172033"><h2>Pedidos pendentes com atenção</h2><p>Foram identificados ${notices.length} pedido(s) para <strong>${nucleus}</strong>, com atraso a partir de <strong>${threshold} dia(s)</strong>.</p><table style="border-collapse:collapse;width:100%"><thead><tr>${["Pedido", "Material", "Núcleo", "Previsão", "Atraso", "Volume"].map((label) => `<th style="text-align:left;border-bottom:1px solid #dbe3dc;padding:8px">${label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><p style="margin-top:20px;color:#52606d;font-size:12px">Mensagem enviada pelo AgroNexus 360.</p></main>`,
      }),
    });
    const result = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) {
      console.error("Resend rejected alert email", { status: emailResponse.status, error: result?.message || result?.name });
      return response.status(502).json({ error: "O serviço de e-mail recusou o envio. Verifique o domínio remetente." });
    }
    return response.status(200).json({ ok: true, id: result?.id });
  } catch (error) {
    console.error("Unable to send operational alert", error);
    return response.status(500).json({ error: "Não foi possível enviar o alerta por e-mail." });
  }
}
