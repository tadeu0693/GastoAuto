package expo.modules.notifcapture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object NotifStore {
  private const val PREFS = "notif_capture"
  private const val KEY_QUEUE = "queue"
  private const val KEY_ALLOWED = "allowed"
  private const val KEY_SEEN = "seen"
  private const val MAX_QUEUE = 500

  val DEFAULT_BANKS = setOf(
    "com.nu.production",                  // Nubank
    "com.itau",                           // Itaú
    "com.itau.iti",                       // iti
    "com.bradesco",                       // Bradesco
    "br.com.bradesco.next",               // Next
    "br.com.bb.android",                  // Banco do Brasil
    "br.com.gabba.Caixa",                 // Caixa
    "com.santander.app",                  // Santander
    "br.com.intermedium",                 // Inter
    "com.c6bank.app",                     // C6
    "com.picpay",                         // PicPay
    "com.mercadopago.wallet",             // Mercado Pago
    "br.com.uol.ps.myaccount",            // PagBank
    "br.com.neon",                        // Neon
    "com.btg.pactual.banking",            // BTG
    "br.com.original.bank",               // Original
    "com.google.android.apps.walletnfcrel" // Google Wallet
  )

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun allowed(ctx: Context): Set<String> {
    val p = prefs(ctx)
    return if (p.contains(KEY_ALLOWED)) p.getStringSet(KEY_ALLOWED, emptySet())!!.toSet() else DEFAULT_BANKS
  }

  fun setAllowed(ctx: Context, pkgs: List<String>) {
    prefs(ctx).edit().putStringSet(KEY_ALLOWED, pkgs.toSet()).apply()
  }

  @Synchronized
  fun markSeen(ctx: Context, pkg: String) {
    val p = prefs(ctx)
    val seen = p.getStringSet(KEY_SEEN, emptySet())!!.toMutableSet()
    if (seen.add(pkg)) p.edit().putStringSet(KEY_SEEN, seen).apply()
  }

  fun seen(ctx: Context): Set<String> = prefs(ctx).getStringSet(KEY_SEEN, emptySet())!!.toSet()

  @Synchronized
  fun add(ctx: Context, pkg: String, title: String, text: String, ts: Long) {
    val arr = JSONArray(prefs(ctx).getString(KEY_QUEUE, "[]"))
    // Deduplica mesma mensagem do mesmo app em 10 min (apps reemitem/atualizam notificações)
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      if (o.getString("app") == pkg && o.getString("text") == text &&
        Math.abs(o.getLong("ts") - ts) < 600_000) return
    }
    val o = JSONObject()
      .put("id", "$pkg:$ts:${text.hashCode()}")
      .put("app", pkg).put("title", title).put("text", text).put("ts", ts)
    arr.put(o)
    while (arr.length() > MAX_QUEUE) arr.remove(0)
    prefs(ctx).edit().putString(KEY_QUEUE, arr.toString()).commit()
  }

  fun pending(ctx: Context): String = prefs(ctx).getString(KEY_QUEUE, "[]")!!

  @Synchronized
  fun remove(ctx: Context, ids: List<String>) {
    val drop = ids.toSet()
    val arr = JSONArray(prefs(ctx).getString(KEY_QUEUE, "[]"))
    val out = JSONArray()
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      if (o.getString("id") !in drop) out.put(o)
    }
    prefs(ctx).edit().putString(KEY_QUEUE, out.toString()).commit()
  }
}
