importScripts('https://www.gstatic.com/firebasejs/4.5.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/4.5.0/firebase-messaging.js');

firebase.initializeApp({
  'messagingSenderId': '877912675687'
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler(function(notification) {
  console.log('[firebase-messaging-sw.js] Received background message ', notification);
  // Customize notification here
  const notificationTitle = notification.data.title;
  const notificationOptions = {
    body: notification.data.message,
    icon: 'logo.png'
  };

  return self.registration.showNotification(notificationTitle,notificationOptions);
});
