package expo.modules.notifcapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class BankNotificationListener : NotificationListenerService() {
  private val money = Regex("""R\$\s?-?\d|\d{1,3}(\.\d{3})*,\d{2}""")

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      val pkg = sbn.packageName ?: return
      if (pkg == packageName) return
      val n = sbn.notification ?: return
      if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
      val ex = n.extras ?: return
      val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
      val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT)
        ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
      val full = "$title $text"
      if (!money.containsMatchIn(full)) return
      NotifStore.markSeen(this, pkg)
      if (pkg !in NotifStore.allowed(this)) return
      NotifStore.add(this, pkg, title, text, sbn.postTime)
    } catch (_: Throwable) { }
  }
}
