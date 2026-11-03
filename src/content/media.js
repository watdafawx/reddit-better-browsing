/* Media extraction from Reddit post JSON + post-info cache */
(() => {
  const cache = new Map();      // t3_id -> post data
  const pending = new Map();    // t3_id -> promise

  const fix = u => (u || '').replace(/&amp;/g, '&');

  RBE.cachePost = d => { if (d && d.name) cache.set(d.name, d); };

  // Batch-fetch post data for t3_ ids.
  // Reddit sometimes answers /api/info.json with 403, so fall back to /by_id/, then to
  // one /comments/<id>.json per post (the endpoint the comment viewer uses).
  const broken = { info: false, byId: false };
  const store = j => (j?.data?.children || []).forEach(c => c?.data?.name && cache.set(c.data.name, c.data));
  async function fetchSingle(id) {
    const j = await RBE.getJSON(`/comments/${id.replace(/^t3_/, '')}.json?raw_json=1&limit=1&depth=1`);
    store(j?.[0]);
  }
  async function fetchChunk(chunk) {
    if (!broken.info) {
      try { return store(await RBE.getJSON('/api/info.json?raw_json=1&sr_detail=1&id=' + chunk.join(','))); }
      catch (e) { broken.info = true; console.warn('[RBE] info.json failed, falling back', e); }
    }
    if (!broken.byId) {
      try { return store(await RBE.getJSON('/by_id/' + chunk.join(',') + '.json?raw_json=1&limit=100')); }
      catch (e) { broken.byId = true; console.warn('[RBE] by_id failed, falling back', e); }
    }
    // a few at a time so we don't trip Reddit's rate limit
    for (let i = 0; i < chunk.length; i += 3) {
      await Promise.all(chunk.slice(i, i + 3).map(id => fetchSingle(id).catch(e => console.warn('[RBE] post fetch failed', id, e))));
    }
  }
  RBE.getPosts = async function (ids) {
    ids = [...new Set(ids.filter(Boolean))];
    const need = ids.filter(id => !cache.has(id) && !pending.has(id));
    if (broken.info && broken.byId) {
      // per-post mode: each id gets its own promise so the post being opened isn't stuck behind prefetches
      need.forEach(id => pending.set(id, fetchSingle(id).catch(e => console.warn('[RBE] post fetch failed', id, e)).finally(() => pending.delete(id))));
      need.length = 0;
    }
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      const p = fetchChunk(chunk).finally(() => chunk.forEach(id => pending.delete(id)));
      chunk.forEach(id => pending.set(id, p));
    }
    await Promise.all(ids.map(id => pending.get(id)).filter(Boolean));
    return ids.map(id => cache.get(id)).filter(Boolean);
  };
  RBE.getPost = async id => (await RBE.getPosts([id]))[0];

  RBE.postIdOf = el => {
    const id = el.getAttribute('id') || el.getAttribute('post-id') || el.getAttribute('thingid') || '';
    if (/^t3_/.test(id)) return id;
    const m = (el.getAttribute('permalink') || '').match(/\/comments\/([a-z0-9]+)/i);
    return m ? 't3_' + m[1] : null;
  };

  RBE.isNsfwEl = el => el.hasAttribute('nsfw') || el.hasAttribute('over-18') || el.hasAttribute('is-nsfw');

  RBE.isMediaPostEl = el => {
    const t = (el.getAttribute('post-type') || '').toLowerCase();
    if (t === 'image' || t === 'gallery' || t === 'multi_media') return true;
    const href = el.getAttribute('content-href') || '';
    return /i\.redd\.it|\.(jpe?g|png|webp|gif|gifv)(\?|$)/i.test(href);
  };

  // Returns { items: [...], kind } — items: {type:'image'|'mp4'|'rvideo'|'embed'|'link', ...}
  RBE.extractMedia = function (d) {
    if (!d) return { items: [], kind: 'none' };
    const src = (d.crosspost_parent_list && d.crosspost_parent_list[0]) || d;
    const preview = src.preview?.images?.[0];
    const poster = preview ? fix(preview.source.url) : '';

    // Gallery
    if (src.is_gallery && src.media_metadata) {
      const order = src.gallery_data?.items || Object.keys(src.media_metadata).map(media_id => ({ media_id }));
      const items = [];
      for (const it of order) {
        const m = src.media_metadata[it.media_id];
        if (!m || m.status !== 'valid' || !m.s) continue;
        const thumb = fix((m.p && (m.p[1] || m.p[0]) || {}).u || m.s.u || m.s.gif);
        if (m.e === 'AnimatedImage') items.push({ type: m.s.mp4 ? 'mp4' : 'image', src: fix(m.s.mp4 || m.s.gif), thumb, w: m.s.x, h: m.s.y, caption: it.caption });
        else items.push({ type: 'image', src: fix(m.s.u), thumb, w: m.s.x, h: m.s.y, caption: it.caption });
      }
      return { items, kind: 'gallery' };
    }

    // Reddit-hosted video
    const rv = src.secure_media?.reddit_video || src.media?.reddit_video || src.preview?.reddit_video_preview;
    if (rv && (src.is_video || src.post_hint === 'hosted:video' || src.preview?.reddit_video_preview)) {
      return { items: [{ type: 'rvideo', hls: fix(rv.hls_url), dash: fix(rv.dash_url), fallback: fix(rv.fallback_url), w: rv.width, h: rv.height, poster, gif: rv.is_gif }], kind: 'video' };
    }

    const url = fix(src.url_overridden_by_dest || src.url || '');

    // imgur gifv / direct mp4
    if (/\.gifv(\?|$)/i.test(url)) return { items: [{ type: 'mp4', src: url.replace(/\.gifv/i, '.mp4'), thumb: poster }], kind: 'image' };
    if (/\.mp4(\?|$)/i.test(url)) return { items: [{ type: 'mp4', src: url, thumb: poster }], kind: 'video' };

    // Image (gif → use mp4 variant when present for smoothness)
    if (src.post_hint === 'image' || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || /i\.redd\.it/.test(url)) {
      const mp4 = preview?.variants?.mp4?.source?.url;
      if (/\.gif(\?|$)/i.test(url) && mp4) return { items: [{ type: 'mp4', src: fix(mp4), thumb: poster, w: preview.source.width, h: preview.source.height }], kind: 'image' };
      return { items: [{ type: 'image', src: url, thumb: poster || url, w: preview?.source.width, h: preview?.source.height }], kind: 'image' };
    }

    // Embeds (YouTube, Streamable, etc.)
    const embedHtml = src.secure_media_embed?.content || src.media_embed?.content;
    if (embedHtml) {
      const m = RBE.decode(embedHtml).match(/src="([^"]+)"/);
      if (m) return { items: [{ type: 'embed', src: m[1], w: src.secure_media_embed.width, h: src.secure_media_embed.height }], kind: 'embed' };
    }

    // External link
    if (url && !src.is_self && !/reddit\.com\/(r|u|user)\//.test(url)) {
      return { items: [{ type: 'link', url, thumb: poster || (/^https?:/.test(src.thumbnail) ? src.thumbnail : ''), domain: src.domain }], kind: 'link' };
    }
    return { items: [], kind: 'self' };
  };

  RBE.imageItems = d => RBE.extractMedia(d).items.filter(i => i.type === 'image' || i.type === 'mp4');
})();
