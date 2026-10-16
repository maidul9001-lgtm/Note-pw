/* ============================================================
   Firebase সেটিং — নোটপ্যাডকে আপনার Firebase প্রজেক্ট (my-notepad-ee92f) এর সাথে জোড়া লাগায়।

   মান বদলাতে চাইলে Firebase Console → Project settings → General →
   "Your apps" → Web অ্যাপ → Config থেকে পুরো `firebaseConfig` কপি করে
   নিচের ঘরের লেখার ওপর বসান।

   এই মানগুলো গোপন নয় (ওয়েব অ্যাপের কোডে থাকাই নিয়ম)। আসল নিরাপত্তা আসে
   Firestore Rules থেকে, যাতে প্রত্যেকে শুধু নিজের নোট দেখে।
   ============================================================ */

// ↓↓↓ এখান থেকে ↓↓↓
const firebaseConfig = {
  apiKey: "AIzaSyAVCUea-HG39CHpQSGb0MCJmf24D5HRv0M",
  authDomain: "my-notepad-ee92f.firebaseapp.com",
  projectId: "my-notepad-ee92f",
  storageBucket: "my-notepad-ee92f.firebasestorage.app",
  messagingSenderId: "104992260233",
  appId: "1:104992260233:web:5d1fa54d840181ea2f0658"
};
// ↑↑↑ এই পর্যন্ত ↑↑↑

window.FIREBASE_CONFIG = firebaseConfig;
