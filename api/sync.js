/* ============================================================
   api/sync.js — Firebase (Authentication + Firestore) দিয়ে নোট সিঙ্ক।
   কোনো লাইব্রেরি লাগে না, সরাসরি Firebase REST API ব্যবহার করে।

   অ্যাপ এই ফাংশনগুলো ব্যবহার করে (window.NotepadSync):
     configured()                     → firebase-config.js ঠিকমতো ভরা আছে কি না
     register(email, password)        → নতুন অ্যাকাউন্ট, সেশন ফেরত দেয়
     login(email, password)           → লগইন, সেশন ফেরত দেয়
     resetPassword(email)             → পাসওয়ার্ড বদলের মেইল পাঠায়
     sync(session, local, base)       → দুই দিকে সিঙ্ক (নিচে বিস্তারিত)
     pending(local, base)             → কতটি পরিবর্তন এখনো সিঙ্ক হয়নি

   সিঙ্কের নিয়ম: প্রতিটি নোট/ফোল্ডার/ডাইরি Firestore-এ একটি আলাদা ডকুমেন্ট
   (users/{uid}/notes/{id} ইত্যাদি)। শেষ সিঙ্কের অবস্থা (base) মনে রেখে
   তিন দিক মিলিয়ে সিদ্ধান্ত নেওয়া হয়: লোকালে বদলালে পাঠানো, রিমোটে বদলালে আনা,
   দুই জায়গায় বদলালে যেটা নতুন সেটা রাখা। মোছা নোট "মোছা চিহ্ন" হিসেবে যায়,
   যাতে এক ফোনে মুছলে অন্য ফোনেও মোছে।
   ============================================================ */
