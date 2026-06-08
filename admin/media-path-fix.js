(function () {
  const TARGET_COLLECTIONS = new Set(['quick_posts', 'posts']);
  const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;
  const SKIP_PATH_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
  const POSTS_COLLECTION_PATH_RE = /^\/collections\/posts(?:\/filter(?:\/.*)?)?\/?$/;
  const POSTS_NEW_PATH_RE = /^\/collections\/posts\/new\/?$/;
  const POSTS_FILTER_PREFIX = '/collections/posts/filter/';
  const POSTS_CREATE_BUTTON_ATTR = 'data-blog-cms-folder-create-button';
  const POSTS_CREATE_BUTTON_STYLE_ID = 'blog-cms-folder-create-button-style';

  function normalizeLabelText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getEntryValue(entry, key) {
    return entry && typeof entry.get === 'function' ? entry.get(key) : '';
  }

  function normalizePathPart(value) {
    return String(value || '').replace(/^\/+|\/+$/g, '');
  }

  function isIndexEntryPath(entryPath) {
    return /(?:^|\/)index\.[^.]+$/i.test(entryPath);
  }

  function decodePathPart(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function decodeNestedPath(value) {
    return String(value || '')
      .split('/')
      .map(decodePathPart)
      .join('/');
  }

  function getCurrentRouteUrl() {
    const hash = String(window.location.hash || '');
    const route = hash.startsWith('#/') ? hash.slice(1) : `${window.location.pathname}${window.location.search}`;

    return new URL(route || '/', window.location.origin);
  }

  function getCurrentRoutePath() {
    return getCurrentRouteUrl().pathname;
  }

  function getCurrentRouteSearchParams() {
    return getCurrentRouteUrl().searchParams;
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

  function isPostsCollectionPage() {
    return POSTS_COLLECTION_PATH_RE.test(getCurrentRoutePath());
  }

  function isPostsNewEntryPage() {
    return POSTS_NEW_PATH_RE.test(getCurrentRoutePath());
  }

  function getCurrentPostsFolderFromRoute() {
    const routePath = getCurrentRoutePath();
    if (!routePath.startsWith(POSTS_FILTER_PREFIX)) return '';

    return normalizePathPart(decodeNestedPath(routePath.slice(POSTS_FILTER_PREFIX.length)));
  }

  function getCurrentFolderFromSearch() {
    return normalizePathPart(getCurrentRouteSearchParams().get('path'));
  }

  function buildAdminHashUrl(pathname, params) {
    const search = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (normalized) {
        search.set(key, normalized);
      }
    });

    const query = search.toString();
    return `#${pathname}${query ? `?${query}` : ''}`;
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

  function ensurePostsCreateButtonStyles() {
    if (document.getElementById(POSTS_CREATE_BUTTON_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = POSTS_CREATE_BUTTON_STYLE_ID;
    style.textContent = `
      a[${POSTS_CREATE_BUTTON_ATTR}] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        padding: 0 30px;
        border-radius: 999px;
        background: #f5f6f9;
        color: #1f2937;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }

      a[${POSTS_CREATE_BUTTON_ATTR}]:hover {
        background: #eceff4;
      }
    `;

    document.head.appendChild(style);
  }

  function findPostsCollectionTopRow() {
    const main = document.querySelector('main');
    if (!main) return null;

    const heading = Array.from(main.querySelectorAll('h1')).find(element => {
      return normalizeLabelText(element.textContent) === '文章库';
    }) || main.querySelector('h1');

    if (!heading || !heading.parentElement) return null;

    return heading.parentElement;
  }

  function getExistingPostsCreateLink(container) {
    return Array.from(container.querySelectorAll('a')).find(link => {
      if (link.hasAttribute(POSTS_CREATE_BUTTON_ATTR)) return false;

      const href = String(link.getAttribute('href') || link.href || '');
      return href.includes('/collections/posts/new');
    }) || null;
  }

  function ensurePostsCollectionCreateButton() {
    const existingCustomButton = document.querySelector(`[${POSTS_CREATE_BUTTON_ATTR}]`);

    if (!isPostsCollectionPage()) {
      if (existingCustomButton) existingCustomButton.remove();
      return;
    }

    const topRow = findPostsCollectionTopRow();
    if (!topRow) return;

    const currentFolder = getCurrentPostsFolderFromRoute();
    const nextHref = buildAdminHashUrl('/collections/posts/new', {
      path: currentFolder,
    });
    const nextLabel = currentFolder ? '在当前文件夹新建文章' : '新建文章';
    const existingCreateLink = getExistingPostsCreateLink(topRow);

    if (existingCreateLink) {
      existingCreateLink.setAttribute('href', nextHref);
      if (currentFolder) {
        existingCreateLink.textContent = nextLabel;
      }
      if (existingCustomButton) existingCustomButton.remove();
      return;
    }

    ensurePostsCreateButtonStyles();

    const button = existingCustomButton instanceof HTMLAnchorElement
      ? existingCustomButton
      : document.createElement('a');

    button.setAttribute(POSTS_CREATE_BUTTON_ATTR, '1');
    button.setAttribute('href', nextHref);
    button.textContent = nextLabel;

    if (button.parentElement !== topRow) {
      topRow.appendChild(button);
    }
  }

  function findControlInput(labelText) {
    const labels = Array.from(document.querySelectorAll('label[for]'));

    for (const label of labels) {
      const text = normalizeLabelText(label.textContent);
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

  function runPostsEnhancements() {
    bindPostsPathSync();
    ensurePostsCollectionCreateButton();
  }

  function schedulePostsEnhancements() {
    window.requestAnimationFrame(runPostsEnhancements);
  }

  function patchHistoryMethod(methodName) {
    const original = window.history[methodName];
    if (typeof original !== 'function') return;

    window.history[methodName] = function () {
      const result = original.apply(this, arguments);
      schedulePostsEnhancements();
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
  window.addEventListener('popstate', schedulePostsEnhancements);
  window.addEventListener('hashchange', schedulePostsEnhancements);
  window.addEventListener('load', schedulePostsEnhancements);

  const observer = new MutationObserver(schedulePostsEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
