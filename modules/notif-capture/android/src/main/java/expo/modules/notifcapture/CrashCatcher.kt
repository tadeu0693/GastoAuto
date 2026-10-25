package expo.modules.notifcapture

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.PrintWriter
import java.io.StringWriter
import kotlin.system.exitProcess

// Captura qualquer crash nativo/JS e mostra o erro numa tela separada (processo :crash)
class CrashCatcher : ContentProvider() {
  override fun onCreate(): Boolean {
    val ctx = context?.applicationContext ?: return true
    if (Build.VERSION.SDK_INT >= 28 && Application.getProcessName().endsWith(":crash")) return true
    Thread.setDefaultUncaughtExceptionHandler { t, e ->
      try {
        val sw = StringWriter(); e.printStackTrace(PrintWriter(sw))
        val text = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\nThread: ${t.name}\n\n$sw"
        ctx.getSharedPreferences("crash", 0).edit().putString("last", text).commit()
        ctx.startActivity(Intent(ctx, CrashActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
          .putExtra("text", text))
      } catch (_: Throwable) { }
      android.os.Process.killProcess(android.os.Process.myPid())
      exitProcess(10)
    }
    return true
  }
  override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
  override fun getType(u: Uri): String? = null
  override fun insert(u: Uri, v: ContentValues?): Uri? = null
  override fun delete(u: Uri, s: String?, a: Array<String>?) = 0
  override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}

class CrashActivity : Activity() {
  override fun onCreate(b: Bundle?) {
    super.onCreate(b)
    val text = intent.getStringExtra("text") ?: getSharedPreferences("crash", 0).getString("last", "") ?: ""
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 96, 32, 32) }
    root.addView(TextView(this).apply { this.text = "GastoAuto travou — envie este texto:"; textSize = 16f })
    root.addView(Button(this).apply {
      this.text = "Compartilhar erro"
      setOnClickListener {
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Enviar"))
      }
    })
    root.addView(ScrollView(this).apply {
      addView(TextView(this@CrashActivity).apply { this.text = text; textSize = 11f; setTextIsSelectable(true) })
    })
    setContentView(root)
  }
}
