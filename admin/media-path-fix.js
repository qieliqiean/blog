(function () {
  const TARGET_COLLECTIONS = new Set(['quick_posts', 'posts']);
  const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;
  const SKIP_PATH_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

  function getEntryValue(entry, key) {
    return entry && typeof entry.get === 'function' ? entry.get(key) : '';
  }

  function postAssetFolderName(entry) {
    const entryPath = String(getEntryValue(entry, 'path') || getEntryValue(entry, 'slug') || '');
    const parts = entryPath.split('/').filter(Boolean);
    const filename = parts.pop() || '';
    const name = filename.replace(/\.[^.]+$/, '');

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

        const folderName = postAssetFolderName(entry);
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
})();
