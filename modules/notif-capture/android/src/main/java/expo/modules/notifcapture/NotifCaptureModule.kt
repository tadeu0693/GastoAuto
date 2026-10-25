package expo.modules.notifcapture

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotifCaptureModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotifCapture")

    Function("hasPermission") {
      val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: ""
      val me = ComponentName(ctx, BankNotificationListener::class.java)
      flat.split(":").any { ComponentName.unflattenFromString(it) == me }
    }

    Function("openPermissionSettings") {
      val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(i)
    }

    Function("getPending") { NotifStore.pending(ctx) }

    Function("removePending") { ids: List<String> -> NotifStore.remove(ctx, ids) }

    Function("getAllowedPackages") { NotifStore.allowed(ctx).toList() }

    Function("setAllowedPackages") { pkgs: List<String> -> NotifStore.setAllowed(ctx, pkgs) }

    Function("getSeenPackages") { NotifStore.seen(ctx).toList() }

    Function("getDefaultPackages") { NotifStore.DEFAULT_BANKS.toList() }
  }
}
