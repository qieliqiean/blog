(function () {
  const TARGET_COLLECTIONS = new Set(['quick_posts', 'posts']);
  const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;
  const SKIP_PATH_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
  const POSTS_NEW_PATH_RE = /\/collections\/posts\/new\/?$/;

  function getEntryValue(entry, key) {
    return entry && typeof entry.get === 'function' ? entry.get(key) : '';
  }

  function normalizePathPart(value) {
    return String(value || '').replace(/^\/+|\/+$/g, '');
  }

  function isIndexEntryPath(entryPath) {
    return /(?:^|\/)index\.[^.]+$/i.test(entryPath);
  }

  function postAssetFolderName(entry, collectionName) {
    const entryPath = String(getEntryValue(entry, 'path') || getEntryValue(entry, 'slug') || '');
    const parts = entryPath.split('/').filter(Boolean);
    const filename = parts.pop() || '';
    const name = filename.replace(/\.[^.]+$/, '');

    if (collectionName === 'posts' && isIndexEntryPath(entryPath)) {
      return 'index';
    }

    if (name && name !== 'index') return name;

    return parts.pop() || name;
  }

  function prefixBareImagePath(rawPath, folderName) {
    const leadingDotSlash = rawPath.startsWith('./');
    const path = leadingDotSlash ? rawPath.slice(2) : rawPath;

    if (!folderName || SKIP_PATH_RE.test(path) || path.includes('/') || path.includes('\\')) {
      return rawPath;
    }

    if (!IMAGE_EXT_RE.test(path)) return rawPath;

    return `${folderName}/${path}`;
  }

  function rewriteMarkdownImagePaths(markdown, folderName) {
    if (!markdown || !folderName) return markdown;

    let inFence = false;

    return String(markdown)
      .split('\n')
      .map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence;
          return line;
        }

        if (inFence) return line;

        return line.replace(/(!\[[^\]]*]\()([^)\s]+)([^)]*)(\))/g, (match, start, imagePath, suffix, end) => {
          return `${start}${prefixBareImagePath(imagePath, folderName)}${suffix}${end}`;
        });
      })
      .join('\n');
  }

  function isPostsNewEntryPage() {
    return POSTS_NEW_PATH_RE.test(window.location.pathname);
  }

  function getCurrentFolderFromSearch() {
    const params = new URLSearchParams(window.location.search);
    return normalizePathPart(params.get('path'));
  }

  function slugifyPathSegment(rawValue) {
    return String(rawValue || '')
      .trim()
      .toLocaleLowerCase()
      .replace(/[']/g, '')
      .replace(/[.]/g, '-')
      .replace(/[\\/:*?"<>|#[\]{}%&@+=`~]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function findControlInput(labelText) {
    const labels = Array.from(document.querySelectorAll('label[for]'));

    for (const label of labels) {
      const text = String(label.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || (text !== labelText && !text.startsWith(labelText + ' '))) continue;

      const field = document.getElementById(label.htmlFor);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        return field;
      }
    }

    return null;
  }

  function setInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncPostsPathField() {
    if (!isPostsNewEntryPage()) return;

    const titleInput = findControlInput('标题');
    const pathInput = findControlInput('保存路径');
    if (!titleInput || !pathInput) return;

    const baseFolder = getCurrentFolderFromSearch();
    const slug = slugifyPathSegment(titleInput.value);
    const nextAutoPath = slug ? (baseFolder ? `${baseFolder}/${slug}` : slug) : baseFolder;
    const currentValue = String(pathInput.value || '').trim();
    const lastAutoPath = pathInput.dataset.cmsAutoPath || '';
    const canAutoUpdate =
      currentValue === '' || currentValue === baseFolder || currentValue === lastAutoPath;

    if (canAutoUpdate && currentValue !== nextAutoPath) {
      setInputValue(pathInput, nextAutoPath);
    }

    pathInput.dataset.cmsAutoPath = nextAutoPath;
  }

  function bindPostsPathSync() {
    if (!isPostsNewEntryPage()) return;

    const titleInput = findControlInput('标题');
    const pathInput = findControlInput('保存路径');
    if (!titleInput || !pathInput) return;

    if (!titleInput.dataset.cmsPathSyncBound) {
      titleInput.addEventListener('input', syncPostsPathField);
      titleInput.dataset.cmsPathSyncBound = '1';
    }

    if (!pathInput.dataset.cmsPathSyncBound) {
      pathInput.addEventListener('blur', syncPostsPathField);
      pathInput.dataset.cmsPathSyncBound = '1';
    }

    syncPostsPathField();
  }

  function schedulePostsPathSync() {
    window.requestAnimationFrame(bindPostsPathSync);
  }

  function patchHistoryMethod(methodName) {
    const original = window.history[methodName];
    if (typeof original !== 'function') return;

    window.history[methodName] = function () {
      const result = original.apply(this, arguments);
      schedulePostsPathSync();
      return result;
    };
  }

  function registerMediaPathFix(CMS) {
    CMS.registerEventListener({
      name: 'preSave',
      handler: ({ entry, collection }) => {
        const collectionName = collection && typeof collection.get === 'function'
          ? collection.get('name')
          : getEntryValue(entry, 'collection');

        if (typeof collectionName === 'string' && collectionName && !TARGET_COLLECTIONS.has(collectionName)) {
          return getEntryValue(entry, 'data');
        }

        const data = getEntryValue(entry, 'data');
        if (!data || typeof data.get !== 'function' || typeof data.set !== 'function') return data;

        const body = data.get('body');
        if (typeof body !== 'string') return data;

        const folderName = postAssetFolderName(entry, collectionName);
        const nextBody = rewriteMarkdownImagePaths(body, folderName);

        return nextBody === body ? data : data.set('body', nextBody);
      },
    });
  }

  window.BlogCmsMediaPathFix = {
    rewriteMarkdownImagePaths,
    postAssetFolderName,
  };

  if (window.CMS) {
    registerMediaPathFix(window.CMS);
  }

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', schedulePostsPathSync);
  window.addEventListener('load', schedulePostsPathSync);

  const observer = new MutationObserver(schedulePostsPathSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
