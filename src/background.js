/* Background: account switching by saving / restoring Reddit's session cookies.
   No passwords are ever stored — the user logs in normally once per account. */
const api = globalThis.browser ?? globalThis.chrome;
const DOMAIN = 'reddit.com';

async function storeIdFor(sender, msg) {
  if (msg.storeId) return msg.storeId;
  if (sender?.tab?.cookieStoreId) return sender.tab.cookieStoreId;  // Firefox containers
  if (sender?.tab?.id != null && api.cookies.getAllCookieStores) {
    const stores = await api.cookies.getAllCookieStores();
    const s = stores.find(st => (st.tabIds || []).includes(sender.tab.id));
    if (s) return s.id;
  }
  return undefined;
}

const cookieUrl = c => `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
const getAll = storeId => api.cookies.getAll(storeId ? { domain: DOMAIN, storeId } : { domain: DOMAIN });

async function getAccounts() {
  const { accounts = {} } = await api.storage.local.get('accounts');
  return accounts;
}

async function save(name, storeId) {
  if (!name) throw new Error('Not logged in');
  const cookies = await getAll(storeId);
  if (!cookies.some(c => c.name === 'reddit_session' || c.name === 'token_v2')) throw new Error('No Reddit session found — log in first');
  const accounts = await getAccounts();
  accounts[name] = {
    savedAt: Date.now(),
    cookies: cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
      sameSite: c.sameSite, hostOnly: c.hostOnly, session: c.session, expirationDate: c.expirationDate
    }))
  };
  await api.storage.local.set({ accounts });
  return Object.keys(accounts);
}

async function clear(storeId) {
  const cookies = await getAll(storeId);
  await Promise.all(cookies.map(c => api.cookies.remove(Object.assign({ url: cookieUrl(c), name: c.name }, storeId ? { storeId } : {})).catch(() => {})));
}

async function switchTo(name, storeId) {
  const accounts = await getAccounts();
  const acct = accounts[name];
  if (!acct) throw new Error('Unknown account ' + name);
  await clear(storeId);
  const now = Date.now() / 1000;
  for (const c of acct.cookies) {
    if (!c.session && c.expirationDate && c.expirationDate < now) continue;
    const d = { url: cookieUrl(c), name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly };
    if (!c.hostOnly) d.domain = c.domain;
    if (c.sameSite && c.sameSite !== 'unspecified') d.sameSite = c.sameSite;
    if (!c.session && c.expirationDate) d.expirationDate = c.expirationDate;
    if (storeId) d.storeId = storeId;
    try { await api.cookies.set(d); } catch (e) { console.warn('[RBE] cookie set failed', c.name, e); }
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // hls.js is injected on demand (first Reddit video in our viewer) instead of on every page load
  if (msg.type === 'rbe:loadHls') {
    if (sender?.tab?.id == null) { sendResponse({ error: 'no tab' }); return false; }
    api.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, files: ['vendor/hls.min.js'] })
      .then(() => sendResponse({ ok: true }), e => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  (async () => {
    const storeId = await storeIdFor(sender, msg);
    switch (msg.type) {
      case 'acct:list': return { accounts: Object.entries(await getAccounts()).map(([name, a]) => ({ name, savedAt: a.savedAt })) };
      case 'acct:save': return { accounts: await save(msg.name, storeId) };
      case 'acct:switch': await switchTo(msg.name, storeId); return { ok: true };
      case 'acct:remove': { const a = await getAccounts(); delete a[msg.name]; await api.storage.local.set({ accounts: a }); return { ok: true }; }
      case 'acct:fresh': if (msg.saveAs) await save(msg.saveAs, storeId).catch(() => {}); await clear(storeId); return { ok: true };
      default: return { error: 'unknown message' };
    }
  })().then(sendResponse, e => sendResponse({ error: String(e.message || e) }));
  return true; // async response
});