(function (root) {
  'use strict';

  const cfg = () => root.FIREBASE_CONFIG || {};
  const configured = () => {
    const c = cfg();
    return !!(c.apiKey && !/^YOUR_/i.test(c.apiKey));      /* projectId টোকেন থেকেই পাওয়া যায় */
  };

  const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
  const TOKEN = 'https://securetoken.googleapis.com/v1/token';
  /* লগইনের টোকেনের "aud" = Firebase প্রজেক্ট আইডি। কনফিগে projectId ভুল লিখলেও এটা থেকে ঠিক আইডি নেওয়া হয় */
  function jwtAud(tok) {
    try {
      const b = String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b + '==='.slice((b.length + 3) % 4))).aud || '';
    } catch (e) { return ''; }
  }
  const pidOf = sess => (sess && (jwtAud(sess.idToken) || sess.pid)) || cfg().projectId;
  const FS = sess => 'https://firestore.googleapis.com/v1/projects/' + pidOf(sess) + '/databases/(default)/documents';
  const KINDS = ['notes', 'folders', 'diary'];

  const ERR = {
    EMAIL_EXISTS: 'এই ইমেইলে আগেই অ্যাকাউন্ট আছে',
    INVALID_LOGIN_CREDENTIALS: 'ইমেইল বা পাসওয়ার্ড ভুল',
    INVALID_PASSWORD: 'পাসওয়ার্ড ভুল',
    EMAIL_NOT_FOUND: 'এই ইমেইলে কোনো অ্যাকাউন্ট নেই',
    WEAK_PASSWORD: 'পাসওয়ার্ড দুর্বল, কমপক্ষে ৬ অক্ষর দিন',
    INVALID_EMAIL: 'ইমেইল সঠিক নয়',
    USER_DISABLED: 'এই অ্যাকাউন্ট বন্ধ করা আছে',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন',
    OPERATION_NOT_ALLOWED: 'Firebase-এ ইমেইল/পাসওয়ার্ড লগইন চালু করা নেই',
    CONFIGURATION_NOT_FOUND: 'Firebase-এ Authentication চালু করা নেই',
    API_KEY_INVALID: 'API Key ভুল, firebase-config.js দেখুন',
    API_KEY_NOT_VALID: 'API Key ভুল, firebase-config.js দেখুন'
  };

  /* ---------- নেটওয়ার্ক ---------- */
  let lastPid = '';
  async function http(url, opt) {
    const m = /\/projects\/([^/]+)\//.exec(url); lastPid = m ? m[1] : '';
    const op = /:runQuery/.test(url) ? 'পড়তে' : /:commit/.test(url) ? 'লিখতে' : '';
    let r;
    try { r = await fetch(url, opt); }
    catch (e) { throw new Error('ইন্টারনেট সংযোগ নেই'); }
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) {
      const e = (j && j.error) || {};
      const raw = e.message || e.status || '';
      const code = String(raw).split(/[\s:]/)[0];
      const low = String(raw).toLowerCase();
      if (ERR[code]) throw new Error(ERR[code]);
      if (/has not been used|is disabled|not been enabled|not enabled/.test(low))
        throw new Error('Firestore চালু করা নেই। Firebase Console → Firestore Database → Create database করুন (' + raw + ')');
      const fail = msg => { const er = new Error(msg); er.status = r.status; return er; };
      if (r.status === 403 || /insufficient permissions|permission_denied/.test(low))
        throw fail('Firestore Rules ' + op + ' দিচ্ছে না। Firebase → Firestore → Rules ট্যাবে README-র নিয়মটা বসিয়ে Publish করুন, আর নিয়মে কোনো তারিখের শর্ত (request.time <) থাকলে সেটা বাদ দিন (প্রজেক্ট: ' + lastPid + '; ' + (raw || r.status) + ')');
      if (r.status === 401) throw fail('লগইনের মেয়াদ শেষ বা অচেনা, লগআউট করে আবার লগইন করুন (' + (raw || r.status) + ')');
      if (r.status === 404) throw new Error('Firestore ডাটাবেস পাওয়া যায়নি, Firebase-এ Firestore তৈরি করুন (' + (raw || r.status) + ')');
      throw new Error('ত্রুটি: ' + (raw || r.status));
    }
    return j;
  }
  const post = (url, body, token) => http(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body)
  });

  /* ---------- অ্যাকাউন্ট ---------- */
  const sessOf = (j, email) => ({
    email: j.email || email,
    uid: j.localId,
    idToken: j.idToken,
    refreshToken: j.refreshToken,
    exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000
  });
  async function register(email, password) {
    const j = await post(AUTH + ':signUp?key=' + cfg().apiKey, { email, password, returnSecureToken: true });
    return sessOf(j, email);
  }
  async function login(email, password) {
    const j = await post(AUTH + ':signInWithPassword?key=' + cfg().apiKey, { email, password, returnSecureToken: true });
    return sessOf(j, email);
  }
  async function resetPassword(email) {
    await post(AUTH + ':sendOobCode?key=' + cfg().apiKey, { requestType: 'PASSWORD_RESET', email });
    return true;
  }
  async function ensure(sess, force) {
    if (!force && sess.exp - Date.now() > 60000) return sess;
    const j = await http(TOKEN + '?key=' + cfg().apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refreshToken)
    });
    return Object.assign({}, sess, {
      idToken: j.id_token,
      refreshToken: j.refresh_token || sess.refreshToken,
      exp: Date.now() + (Number(j.expires_in) || 3600) * 1000
    });
  }

  /* ---------- সাহায্যকারী ---------- */
  function djb(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  const hashOf = r => { const s = JSON.stringify(r); return s.length + '.' + djb(s); };
  const stamp = r => Number(r && (r.updated || r.created)) || 0;

  /* ---------- Firestore ---------- */
  async function fetchChanged(sess, kind, since) {
    const url = FS(sess) + '/users/' + sess.uid + ':runQuery';
    const body = { structuredQuery: {
      from: [{ collectionId: kind }],
      where: { fieldFilter: { field: { fieldPath: 'ts' }, op: 'GREATER_THAN', value: { integerValue: String(since) } } },
      orderBy: [{ field: { fieldPath: 'ts' }, direction: 'ASCENDING' }]
    } };
    const j = await post(url, body, sess.idToken);
    const m = new Map();
    (Array.isArray(j) ? j : []).forEach(x => {
      if (!x.document) return;
      const d = x.document, f = d.fields || {}, id = d.name.split('/').pop();
      const ts = Number(f.ts && f.ts.integerValue) || 0;
      const del = !!(f.deleted && f.deleted.booleanValue);
      let rec = null;
      if (!del) { try { rec = JSON.parse(f.data.stringValue); } catch (e) { return; } }
      m.set(id, { ts, deleted: del, rec });
    });
    return m;
  }
  function docOf(sess, kind, id, rec, del, ts) {
    return { update: {
      name: 'projects/' + pidOf(sess) + '/databases/(default)/documents/users/' + sess.uid + '/' + kind + '/' + id,
      fields: {
        data: { stringValue: del ? '' : JSON.stringify(rec) },
        ts: { integerValue: String(ts) },
        deleted: { booleanValue: !!del }
      }
    } };
  }
  async function commit(sess, writes) {
    /* :commit ব্যবহার করতে হয় (Firestore Rules মানে); :batchWrite লগইন-টোকেনে 403 দেয় */
    for (let i = 0; i < writes.length; i += 100) {
      await post(FS(sess) + ':commit', { writes: writes.slice(i, i + 100) }, sess.idToken);
    }
  }

  /* ---------- সিঙ্ক ---------- */
  /*  local = { notes:[…], folders:[…], diary:[…] }  (প্রতিটি রেকর্ডে id থাকতে হবে)
      base  = আগের সিঙ্কের অবস্থা (প্রথমবার খালি)
      ফেরত: { sess, base, changes:{notes:{upsert:[…],remove:[ids]},…}, pushed, pulled, conflicts, total:{notes,…} }
      অ্যাপ changes নিজের ডাটায় বসাবে আর নতুন base সেভ করবে।                         */
  async function sync(sess, local, base) {
    try { return await syncOnce(sess, local, base, false); }
    catch (e) {
      if (e && (e.status === 401 || e.status === 403) && sess && sess.refreshToken)
        return await syncOnce(sess, local, base, true);      /* পুরোনো টোকেন হলে নতুন টোকেন নিয়ে আরেকবার */
      throw e;
    }
  }
  async function syncOnce(sess, local, base, force) {
    sess = await ensure(sess, force);
    base = (base && base.notes) ? base : { notes: {}, folders: {}, diary: {}, cursor: 0 };
    const since = Math.max(0, (base.cursor || 0) - 300000);      /* ৫ মিনিট ওভারল্যাপ: ঘড়ির পার্থক্যের নিরাপত্তা */
    const out = { sess, changes: {}, base: { notes: {}, folders: {}, diary: {}, cursor: base.cursor || 0 }, pushed: 0, pulled: 0, conflicts: 0, total: {} };
    const writes = [];
    let maxTs = base.cursor || 0;
    const now = Date.now();

    for (const k of KINDS) {
      const remote = await fetchChanged(sess, k, since);
      const b = base[k] || {};
      const L = new Map((local[k] || []).map(r => [r.id, r]));
      const ch = { upsert: [], remove: [] }, nb = {};
      const ids = new Set([...L.keys(), ...remote.keys(), ...Object.keys(b)]);

      for (const id of ids) {
        const l = L.get(id), r = remote.get(id), bs = b[id];
        const lh = l ? hashOf(l) : null;
        const lCh = !!l && (!bs || bs.h !== lh);               /* লোকালে বদলেছে */
        const rCh = !!r && (!bs || bs.t !== r.ts);             /* রিমোটে বদলেছে */
        if (r && r.ts > maxTs) maxTs = r.ts;

        const push = (rec, del) => {
          writes.push(docOf(sess, k, id, rec, del, now));
          nb[id] = del ? { h: null, t: now, d: 1 } : { h: hashOf(rec), t: now };
          out.pushed++;
        };
        const pull = rr => {
          if (rr.deleted) { ch.remove.push(id); nb[id] = { h: null, t: rr.ts, d: 1 }; }
          else { ch.upsert.push(rr.rec); nb[id] = { h: hashOf(rr.rec), t: rr.ts }; }
          out.pulled++;
        };

        if (l && !r) {
          if (lCh) push(l, false); else nb[id] = bs;           /* রিমোটে অপরিবর্তিত */
        } else if (!l && r) {
          if (r.deleted) nb[id] = { h: null, t: r.ts, d: 1 };
          else if (bs && !bs.d && !rCh) push(null, true);      /* এখানে মুছেছেন, রিমোটে বদলায়নি */
          else pull(r);                                        /* নতুন বা অন্য ফোনে বদলানো */
        } else if (l && r) {
          if (r.deleted) { if (lCh) push(l, false); else pull(r); }
          else if (!lCh && !rCh) nb[id] = bs || { h: lh, t: r.ts };
          else if (lCh && !rCh) push(l, false);
          else if (!lCh && rCh) pull(r);
          else { out.conflicts++; if (stamp(l) > stamp(r.rec)) push(l, false); else pull(r); }
        } else if (bs && !bs.d) {
          push(null, true);                                    /* এখানে মুছেছেন, রিমোটে অপরিবর্তিত */
        } else if (bs) {
          nb[id] = bs;
        }
      }
      out.base[k] = nb;
      out.changes[k] = ch;
      out.total[k] = Object.values(nb).filter(x => x && !x.d).length;
    }
    if (writes.length) { await commit(sess, writes); maxTs = Math.max(maxTs, now); }
    out.base.cursor = maxTs;
    out.sess = sess;
    return out;
  }

  /* কতটি পরিবর্তন সিঙ্ক বাকি (ইন্টারনেট ছাড়াই হিসাব) */
  function pending(local, base) {
    base = base || {};
    let n = 0;
    for (const k of KINDS) {
      const b = base[k] || {}, seen = new Set();
      for (const r of (local[k] || [])) {
        seen.add(r.id);
        const bs = b[r.id];
        if (!bs || bs.d || bs.h !== hashOf(r)) n++;
      }
      for (const id of Object.keys(b)) if (!seen.has(id) && !b[id].d) n++;
    }
    return n;
  }

  root.NotepadSync = { configured, register, login, resetPassword, sync, pending, _hash: hashOf };
})(typeof window !== 'undefined' ? window : globalThis);
